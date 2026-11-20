import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UNITS, kindFromNcm, normalizeText, type Unit, type StockEntryInput, type StockEntryItem, type StockEntryPreview, type StockEntryResult, type StockEntryRow } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, ForbiddenError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { readPurchaseNote, type PurchaseNote } from './nfe-xml';
import { putStock, q3 } from './stock';

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** Unidade da nota → unidade do sistema (PC, PÇ, UND viram UN). */
const unitOf = (u: string | null): Unit => {
  const v = (u ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z]/g, '');
  if (v in UNITS) return v as Unit;
  if (/^(KGS?|QUILO)$/.test(v)) return 'KG';
  if (/^(LT|LTS|LITRO)$/.test(v)) return 'L';
  if (/^(PCTE|PACOTE)$/.test(v)) return 'PCT';
  if (/^(CAIXA|CXA)$/.test(v)) return 'CX';
  return 'UN';
};

/** Entrada de mercadoria pelo XML da nota do fornecedor. */
@Injectable()
export class StockEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Lê a nota e diz, item a item, qual produto do Mercearia corresponde. Não grava nada. */
  async preview(ctx: RequestContext, xml: string): Promise<StockEntryPreview> {
    const note = readPurchaseNote(xml);
    const [already, items] = await Promise.all([this.prisma.stockEntry.count({ where: { tenantId: ctx.tenantId, accessKey: note.accessKey } }), this.match(ctx, note)]);
    return { accessKey: note.accessKey, number: note.number, series: note.series, issuedAt: note.issuedAt, supplier: note.supplier, total: note.total, alreadyImported: already > 0, items, installments: note.installments };
  }

  async confirm(ctx: RequestContext, input: StockEntryInput): Promise<StockEntryResult> {
    const note = readPurchaseNote(input.xml);
    await this.assertStore(ctx, input.storeId);
    const items = await this.match(ctx, note);
    const lines = new Map(input.lines.map((l) => [l.index, l]));
    if (lines.size !== input.lines.length) throw new DomainError('DUPLICATE_LINE', 'O mesmo item da nota apareceu duas vezes.');
    for (const l of input.lines) {
      const item = items[l.index];
      if (!item) throw new DomainError('LINE_NOT_FOUND', `A nota não tem o item ${l.index + 1}.`);
      if (l.action !== 'skip' && item.problem) throw new DomainError('LINE_BLOCKED', `Item ${l.index + 1} (${item.description}): ${item.problem}`);
    }
    if (!input.lines.some((l) => l.action !== 'skip')) throw new DomainError('NOTHING_TO_ENTER', 'Todos os itens estão marcados para ignorar.');

    const label = `NF ${note.number} · ${note.supplier.name}`.slice(0, 120);
    const result: StockEntryResult = { id: '', created: 0, linked: 0, skipped: note.items.length, units: 0, payables: 0 };
    try {
      await this.prisma.$transaction(
        async (tx) => {
          // A chave única barra a mesma nota duas vezes, mesmo em dois cliques juntos.
          const summary: Prisma.InputJsonValue[] = [];
          for (const item of items) {
            const l = lines.get(item.index);
            const source = note.items[item.index]!;
            if (!l || l.action === 'skip') {
              summary.push({ code: item.code, description: item.description, action: 'skip' });
              continue;
            }
            let product: { id: string; trackStock: boolean; trackLots: boolean; ncm: string | null; cost: Prisma.Decimal };
            if (l.action === 'link') {
              const found = await tx.product.findFirst({ where: { id: l.productId, tenantId: ctx.tenantId }, select: { id: true, trackStock: true, trackLots: true, ncm: true, cost: true } });
              if (!found) throw new DomainError('PRODUCT_NOT_FOUND', `Item ${item.index + 1}: produto não encontrado.`);
              product = found;
              result.linked++;
            } else {
              const barcode = item.ean;
              if (barcode && (await tx.product.count({ where: { tenantId: ctx.tenantId, barcode } }))) throw new ConflictError('BARCODE_TAKEN', `Item ${item.index + 1}: já existe um produto com o código de barras ${barcode}. Use "Vincular".`);
              product = await tx.product.create({
                data: {
                  tenantId: ctx.tenantId,
                  name: l.name,
                  kind: l.kind,
                  barcode,
                  price: l.price,
                  cost: item.unitCost,
                  trackStock: l.kind !== 'preparado',
                  trackLots: l.kind !== 'preparado' && source.lots.length > 0,
                  sellable: l.kind !== 'insumo',
                  ncm: item.ncm,
                  cest: source.cest,
                  unit: unitOf(item.unit),
                  supplier: note.supplier.name,
                  searchText: normalizeText([l.name, barcode].filter(Boolean).join(' ')),
                },
                select: { id: true, trackStock: true, trackLots: true, ncm: true, cost: true },
              });
              result.created++;
            }
            result.skipped--;
            // Custo passa a ser o da última compra; NCM e unidade só entram se estavam vazios.
            await tx.product.update({
              where: { id: product.id },
              data: { ...(item.unitCost > 0 ? { cost: item.unitCost } : {}), ...(!product.ncm && item.ncm ? { ncm: item.ncm } : {}) },
            });
            if (product.trackStock) {
              const base = { tenantId: ctx.tenantId, productId: product.id, storeId: input.storeId, type: 'entrada', userId: ctx.userId, note: label, unitCost: item.unitCost };
              if (product.trackLots) {
                // Lotes da nota; o que sobrar (ou nota sem lote) entra num lote com o número da nota.
                let left = q3(item.quantity);
                for (const lot of source.lots) {
                  const qty = Math.min(left, q3(lot.quantity));
                  if (qty <= 0) continue;
                  await putStock(tx, base, qty, { code: lot.code, expiresAt: lot.expiresAt });
                  left = q3(left - qty);
                }
                if (left > 0) await putStock(tx, base, left, { code: `NF${note.number}`, expiresAt: null });
              } else {
                await putStock(tx, base, item.quantity, null);
              }
              result.units = q3(result.units + item.quantity);
            }
            // Lembra: da próxima vez este código do fornecedor já vem ligado ao produto.
            const key = { tenantId: ctx.tenantId, supplierDocument: note.supplier.document, supplierCode: item.code };
            await tx.supplierProduct.upsert({ where: { tenantId_supplierDocument_supplierCode: key }, create: { ...key, productId: product.id }, update: { productId: product.id } });
            summary.push({ code: item.code, description: item.description, action: l.action, productId: product.id, quantity: item.quantity, unitCost: item.unitCost });
          }
          if (input.createPayables) {
            for (const [i, d] of note.installments.entries()) {
              const description = `${label}${note.installments.length > 1 ? ` (${i + 1}/${note.installments.length})` : ''}`;
              await tx.payable.create({
                data: { tenantId: ctx.tenantId, storeId: input.storeId, description, supplier: note.supplier.name, category: 'fornecedor', amount: d.amount, dueDate: asDate(d.dueDate), searchText: normalizeText(description), createdById: ctx.userId },
              });
              result.payables++;
            }
          }
          const entry = await tx.stockEntry.create({
            data: {
              tenantId: ctx.tenantId,
              storeId: input.storeId,
              accessKey: note.accessKey,
              number: note.number,
              series: note.series,
              supplierName: note.supplier.name,
              supplierDocument: note.supplier.document,
              issuedAt: asDate(note.issuedAt),
              total: note.total,
              lines: summary,
              userId: ctx.userId,
            },
          });
          result.id = entry.id;
        },
        { timeout: 120_000, maxWait: 10_000 },
      );
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('ENTRY_ALREADY_DONE', 'Essa nota já deu entrada no estoque.');
      throw e;
    }
    await this.audit.record(ctx, 'stock.entry_xml', 'stock_entry', result.id, { number: note.number, supplier: note.supplier.name, created: result.created, linked: result.linked, units: result.units, payables: result.payables });
    return result;
  }

  async list(ctx: RequestContext): Promise<StockEntryRow[]> {
    const rows = await this.prisma.stockEntry.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 50 });
    if (!rows.length) return [];
    const [stores, users] = await Promise.all([
      this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      this.prisma.appUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } }),
    ]);
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      supplierName: r.supplierName,
      storeName: stores.find((s) => s.id === r.storeId)?.name ?? '',
      issuedAt: r.issuedAt.toISOString().slice(0, 10),
      total: Number(r.total),
      createdAt: r.createdAt.toISOString(),
      userName: users.find((u) => u.id === r.userId)?.name ?? null,
    }));
  }

  /** Liga cada item da nota a um produto: primeiro pelo que foi lembrado, depois pelo código de barras. */
  private async match(ctx: RequestContext, note: PurchaseNote): Promise<StockEntryItem[]> {
    const eans = [...new Set(note.items.map((i) => i.ean).filter((v): v is string => Boolean(v)))];
    const [memory, byEan] = await Promise.all([
      this.prisma.supplierProduct.findMany({ where: { tenantId: ctx.tenantId, supplierDocument: note.supplier.document, supplierCode: { in: note.items.map((i) => i.code) } } }),
      eans.length ? this.prisma.product.findMany({ where: { tenantId: ctx.tenantId, barcode: { in: eans } }, select: { id: true, name: true, sku: true, barcode: true } }) : [],
    ]);
    const remembered = memory.length ? await this.prisma.product.findMany({ where: { tenantId: ctx.tenantId, id: { in: memory.map((m) => m.productId) } }, select: { id: true, name: true, sku: true } }) : [];
    return note.items.map((i) => {
      const mem = memory.find((m) => m.supplierCode === i.code);
      const viaMemory = mem ? remembered.find((p) => p.id === mem.productId) : undefined;
      const viaEan = i.ean ? byEan.find((p) => p.barcode === i.ean) : undefined;
      const hit = viaMemory ?? viaEan;
      return {
        index: i.index,
        code: i.code,
        ean: i.ean,
        description: i.description,
        ncm: i.ncm,
        unit: i.unit,
        quantity: i.quantity,
        unitCost: i.unitCost,
        total: i.total,
        match: hit ? { productId: hit.id, name: hit.name, sku: hit.sku, via: viaMemory ? 'memoria' : 'codigo' } : null,
        suggestedKind: kindFromNcm(i.ncm),
        lots: i.lots,
        problem: i.quantity > 0 ? null : 'Quantidade zerada na nota.',
      };
    });
  }

  /** A loja existe e a pessoa trabalha em alguma loja que usa aquele estoque. */
  private async assertStore(ctx: RequestContext, storeId: string): Promise<void> {
    const all = await this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, stockStoreId: true } });
    const real = (id: string) => all.find((s) => s.id === id)?.stockStoreId ?? id;
    if (!all.some((s) => s.id === storeId)) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    if (!all.some((s) => real(s.id) === real(storeId) && canUseStore(ctx, s.id))) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
  }
}
