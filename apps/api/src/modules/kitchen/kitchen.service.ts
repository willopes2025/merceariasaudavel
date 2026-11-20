import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  COUNT_SCOPES,
  LOSS_REASONS,
  todayBR,
  type CountScope,
  type CountSheetLine,
  type InventoryCount,
  type InventoryCountInput,
  type InventoryCountLine,
  type InventoryCountRow,
  type LossReason,
  type LossReport,
  type LossReportQuery,
  type Unit,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { applyStock, q3, stockStoreOf, takeStock } from '../products/stock';

const brStart = (iso: string) => new Date(`${iso}T00:00:00-03:00`);
const brEnd = (iso: string) => new Date(brStart(iso).getTime() + 86_400_000);
const money = (v: number) => Math.round(v * 100) / 100;

/**
 * Preparo: contagem dos insumos (fim do dia ou inventário geral) e o
 * relatório de perdas — o que as vendas deveriam ter gastado × o que sumiu.
 */
@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Folha de contagem: os itens com o saldo que o sistema tem agora. */
  async countSheet(ctx: RequestContext, storeId: string, scope: CountScope): Promise<CountSheetLine[]> {
    this.assertStore(ctx, storeId);
    const realStore = await stockStoreOf(this.prisma as unknown as Prisma.TransactionClient, storeId);
    const where: Prisma.ProductWhereInput = { tenantId: ctx.tenantId, active: true, trackStock: true };
    // Insumos = o que é insumo ou entra em alguma ficha técnica (o whey vendido em pote também serve no shake).
    if (scope === 'insumos') where.OR = [{ kind: 'insumo' }, { usedIn: { some: {} } }];
    const rows = await this.prisma.product.findMany({ where, include: { balances: { where: { storeId: realStore } }, category: { select: { name: true } } }, orderBy: [{ name: 'asc' }] });
    return rows.map((p) => ({ productId: p.id, name: p.name, unit: p.unit as Unit, categoryName: p.category?.name ?? null, system: q3(p.balances[0]?.quantity), unitCost: Number(p.cost) }));
  }

  /**
   * Grava a contagem: cada diferença vira movimentação "contagem" (o que faltou
   * sai pelo FEFO dos lotes) e o valor fica registrado como perda de contagem.
   */
  async saveCount(ctx: RequestContext, input: InventoryCountInput): Promise<InventoryCount> {
    this.assertStore(ctx, input.storeId);
    if (!(await this.prisma.store.count({ where: { id: input.storeId, tenantId: ctx.tenantId } }))) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    const ids = input.lines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) throw new DomainError('DUPLICATE_LINE', 'O mesmo produto apareceu duas vezes na contagem.');
    const products = await this.prisma.product.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId, trackStock: true } });
    if (products.length !== ids.length) throw new DomainError('PRODUCT_NOT_FOUND', 'Um dos itens não foi encontrado ou não controla estoque.');

    const id = await this.prisma.$transaction(
      async (tx) => {
        const realStore = await stockStoreOf(tx, input.storeId);
        // A contagem é gravada de uma vez no fim (a tabela não aceita alteração).
        const count = { id: randomUUID() };
        const lines: InventoryCountLine[] = [];
        let diffCents = 0;
        for (const l of input.lines) {
          const p = products.find((x) => x.id === l.productId)!;
          await tx.$queryRaw`SELECT id FROM product WHERE id = ${p.id} FOR UPDATE`;
          const bal = await tx.stockBalance.findUnique({ where: { productId_storeId: { productId: p.id, storeId: realStore } } });
          const system = q3(bal?.quantity);
          const diff = q3(l.counted - system);
          const cost = Number(p.cost);
          const base = { tenantId: ctx.tenantId, productId: p.id, storeId: realStore, type: 'contagem', userId: ctx.userId, countId: count.id, unitCost: cost, note: `Contagem (${COUNT_SCOPES[input.scope].split(' (')[0]})` };
          if (diff < 0) await takeStock(tx, base, -diff, { trackLots: p.trackLots });
          else if (diff > 0) await applyStock(tx, { ...base, delta: diff });
          const value = money(diff * cost);
          diffCents += Math.round(value * 100);
          lines.push({ productId: p.id, name: p.name, unit: p.unit as Unit, system, counted: l.counted, diff, value });
        }
        await tx.inventoryCount.create({ data: { id: count.id, tenantId: ctx.tenantId, storeId: realStore, scope: input.scope, day: new Date(`${todayBR()}T00:00:00Z`), lines: lines as unknown as Prisma.InputJsonValue, diffValue: diffCents / 100, userId: ctx.userId } });
        return count.id;
      },
      { timeout: 60_000, maxWait: 10_000 },
    );
    const saved = await this.getCount(ctx, id);
    await this.audit.record(ctx, 'stock.count', 'inventory_count', id, { scope: input.scope, items: saved.lines.length, diffValue: saved.diffValue });
    return saved;
  }

  async getCount(ctx: RequestContext, id: string): Promise<InventoryCount> {
    const c = await this.prisma.inventoryCount.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!c) throw new NotFoundError('contagem', id);
    const [store, user] = await Promise.all([
      this.prisma.store.findUnique({ where: { id: c.storeId }, select: { name: true } }),
      this.prisma.appUser.findUnique({ where: { id: c.userId }, select: { name: true } }),
    ]);
    return { id: c.id, storeName: store?.name ?? '', scope: c.scope as CountScope, day: c.day.toISOString().slice(0, 10), userName: user?.name ?? null, diffValue: Number(c.diffValue), lines: c.lines as unknown as InventoryCountLine[], createdAt: c.createdAt.toISOString() };
  }

  async counts(ctx: RequestContext): Promise<InventoryCountRow[]> {
    const rows = await this.prisma.inventoryCount.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 60 });
    const [stores, users] = await Promise.all([
      this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      rows.length ? this.prisma.appUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } }) : [],
    ]);
    return rows.map((r) => ({
      id: r.id,
      storeName: stores.find((s) => s.id === r.storeId)?.name ?? '',
      scope: r.scope as CountScope,
      day: r.day.toISOString().slice(0, 10),
      userName: users.find((u) => u.id === r.userId)?.name ?? null,
      items: Array.isArray(r.lines) ? r.lines.length : 0,
      diffValue: Number(r.diffValue),
      createdAt: r.createdAt.toISOString(),
    }));
  }

  /** Perdas do período + margem de cada preparado pela ficha técnica. */
  async lossReport(ctx: RequestContext, q: LossReportQuery): Promise<LossReport> {
    if (q.storeId) this.assertStore(ctx, q.storeId);
    const store = q.storeId ? await stockStoreOf(this.prisma as unknown as Prisma.TransactionClient, q.storeId) : null;
    const from = brStart(q.from);
    const to = brEnd(q.to);
    const storeFilter = store ? Prisma.sql`AND m.store_id = ${store}` : Prisma.empty;
    const moves = await this.prisma.$queryRaw<Array<{ product_id: string; type: string; reason: string | null; qty: Prisma.Decimal; value: Prisma.Decimal }>>`
      SELECT m.product_id, m.type, m.reason, SUM(m.delta) AS qty, SUM(m.delta * m.unit_cost) AS value
        FROM stock_movement m
       WHERE m.tenant_id = ${ctx.tenantId} AND m.created_at >= ${from} AND m.created_at < ${to}
         AND m.type IN ('perda', 'contagem', 'consumo', 'consumo_estorno') ${storeFilter}
       GROUP BY m.product_id, m.type, m.reason`;
    const productIds = [...new Set(moves.map((m) => m.product_id))];
    const products = productIds.length ? await this.prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, unit: true, kind: true, cost: true } }) : [];

    const byReason = new Map<string, number>();
    const byProduct = new Map<string, { expectedUse: number; lossQty: number; countMissing: number; value: number; expectedValue: number }>();
    const get = (id: string) => byProduct.get(id) ?? byProduct.set(id, { expectedUse: 0, lossQty: 0, countMissing: 0, value: 0, expectedValue: 0 }).get(id)!;
    for (const m of moves) {
      const qty = Number(m.qty);
      const value = Number(m.value);
      const row = get(m.product_id);
      if (m.type === 'consumo' || m.type === 'consumo_estorno') {
        row.expectedUse += -qty;
        row.expectedValue += -value;
      } else if (m.type === 'perda') {
        row.lossQty += -qty;
        row.value += -value;
        byReason.set(m.reason ?? 'outro', (byReason.get(m.reason ?? 'outro') ?? 0) + -value);
      } else {
        // Contagem: sobra compensa falta do mesmo produto.
        row.countMissing += -qty;
        row.value += -value;
        byReason.set('contagem', (byReason.get('contagem') ?? 0) + -value);
      }
    }
    const lines = [...byProduct.entries()]
      .map(([id, r]) => {
        const p = products.find((x) => x.id === id);
        return {
          productId: id,
          name: p?.name ?? '—',
          unit: (p?.unit ?? 'UN') as Unit,
          expectedUse: q3(r.expectedUse),
          lossQty: q3(r.lossQty),
          countMissing: q3(r.countMissing),
          value: money(r.value),
          pct: r.expectedUse > 0 ? Math.round(((r.lossQty + r.countMissing) / r.expectedUse) * 1000) / 10 : null,
          expectedValue: r.expectedValue,
          kind: p?.kind,
        };
      })
      .filter((l) => l.lossQty !== 0 || l.countMissing !== 0 || l.expectedUse !== 0)
      .sort((a, b) => b.value - a.value);
    const insumoLoss = lines.filter((l) => l.kind === 'insumo' || l.expectedUse > 0).reduce((s, l) => s + Math.max(0, l.value), 0);
    const insumoUse = lines.reduce((s, l) => s + Math.max(0, l.expectedValue), 0);

    // Margem dos preparados: ficha técnica × preço, e quanto vendeu no período.
    const recipes = await this.prisma.product.findMany({ where: { tenantId: ctx.tenantId, kind: 'preparado', active: true }, include: { recipe: { include: { ingredient: { select: { cost: true } } } } }, orderBy: { name: 'asc' } });
    const sold = recipes.length
      ? await this.prisma.$queryRaw<Array<{ product_id: string; qty: Prisma.Decimal }>>`
          SELECT i.product_id, SUM(i.quantity) AS qty FROM sale_item i JOIN sale s ON s.id = i.sale_id
           WHERE s.tenant_id = ${ctx.tenantId} AND s.status = 'completed' AND s.created_at >= ${from} AND s.created_at < ${to}
             ${q.storeId ? Prisma.sql`AND s.store_id = ${q.storeId}` : Prisma.empty}
             AND i.kind = 'preparado' GROUP BY i.product_id`
      : [];
    return {
      from: q.from,
      to: q.to,
      totalValue: money(lines.reduce((s, l) => s + Math.max(0, l.value), 0)),
      insumoLossPct: insumoUse + insumoLoss > 0 ? Math.round((insumoLoss / (insumoUse + insumoLoss)) * 1000) / 10 : 0,
      byReason: [...byReason.entries()]
        .map(([reason, value]) => ({ reason: reason as LossReason | 'contagem', label: reason === 'contagem' ? 'Diferença na contagem' : (LOSS_REASONS[reason as LossReason] ?? reason), value: money(value) }))
        .filter((r) => r.value !== 0)
        .sort((a, b) => b.value - a.value),
      byProduct: lines.map(({ expectedValue: _e, kind: _k, ...l }) => l),
      recipes: recipes.map((r) => {
        const cost = money(r.recipe.reduce((s, i) => s + Number(i.quantity) * Number(i.ingredient.cost), 0));
        const price = Number(r.price);
        const memberPrice = r.memberPrice == null ? null : Number(r.memberPrice);
        return {
          productId: r.id,
          name: r.name,
          price,
          memberPrice,
          cost,
          margin: price > 0 ? Math.round(((price - cost) / price) * 1000) / 10 : 0,
          memberMargin: memberPrice ? Math.round(((memberPrice - cost) / memberPrice) * 1000) / 10 : null,
          sold: q3(sold.find((s) => s.product_id === r.id)?.qty),
        };
      }),
    };
  }

  private assertStore(ctx: RequestContext, storeId: string) {
    if (!canUseStore(ctx, storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
  }
}
