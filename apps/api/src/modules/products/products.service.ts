import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  normalizeText,
  stockStores,
  todayBR,
  type Category,
  type CategoryInput,
  type ExpiringLot,
  type LossReason,
  type Page,
  type Product,
  type ProductDetail,
  type ProductInput,
  type ProductKind,
  type ProductListQuery,
  type ProductOption,
  type RecipeInput,
  type StockByStore,
  type StockMoveInput,
  type StockMovementType,
  type Unit,
} from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { applyStock, currentStock, putStock, q3, stockStoreOf, takeStock } from './stock';

const include = {
  balances: true,
  category: { select: { name: true } },
  recipe: { include: { ingredient: { select: { cost: true } } } },
} satisfies Prisma.ProductInclude;
type Row = Prisma.ProductGetPayload<{ include: typeof include }>;

const DAY = 86_400_000;
const daysUntil = (d: Date | null, today = todayBR()) => (d ? Math.round((d.getTime() - new Date(`${today}T00:00:00Z`).getTime()) / DAY) : null);
const c4 = (v: number) => Math.round(v * 10000) / 10000;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ consulta

  async list(ctx: RequestContext, q: ProductListQuery): Promise<Page<Product>> {
    const where: Prisma.ProductWhereInput = { tenantId: ctx.tenantId };
    if (q.status !== 'all') where.active = q.status === 'active';
    if (q.kind) where.kind = q.kind;
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.q) {
      const words = normalizeText(q.q).split(' ').filter(Boolean);
      where.OR = [{ barcode: q.q.trim() }, { sku: q.q.trim() }, { AND: words.map((w) => ({ searchText: { contains: w } })) }];
    }
    if (q.stock !== 'all') {
      where.trackStock = true;
      const ids =
        q.stock === 'out'
          ? await this.prisma.$queryRaw<Array<{ id: string }>>`
              SELECT p.id FROM product p WHERE p.tenant_id = ${ctx.tenantId} AND p.track_stock
                AND (NOT EXISTS (SELECT 1 FROM stock_balance b WHERE b.product_id = p.id AND b.quantity > 0))`
          : await this.prisma.$queryRaw<Array<{ id: string }>>`
              SELECT p.id FROM product p WHERE p.tenant_id = ${ctx.tenantId} AND p.track_stock AND p.min_stock > 0
                AND COALESCE((SELECT SUM(b.quantity) FROM stock_balance b WHERE b.product_id = p.id), 0) < p.min_stock`;
      where.id = { in: ids.map((r) => r.id) };
    }
    const [total, rows, stores] = await Promise.all([
      this.prisma.product.count({ where }),
      this.prisma.product.findMany({ where, include, orderBy: { name: 'asc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      this.stores(ctx),
    ]);
    return { items: rows.map((r) => toProduct(r, stores)), total, page: q.page, pageSize: q.pageSize };
  }

  /**
   * Para o caixa. Código de barras/código interno exato vem primeiro (o leitor
   * manda o código inteiro); senão, busca por nome. Só o que é vendável.
   */
  async lookup(ctx: RequestContext, q: string, storeId?: string): Promise<ProductOption[]> {
    const text = q.trim();
    if (!text) return [];
    const words = normalizeText(text).split(' ').filter(Boolean);
    const base: Prisma.ProductWhereInput = { tenantId: ctx.tenantId, active: true, sellable: true };
    const exact = await this.prisma.product.findMany({ where: { ...base, OR: [{ barcode: text }, { sku: text }] }, include, take: 1 });
    const rows = exact.length
      ? exact
      : await this.prisma.product.findMany({ where: { ...base, AND: words.map((w) => ({ searchText: { contains: w } })) }, include, orderBy: { name: 'asc' }, take: 12 });
    const realStore = storeId ? await stockStoreOf(this.prisma as unknown as Prisma.TransactionClient, storeId) : null;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      kind: r.kind as ProductKind,
      barcode: r.barcode,
      sku: r.sku,
      unit: r.unit as Unit,
      soldByWeight: r.soldByWeight,
      price: Number(r.price),
      memberPrice: r.memberPrice == null ? null : Number(r.memberPrice),
      trackStock: r.trackStock,
      stock: r.trackStock ? q3(r.balances.find((b) => b.storeId === realStore)?.quantity ?? (realStore ? 0 : r.balances.reduce((s, b) => s + Number(b.quantity), 0))) : null,
      categoryName: r.category?.name ?? null,
    }));
  }

  async get(ctx: RequestContext, id: string): Promise<ProductDetail> {
    const [row, stores] = await Promise.all([this.prisma.product.findFirst({ where: { id, tenantId: ctx.tenantId }, include }), this.stores(ctx)]);
    if (!row) throw new NotFoundError('produto', id);
    const [movements, lots, recipe, usedIn, allStores] = await Promise.all([
      this.prisma.stockMovement.findMany({ where: { tenantId: ctx.tenantId, productId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.prisma.stockLot.findMany({ where: { tenantId: ctx.tenantId, productId: id, quantity: { gt: 0 } }, orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }] }),
      this.prisma.recipeItem.findMany({ where: { tenantId: ctx.tenantId, productId: id }, include: { ingredient: { select: { name: true, unit: true, cost: true } } } }),
      this.prisma.recipeItem.findMany({ where: { tenantId: ctx.tenantId, ingredientId: id }, include: { product: { select: { name: true } } } }),
      this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    ]);
    const userIds = [...new Set(movements.map((m) => m.userId))];
    const saleIds = [...new Set(movements.map((m) => m.saleId).filter((v): v is string => Boolean(v)))];
    const lotIds = [...new Set(movements.map((m) => m.lotId).filter((v): v is string => Boolean(v)))];
    const [users, sales, movLots] = await Promise.all([
      userIds.length ? this.prisma.appUser.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [],
      saleIds.length ? this.prisma.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, number: true } }) : [],
      lotIds.length ? this.prisma.stockLot.findMany({ where: { id: { in: lotIds } }, select: { id: true, code: true } }) : [],
    ]);
    const storeName = new Map(allStores.map((s) => [s.id, s.name]));
    return {
      ...toProduct(row, stores),
      lots: lots.map((l) => ({ id: l.id, storeId: l.storeId, storeName: storeName.get(l.storeId) ?? '', code: l.code, expiresAt: l.expiresAt?.toISOString().slice(0, 10) ?? null, quantity: q3(l.quantity), daysLeft: daysUntil(l.expiresAt) })),
      movements: movements.map((m) => ({
        id: m.id,
        type: m.type as StockMovementType,
        storeName: storeName.get(m.storeId) ?? '',
        delta: q3(m.delta),
        balanceAfter: q3(m.balanceAfter),
        lotCode: m.lotId ? (movLots.find((l) => l.id === m.lotId)?.code ?? null) : null,
        reason: m.reason as LossReason | null,
        note: m.note,
        saleId: m.saleId,
        saleNumber: m.saleId ? (sales.find((s) => s.id === m.saleId)?.number ?? null) : null,
        userName: users.find((u) => u.id === m.userId)?.name ?? null,
        at: m.createdAt.toISOString(),
      })),
      recipe: recipe.map((r) => ({
        ingredientId: r.ingredientId,
        ingredientName: r.ingredient.name,
        unit: r.ingredient.unit as Unit,
        quantity: c4(Number(r.quantity)),
        unitCost: Number(r.ingredient.cost),
        cost: Math.round(Number(r.quantity) * Number(r.ingredient.cost) * 100) / 100,
      })),
      usedIn: usedIn.map((u) => ({ productId: u.productId, name: u.product.name, quantity: c4(Number(u.quantity)) })),
    };
  }

  // ------------------------------------------------------------ cadastro

  async create(ctx: RequestContext, input: ProductInput): Promise<ProductDetail> {
    await this.assertCategory(ctx, input.categoryId);
    try {
      const row = await this.prisma.product.create({ data: { tenantId: ctx.tenantId, ...this.data(input) } });
      await this.audit.record(ctx, 'product.create', 'product', row.id, { name: row.name, price: input.price, memberPrice: input.memberPrice });
      return this.get(ctx, row.id);
    } catch (e) {
      throw this.unique(e);
    }
  }

  async update(ctx: RequestContext, id: string, input: ProductInput): Promise<ProductDetail> {
    const current = await this.prisma.product.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!current) throw new NotFoundError('produto', id);
    await this.assertCategory(ctx, input.categoryId);
    if (current.kind !== input.kind && current.kind === 'preparado' && (await this.prisma.recipeItem.count({ where: { productId: id } })))
      throw new DomainError('HAS_RECIPE', 'Esse preparado tem ficha técnica. Apague a ficha antes de mudar o tipo.');
    if (input.kind === 'preparado' && current.kind !== 'preparado' && (await this.prisma.stockBalance.count({ where: { productId: id, quantity: { not: 0 } } })))
      throw new DomainError('HAS_STOCK', 'Esse produto tem estoque. Zere o estoque antes de transformar em preparado.');
    try {
      await this.prisma.product.update({ where: { id }, data: this.data(input) });
    } catch (e) {
      throw this.unique(e);
    }
    const priceChanged = Number(current.price) !== input.price || (current.memberPrice == null ? null : Number(current.memberPrice)) !== input.memberPrice;
    await this.audit.record(ctx, 'product.update', 'product', id, { name: input.name, ...(priceChanged ? { price: input.price, memberPrice: input.memberPrice, before: { price: Number(current.price), memberPrice: current.memberPrice == null ? null : Number(current.memberPrice) } } : {}) });
    return this.get(ctx, id);
  }

  /** Ficha técnica do preparado. Substitui a ficha inteira. */
  async saveRecipe(ctx: RequestContext, id: string, input: RecipeInput): Promise<ProductDetail> {
    const product = await this.prisma.product.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!product) throw new NotFoundError('produto', id);
    if (product.kind !== 'preparado') throw new DomainError('NOT_PREPARED', 'Só produto do tipo "preparado na loja" tem ficha técnica.');
    const ids = input.items.map((i) => i.ingredientId);
    if (ids.includes(id)) throw new DomainError('RECIPE_SELF', 'O preparado não pode ser insumo dele mesmo.');
    const ingredients = ids.length ? await this.prisma.product.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId }, select: { id: true, kind: true, name: true } }) : [];
    if (ingredients.length !== ids.length) throw new DomainError('PRODUCT_NOT_FOUND', 'Um dos insumos não foi encontrado.');
    const nested = ingredients.find((i) => i.kind === 'preparado');
    if (nested) throw new DomainError('RECIPE_NESTED', `"${nested.name}" também é um preparado. Use os insumos dele direto na ficha.`);
    await this.prisma.$transaction(async (tx) => {
      await tx.recipeItem.deleteMany({ where: { productId: id, tenantId: ctx.tenantId } });
      if (input.items.length) await tx.recipeItem.createMany({ data: input.items.map((i) => ({ tenantId: ctx.tenantId, productId: id, ingredientId: i.ingredientId, quantity: i.quantity })) });
    });
    await this.audit.record(ctx, 'product.recipe', 'product', id, { items: input.items.length });
    return this.get(ctx, id);
  }

  // ------------------------------------------------------------ estoque

  /** Entrada, perda, saída, acerto ou transferência entre lojas. */
  async move(ctx: RequestContext, productId: string, input: StockMoveInput): Promise<ProductDetail> {
    const product = await this.prisma.product.findFirst({ where: { id: productId, tenantId: ctx.tenantId } });
    if (!product) throw new NotFoundError('produto', productId);
    if (!product.trackStock) throw new DomainError('NO_STOCK_CONTROL', product.kind === 'preparado' ? 'Preparado não tem estoque: quem tem são os insumos da ficha técnica.' : 'Esse produto não controla estoque.');
    if (input.type === 'entrada' && product.trackLots && !input.lotCode) throw new DomainError('LOT_REQUIRED', 'Esse produto controla lote: informe o lote e a validade.');
    if (!product.unit.match(/KG|G|L|ML/) && 'quantity' in input && !Number.isInteger(input.quantity) && input.type !== 'ajuste')
      throw new DomainError('WHOLE_QUANTITY', `"${product.name}" é contado em ${product.unit}: use número inteiro.`);
    const storeIds = [input.storeId, ...(input.type === 'transferencia' ? [input.toStoreId] : [])];
    const all = await this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, stockStoreId: true } });
    const real = (id: string) => all.find((s) => s.id === id)?.stockStoreId ?? id;
    for (const s of storeIds) {
      if (!all.some((x) => x.id === s)) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
      if (!all.some((x) => real(x.id) === real(s) && canUseStore(ctx, x.id))) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
    }
    if (input.type === 'transferencia' && real(input.storeId) === real(input.toStoreId)) throw new DomainError('SAME_STORE', 'Essas lojas usam o mesmo estoque: não há o que transferir.');

    const cost = Number(product.cost);
    const base = { tenantId: ctx.tenantId, productId, userId: ctx.userId, note: input.note ?? null, unitCost: cost };
    const lots = { trackLots: product.trackLots };
    await this.prisma.$transaction(async (tx) => {
      // Trava o produto: acerto e transferência leem o saldo antes de gravar.
      await tx.$queryRaw`SELECT id FROM product WHERE id = ${productId} FOR UPDATE`;
      if (input.type === 'entrada') {
        const unitCost = input.unitCost != null ? input.unitCost : cost;
        await putStock(tx, { ...base, storeId: input.storeId, type: 'entrada', unitCost }, input.quantity, product.trackLots ? { code: input.lotCode!, expiresAt: input.expiresAt } : null);
        if (input.unitCost != null && input.unitCost > 0) await tx.product.update({ where: { id: productId }, data: { cost: input.unitCost } });
      } else if (input.type === 'perda') {
        await takeStock(tx, { ...base, storeId: input.storeId, type: 'perda', reason: input.reason }, input.quantity, { ...lots, lotId: input.lotId ?? null });
      } else if (input.type === 'saida') {
        if ((await currentStock(tx, productId, input.storeId)) < input.quantity) throw new ConflictError('NOT_ENOUGH_STOCK', 'Não há essa quantidade em estoque nessa loja.');
        await takeStock(tx, { ...base, storeId: input.storeId, type: 'saida' }, input.quantity, lots);
      } else if (input.type === 'ajuste') {
        const now = await currentStock(tx, productId, input.storeId);
        const diff = q3(input.quantity - now);
        if (diff === 0) throw new ConflictError('NO_CHANGE', `O sistema já está com ${String(now).replace('.', ',')}.`);
        const note = input.note ?? `Contagem: ${String(input.quantity).replace('.', ',')} (sistema tinha ${String(now).replace('.', ',')})`;
        if (diff < 0) await takeStock(tx, { ...base, storeId: input.storeId, type: 'ajuste', note }, -diff, lots);
        else await applyStock(tx, { ...base, storeId: input.storeId, type: 'ajuste', delta: diff, note });
      } else {
        if ((await currentStock(tx, productId, input.storeId)) < input.quantity) throw new ConflictError('NOT_ENOUGH_STOCK', 'Não há essa quantidade na loja de origem.');
        await takeStock(tx, { ...base, storeId: input.storeId, type: 'transferencia' }, input.quantity, { trackLots: false });
        await applyStock(tx, { ...base, storeId: input.toStoreId, type: 'transferencia', delta: input.quantity });
      }
    });
    if (input.type === 'perda') await this.audit.record(ctx, 'stock.loss', 'product', productId, { quantity: input.quantity, reason: input.reason, value: Math.round(input.quantity * cost * 100) / 100 });
    return this.get(ctx, productId);
  }

  /** Lotes vencendo nos próximos `days` dias (e os já vencidos que ainda têm saldo). */
  async expiring(ctx: RequestContext, days: number, storeId?: string): Promise<ExpiringLot[]> {
    const limit = new Date(`${todayBR()}T00:00:00Z`).getTime() + days * DAY;
    const rows = await this.prisma.stockLot.findMany({
      where: { tenantId: ctx.tenantId, quantity: { gt: 0 }, expiresAt: { not: null, lte: new Date(limit) }, ...(storeId ? { storeId } : {}) },
      include: { product: { select: { name: true, unit: true, cost: true, active: true } } },
      orderBy: { expiresAt: 'asc' },
      take: 200,
    });
    const stores = new Map((await this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
    return rows
      .filter((l) => canUseStore(ctx, l.storeId) || !ctx.storeIds.length)
      .map((l) => ({
        id: l.id,
        storeId: l.storeId,
        storeName: stores.get(l.storeId) ?? '',
        code: l.code,
        expiresAt: l.expiresAt!.toISOString().slice(0, 10),
        quantity: q3(l.quantity),
        daysLeft: daysUntil(l.expiresAt)!,
        productId: l.productId,
        productName: l.product.name,
        unit: l.product.unit as Unit,
        value: Math.round(Number(l.quantity) * Number(l.product.cost) * 100) / 100,
      }));
  }

  // ------------------------------------------------------------ categorias

  async categories(ctx: RequestContext): Promise<Category[]> {
    const rows = await this.prisma.productCategory.findMany({ where: { tenantId: ctx.tenantId }, include: { _count: { select: { products: true } } }, orderBy: { name: 'asc' } });
    return rows.map((r) => ({ id: r.id, name: r.name, active: r.active, products: r._count.products }));
  }

  async saveCategory(ctx: RequestContext, id: string | null, input: CategoryInput): Promise<Category> {
    try {
      if (id) {
        const found = await this.prisma.productCategory.findFirst({ where: { id, tenantId: ctx.tenantId } });
        if (!found) throw new NotFoundError('categoria', id);
        await this.prisma.productCategory.update({ where: { id }, data: input });
      } else {
        id = (await this.prisma.productCategory.create({ data: { tenantId: ctx.tenantId, ...input } })).id;
      }
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictError('CATEGORY_TAKEN', 'Já existe uma categoria com esse nome.');
      throw e;
    }
    return (await this.categories(ctx)).find((c) => c.id === id)!;
  }

  // ------------------------------------------------------------ apoio

  private data(input: ProductInput) {
    return {
      name: input.name,
      kind: input.kind,
      categoryId: input.categoryId,
      brand: input.brand,
      sku: input.sku,
      barcode: input.barcode,
      unit: input.unit,
      soldByWeight: input.soldByWeight,
      price: input.price,
      memberPrice: input.memberPrice,
      cost: input.cost,
      trackStock: input.trackStock,
      trackLots: input.trackLots,
      minStock: input.minStock,
      sellable: input.sellable,
      supplier: input.supplier,
      active: input.active,
      // Sem o campo na requisição, o que está gravado fica.
      ...(input.ncm !== undefined ? { ncm: input.ncm } : {}),
      ...(input.cest !== undefined ? { cest: input.cest } : {}),
      searchText: normalizeText([input.name, input.brand, input.sku, input.barcode].filter(Boolean).join(' ')),
    };
  }

  private async assertCategory(ctx: RequestContext, id: string | null) {
    if (id && !(await this.prisma.productCategory.count({ where: { id, tenantId: ctx.tenantId } }))) throw new DomainError('CATEGORY_NOT_FOUND', 'Categoria não encontrada.');
  }

  private unique(e: unknown) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const target = String((e.meta as { target?: unknown } | undefined)?.target ?? '');
      return new ConflictError(target.includes('barcode') ? 'BARCODE_TAKEN' : 'SKU_TAKEN', target.includes('barcode') ? 'Já existe um produto com esse código de barras.' : 'Já existe um produto com esse código.');
    }
    return e;
  }

  private async stores(ctx: RequestContext): Promise<Map<string, string>> {
    const rows = await this.prisma.store.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, name: true, stockStoreId: true }, orderBy: { name: 'asc' } });
    return new Map(stockStores(rows).map((s) => [s.id, s.name]));
  }
}

