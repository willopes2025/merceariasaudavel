import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { ALL_PERMISSIONS, saleCreateSchema, type IfoodOrderRow, type IfoodStatus, type OrderItem } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runWithContextScope, setContext, type RequestContext } from '../../common/tenancy/request-context';
import { orderNumber, SalesService } from '../sales/sales.service';
import { ifoodApi, ifoodTeste, type IfoodAction, type IfoodApi, type IfoodItem, type IfoodOrderData } from './ifood.api';

const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const curto = (e: unknown) => ((e as Error).message ?? 'erro').slice(0, 300);
/** Andamento na tela de preparo → aviso para o iFood. */
const AVISO: Record<string, IfoodAction> = { preparando: 'startPreparation', pronto: 'readyToPickup', entregue: 'dispatch' };

/**
 * Integração com o iFood: a cada 30 segundos busca os eventos, traz o pedido novo para a tela de preparo,
 * registra a venda no canal iFood e avisa o iFood do andamento. As chaves ficam só no .env do servidor:
 *   IFOOD_CLIENT_ID, IFOOD_CLIENT_SECRET, IFOOD_MERCHANT_ID  (e IFOOD_STORE_ID se houver mais de uma loja)
 * Os produtos são reconhecidos pelo "código PDV" do cardápio do iFood, que tem de ser o código (ou o código de
 * barras) do produto no sistema.
 */
