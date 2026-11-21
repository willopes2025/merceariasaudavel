import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PurchaseOrder, PurchaseOrderInput, PurchaseStatus, PurchaseStatusInput, StockIntel, StockIntelQuery, Supplier, SupplierInput, Unit } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { putStock, q3 } from '../products/stock';
import { nextNumber } from '../sales/sales.service';
import { stockIntelligence } from './intelligence';

const orderInclude = { supplier: { select: { name: true, phone: true } } } satisfies Prisma.PurchaseOrderInclude;
type OrderRow = Prisma.PurchaseOrderGetPayload<{ include: typeof orderInclude }>;
type Item = PurchaseOrder['items'][number];

/** Fornecedores, análise do estoque e pedidos de compra. */
@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- fornecedores

  async suppliers(ctx: RequestContext): Promise<Supplier[]> {
    const rows = await this.prisma.supplier.findMany({ where: { tenantId: ctx.tenantId }, include: { _count: { select: { products: true } } }, orderBy: [{ active: 'desc' }, { name: 'asc' }] });
    return rows.map((r) => ({ id: r.id, name: r.name, document: r.document, phone: r.phone, email: r.email, contactName: r.contactName, leadTimeDays: r.leadTimeDays, minOrder: Number(r.minOrder), notes: r.notes, active: r.active, products: r._count.products }));
  }

  async saveSupplier(ctx: RequestContext, id: string | null, input: SupplierInput): Promise<Supplier> {
    if (id && !(await this.prisma.supplier.count({ where: { id, tenantId: ctx.tenantId } }))) throw new NotFoundError('fornecedor', id);
    try {
      const row = id ? await this.prisma.supplier.update({ where: { id }, data: input }) : await this.prisma.supplier.create({ data: { ...input, tenantId: ctx.tenantId } });
      await this.audit.record(ctx, id ? 'supplier.update' : 'supplier.create', 'supplier', row.id, { name: row.name });
      return (await this.suppliers(ctx)).find((s) => s.id === row.id)!;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('SUPPLIER_DOCUMENT_TAKEN', 'Já existe um fornecedor com esse CNPJ/CPF.');
      throw e;
    }
  }

  // ---------------------------------------------------------------- análise

  intelligence(ctx: RequestContext, q: StockIntelQuery): Promise<StockIntel> {
    this.assertStore(ctx, q.storeId);
    return stockIntelligence(this.prisma as unknown as Prisma.TransactionClient, ctx.tenantId, q);
  }

  // ---------------------------------------------------------------- pedidos

  async orders(ctx: RequestContext, status?: string): Promise<PurchaseOrder[]> {
    const rows = await this.prisma.purchaseOrder.findMany({
      where: { tenantId: ctx.tenantId, ...(status && status !== 'todos' ? { status } : {}), ...(ctx.storeIds.length ? { storeId: { in: ctx.storeIds } } : {}) },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return this.toOrders(rows);
  }

  async order(ctx: RequestContext, id: string): Promise<PurchaseOrder> {
    const row = await this.prisma.purchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: orderInclude });
    if (!row || !canUseStore(ctx, row.storeId)) throw new NotFoundError('pedido de compra', id);
    return (await this.toOrders([row]))[0]!;
  }

  /** Cria (rascunho) ou altera um rascunho. */
  async saveOrder(ctx: RequestContext, id: string | null, input: PurchaseOrderInput): Promise<PurchaseOrder> {
    this.assertStore(ctx, input.storeId);
    if (!(await this.prisma.supplier.count({ where: { id: input.supplierId, tenantId: ctx.tenantId } }))) throw new DomainError('SUPPLIER_NOT_FOUND', 'Fornecedor não encontrado.');
    const ids = [...new Set(input.items.map((i) => i.productId))];
    if (ids.length !== input.items.length) throw new DomainError('PRODUCT_REPEATED', 'O mesmo produto aparece duas vezes no pedido.');
    const products = await this.prisma.product.findMany({ where: { tenantId: ctx.tenantId, id: { in: ids } }, select: { id: true, name: true, unit: true, kind: true } });
    if (products.length !== ids.length) throw new DomainError('PRODUCT_NOT_FOUND', 'Um dos produtos não foi encontrado.');
    if (products.some((p) => p.kind === 'preparado')) throw new DomainError('PRODUCT_PREPARED', 'Preparado não se compra: compre os insumos dele.');
    const items: Item[] = input.items.map((i) => {
      const p = products.find((x) => x.id === i.productId)!;
      return { productId: p.id, name: p.name, unit: p.unit as Unit, quantity: q3(i.quantity), unitCost: Math.round(i.unitCost * 10000) / 10000, total: Math.round(i.quantity * i.unitCost * 100) / 100 };
    });
    const total = Math.round(items.reduce((s, i) => s + i.total, 0) * 100) / 100;
    const data = { storeId: input.storeId, supplierId: input.supplierId, items: items as unknown as Prisma.InputJsonValue, total, notes: input.notes, expectedOn: input.expectedOn ? new Date(`${input.expectedOn}T00:00:00Z`) : null };
    let savedId: string;
    if (id) {
      const changed = await this.prisma.purchaseOrder.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'rascunho' }, data });
      if (!changed.count) throw new ConflictError('PURCHASE_NOT_DRAFT', 'Só dá para mudar pedido em rascunho.');
      savedId = id;
    } else {
      savedId = await this.prisma.$transaction(async (tx) => (await tx.purchaseOrder.create({ data: { ...data, tenantId: ctx.tenantId, number: await nextNumber(tx, ctx.tenantId, 'purchase'), createdById: ctx.userId } })).id);
    }
    await this.audit.record(ctx, id ? 'purchase.update' : 'purchase.create', 'purchase_order', savedId, { total, items: items.length });
    return this.order(ctx, savedId);
  }

  /**
   * Enviado (conta como "já pedido" na sugestão), recebido (pode dar entrada
   * no estoque com as quantidades e custos do pedido) ou cancelado.
   */
  async setStatus(ctx: RequestContext, id: string, input: PurchaseStatusInput & { addStock?: boolean }): Promise<PurchaseOrder> {
    const current = await this.order(ctx, id);
    const allowed: Record<PurchaseStatus, PurchaseStatus[]> = { rascunho: ['enviado', 'cancelado'], enviado: ['recebido', 'cancelado'], recebido: [], cancelado: [] };
    if (!allowed[current.status].includes(input.status)) throw new ConflictError('PURCHASE_STATUS', `Pedido "${current.status}" não pode virar "${input.status}".`);
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.purchaseOrder.updateMany({
        where: { id, tenantId: ctx.tenantId, status: current.status },
        data: { status: input.status, ...(input.status === 'enviado' ? { sentAt: now } : input.status === 'recebido' ? { receivedAt: now } : { canceledAt: now }) },
      });
      if (!changed.count) throw new ConflictError('PURCHASE_CHANGED', 'O pedido mudou enquanto isso. Atualize.');
      if (input.status === 'recebido' && input.addStock) {
        const products = await tx.product.findMany({ where: { tenantId: ctx.tenantId, id: { in: current.items.map((i) => i.productId) } }, select: { id: true, trackStock: true, trackLots: true } });
        for (const i of current.items) {
          const p = products.find((x) => x.id === i.productId);
          if (!p?.trackStock) continue;
          const base = { tenantId: ctx.tenantId, productId: p.id, storeId: current.storeId, type: 'entrada', userId: ctx.userId, note: `Pedido de compra nº ${current.number} · ${current.supplierName}`.slice(0, 120), unitCost: i.unitCost };
          await putStock(tx, base, i.quantity, p.trackLots ? { code: `PC${current.number}`, expiresAt: null } : null);
          if (i.unitCost > 0) await tx.product.update({ where: { id: p.id }, data: { cost: i.unitCost } });
        }
      }
    });
    await this.audit.record(ctx, `purchase.${input.status}`, 'purchase_order', id, { number: current.number, addStock: Boolean(input.addStock) });
    return this.order(ctx, id);
  }

  private async toOrders(rows: OrderRow[]): Promise<PurchaseOrder[]> {
    const userIds = [...new Set(rows.map((r) => r.createdById))];
    const users = userIds.length ? await this.prisma.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
    return rows.map((r) => ({
      id: r.id,
      number: r.number,
      storeId: r.storeId,
      supplierId: r.supplierId,
      supplierName: r.supplier.name,
      supplierPhone: r.supplier.phone,
      status: r.status as PurchaseStatus,
      items: r.items as unknown as Item[],
      total: Number(r.total),
      notes: r.notes,
      expectedOn: r.expectedOn?.toISOString().slice(0, 10) ?? null,
      createdAt: r.createdAt.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
      receivedAt: r.receivedAt?.toISOString() ?? null,
      createdByName: users.find((u) => u.id === r.createdById)?.name ?? null,
    }));
  }

  private assertStore(ctx: RequestContext, storeId: string) {
    if (!canUseStore(ctx, storeId)) throw new DomainError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.', undefined, 403);
  }
}