export function toProduct(r: Row, stores: Map<string, string>): Product {
  const stock: StockByStore[] = r.trackStock
    ? [...stores.entries()].map(([storeId, storeName]) => ({ storeId, storeName, quantity: q3(r.balances.find((b) => b.storeId === storeId)?.quantity) }))
    : [];
  const minStock = q3(r.minStock);
  const recipeCost = r.kind === 'preparado' ? Math.round(r.recipe.reduce((s, i) => s + Number(i.quantity) * Number(i.ingredient.cost), 0) * 100) / 100 : null;
  return {
    id: r.id,
    name: r.name,
    kind: r.kind as ProductKind,
    categoryId: r.categoryId,
    categoryName: r.category?.name ?? null,
    brand: r.brand,
    sku: r.sku,
    barcode: r.barcode,
    unit: r.unit as Unit,
    soldByWeight: r.soldByWeight,
    price: Number(r.price),
    memberPrice: r.memberPrice == null ? null : Number(r.memberPrice),
    cost: Number(r.cost),
    trackStock: r.trackStock,
    trackLots: r.trackLots,
    minStock,
    sellable: r.sellable,
    ncm: r.ncm,
    cest: r.cest,
    supplier: r.supplier,
    active: r.active,
    stock,
    totalStock: q3(stock.reduce((s, b) => s + b.quantity, 0)),
    low: r.trackStock && minStock > 0 && stock.some((b) => b.quantity < minStock),
    recipeCost,
  };
}