@Injectable()
export class IfoodService {
  private readonly logger = new Logger('iFood');
  readonly api: IfoodApi | null;
  private rodando = false;
  private lastPollAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly audit: AuditService,
  ) {
    const env = (k: string) => process.env[k]?.trim() || undefined;
    if (env('IFOOD_PROVIDER') === 'teste') this.api = ifoodTeste();
    else this.api = env('IFOOD_CLIENT_ID') && env('IFOOD_CLIENT_SECRET') && env('IFOOD_MERCHANT_ID') ? ifoodApi(env('IFOOD_CLIENT_ID')!, env('IFOOD_CLIENT_SECRET')!, env('IFOOD_MERCHANT_ID')!) : null;
    this.logger.log(this.api ? `ligado (${this.api.kind})` : 'desligado (sem chaves no .env)');
  }

  /** Loja que recebe os pedidos: a do .env ou a primeira ativa. */
  private async loja() {
    const id = process.env.IFOOD_STORE_ID?.trim();
    return this.prisma.store.findFirst({ where: id ? { id } : { active: true }, orderBy: { createdAt: 'asc' }, select: { id: true, tenantId: true, name: true } });
  }

  @Cron('*/30 * * * * *')
  async tick() {
    if (!this.api || this.rodando) return;
    this.rodando = true;
    try {
      const loja = await this.loja();
      if (!loja) return;
      await runWithContextScope(async () => {
        setContext({ tenantId: loja.tenantId, userId: '', storeIds: [], permissions: [...ALL_PERMISSIONS] } as RequestContext);
        const eventos = await this.api!.poll();
        for (const e of eventos) {
          try {
            if (e.code === 'PLC') await this.importar(loja, e.orderId);
            else if (e.code === 'CAN') await this.cancelado(e.orderId);
            else if (e.code === 'CON') await this.prisma.ifoodOrder.updateMany({ where: { ifoodId: e.orderId, status: 'importado' }, data: { status: 'concluido' } });
          } catch (err) {
            this.logger.error(`evento ${e.code} do pedido ${e.orderId}: ${curto(err)}`);
          }
        }
        await this.api!.ack(eventos.map((e) => e.id));
        await this.pendencias(loja);
        await this.avisar(loja.tenantId);
      });
      this.lastPollAt = new Date();
      this.lastError = null;
    } catch (e) {
      this.lastError = curto(e);
      this.logger.warn(`falha na busca: ${this.lastError}`);
    } finally {
      this.rodando = false;
    }
  }

  /** Liga cada item ao produto pelo código PDV (código ou código de barras). */
  private async reconhecer(tenantId: string, itens: IfoodItem[]) {
    const codigos = [...new Set(itens.map((i) => (i.externalCode ?? '').trim()).filter(Boolean))];
    const produtos = codigos.length ? await this.prisma.product.findMany({ where: { tenantId, active: true, OR: [{ sku: { in: codigos } }, { barcode: { in: codigos } }] }, select: { id: true, sku: true, barcode: true } }) : [];
    return itens.map((i) => {
      const c = (i.externalCode ?? '').trim();
      return { item: i, productId: c ? (produtos.find((p) => p.sku === c || p.barcode === c)?.id ?? null) : null };
    });
  }

  private async importar(loja: { id: string; tenantId: string }, ifoodId: string) {
    if (await this.prisma.ifoodOrder.count({ where: { ifoodId } })) return;
    const o = await this.api!.order(ifoodId);
    const linha = await this.prisma.ifoodOrder.create({
      data: { tenantId: loja.tenantId, storeId: loja.id, ifoodId, displayId: o.displayId ?? '', customerName: o.customer?.name ?? '', total: o.total?.orderAmount ?? 0, payload: o as unknown as Prisma.InputJsonValue },
    });
    // Aceita no iFood de qualquer jeito: sem confirmar em poucos minutos o iFood cancela o pedido.
    await this.api!.action(ifoodId, 'confirm').catch((e) => this.logger.warn(`pedido ${o.displayId}: não confirmou no iFood (${curto(e)})`));
    await this.criarPedido(linha.id);
  }

  /** Cria o pedido da tela de preparo a partir do pedido do iFood. Falhou = fica "sem cadastro", com o motivo. */
  private async criarPedido(id: string) {
    const linha = await this.prisma.ifoodOrder.findUniqueOrThrow({ where: { id } });
    const o = linha.payload as unknown as IfoodOrderData;
    const itens = await this.reconhecer(linha.tenantId, o.items ?? []);
    const faltam = itens.filter((i) => !i.productId).map((i) => i.item.name);
    try {
      if (!itens.length) throw new Error('O pedido veio sem itens.');
      if (faltam.length) throw new Error(`Sem produto com o código PDV do iFood: ${faltam.join(', ')}.`);
      const entregaDaLoja = o.orderType === 'DELIVERY' && o.delivery?.deliveredBy === 'MERCHANT';
      const taxa = entregaDaLoja ? r2(o.total?.deliveryFee ?? 0) : 0;
      const linhas = itens.map((i) => ({ productId: i.productId!, quantity: i.item.quantity, options: [] }));
      const quote = await this.sales.estimate(linha.tenantId, { storeId: linha.storeId, items: linhas, discount: 0, useCashback: 0, deliveryFee: taxa, couponCode: null });
      const obs = [
        ...itens.flatMap((i) => [...(i.item.options ?? []).map((op) => `${i.item.name}: ${op.quantity && op.quantity > 1 ? `${op.quantity}x ` : ''}${op.name}`), ...(i.item.observations ? [`${i.item.name}: ${i.item.observations}`] : [])]),
        ...(o.extraInfo ? [o.extraInfo] : []),
      ].join(' | ');
      const end = o.delivery?.deliveryAddress;
      const orderId = await this.prisma.$transaction(async (tx) => {
        const criado = await tx.order.create({
          data: {
            tenantId: linha.tenantId,
            storeId: linha.storeId,
            number: await orderNumber(tx, linha.tenantId),
            channel: 'ifood',
            status: 'aguardando_pagamento',
            callName: `iFood ${o.displayId ?? ''} ${(o.customer?.name ?? '').split(' ')[0] ?? ''}`.trim().slice(0, 60),
            items: quote.items.map((l): OrderItem => ({ productId: l.productId, description: l.description, kind: l.kind, unit: l.unit, quantity: l.quantity, options: l.options })) as unknown as Prisma.InputJsonValue,
            estimate: quote.total,
            notes: obs.slice(0, 500) || null,
            paymentNote: 'Pago pelo iFood',
            ...(entregaDaLoja ? { fulfillment: 'entrega', deliveryFee: taxa, address: { street: end?.streetName ?? end?.formattedAddress ?? '', number: end?.streetNumber ?? '', complement: end?.complement ?? '', neighborhood: end?.neighborhood ?? '', reference: end?.reference ?? '' } } : {}),
          },
        });
        await tx.ifoodOrder.update({ where: { id }, data: { status: 'importado', orderId: criado.id, localTotal: quote.total, problem: null } });
        return criado.id;
      });
      await this.registrarVenda(id, orderId);
    } catch (e) {
      await this.prisma.ifoodOrder.update({ where: { id }, data: { status: 'sem_cadastro', problem: curto(e) } });
      this.logger.warn(`pedido iFood ${linha.displayId}: ${curto(e)}`);
    }
  }

  /** Venda no canal iFood, em nome de quem abriu o caixa. Caixa fechado = tenta de novo a cada busca. */
  private async registrarVenda(id: string, orderId: string) {
    const linha = await this.prisma.ifoodOrder.findUniqueOrThrow({ where: { id } });
    const pedido = await this.prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (pedido.status !== 'aguardando_pagamento') return;
    try {
      const caixa = await this.prisma.cashSession.findFirst({ where: { tenantId: linha.tenantId, storeId: linha.storeId, status: 'open' }, select: { openedById: true } });
      if (!caixa) throw new Error('Caixa fechado: a venda entra sozinha quando o caixa abrir.');
      const metodo = await this.prisma.paymentMethod.upsert({ where: { tenantId_name: { tenantId: linha.tenantId, name: 'iFood' } }, create: { tenantId: linha.tenantId, name: 'iFood', kind: 'outro', settleDays: 30 }, update: {} });
      if (!metodo.active) throw new Error('A forma de pagamento "iFood" está desativada.');
      const ctx: RequestContext = { tenantId: linha.tenantId, userId: caixa.openedById, storeIds: [], permissions: [...ALL_PERMISSIONS] };
      const input = saleCreateSchema.parse({
        storeId: linha.storeId,
        customerId: null,
        items: (pedido.items as unknown as OrderItem[]).map((i) => ({ productId: i.productId, quantity: i.quantity, options: [] })),
        discount: 0,
        useCashback: 0,
        deliveryFee: 0,
        channel: 'ifood',
        orderId,
        payments: [{ methodId: metodo.id, amount: num(pedido.estimate) }],
        emitNfce: true,
      });
      await this.sales.create(ctx, input);
      await this.prisma.ifoodOrder.update({ where: { id }, data: { problem: null } });
    } catch (e) {
      await this.prisma.ifoodOrder.update({ where: { id }, data: { problem: `Venda não registrada: ${curto(e)}` } });
    }
  }

  /** Pedidos que ficaram sem venda (caixa estava fechado) tentam de novo. */
  private async pendencias(loja: { tenantId: string }) {
    const rows = await this.prisma.ifoodOrder.findMany({ where: { tenantId: loja.tenantId, status: 'importado', orderId: { not: null }, problem: { startsWith: 'Venda não registrada' }, createdAt: { gte: new Date(Date.now() - 24 * 3_600_000) } }, select: { id: true, orderId: true }, take: 50 });
    for (const r of rows) await this.registrarVenda(r.id, r.orderId!);
  }

  /** Avisa o iFood quando o pedido anda na tela de preparo. */
  private async avisar(tenantId: string) {
    const rows = await this.prisma.$queryRaw<Array<{ id: string; ifood_id: string; status: string; synced_status: string | null }>>`
      SELECT i.id, i.ifood_id, o.status, i.synced_status FROM ifood_order i JOIN "order" o ON o.id = i.order_id
       WHERE i.tenant_id = ${tenantId} AND i.status = 'importado' AND o.status IN ('preparando', 'pronto', 'entregue')
         AND i.synced_status IS DISTINCT FROM o.status AND i.created_at >= now() - interval '2 days'`;
    for (const r of rows) {
      try {
        await this.api!.action(r.ifood_id, AVISO[r.status]!);
        await this.prisma.ifoodOrder.update({ where: { id: r.id }, data: { syncedStatus: r.status } });
      } catch (e) {
        this.logger.warn(`não avisou o iFood (${r.status}): ${curto(e)}`);
      }
    }
  }

  private async cancelado(ifoodId: string) {
    const linha = await this.prisma.ifoodOrder.findUnique({ where: { ifoodId } });
    if (!linha) return;
    const pedido = linha.orderId ? await this.prisma.order.findUnique({ where: { id: linha.orderId }, select: { id: true, status: true, saleId: true } }) : null;
    let problema: string | null = null;
    if (pedido && !['entregue', 'cancelado'].includes(pedido.status)) {
      await this.prisma.order.update({ where: { id: pedido.id }, data: { status: 'cancelado', canceledAt: new Date(), cancelReason: 'Cancelado no iFood' } });
    }
    if (pedido?.saleId) {
      const venda = await this.prisma.sale.findUnique({ where: { id: pedido.saleId }, select: { number: true, status: true } });
      if (venda?.status === 'completed') problema = `Cancelado no iFood: cancele a venda nº ${venda.number} para devolver o estoque.`;
    }
    await this.prisma.ifoodOrder.update({ where: { id: linha.id }, data: { status: 'cancelado', problem: problema } });
  }

  // ───────────── Tela ─────────────

  async status(ctx: RequestContext): Promise<IfoodStatus> {
    const loja = this.api ? await this.loja() : null;
    const rows = await this.prisma.ifoodOrder.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
    const pedidos = await this.prisma.order.findMany({ where: { id: { in: rows.map((r) => r.orderId).filter((x): x is string => !!x) } }, select: { id: true, status: true, number: true, sale: { select: { number: true } } } });
    const orders: IfoodOrderRow[] = [];
    for (const r of rows) {
      const o = r.payload as unknown as IfoodOrderData;
      const itens = await this.reconhecer(ctx.tenantId, o.items ?? []);
      const p = pedidos.find((x) => x.id === r.orderId);
      orders.push({
        id: r.id,
        displayId: r.displayId,
        status: r.status as IfoodOrderRow['status'],
        customerName: r.customerName,
        createdAt: r.createdAt.toISOString(),
        total: num(r.total),
        localTotal: r.localTotal == null ? null : num(r.localTotal),
        items: itens.map((i) => ({ name: i.item.name, quantity: i.item.quantity, code: i.item.externalCode ?? null, matched: !!i.productId })),
        delivery: o.orderType === 'DELIVERY' ? (o.delivery?.deliveredBy === 'MERCHANT' ? 'Entrega da loja' : 'Entrega do iFood') : 'Retirada',
        orderStatus: p?.status ?? null,
        orderNumber: p?.number ?? null,
        saleNumber: p?.sale?.number ?? null,
        problem: r.problem,
      });
    }
    return { provider: this.api?.kind ?? 'off', storeName: loja?.name ?? null, lastPollAt: this.lastPollAt?.toISOString() ?? null, lastError: this.lastError, orders };
  }

  /** Depois de corrigir o código do produto, tenta importar de novo um pedido que ficou sem cadastro. */
  async retry(ctx: RequestContext, id: string) {
    const r = await this.prisma.ifoodOrder.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw new NotFoundError('pedido do iFood', id);
    if (r.status === 'sem_cadastro') await this.criarPedido(id);
    else if (r.status === 'importado' && r.orderId) await this.registrarVenda(id, r.orderId);
    else throw new DomainError('IFOOD_NOTHING_TO_RETRY', 'Não há o que refazer neste pedido.');
    await this.audit.record(ctx, 'ifood.retry', 'ifood_order', id);
    return { ok: true };
  }
}
