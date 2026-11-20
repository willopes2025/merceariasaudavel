import { Injectable } from '@nestjs/common';
import type { Store, StoreInput } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';

/** Lojas e operações da organização. */
@Injectable()
export class TenancyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------------ lojas

  async stores(ctx: RequestContext): Promise<Store[]> {
    const rows = await this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: 'asc' } });
    return rows.map((s) => this.store(s));
  }

  async createStore(ctx: RequestContext, input: StoreInput): Promise<Store> {
    await this.assertStockStore(ctx, null, input.stockStoreId);
    const row = await this.prisma.store.create({ data: { tenantId: ctx.tenantId, ...input, stockStoreId: input.stockStoreId ?? null } });
    await this.audit.record(ctx, 'store.create', 'store', row.id, { code: row.code });
    return this.store(row);
  }

  async updateStore(ctx: RequestContext, id: string, input: StoreInput): Promise<Store> {
    await this.findStore(ctx, id);
    await this.assertStockStore(ctx, id, input.stockStoreId);
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.store.update({ where: { id }, data: { ...input, stockStoreId: input.stockStoreId ?? null } });
      if (saved.stockStoreId) {
        // Passou a dividir o estoque: o saldo que ela tinha vai para a loja que guarda.
        await tx.$executeRaw`
          INSERT INTO stock_balance (tenant_id, product_id, store_id, quantity)
          SELECT tenant_id, product_id, ${saved.stockStoreId}, quantity FROM stock_balance WHERE store_id = ${id} AND tenant_id = ${ctx.tenantId}
          ON CONFLICT (product_id, store_id) DO UPDATE SET quantity = stock_balance.quantity + EXCLUDED.quantity`;
        await tx.$executeRaw`DELETE FROM stock_balance WHERE store_id = ${id} AND tenant_id = ${ctx.tenantId}`;
      }
      return saved;
    });
    await this.audit.record(ctx, 'store.update', 'store', id, { code: row.code, active: row.active });
    return this.store(row);
  }

  // ------------------------------------------------------------ operações

  // ------------------------------------------------------------ apoio

  private async findStore(ctx: RequestContext, id: string) {
    const store = await this.prisma.store.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!store) throw new NotFoundError('loja', id);
    return store;
  }

  /** Estoque compartilhado: aponta para outra loja, que tem estoque próprio. Sem corrente. */
  private async assertStockStore(ctx: RequestContext, id: string | null, stockStoreId: string | null | undefined): Promise<void> {
    if (!stockStoreId) return;
    if (stockStoreId === id) throw new DomainError('STOCK_STORE_SELF', 'Para estoque próprio, deixe em branco.');
    const target = await this.prisma.store.findFirst({ where: { id: stockStoreId, tenantId: ctx.tenantId } });
    if (!target) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada nesta organização');
    if (target.stockStoreId) throw new DomainError('STOCK_STORE_CHAIN', `A loja ${target.name} já usa o estoque de outra. Escolha a loja que guarda o estoque.`);
    if (id && (await this.prisma.store.count({ where: { tenantId: ctx.tenantId, stockStoreId: id } }))) throw new DomainError('STOCK_STORE_CHAIN', 'Outra loja usa o estoque desta. Mude a outra primeiro.');
  }

  private async assertStore(ctx: RequestContext, storeId: string | null | undefined): Promise<void> {
    if (!storeId) return;
    const store = await this.prisma.store.findFirst({ where: { id: storeId, tenantId: ctx.tenantId } });
    if (!store) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada nesta organização');
  }

  private store(s: { id: string; code: string; name: string; cnpj: string | null; phone: string | null; address: string | null; active: boolean; stockStoreId: string | null }): Store {
    return { id: s.id, code: s.code, name: s.name, cnpj: s.cnpj, phone: s.phone, address: s.address, active: s.active, stockStoreId: s.stockStoreId };
  }

}
