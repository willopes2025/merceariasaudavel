import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  memberLookupKey,
  type ChosenOption,
  type Order,
  type OrderAdvanceInput,
  type OrderChannel,
  type OrderItem,
  type OrderStatus,
  type PickupBoard,
  type SaleLineInput,
  type ShopOrderInput,
  type TotemOrderInput,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { orderNumber, SalesService } from '../sales/sales.service';

const ACTIVE: OrderStatus[] = ['na_fila', 'preparando', 'pronto'];
/** Pedido do app/totem que ninguém pagou some da fila do caixa depois disso. */
const UNPAID_HOURS = 3;
/** Por cliente: pedidos esperando pagamento ao mesmo tempo. */
const MAX_PENDING_PER_CUSTOMER = 3;

const include = {
  customer: { select: { name: true } },
  sale: { select: { number: true } },
} satisfies Prisma.OrderInclude;
type Row = Prisma.OrderGetPayload<{ include: typeof include }>;

export interface ShopPlace {
  tenantId: string;
  storeId: string | null;
}

/**
 * Pedidos: nascem no app, no totem ou no balcão; app e totem pagam no caixa
 * (SalesService.create com orderId leva o pedido para a fila). A tela de
 * preparo anda com o pedido: na fila → preparando → pronto → entregue.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger('Pedidos');

  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- equipe

  /** Tela de preparo: o que está na fila, preparando e pronto (mais antigos primeiro). */
  async board(ctx: RequestContext, storeId: string): Promise<Order[]> {
    this.assertStore(ctx, storeId);
    const since = new Date(Date.now() - 20 * 60_000);
    const rows = await this.prisma.order.findMany({
      where: { tenantId: ctx.tenantId, storeId, OR: [{ status: { in: ACTIVE } }, { status: 'entregue', deliveredAt: { gte: since } }] },
      include,
      orderBy: [{ paidAt: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    return rows.map(toOrder);
  }

  /** Caixa: pedidos do app/totem esperando pagamento. */
  async pending(ctx: RequestContext, storeId: string): Promise<Order[]> {
    this.assertStore(ctx, storeId);
    const rows = await this.prisma.order.findMany({
      where: { tenantId: ctx.tenantId, storeId, status: 'aguardando_pagamento', createdAt: { gte: this.unpaidLimit() } },
      include,
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    return rows.map(toOrder);
  }

  async get(ctx: RequestContext, id: string): Promise<Order> {
    const row = await this.prisma.order.findFirst({ where: { id, tenantId: ctx.tenantId }, include });
    if (!row || !canUseStore(ctx, row.storeId)) throw new NotFoundError('pedido', id);
    return toOrder(row);
  }

  /** Anda um passo na tela de preparo (ou pula para pronto/entregue). */
  async advance(ctx: RequestContext, id: string, input: OrderAdvanceInput): Promise<Order> {
    const current = await this.get(ctx, id);
    const order: OrderStatus[] = ['na_fila', 'preparando', 'pronto', 'entregue'];
    const from = order.indexOf(current.status);
    const to = order.indexOf(input.status);
    if (current.status === 'aguardando_pagamento') throw new ConflictError('ORDER_NOT_PAID', 'Esse pedido ainda não foi pago no caixa.');
    if (from < 0 || to <= from) throw new ConflictError('ORDER_STATUS', `O pedido já está "${current.status === 'cancelado' ? 'cancelado' : current.status}".`);
    const now = new Date();
    const data: Prisma.OrderUpdateInput = { status: input.status };
    if (to >= 1 && !current.startedAt) data.startedAt = now;
    if (to >= 2 && !current.readyAt) data.readyAt = now;
    if (to >= 3) data.deliveredAt = now;
    // Só anda se ninguém andou antes (duas telas abertas).
    const changed = await this.prisma.order.updateMany({ where: { id, tenantId: ctx.tenantId, status: current.status }, data: data as Prisma.OrderUpdateManyMutationInput });
    if (!changed.count) throw new ConflictError('ORDER_CHANGED', 'Outra tela já mexeu nesse pedido. Atualize.');
    return this.get(ctx, id);
  }

  /** Cancela pedido que ainda não foi pago (pago se cancela pela venda). */
  async cancel(ctx: RequestContext, id: string, reason: string): Promise<Order> {
    const current = await this.get(ctx, id);
    if (current.status !== 'aguardando_pagamento') throw new ConflictError('ORDER_PAID', current.status === 'cancelado' ? 'Esse pedido já está cancelado.' : 'Pedido pago: cancele a venda dele em Vendas.');
    const changed = await this.prisma.order.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'aguardando_pagamento' }, data: { status: 'cancelado', canceledAt: new Date(), cancelReason: reason } });
    if (!changed.count) throw new ConflictError('ORDER_CHANGED', 'O pedido mudou enquanto isso. Atualize.');
    await this.audit.record(ctx, 'order.cancel', 'order', id, { number: current.number, reason });
    return this.get(ctx, id);
  }

  // ---------------------------------------------------------------- app e totem

  async createFromApp(place: ShopPlace, customerId: string, input: ShopOrderInput): Promise<Order> {
    const storeId = await this.assertOrdering(place);
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId: place.tenantId, active: true } });
    if (!customer) throw new NotFoundError('cliente');
    const open = await this.prisma.order.count({ where: { tenantId: place.tenantId, customerId, status: 'aguardando_pagamento', createdAt: { gte: this.unpaidLimit() } } });
    if (open >= MAX_PENDING_PER_CUSTOMER) throw new DomainError('TOO_MANY_PENDING', 'Você já tem pedidos esperando pagamento. Pague no caixa ou cancele um antes de fazer outro.');
    return this.place(place.tenantId, storeId, 'app', customer.id, customer.name.split(' ')[0]!, input.items, input.notes);
  }

  async createFromTotem(place: ShopPlace, input: TotemOrderInput): Promise<Order> {
    const storeId = await this.assertOrdering(place);
    let customerId: string | null = null;
    if (input.member) {
      const key = memberLookupKey(input.member);
      if (!key) throw new DomainError('MEMBER_INVALID', 'Digite o celular com DDD ou o código do cartão de membro.');
      const c = await this.prisma.customer.findFirst({ where: { tenantId: place.tenantId, active: true, isMember: true, ...('code' in key ? { memberCode: key.code } : { phone: key.phone }) }, select: { id: true } });
      if (!c) throw new DomainError('MEMBER_NOT_FOUND', 'Não achamos esse membro. Confira o número ou faça o pedido sem ele (o caixa acha você na hora de pagar).');
      customerId = c.id;
    }
    return this.place(place.tenantId, storeId, 'totem', customerId, input.callName.split(' ')[0]!.slice(0, 20), input.items, input.notes);
  }

  async mine(place: ShopPlace, customerId: string): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({ where: { tenantId: place.tenantId, customerId, channel: { in: ['app', 'totem'] } }, include, orderBy: { createdAt: 'desc' }, take: 20 });
    return rows.map((r) => this.expired(toOrder(r)));
  }

  async mineOne(place: ShopPlace, customerId: string, id: string): Promise<Order> {
    const row = await this.prisma.order.findFirst({ where: { id, tenantId: place.tenantId, customerId }, include });
    if (!row) throw new NotFoundError('pedido', id);
    return this.expired(toOrder(row));
  }

  async cancelMine(place: ShopPlace, customerId: string, id: string): Promise<Order> {
    const changed = await this.prisma.order.updateMany({ where: { id, tenantId: place.tenantId, customerId, status: 'aguardando_pagamento' }, data: { status: 'cancelado', canceledAt: new Date(), cancelReason: 'Cancelado pela cliente no app' } });
    if (!changed.count) throw new ConflictError('ORDER_PAID', 'Esse pedido não pode mais ser cancelado pelo app. Fale com o balcão.');
    return this.mineOne(place, customerId, id);
  }

  /** Painel de retirada: só número e primeiro nome (nada de dado da cliente). */
  async pickup(place: ShopPlace): Promise<PickupBoard> {
    if (!place.storeId) return { preparing: [], ready: [] };
    const since = new Date(Date.now() - 6 * 3_600_000);
    const rows = await this.prisma.order.findMany({
      where: { tenantId: place.tenantId, storeId: place.storeId, status: { in: ACTIVE }, paidAt: { gte: since } },
      select: { number: true, callName: true, status: true },
      orderBy: [{ readyAt: 'desc' }, { paidAt: 'asc' }],
      take: 60,
    });
    const pick = (r: { number: number; callName: string }) => ({ number: r.number, callName: r.callName.split(' ')[0]!.slice(0, 14) });
    return { preparing: rows.filter((r) => r.status !== 'pronto').map(pick), ready: rows.filter((r) => r.status === 'pronto').map(pick) };
  }

  // ---------------------------------------------------------------- rotina

  /** A cada 15 min: pedido do app/totem não pago há mais de 3 h é cancelado. */
  @Cron('0 */15 * * * *', { timeZone: 'America/Sao_Paulo' })
  async expireUnpaid(): Promise<number> {
    const r = await this.prisma.order.updateMany({
      where: { status: 'aguardando_pagamento', createdAt: { lt: this.unpaidLimit() } },
      data: { status: 'cancelado', canceledAt: new Date(), cancelReason: `Não foi pago em ${UNPAID_HOURS} h` },
    });
    if (r.count) this.logger.log(`${r.count} pedido(s) sem pagamento cancelado(s)`);
    return r.count;
  }

  // ---------------------------------------------------------------- apoio

  private async place(tenantId: string, storeId: string, channel: OrderChannel, customerId: string | null, callName: string, items: SaleLineInput[], notes: string | null): Promise<Order> {
    // Mesma conta do caixa (preço de membro, montagem, regras): erro aqui = erro no caixa.
    const quote = await this.sales.estimate(tenantId, { storeId, customerId: customerId ?? undefined, items, discount: 0, useCashback: 0, couponCode: null });
    const kinds = await this.prisma.product.findMany({ where: { tenantId, id: { in: items.map((i) => i.productId) } }, select: { id: true, kind: true, unit: true, showInApp: true } });
    const hidden = kinds.find((k) => !k.showInApp || k.kind === 'insumo');
    if (hidden) throw new DomainError('PRODUCT_NOT_AVAILABLE', 'Um dos produtos não está disponível para pedido.');
    const lines: OrderItem[] = quote.items.map((l) => ({ productId: l.productId, description: l.description, kind: l.kind, unit: l.unit, quantity: l.quantity, options: l.options }));
    const id = await this.prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          tenantId,
          storeId,
          number: await orderNumber(tx, tenantId),
          channel,
          status: 'aguardando_pagamento',
          customerId,
          callName,
          items: lines as unknown as Prisma.InputJsonValue,
          estimate: quote.total,
          notes,
        },
      });
      return created.id;
    });
    const row = await this.prisma.order.findUniqueOrThrow({ where: { id }, include });
    return toOrder(row);
  }

  private async assertOrdering(place: ShopPlace): Promise<string> {
    if (!place.storeId) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    const settings = await this.prisma.tenantSetting.findUnique({ where: { tenantId: place.tenantId }, select: { ordersEnabled: true } });
    if (settings && !settings.ordersEnabled) throw new DomainError('ORDERS_OFF', 'Pedidos pelo app e totem estão pausados agora. Peça direto no balcão.');
    return place.storeId;
  }

  private unpaidLimit() {
    return new Date(Date.now() - UNPAID_HOURS * 3_600_000);
  }

  /** O cron cancela de 15 em 15 min; para a cliente, o que passou do prazo já aparece cancelado. */
  private expired(o: Order): Order {
    if (o.status === 'aguardando_pagamento' && new Date(o.createdAt) < this.unpaidLimit()) return { ...o, status: 'cancelado', cancelReason: `Não foi pago em ${UNPAID_HOURS} h` };
    return o;
  }

  private assertStore(ctx: RequestContext, storeId: string) {
    if (!canUseStore(ctx, storeId)) throw new DomainError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.', undefined, 403);
  }
}

export function toOrder(r: Row): Order {
  const items = (r.items as unknown as OrderItem[]).map((i) => ({ ...i, options: (i.options ?? []) as ChosenOption[] }));
  return {
    id: r.id,
    number: r.number,
    storeId: r.storeId,
    channel: r.channel as OrderChannel,
    status: r.status as OrderStatus,
    callName: r.callName,
    customerId: r.customerId,
    customerName: r.customer?.name ?? null,
    items,
    estimate: Number(r.estimate),
    notes: r.notes,
    saleId: r.saleId,
    saleNumber: r.sale?.number ?? null,
    createdAt: r.createdAt.toISOString(),
    paidAt: r.paidAt?.toISOString() ?? null,
    startedAt: r.startedAt?.toISOString() ?? null,
    readyAt: r.readyAt?.toISOString() ?? null,
    deliveredAt: r.deliveredAt?.toISOString() ?? null,
    canceledAt: r.canceledAt?.toISOString() ?? null,
    cancelReason: r.cancelReason,
  };
}

