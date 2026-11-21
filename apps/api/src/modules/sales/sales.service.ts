import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  addDays,
  changeFor,
  type ChosenOption,
  PERMISSIONS,
  todayBR,
  type Page,
  type PaymentKind,
  type ProductKind,
  type Sale,
  type SaleCancelInput,
  type SaleChannel,
  type SaleCreateInput,
  type SaleListQuery,
  type SaleQuote,
  type SaleQuoteInput,
  type SaleQuoteLine,
  type SaleRow,
  type Unit,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { CashService } from '../cash/cash.service';
import { clubRules, moveCashback, type ClubRules } from '../customers/cashback';
import { FiscalService } from '../fiscal/fiscal.service';
import { q3, returnSaleStock, stockStoreOf, takeStock } from '../products/stock';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;
const cents = (v: number | Prisma.Decimal | null | undefined) => Math.round(Number(v ?? 0) * 100);
const brStart = (iso: string) => new Date(`${iso}T00:00:00-03:00`);
const WEIGHT_UNITS = ['KG', 'G', 'L', 'ML'];

interface Supply {
  ingredientId: string;
  quantity: number;
  cost: number;
  trackStock: boolean;
  trackLots: boolean;
}

interface Computed {
  quote: SaleQuote;
  lines: Array<SaleQuoteLine & { categoryId: string | null; unitCost: number; trackStock: boolean; trackLots: boolean; recipe: Supply[]; extras: Supply[] }>;
  subtotalCents: number;
}

/** Pedido do dia: número curto que volta a 1 todo dia (para chamar no balcão). */
export async function orderNumber(tx: Tx, tenantId: string): Promise<number> {
  return nextNumber(tx, tenantId, `order:${todayBR()}`);
}

