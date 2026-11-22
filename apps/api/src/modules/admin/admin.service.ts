import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, categorySchema, customerSchema, normalizePhone, onlyDigits, productSchema, stockMoveSchema, type AuditPage, type AuditQuery, type ImportInput, type ImportResult } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { DomainError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';
import { CustomersService } from '../customers/customers.service';
import { ProductsService } from '../products/products.service';

const PAGE = 100;
/** "Preço Membro" → "preco_membro": a planilha pode vir com acento, maiúscula e espaço. */
const chave = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const sim = (v: string | undefined) => /^(s|sim|x|1|true|membro)$/i.test((v ?? '').trim());
/** 31/12/1990 ou 1990-12-31. */
function dataBR(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (br) return `${br[3]}-${br[2]!.padStart(2, '0')}-${br[1]!.padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}
const motivo = (e: unknown) => {
  const z = e as { issues?: Array<{ message: string; path: Array<string | number> }> };
  if (z.issues?.length) return z.issues.map((i) => `${i.path.join('.') || 'linha'}: ${i.message}`).join('; ');
  return (e as Error).message || 'Erro ao gravar';
};

/** Histórico de alterações (auditoria) e importação de produtos e clientes por planilha. */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly products: ProductsService,
    private readonly customers: CustomersService,
  ) {}

  async auditLog(ctx: RequestContext, q: AuditQuery): Promise<AuditPage> {
    const where: Prisma.AuditLogWhereInput = {
      tenantId: ctx.tenantId,
      createdAt: { gte: new Date(`${q.from}T03:00:00Z`), lt: new Date(`${addDays(q.to, 1)}T03:00:00Z`) },
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.q ? { OR: [{ action: { contains: q.q, mode: 'insensitive' } }, { entityId: { contains: q.q } }] } : {}),
    };
    const [rows, total, entidades, usuarios] = await Promise.all([
      this.prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * PAGE, take: PAGE }),
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({ where: { tenantId: ctx.tenantId }, distinct: ['entity'], select: { entity: true }, orderBy: { entity: 'asc' } }),
      this.prisma.appUser.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const nome = new Map(usuarios.map((u) => [u.id, u.name]));
    return {
      rows: rows.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), userName: r.userId ? (nome.get(r.userId) ?? '—') : null, action: r.action, entity: r.entity, entityId: r.entityId, data: r.data })),
      total,
      page: q.page,
      pageSize: PAGE,
      entities: entidades.map((e) => e.entity),
      users: usuarios,
    };
  }

  /** Confere (dryRun) ou grava as linhas da planilha. Produto que já existe (mesmo código ou código de barras) só tem preço, custo e nome atualizados. */
  async import(ctx: RequestContext, d: ImportInput): Promise<ImportResult> {
    const linhas = d.rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [chave(k), String(v ?? '').trim()])));
    if (!linhas.some((l) => l.nome)) throw new DomainError('IMPORT_NO_NAME', 'A planilha precisa de uma coluna "nome".');
    const out: ImportResult = { dryRun: d.dryRun, created: 0, updated: 0, errors: [] };
    const erro = (i: number, message: string) => out.errors.push({ line: i + 2, message });
    if (d.kind === 'clientes') await this.importCustomers(ctx, linhas, d.dryRun, out, erro);
    else await this.importProducts(ctx, linhas, d.dryRun, out, erro);
    if (!d.dryRun) await this.audit.record(ctx, `import.${d.kind}`, 'import', null, { criados: out.created, atualizados: out.updated, erros: out.errors.length });
    return out;
  }

  private async importCustomers(ctx: RequestContext, linhas: Array<Record<string, string>>, dry: boolean, out: ImportResult, erro: (i: number, m: string) => void) {
    const existentes = await this.prisma.customer.findMany({ where: { tenantId: ctx.tenantId }, select: { phone: true, document: true } });
    const fones = new Set(existentes.map((c) => c.phone).filter(Boolean));
    const docs = new Set(existentes.map((c) => c.document).filter(Boolean));
    for (const [i, l] of linhas.entries()) {
      if (!l.nome && !l.telefone) continue;
      const fone = normalizePhone(l.telefone ?? l.celular ?? l.whatsapp);
      const doc = onlyDigits(l.cpf ?? l.documento) || null;
      const p = customerSchema.safeParse({ name: l.nome, phone: l.telefone ?? l.celular ?? l.whatsapp ?? null, email: l.email || null, document: doc, birthDate: dataBR(l.nascimento ?? l.aniversario), isMember: sim(l.membro) && !!fone });
      if (!p.success) {
        erro(i, motivo(p.error));
        continue;
      }
      if ((fone && fones.has(fone)) || (doc && docs.has(doc))) {
        erro(i, 'Já cadastrada (mesmo celular ou CPF): pulei.');
        continue;
      }
      if (fone) fones.add(fone);
      if (doc) docs.add(doc);
      if (!dry) {
        try {
          await this.customers.create(ctx, p.data);
        } catch (e) {
          erro(i, motivo(e));
          continue;
        }
      }
      out.created++;
    }
  }

  private async importProducts(ctx: RequestContext, linhas: Array<Record<string, string>>, dry: boolean, out: ImportResult, erro: (i: number, m: string) => void) {
    const [existentes, categorias, loja] = await Promise.all([
      this.prisma.product.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, sku: true, barcode: true } }),
      this.prisma.productCategory.findMany({ where: { tenantId: ctx.tenantId } }),
      this.prisma.store.findFirst({ where: { tenantId: ctx.tenantId, ...(ctx.storeIds.length ? { id: { in: ctx.storeIds } } : {}) }, orderBy: { createdAt: 'asc' } }),
    ]);
    const porSku = new Map(existentes.filter((p) => p.sku).map((p) => [p.sku!, p.id]));
    const porEan = new Map(existentes.filter((p) => p.barcode).map((p) => [p.barcode!, p.id]));
    const cat = new Map(categorias.map((c) => [chave(c.name), c.id]));
    for (const [i, l] of linhas.entries()) {
      if (!l.nome) continue;
      const sku = l.codigo || l.sku || null;
      const ean = (l.codigo_barras || l.ean || l.barras || '').replace(/\s/g, '') || null;
      const nomeCat = l.categoria;
      let categoryId: string | null = nomeCat ? (cat.get(chave(nomeCat)) ?? null) : null;
      const p = productSchema.safeParse({ name: l.nome, kind: 'revenda', categoryId: null, sku, barcode: ean, unit: (l.unidade || 'UN').toUpperCase(), price: l.preco || '0', memberPrice: l.preco_membro || null, cost: l.custo || '0', minStock: l.estoque_minimo || '0', ncm: l.ncm || null, brand: l.marca || null });
      if (!p.success) {
        erro(i, motivo(p.error));
        continue;
      }
      const id = (sku && porSku.get(sku)) || (ean && porEan.get(ean)) || null;
      if (dry) {
        if (id) out.updated++;
        else out.created++;
        continue;
      }
      try {
        if (nomeCat && !categoryId) {
          categoryId = (await this.products.saveCategory(ctx, null, categorySchema.parse({ name: nomeCat }))).id;
          cat.set(chave(nomeCat), categoryId);
        }
        if (id) {
          await this.prisma.product.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { name: p.data.name, ...(l.preco ? { price: p.data.price } : {}), ...(l.preco_membro ? { memberPrice: p.data.memberPrice } : {}), ...(l.custo ? { cost: p.data.cost } : {}), ...(categoryId ? { categoryId } : {}), ...(p.data.ncm ? { ncm: p.data.ncm } : {}) } });
          out.updated++;
        } else {
          const novo = await this.products.create(ctx, { ...p.data, categoryId });
          if (sku) porSku.set(sku, novo.id);
          if (ean) porEan.set(ean, novo.id);
          const qtd = Number((l.estoque || '').replace(/\./g, '').replace(',', '.'));
          if (qtd > 0 && loja) await this.products.move(ctx, novo.id, stockMoveSchema.parse({ type: 'entrada', storeId: loja.id, quantity: qtd, unitCost: p.data.cost || undefined, note: 'Estoque inicial (importação)' }));
          out.created++;
        }
      } catch (e) {
        erro(i, motivo(e));
      }
    }
  }
}
