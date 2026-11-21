import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  ALL_PERMISSIONS,
  saleCreateSchema,
  type OnlineMethod,
  type OnlinePaymentView,
  type OnlineSettings,
  type OnlineSettingsInput,
  type OnlineStatus,
  type Order,
  type OrderItem,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { OnlineRefunds } from '../../common/payments/online-refunds.service';
import { PaymentGateway } from '../../common/payments/payment-gateway';
import type { RemotePayment, WebhookInput } from '../../common/payments/provider';
import { TestProvider } from '../../common/payments/test-provider';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';
import { OrdersService, type ShopPlace } from '../orders/orders.service';
import { SalesService } from '../sales/sales.service';

const PIX_MINUTES = 15;
const CARD_MINUTES = 60;
/** Consulta ao provedor no máximo a cada tantos ms por pagamento (a tela pergunta de 4 em 4 s). */
const CHECK_EVERY_MS = 4_000;
const METHOD_NAME: Record<OnlineMethod, { name: string; kind: string }> = {
  pix: { name: 'Pix online', kind: 'pix' },
  cartao: { name: 'Cartão online', kind: 'credito' },
};

type Row = Prisma.OnlinePaymentGetPayload<object>;
type OrderRow = Prisma.OrderGetPayload<object>;

/**
 * Pagamento online do pedido: gera o Pix ou o checkout do cartão, confirma
 * pelo aviso do provedor (ou consultando) e registra a venda sozinho, no caixa
 * aberto da loja. Sem caixa aberto ou com valor diferente, fica para o caixa
 * resolver ("Registrar pagamento online"). Pedido cancelado que recebe
 * pagamento tem o dinheiro devolvido.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Pagamento online');

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: PaymentGateway,
    private readonly refunds: OnlineRefunds,
    private readonly sales: SalesService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- configuração

  async settings(ctx: RequestContext): Promise<OnlineSettings> {
    const s = await this.prisma.tenantSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { onlinePix: true, onlineCard: true, onlineTotem: true } });
    const p = this.gateway.provider;
    return {
      onlinePix: s?.onlinePix ?? false,
      onlineCard: s?.onlineCard ?? false,
      onlineTotem: s?.onlineTotem ?? false,
      provider: p?.name ?? null,
      testMode: p?.testMode ?? false,
      webhookUrl: this.gateway.webhookUrl(),
      webhookSigned: p?.webhookSigned ?? false,
    };
  }

  async saveSettings(ctx: RequestContext, input: OnlineSettingsInput): Promise<OnlineSettings> {
    if ((input.onlinePix || input.onlineCard || input.onlineTotem) && !this.gateway.provider) throw new DomainError('PAY_PROVIDER_OFF', 'Falta ligar o Mercado Pago no servidor (chave no .env). Veja as instruções na tela.');
    if (input.onlineCard && !this.gateway.publicUrl()) throw new DomainError('PUBLIC_URL_MISSING', 'Cartão precisa do endereço do sistema (PUBLIC_URL no .env) para a cliente voltar ao app depois de pagar.');
    await this.prisma.tenantSetting.upsert({ where: { tenantId: ctx.tenantId }, create: { tenantId: ctx.tenantId, ...input }, update: input });
    await this.audit.record(ctx, 'settings.online', 'tenant', ctx.tenantId, input);
    return this.settings(ctx);
  }

  // ---------------------------------------------------------------- cliente e totem

  async startForCustomer(place: ShopPlace, customerId: string, orderId: string, method: OnlineMethod): Promise<OnlinePaymentView> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId: place.tenantId, customerId } });
    if (!order) throw new NotFoundError('pedido', orderId);
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId: place.tenantId }, select: { name: true, email: true } });
    return this.start(order, method, false, customer);
  }

  async startForTotem(place: ShopPlace, orderId: string): Promise<OnlinePaymentView> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId: place.tenantId, channel: 'totem' } });
    if (!order) throw new NotFoundError('pedido', orderId);
    return this.start(order, 'pix', true, null);
  }

  async viewForCustomer(place: ShopPlace, customerId: string, orderId: string): Promise<OnlinePaymentView | null> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId: place.tenantId, customerId }, select: { id: true } });
    if (!order) throw new NotFoundError('pedido', orderId);
    return this.latestView(place.tenantId, orderId);
  }

  async viewForTotem(place: ShopPlace, orderId: string): Promise<OnlinePaymentView | null> {
    const order = await this.prisma.order.findFirst({ where: { id: orderId, tenantId: place.tenantId, channel: 'totem' }, select: { id: true } });
    if (!order) throw new NotFoundError('pedido', orderId);
    return this.latestView(place.tenantId, orderId);
  }

  // ---------------------------------------------------------------- equipe

  /** Caixa: registra a venda de um pedido pago pelo app (caixa estava fechado, por exemplo). */
  async settleForStaff(ctx: RequestContext, orderId: string): Promise<Order> {
    const order = await this.orders.get(ctx, orderId);
    const row = await this.refunds.paidUnsettled(ctx.tenantId, order.id);
    if (!row) throw new ConflictError('NOTHING_TO_SETTLE', 'Esse pedido não tem pagamento online para registrar.');
    await this.settle(row.id, ctx);
    return this.orders.get(ctx, orderId);
  }

  /** Provedor de teste: simula a cliente pagando o pagamento aberto do pedido. */
  async testApprove(ctx: RequestContext, orderId: string, amount?: number): Promise<Order> {
    const provider = this.gateway.provider;
    if (!(provider instanceof TestProvider)) throw new DomainError('NOT_TEST_PROVIDER', 'Só dá para simular com o provedor de teste.');
    // Também o cancelado: simula o Pix que cai depois do pedido cancelado (tem que ser devolvido).
    const row = await this.prisma.onlinePayment.findFirst({ where: { tenantId: ctx.tenantId, orderId, status: { in: ['pendente', 'cancelado'] } }, orderBy: { createdAt: 'desc' } });
    if (!row?.providerRef) throw new NotFoundError('pagamento aberto');
    const remote = provider.approve(row.providerRef, amount);
    if (remote) await this.apply(row.id, remote);
    return this.orders.get(ctx, orderId);
  }

  // ---------------------------------------------------------------- aviso do provedor

  async webhook(input: WebhookInput): Promise<void> {
    const provider = this.gateway.provider;
    if (!provider) return;
    const id = provider.webhookPaymentId(input);
    if (!id) return;
    const remote = await provider.getPayment(id);
    if (!remote?.reference || !/^[0-9a-f-]{36}$/.test(remote.reference)) return;
    await this.apply(remote.reference, remote);
  }

  // ---------------------------------------------------------------- rotina

  /** A cada minuto: confere Pix vencidos e tenta registrar vendas que ficaram para trás. */
  @Cron('30 * * * * *')
  async sweep(): Promise<void> {
    if (!this.gateway.provider) return;
    const now = Date.now();
    const stale = await this.prisma.onlinePayment.findMany({ where: { status: 'pendente', expiresAt: { lt: new Date(now) } }, take: 50 });
    for (const row of stale) await this.refresh(row, true).catch((e: Error) => this.logger.warn(`Conferência de ${row.id}: ${e.message}`));
    const unsettled = await this.prisma.onlinePayment.findMany({ where: { status: 'pago', saleId: null, paidAt: { lt: new Date(now - 20_000) }, updatedAt: { lt: new Date(now - 55_000) } }, take: 20 });
    for (const row of unsettled) {
      await this.settle(row.id).catch((e: Error) => this.logger.warn(`Registro de ${row.id}: ${e.message}`));
      await this.prisma.onlinePayment.update({ where: { id: row.id }, data: { lastCheckAt: new Date() } }).catch(() => undefined);
    }
  }

  // ---------------------------------------------------------------- miolo

  private async start(order: OrderRow, method: OnlineMethod, totem: boolean, customer: { name: string; email: string | null } | null): Promise<OnlinePaymentView> {
    if (order.status !== 'aguardando_pagamento') throw new ConflictError('ORDER_NOT_PENDING', order.status === 'cancelado' ? 'Esse pedido foi cancelado.' : 'Esse pedido já foi pago.');
    await this.orders.assertOnline(order.tenantId, method, totem);
    const provider = this.gateway.provider!;
    const now = Date.now();
    const open = await this.prisma.onlinePayment.findFirst({ where: { tenantId: order.tenantId, orderId: order.id, status: 'pendente', method, provider: provider.name, expiresAt: { gt: new Date(now + 60_000) } }, orderBy: { createdAt: 'desc' } });
    if (open) return this.view(open);
    if (await this.refunds.paidUnsettled(order.tenantId, order.id)) throw new ConflictError('ORDER_PAID_ONLINE', 'Esse pedido já foi pago. Aguarde a confirmação da loja.');
    if (!(await this.prisma.cashSession.count({ where: { tenantId: order.tenantId, storeId: order.storeId, status: 'open' } }))) throw new DomainError('STORE_CLOSED', 'O caixa da loja ainda não abriu. Pague na loja ou tente daqui a pouco.');
    await this.refunds.cancelPending(order.tenantId, order.id);

    const quote = await this.sales.estimate(order.tenantId, { storeId: order.storeId, customerId: order.customerId ?? undefined, items: lines(order), discount: 0, useCashback: 0, couponCode: order.couponCode, deliveryFee: order.fulfillment === 'entrega' ? Number(order.deliveryFee) : 0 });
    if (quote.total <= 0) throw new DomainError('NOTHING_TO_PAY', 'Esse pedido não tem valor a pagar.');
    const expiresAt = new Date(now + (method === 'pix' ? PIX_MINUTES : CARD_MINUTES) * 60_000);
    const row = await this.prisma.onlinePayment.create({ data: { tenantId: order.tenantId, orderId: order.id, provider: provider.name, method, amount: quote.total, expiresAt } });
    const store = await this.prisma.store.findFirst({ where: { id: order.storeId }, select: { name: true } });
    const base = this.gateway.publicUrl();
    const notificationUrl = this.gateway.webhookUrl();
    try {
      if (method === 'pix') {
        const pix = await provider.createPix({
          reference: row.id,
          amount: quote.total,
          description: `Pedido ${order.number} · ${store?.name ?? 'Mercearia'}`,
          payerEmail: customer?.email ?? process.env.MP_PAYER_EMAIL?.trim() ?? 'cliente@merceariasaudavel.com.br',
          payerName: customer?.name ?? order.callName,
          expiresAt,
          notificationUrl,
        });
        return this.view(await this.prisma.onlinePayment.update({ where: { id: row.id }, data: { providerRef: pix.ref, qrCode: pix.qrCode, qrImage: pix.qrImage } }));
      }
      const checkout = await provider.createCheckout({ reference: row.id, amount: quote.total, title: `Pedido ${order.number} · ${store?.name ?? 'Mercearia'}`, backUrl: `${base ?? 'http://localhost:5180'}/app/pedido/${order.id}`, expiresAt, notificationUrl });
      return this.view(await this.prisma.onlinePayment.update({ where: { id: row.id }, data: { providerRef: checkout.ref, checkoutUrl: checkout.url } }));
    } catch (e) {
      await this.prisma.onlinePayment.update({ where: { id: row.id }, data: { status: 'cancelado' } });
      this.logger.warn(`Pedido ${order.number}: ${(e as Error).message}`);
      throw new DomainError('PAY_PROVIDER_ERROR', 'Não deu para gerar o pagamento agora. Tente de novo ou pague na loja.');
    }
  }

  private async latestView(tenantId: string, orderId: string): Promise<OnlinePaymentView | null> {
    const row = await this.prisma.onlinePayment.findFirst({ where: { tenantId, orderId }, orderBy: { createdAt: 'desc' } });
    if (!row) return null;
    return this.view(await this.refresh(row));
  }

  /** Pergunta ao provedor como está (sem martelar: no máximo a cada 4 s). */
  private async refresh(row: Row, force = false): Promise<Row> {
    const provider = this.gateway.provider;
    if (row.status !== 'pendente' || !provider || provider.name !== row.provider) return row;
    if (!force && row.lastCheckAt && Date.now() - row.lastCheckAt.getTime() < CHECK_EVERY_MS) return row;
    await this.prisma.onlinePayment.update({ where: { id: row.id }, data: { lastCheckAt: new Date() } });
    const remotes = row.method === 'pix' && row.providerRef ? [await provider.getPayment(row.providerRef)].filter((r): r is RemotePayment => Boolean(r)) : await provider.findByReference(row.id);
    const remote = remotes.find((r) => r.status === 'approved') ?? remotes[0];
    if (remote) await this.apply(row.id, remote);
    const now = await this.prisma.onlinePayment.findUniqueOrThrow({ where: { id: row.id } });
    if (now.status === 'pendente' && now.expiresAt.getTime() < Date.now() - 60_000) {
      if (now.method === 'pix' && now.providerRef) await provider.cancel(now.providerRef).catch(() => undefined);
      return this.prisma.onlinePayment.update({ where: { id: row.id }, data: { status: 'expirado' } });
    }
    return now;
  }

  /** Aplica o que o provedor disse. Aprovado → pago (e registra a venda). */
  private async apply(rowId: string, remote: RemotePayment): Promise<void> {
    if (remote.reference && remote.reference !== rowId) return;
    let settle = false;
    try {
      await this.prisma.$transaction(async (tx) => {
        const row = (await tx.$queryRaw<Array<{ id: string; status: string; amount: Prisma.Decimal; method: string; order_id: string }>>`
          SELECT id, status, amount, method, order_id FROM online_payment WHERE id = ${rowId} FOR UPDATE`)[0];
        if (!row) return;
        if (remote.status === 'approved' && ['pendente', 'cancelado', 'expirado'].includes(row.status)) {
          const same = Math.abs(remote.amount - Number(row.amount)) < 0.01;
          await tx.onlinePayment.update({ where: { id: rowId }, data: { status: same ? 'pago' : 'divergente', providerPaymentId: remote.paymentId, paidAt: new Date(), settleError: same ? null : `Pago R$ ${remote.amount.toFixed(2).replace('.', ',')}, esperado R$ ${Number(row.amount).toFixed(2).replace('.', ',')}` } });
          settle = same;
          if (!same) this.logger.warn(`Pagamento ${rowId}: valor diferente (pago ${remote.amount}, esperado ${row.amount})`);
        } else if (remote.status === 'refunded' && row.status === 'pago') {
          await tx.onlinePayment.update({ where: { id: rowId }, data: { status: 'estornado' } });
        } else if ((remote.status === 'cancelled' || remote.status === 'rejected') && row.status === 'pendente' && row.method === 'pix') {
          await tx.onlinePayment.update({ where: { id: rowId }, data: { status: 'cancelado' } });
        }
      });
    } catch (e) {
      // O mesmo pagamento do provedor já foi aplicado em outro registro.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return;
      throw e;
    }
    if (settle) await this.settle(rowId).catch((e: Error) => this.logger.warn(`Registro de ${rowId}: ${e.message}`));
  }

  /**
   * Pago → venda. Pedido que não está mais esperando (cancelado, ou cobrado no
   * caixa enquanto isso) tem o pagamento devolvido.
   */
  private async settle(rowId: string, staff?: RequestContext): Promise<void> {
    const row = await this.prisma.onlinePayment.findUnique({ where: { id: rowId } });
    if (!row || row.status !== 'pago' || row.saleId) return;
    const order = await this.prisma.order.findUniqueOrThrow({ where: { id: row.orderId } });
    if (order.status !== 'aguardando_pagamento') {
      await this.refunds.refund(row.tenantId, row.id);
      this.logger.log(`Pedido ${order.number} não estava mais esperando pagamento: devolvido`);
      return;
    }
    let ctx = staff;
    if (!ctx) {
      const session = await this.prisma.cashSession.findFirst({ where: { tenantId: row.tenantId, storeId: order.storeId, status: 'open' }, select: { openedById: true } });
      if (!session) {
        await this.prisma.onlinePayment.update({ where: { id: row.id }, data: { settleError: 'Caixa fechado: abra o caixa e registre o pagamento.' } });
        return;
      }
      // Venda registrada em nome de quem abriu o caixa.
      ctx = { tenantId: row.tenantId, userId: session.openedById, storeIds: [], permissions: [...ALL_PERMISSIONS] };
    }
    const methodId = await this.methodId(row.tenantId, row.method as OnlineMethod);
    const input = saleCreateSchema.parse({
      storeId: order.storeId,
      customerId: order.customerId,
      items: lines(order),
      discount: 0,
      useCashback: 0,
      couponCode: order.couponCode,
      deliveryFee: 0,
      channel: order.channel === 'app' ? 'app' : 'loja',
      orderId: order.id,
      payments: [{ methodId, amount: Number(row.amount) }],
      emitNfce: true,
    });
    try {
      await this.sales.create(ctx, input, { onlinePaymentId: row.id });
    } catch (e) {
      await this.prisma.onlinePayment.update({ where: { id: row.id }, data: { settleError: (e as Error).message.slice(0, 300) } });
      if (staff) throw e;
      this.logger.warn(`Pedido ${order.number}: venda não registrada (${(e as Error).message})`);
    }
  }

  /** Formas "Pix online" e "Cartão online" (criadas na primeira vez). */
  private async methodId(tenantId: string, method: OnlineMethod): Promise<string> {
    const m = METHOD_NAME[method];
    const row = await this.prisma.paymentMethod.upsert({ where: { tenantId_name: { tenantId, name: m.name } }, create: { tenantId, name: m.name, kind: m.kind }, update: { active: true } });
    return row.id;
  }

  private view(r: Row): OnlinePaymentView {
    return {
      id: r.id,
      orderId: r.orderId,
      method: r.method as OnlineMethod,
      status: r.status as OnlineStatus,
      amount: Number(r.amount),
      qrCode: r.status === 'pendente' ? r.qrCode : null,
      qrImage: r.status === 'pendente' ? r.qrImage : null,
      checkoutUrl: r.status === 'pendente' ? r.checkoutUrl : null,
      expiresAt: r.expiresAt.toISOString(),
      paidAt: r.paidAt?.toISOString() ?? null,
      test: r.provider === 'teste' || Boolean(this.gateway.provider?.testMode),
    };
  }
}

/** Itens do pedido no formato da venda. */
function lines(order: OrderRow) {
  return (order.items as unknown as OrderItem[]).map((i) => ({ productId: i.productId, quantity: i.quantity, options: (i.options ?? []).map((o) => o.id) }));
}