const saleInclude = {
  store: { select: { name: true } },
  customer: { select: { name: true } },
  seller: { select: { name: true } },
  items: { orderBy: { position: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' }, include: { method: { select: { name: true, kind: true } }, reversal: { select: { id: true } } } },
  order: { select: { id: true, number: true, status: true } },
} satisfies Prisma.SaleInclude;
type SaleFull = Prisma.SaleGetPayload<{ include: typeof saleInclude }>;

/**
 * Venda no balcão. Tudo numa transação: número da venda, itens, baixa do
 * estoque (FEFO nos lotes; preparado baixa os insumos da ficha), pagamentos no
 * caixa aberto e cashback. A nota fiscal sai depois, fora da transação: se a
 * SEFAZ demorar, a venda já está gravada e a nota fica "processando".
 */
@Injectable()
export class SalesService {
  private readonly logger = new Logger('Vendas');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly cash: CashService,
    private readonly fiscal: FiscalService,
  ) {}

  async quote(ctx: RequestContext, input: SaleQuoteInput): Promise<SaleQuote> {
    this.assertStore(ctx, input.storeId);
    return (await this.compute(this.prisma, ctx.tenantId, input)).quote;
  }

  /** Conta de um pedido do app/totem (sem caixa, sem usuário da equipe). */
  async estimate(tenantId: string, input: SaleQuoteInput): Promise<SaleQuote> {
    return (await this.compute(this.prisma, tenantId, input)).quote;
  }

  async create(ctx: RequestContext, input: SaleCreateInput): Promise<Sale> {
    this.assertStore(ctx, input.storeId);
    if (input.discount > 0 && !this.can(ctx, PERMISSIONS.saleDiscount)) throw new ForbiddenError('DISCOUNT_NOT_ALLOWED', 'Você não pode dar desconto. Peça para a gerente.');
    const methodIds = [...new Set(input.payments.map((p) => p.methodId))];
    const methods = await this.prisma.paymentMethod.findMany({ where: { id: { in: methodIds }, tenantId: ctx.tenantId, active: true } });
    if (methods.length !== methodIds.length) throw new DomainError('METHOD_NOT_FOUND', 'Forma de pagamento não encontrada.');
    const kindOf = (id: string) => methods.find((m) => m.id === id)!.kind as PaymentKind;
    if (!(await this.prisma.store.count({ where: { id: input.storeId, tenantId: ctx.tenantId, active: true } }))) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');

    const saleId = await this.prisma.$transaction(
      async (tx) => {
        const session = await this.cash.lockOpenOf(tx, ctx, input.storeId);
        // Pedido do app/totem sendo cobrado: trava para ninguém cobrar duas vezes.
        let order: { id: string; status: string; store_id: string; customer_id: string | null } | undefined;
        if (input.orderId) {
          order = (await tx.$queryRaw<Array<{ id: string; status: string; store_id: string; customer_id: string | null }>>`
            SELECT id, status, store_id, customer_id FROM "order" WHERE id = ${input.orderId} AND tenant_id = ${ctx.tenantId} FOR UPDATE`)[0];
          if (!order) throw new NotFoundError('pedido', input.orderId);
          if (order.status !== 'aguardando_pagamento') throw new ConflictError('ORDER_NOT_PENDING', 'Esse pedido já foi cobrado ou cancelado.');
          if (order.store_id !== input.storeId) throw new DomainError('ORDER_OTHER_STORE', 'Esse pedido é de outra loja.');
        }
        const { quote, lines } = await this.compute(tx, ctx.tenantId, input);
        const { change, error } = changeFor(quote.total, input.payments.map((p) => ({ amount: p.amount, kind: kindOf(p.methodId) })));
        if (error) throw new DomainError('PAYMENT_MISMATCH', error);
        if (quote.total > 0 && !input.payments.length) throw new DomainError('PAYMENT_MISSING', 'Informe como a cliente pagou.');

        const number = await nextNumber(tx, ctx.tenantId, 'sale');
        const costCents = lines.reduce((s, l) => s + Math.round(l.unitCost * l.quantity * 100), 0);
        const sale = await tx.sale.create({
          data: {
            tenantId: ctx.tenantId,
            number,
            storeId: input.storeId,
            sessionId: session.id,
            customerId: quote.customer?.id ?? null,
            sellerId: ctx.userId,
            channel: input.channel,
            memberPricing: quote.member,
            grossTotal: quote.grossTotal,
            memberSavings: quote.memberSavings,
            discount: quote.discount,
            total: quote.total,
            cashbackUsed: quote.cashbackUsed,
            cashbackEarned: quote.cashbackEarned,
            costTotal: costCents / 100,
            itemsCount: q3(lines.reduce((s, l) => s + l.quantity, 0)),
            notes: input.notes ?? null,
            createdById: ctx.userId,
            items: {
              create: lines.map((l, i) => ({
                tenantId: ctx.tenantId,
                position: i + 1,
                productId: l.productId,
                description: l.description,
                kind: l.kind,
                categoryId: l.categoryId,
                unit: l.unit,
                quantity: l.quantity,
                listPrice: l.listPrice,
                unitPrice: l.unitPrice,
                total: l.total,
                unitCost: l.unitCost,
                options: l.options.length ? (l.options as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
              })),
            },
          },
        });

        // Estoque: revenda e insumo saem direto; preparado tira os insumos da ficha.
        for (const l of lines) {
          const base = { tenantId: ctx.tenantId, storeId: input.storeId, userId: ctx.userId, saleId: sale.id, note: `Venda ${number}` };
          if (l.kind === 'preparado') {
            for (const r of l.recipe) {
              if (!r.trackStock) continue;
              await takeStock(tx, { ...base, productId: r.ingredientId, type: 'consumo', unitCost: r.cost }, q3(r.quantity * l.quantity), { trackLots: r.trackLots });
            }
          } else if (l.trackStock) {
            await takeStock(tx, { ...base, productId: l.productId, type: 'venda', unitCost: l.unitCost }, l.quantity, { trackLots: l.trackLots });
          }
          // Adicionais da montagem: cada opção escolhida gasta o seu insumo.
          for (const x of l.extras) {
            if (!x.trackStock) continue;
            await takeStock(tx, { ...base, productId: x.ingredientId, type: 'consumo', unitCost: x.cost }, q3(x.quantity * l.quantity), { trackLots: x.trackLots });
          }
        }

        // Tela de preparo: pedido cobrado entra na fila; balcão com shake/sorvete abre pedido já pago.
        if (order) {
          await tx.order.update({ where: { id: order.id }, data: { status: 'na_fila', saleId: sale.id, paidAt: new Date(), customerId: quote.customer?.id ?? order.customer_id } });
        } else {
          const prepared = lines.filter((l) => l.kind === 'preparado');
          const settings = prepared.length ? await tx.tenantSetting.findUnique({ where: { tenantId: ctx.tenantId }, select: { kitchenFromCounter: true } }) : null;
          if (prepared.length && (settings?.kitchenFromCounter ?? true)) {
            await tx.order.create({
              data: {
                tenantId: ctx.tenantId,
                storeId: input.storeId,
                number: await orderNumber(tx, ctx.tenantId),
                channel: 'balcao',
                status: 'na_fila',
                customerId: quote.customer?.id ?? null,
                callName: quote.customer ? quote.customer.name.split(' ')[0]! : `Venda ${number}`,
                items: prepared.map((l) => ({ productId: l.productId, description: l.description, kind: l.kind, unit: l.unit, quantity: l.quantity, options: l.options })) as unknown as Prisma.InputJsonValue,
                estimate: quote.total,
                notes: input.notes ?? null,
                saleId: sale.id,
                paidAt: new Date(),
              },
            });
          }
        }

        // Pagamentos: o troco sai do último pagamento em dinheiro.
        let changeLeft = cents(change);
        const payments = [...input.payments].reverse().map((p) => {
          let amount = cents(p.amount);
          if (changeLeft > 0 && kindOf(p.methodId) === 'dinheiro') {
            const take = Math.min(changeLeft, amount);
            amount -= take;
            changeLeft -= take;
          }
          return { ...p, amount };
        });
        for (const p of payments.reverse()) {
          if (p.amount <= 0) continue;
          await tx.cashMovement.create({ data: { tenantId: ctx.tenantId, sessionId: session.id, type: 'recebimento', amount: p.amount / 100, methodId: p.methodId, saleId: sale.id, userId: ctx.userId, note: change > 0 && kindOf(p.methodId) === 'dinheiro' ? `Troco R$ ${change.toFixed(2).replace('.', ',')}` : null } });
        }

        if (quote.customer) {
          if (quote.cashbackUsed > 0) await moveCashback(tx, { tenantId: ctx.tenantId, customerId: quote.customer.id, type: 'uso', amount: -quote.cashbackUsed, saleId: sale.id, userId: ctx.userId });
          if (quote.cashbackEarned > 0) {
            const rules = await clubRules(tx, ctx.tenantId);
            const expiresAt = rules.cashbackDays > 0 ? new Date(`${addDays(todayBR(), rules.cashbackDays)}T00:00:00Z`) : null;
            await moveCashback(tx, { tenantId: ctx.tenantId, customerId: quote.customer.id, type: 'credito', amount: quote.cashbackEarned, saleId: sale.id, expiresAt, userId: ctx.userId });
          }
        }
        return sale.id;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );

    const created = await this.get(ctx, saleId);
    await this.audit.record(ctx, 'sale.create', 'sale', saleId, { number: created.number, total: created.total, member: created.memberPricing });
    if (created.customerId) await this.audit.record(ctx, 'sale.create', 'customer', created.customerId, { detail: `Venda nº ${created.number}: R$ ${created.total.toFixed(2).replace('.', ',')}`, saleId });

    // Nota fiscal: só se a loja tem a emissão automática ligada e pronta. Falha não desfaz a venda.
    if (input.emitNfce && (await this.fiscal.autoEmitReady(ctx.tenantId, input.storeId))) {
      try {
        await this.fiscal.emit(ctx, saleId, { includeCustomer: true, cpf: input.cpf ?? null });
      } catch (e) {
        this.logger.warn(`Venda ${created.number}: nota não emitida (${(e as Error).message})`);
      }
      return this.get(ctx, saleId);
    }
    return created;
  }

  /**
   * Cancela a venda: devolve o dinheiro pelo caixa aberto agora (estornos),
   * volta o estoque (nos mesmos lotes) e desfaz o cashback. Com nota
   * autorizada, cancela a nota antes; se a SEFAZ recusar, a venda não é cancelada.
   */
  async cancel(ctx: RequestContext, id: string, input: SaleCancelInput): Promise<Sale> {
    const current = await this.get(ctx, id);
    if (current.status === 'canceled') throw new ConflictError('SALE_CANCELED', 'Essa venda já foi cancelada.');
    if (current.fiscal?.status === 'processing') throw new ConflictError('FISCAL_PROCESSING', 'A nota desta venda ainda está processando. Atualize a nota antes de cancelar.');
    if (current.fiscal?.status === 'authorized') {
      try {
        await this.fiscal.cancel(ctx, current.fiscal.id, `Venda cancelada: ${input.reason}`.padEnd(15, '.').slice(0, 255));
      } catch (e) {
        throw new DomainError('FISCAL_CANCEL_FAILED', `A nota fiscal não foi cancelada, então a venda continua valendo. ${(e as Error).message}`);
      }
    }
    await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<Array<{ status: string; store_id: string; customer_id: string | null; number: number; cashback_used: Prisma.Decimal; cashback_earned: Prisma.Decimal }>>`
          SELECT status, store_id, customer_id, number, cashback_used, cashback_earned FROM sale WHERE id = ${id} AND tenant_id = ${ctx.tenantId} FOR UPDATE`;
        const sale = rows[0];
        if (!sale) throw new NotFoundError('venda', id);
        if (sale.status !== 'completed') throw new ConflictError('SALE_CANCELED', 'Essa venda já foi cancelada.');
        const session = await this.cash.lockOpenOf(tx, ctx, sale.store_id);
        const payments = await tx.cashMovement.findMany({ where: { saleId: id, type: 'recebimento', reversal: null }, include: { method: { select: { kind: true } } } });
        const cashBack = payments.filter((p) => p.method?.kind === 'dinheiro').reduce((s, p) => s + cents(p.amount), 0);
        if (cashBack > (await this.cash.drawerCents(tx, session))) throw new DomainError('NOT_ENOUGH_CASH', 'Não há dinheiro suficiente na gaveta para devolver.');
        for (const p of payments) {
          await tx.cashMovement.create({ data: { tenantId: ctx.tenantId, sessionId: session.id, type: 'estorno', amount: -Number(p.amount), methodId: p.methodId, saleId: id, reversesId: p.id, note: input.reason, userId: ctx.userId } });
        }
        await returnSaleStock(tx, { tenantId: ctx.tenantId, saleId: id, userId: ctx.userId, note: `Cancelamento da venda ${sale.number}` });
        if (sale.customer_id) {
          if (cents(sale.cashback_used) > 0) await moveCashback(tx, { tenantId: ctx.tenantId, customerId: sale.customer_id, type: 'estorno', amount: Number(sale.cashback_used), saleId: id, note: 'Devolvido: venda cancelada', userId: ctx.userId });
          if (cents(sale.cashback_earned) > 0) {
            // Se a cliente já gastou parte do que ganhou, tira só o que sobrou.
            const c = await tx.customer.findUnique({ where: { id: sale.customer_id }, select: { cashbackBalance: true } });
            const take = Math.min(cents(sale.cashback_earned), cents(c?.cashbackBalance));
            if (take > 0) await moveCashback(tx, { tenantId: ctx.tenantId, customerId: sale.customer_id, type: 'estorno', amount: -take / 100, saleId: id, note: 'Retirado: venda cancelada', userId: ctx.userId });
          }
        }
        await tx.sale.update({ where: { id }, data: { status: 'canceled', canceledAt: new Date(), canceledById: ctx.userId, cancelReason: input.reason } });
        await tx.order.updateMany({ where: { saleId: id, tenantId: ctx.tenantId, status: { not: 'cancelado' } }, data: { status: 'cancelado', canceledAt: new Date(), cancelReason: `Venda cancelada: ${input.reason}` } });
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    await this.audit.record(ctx, 'sale.cancel', 'sale', id, { number: current.number, reason: input.reason });
    if (current.customerId) await this.audit.record(ctx, 'sale.cancel', 'customer', current.customerId, { detail: `Venda nº ${current.number} — ${input.reason}` });
    return this.get(ctx, id);
  }

  async get(ctx: RequestContext, id: string): Promise<Sale> {
    const s = await this.prisma.sale.findFirst({ where: { id, tenantId: ctx.tenantId }, include: saleInclude });
    if (!s || !canUseStore(ctx, s.storeId)) throw new NotFoundError('venda', id);
    const doc = await this.prisma.fiscalDocument.findFirst({ where: { tenantId: ctx.tenantId, saleId: id }, orderBy: { createdAt: 'desc' } });
    return toSale(s, doc);
  }

  async list(ctx: RequestContext, q: SaleListQuery): Promise<Page<SaleRow>> {
    const where: Prisma.SaleWhereInput = { tenantId: ctx.tenantId };
    if (ctx.storeIds.length) where.storeId = { in: q.storeId ? ctx.storeIds.filter((s) => s === q.storeId) : ctx.storeIds };
    else if (q.storeId) where.storeId = q.storeId;
    if (q.status !== 'all') where.status = q.status;
    if (q.customerId) where.customerId = q.customerId;
    if (q.q) where.number = q.q;
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: brStart(q.from) } : {}), ...(q.to ? { lt: new Date(brStart(q.to).getTime() + 86_400_000) } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.sale.count({ where }),
      this.prisma.sale.findMany({ where, include: { store: { select: { name: true } }, customer: { select: { name: true } }, seller: { select: { name: true } } }, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    const docs = rows.length ? await this.prisma.fiscalDocument.findMany({ where: { tenantId: ctx.tenantId, saleId: { in: rows.map((r) => r.id) } }, orderBy: { createdAt: 'desc' }, select: { saleId: true, status: true } }) : [];
    return {
      total,
      page: q.page,
      pageSize: q.pageSize,
      items: rows.map((r) => ({
        id: r.id,
        number: r.number,
        storeName: r.store.name,
        channel: r.channel as SaleChannel,
        status: r.status as 'completed' | 'canceled',
        customerName: r.customer?.name ?? null,
        memberPricing: r.memberPricing,
        sellerName: r.seller?.name ?? null,
        total: Number(r.total),
        itemsCount: q3(r.itemsCount),
        createdAt: r.createdAt.toISOString(),
        fiscalStatus: docs.find((d) => d.saleId === r.id)?.status ?? null,
      })),
    };
  }

  // ------------------------------------------------------------ cálculo

  /** Preço, preço de membro, desconto, cashback e total — a única conta da venda. */
  private async compute(db: Db, tenantId: string, input: SaleQuoteInput): Promise<Computed> {
    const ids = [...new Set(input.items.map((i) => i.productId))];
    const supplySelect = { id: true, name: true, cost: true, trackStock: true, trackLots: true, unit: true, balances: true } as const;
    const [products, customer, rules, storeId, groups] = await Promise.all([
      db.product.findMany({
        where: { id: { in: ids }, tenantId },
        include: { balances: true, recipe: { include: { ingredient: { select: supplySelect } } } },
      }),
      input.customerId ? db.customer.findFirst({ where: { id: input.customerId, tenantId, active: true } }) : null,
      clubRules(db, tenantId),
      stockStoreOf(db as Tx, input.storeId),
      db.optionGroup.findMany({
        where: { tenantId, productId: { in: ids }, active: true },
        include: { options: { where: { active: true }, include: { supply: { select: supplySelect } } } },
        orderBy: { position: 'asc' },
      }),
    ]);
    if (input.customerId && !customer) throw new DomainError('CUSTOMER_NOT_FOUND', 'Cliente não encontrada.');
    const member = Boolean(customer?.isMember);

    const used = new Map<string, number>();
    const lines: Computed['lines'] = input.items.map((item) => {
      const p = products.find((x) => x.id === item.productId);
      if (!p) throw new DomainError('PRODUCT_NOT_FOUND', 'Um dos produtos não foi encontrado.');
      if (!p.active) throw new DomainError('PRODUCT_INACTIVE', `"${p.name}" está inativo.`);
      if (!p.sellable) throw new DomainError('PRODUCT_NOT_SELLABLE', `"${p.name}" é insumo e não está liberado para venda avulsa.`);
      if (!WEIGHT_UNITS.includes(p.unit) && !Number.isInteger(item.quantity)) throw new DomainError('WHOLE_QUANTITY', `"${p.name}" é vendido por ${p.unit}: use número inteiro.`);
      if (p.kind === 'preparado' && !p.recipe.length) throw new DomainError('RECIPE_MISSING', `"${p.name}" ainda não tem ficha técnica. Cadastre a ficha para poder vender.`);
      // Montagem: confere as escolhas contra os grupos ativos do produto.
      const productGroups = groups.filter((g) => g.productId === p.id && g.options.length);
      const chosenIds = item.options ?? [];
      if (new Set(chosenIds).size !== chosenIds.length) throw new DomainError('OPTION_REPEATED', `"${p.name}": a mesma opção foi escolhida duas vezes.`);
      const chosen = chosenIds.map((oid) => {
        const g = productGroups.find((x) => x.options.some((o) => o.id === oid));
        if (!g) throw new DomainError('OPTION_NOT_FOUND', `"${p.name}": uma das opções escolhidas não existe mais. Monte o item de novo.`);
        return { group: g, option: g.options.find((o) => o.id === oid)! };
      });
      for (const g of productGroups) {
        const n = chosen.filter((c) => c.group.id === g.id).length;
        if (n < g.minSelect) throw new DomainError('OPTION_MISSING', `"${p.name}": escolha ${g.minSelect === 1 ? 'o' : `${g.minSelect} em`} ${g.name.toLowerCase()}.`);
        if (n > g.maxSelect) throw new DomainError('OPTION_TOO_MANY', `"${p.name}": no máximo ${g.maxSelect} em ${g.name.toLowerCase()}.`);
      }
      const options = chosen.map((c) => ({ id: c.option.id, group: c.group.name, name: c.option.name, price: Number(c.option.price) }));
      const extrasCents = options.reduce((sum, o) => sum + cents(o.price), 0);
      const extras: Supply[] = chosen
        .filter((c) => c.option.supply && c.option.supplyQty != null)
        .map((c) => ({ ingredientId: c.option.supply!.id, quantity: Number(c.option.supplyQty), cost: Number(c.option.supply!.cost), trackStock: c.option.supply!.trackStock, trackLots: c.option.supply!.trackLots }));

      const baseList = Number(p.price);
      const baseUnit = member && p.memberPrice != null && Number(p.memberPrice) < baseList ? Number(p.memberPrice) : baseList;
      // Adicional custa igual para membro e não membro.
      const listPrice = (cents(baseList) + extrasCents) / 100;
      const unitPrice = (cents(baseUnit) + extrasCents) / 100;
      const totalCents = Math.round(unitPrice * 100 * item.quantity);
      const listCents = Math.round(listPrice * 100 * item.quantity);
      const recipe: Supply[] = p.recipe.map((r) => ({ ingredientId: r.ingredientId, quantity: Number(r.quantity), cost: Number(r.ingredient.cost), trackStock: r.ingredient.trackStock, trackLots: r.ingredient.trackLots }));
      const unitCost = (p.kind === 'preparado' ? recipe.reduce((s, r) => s + r.quantity * r.cost, 0) : Number(p.cost)) + extras.reduce((s, x) => s + x.quantity * x.cost, 0);

      // Aviso de estoque (não bloqueia): soma o que esta venda tira de cada produto.
      let stockWarning: string | null = null;
      const need = [
        ...(p.kind === 'preparado' ? p.recipe.filter((r) => r.ingredient.trackStock).map((r) => ({ id: r.ingredientId, name: r.ingredient.name, unit: r.ingredient.unit, qty: Number(r.quantity) * item.quantity, balances: r.ingredient.balances })) : p.trackStock ? [{ id: p.id, name: p.name, unit: p.unit, qty: item.quantity, balances: p.balances }] : []),
        ...chosen.filter((c) => c.option.supply?.trackStock && c.option.supplyQty != null).map((c) => ({ id: c.option.supply!.id, name: c.option.supply!.name, unit: c.option.supply!.unit, qty: Number(c.option.supplyQty) * item.quantity, balances: c.option.supply!.balances })),
      ];
      for (const n of need) {
        const total = q3((used.get(n.id) ?? 0) + n.qty);
        used.set(n.id, total);
        const has = q3(n.balances.find((b) => b.storeId === storeId)?.quantity);
        if (has < total) stockWarning = `${n.name}: o sistema tem ${String(has).replace('.', ',')} ${n.unit}.`;
      }
      return {
        productId: p.id,
        description: p.name,
        options,
        kind: p.kind as ProductKind,
        unit: p.unit as Unit,
        quantity: item.quantity,
        listPrice,
        unitPrice,
        memberSavings: (listCents - totalCents) / 100,
        total: totalCents / 100,
        stockWarning,
        categoryId: p.categoryId,
        unitCost: Math.round(unitCost * 10000) / 10000,
        trackStock: p.trackStock,
        trackLots: p.trackLots,
        recipe,
        extras,
      };
    });

    const subtotalCents = lines.reduce((s, l) => s + cents(l.total), 0);
    const grossCents = lines.reduce((s, l) => s + Math.round(l.listPrice * 100 * l.quantity), 0);
    const discountCents = cents(input.discount);
    if (discountCents > subtotalCents) throw new DomainError('DISCOUNT_TOO_BIG', 'O desconto é maior que a compra.');
    const afterDiscount = subtotalCents - discountCents;
    const balance = cents(customer?.cashbackBalance);
    const cashbackAvailable = customer ? Math.min(balance, Math.floor((afterDiscount * rules.cashbackMaxUsePct) / 100)) : 0;
    const cashbackUsed = Math.min(cents(input.useCashback), cashbackAvailable);
    const total = afterDiscount - cashbackUsed;
    const wouldSave = member
      ? 0
      : input.items.reduce((s, i) => {
          const p = products.find((x) => x.id === i.productId)!;
          return p.memberPrice != null && Number(p.memberPrice) < Number(p.price) ? s + Math.round((Number(p.price) - Number(p.memberPrice)) * 100 * i.quantity) : s;
        }, 0);
    return {
      subtotalCents,
      lines,
      quote: {
        member,
        customer: customer ? { id: customer.id, name: customer.name, cashbackBalance: balance / 100 } : null,
        items: lines.map(({ categoryId: _c, unitCost: _u, trackStock: _t, trackLots: _l, recipe: _r, extras: _x, ...l }) => l),
        grossTotal: grossCents / 100,
        memberSavings: (grossCents - subtotalCents) / 100,
        discount: discountCents / 100,
        cashbackUsed: cashbackUsed / 100,
        cashbackAvailable: cashbackAvailable / 100,
        total: total / 100,
        cashbackEarned: member ? earned(total, rules) / 100 : 0,
        wouldSaveAsMember: wouldSave / 100,
      },
    };
  }

  private assertStore(ctx: RequestContext, storeId: string) {
    if (!canUseStore(ctx, storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
  }

  private can(ctx: RequestContext, permission: string) {
    return ctx.permissions.includes('*') || ctx.permissions.includes(permission);
  }
}

/** Cashback ganho sobre o que foi pago de verdade (sem contar o cashback usado). */
function earned(totalCents: number, rules: ClubRules): number {
  return rules.cashbackPct > 0 ? Math.floor((totalCents * rules.cashbackPct) / 100) : 0;
}

/** Número da venda sem buraco nem repetição (linha travada pelo próprio UPSERT). */
export async function nextNumber(tx: Tx, tenantId: string, name: string): Promise<number> {
  const rows = await tx.$queryRaw<Array<{ value: number }>>`
    INSERT INTO tenant_sequence (tenant_id, name, value) VALUES (${tenantId}, ${name}, 1)
    ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_sequence.value + 1
    RETURNING value`;
  return Number(rows[0]!.value);
}

function toSale(s: SaleFull, doc: { id: string; status: string; number: string | null; danfeUrl: string | null; message: string | null } | null): Sale {
  const received = s.payments.filter((p) => p.type === 'recebimento');
  const paid = received.reduce((sum, p) => sum + cents(p.amount), 0);
  // Troco = o que a cliente entregou a mais; aqui o caixa já gravou o líquido.
  const changeNote = received.map((p) => p.note?.match(/Troco R\$ ([\d,]+)/)?.[1]).find(Boolean);
  return {
    id: s.id,
    number: s.number,
    storeId: s.storeId,
    storeName: s.store.name,
    channel: s.channel as SaleChannel,
    status: s.status as 'completed' | 'canceled',
    customerId: s.customerId,
    customerName: s.customer?.name ?? null,
    memberPricing: s.memberPricing,
    sellerName: s.seller?.name ?? null,
    items: s.items.map((i) => ({ productId: i.productId, description: i.description, options: (i.options as unknown as ChosenOption[] | null) ?? [], unit: i.unit as Unit, quantity: q3(i.quantity), listPrice: Number(i.listPrice), unitPrice: Number(i.unitPrice), total: Number(i.total) })),
    order: s.order ? { id: s.order.id, number: s.order.number, status: s.order.status } : null,
    grossTotal: Number(s.grossTotal),
    memberSavings: Number(s.memberSavings),
    discount: Number(s.discount),
    cashbackUsed: Number(s.cashbackUsed),
    cashbackEarned: Number(s.cashbackEarned),
    total: Number(s.total),
    change: changeNote ? Number(changeNote.replace(',', '.')) : paid > cents(s.total) ? (paid - cents(s.total)) / 100 : 0,
    payments: s.payments.map((p) => ({ id: p.id, methodName: p.method?.name ?? '—', kind: (p.method?.kind as PaymentKind | undefined) ?? null, amount: Number(p.amount), reversed: Boolean(p.reversal) })),
    notes: s.notes,
    createdAt: s.createdAt.toISOString(),
    canceledAt: s.canceledAt?.toISOString() ?? null,
    cancelReason: s.cancelReason,
    fiscal: doc ? { id: doc.id, status: doc.status, number: doc.number, danfeUrl: doc.danfeUrl, message: doc.message } : null,
  };
}
