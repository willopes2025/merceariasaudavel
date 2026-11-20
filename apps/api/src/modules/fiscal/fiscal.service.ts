import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { FiscalConfig, FiscalConfigInput, FiscalDocument, FiscalEmitInput, FiscalEnvironment, FiscalListQuery, FiscalPreview, FiscalStatus, Page } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { FocusNfeClient, FocusUnreachable, focusMessage, type FocusReply } from './focus.client';
import { draftNfce, nfcePayload, type NfceDraft } from './nfce.builder';
import { open, seal } from './secret-box';

type ConfigRow = Prisma.FiscalConfigGetPayload<object>;
type DocRow = Prisma.FiscalDocumentGetPayload<object>;
type StoreRow = { id: string; name: string; cnpj: string | null };

const DEFAULTS = { enabled: false, autoEmit: true, environment: 'homologacao', cfop: '5102', icmsOrigin: '0', icmsCst: '102', defaultNcm: null as string | null };
const ACTIVE: FiscalStatus[] = ['processing', 'authorized'];
const brStart = (iso: string) => new Date(`${iso}T00:00:00-03:00`);

/** Nota fiscal (NFC-e) pela Focus NFe. Desligada até a loja ser configurada. */
@Injectable()
export class FiscalService {
  private readonly logger = new Logger('Fiscal');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly focus: FocusNfeClient,
  ) {}

  // ------------------------------------------------------------ configuração

  async configs(ctx: RequestContext): Promise<FiscalConfig[]> {
    const [stores, rows] = await Promise.all([
      this.prisma.store.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, name: true, cnpj: true }, orderBy: { name: 'asc' } }),
      this.prisma.fiscalConfig.findMany({ where: { tenantId: ctx.tenantId } }),
    ]);
    return stores.map((s) => this.toConfig(s, rows.find((r) => r.storeId === s.id) ?? null));
  }

  async saveConfig(ctx: RequestContext, storeId: string, input: FiscalConfigInput): Promise<FiscalConfig> {
    const store = await this.prisma.store.findFirst({ where: { id: storeId, tenantId: ctx.tenantId }, select: { id: true, name: true, cnpj: true } });
    if (!store) throw new NotFoundError('loja', storeId);
    const tokens = {
      ...(input.tokenHomologacao !== undefined ? { tokenHomologacao: input.tokenHomologacao ? seal(input.tokenHomologacao) : null } : {}),
      ...(input.tokenProducao !== undefined ? { tokenProducao: input.tokenProducao ? seal(input.tokenProducao) : null } : {}),
    };
    const data = { enabled: input.enabled, autoEmit: input.autoEmit, environment: input.environment, cfop: input.cfop, icmsOrigin: input.icmsOrigin, icmsCst: input.icmsCst, defaultNcm: input.defaultNcm ?? null, ...tokens };
    const row = await this.prisma.fiscalConfig.upsert({ where: { storeId }, create: { storeId, tenantId: ctx.tenantId, ...data }, update: data });
    // O token nunca vai para o histórico: só o que mudou em volta dele.
    await this.audit.record(ctx, 'fiscal.config', 'store', storeId, { enabled: row.enabled, environment: row.environment, tokenChanged: Object.keys(tokens) });
    return this.toConfig(store, row);
  }

  /** Confere com a Focus NFe se o token do ambiente escolhido é aceito. Não emite nada. */
  async testConfig(ctx: RequestContext, storeId: string): Promise<{ ok: boolean; message: string }> {
    const s = await this.setup(ctx.tenantId, storeId);
    if (!s.token) return { ok: false, message: `Grave primeiro o token de ${s.environment === 'producao' ? 'produção' : 'homologação'}.` };
    try {
      const r = await this.focus.getNfce(s.token, s.environment, `mercearia-teste-${randomUUID()}`);
      // Nota que não existe = 404: o token foi aceito.
      if (r.http === 404 || r.http === 200) return { ok: true, message: 'Token aceito pela Focus NFe.' };
      return { ok: false, message: focusMessage(r) };
    } catch (e) {
      return { ok: false, message: `Não consegui falar com a Focus NFe (${(e as Error).message}).` };
    }
  }

  // ------------------------------------------------------------ nota da venda

  /** A loja emite sozinha ao finalizar a venda? (ligada, automática e com token) */
  async autoEmitReady(tenantId: string, storeId: string): Promise<boolean> {
    const s = await this.setup(tenantId, storeId);
    return s.ready && s.autoEmit;
  }

  async preview(ctx: RequestContext, saleId: string): Promise<FiscalPreview> {
    const { preview } = await this.prepare(ctx, saleId);
    return preview;
  }

  async emit(ctx: RequestContext, saleId: string, input: Partial<FiscalEmitInput>): Promise<FiscalDocument> {
    const { preview, draft, sale, setup } = await this.prepare(ctx, saleId);
    if (preview.documents.some((d) => ACTIVE.includes(d.status))) throw new ConflictError('FISCAL_ALREADY_ISSUED', 'Esta venda já tem uma nota autorizada ou em processamento.');
    if (preview.problems.length) throw new DomainError('FISCAL_BLOCKED', preview.problems.join(' '));
    const document = input.cpf ?? preview.customer.document;
    const customer = input.includeCustomer !== false && document ? { name: preview.customer.name, document } : null;
    const payload = nfcePayload({ cnpj: setup.cnpj!, saleNumber: sale.number, cfop: setup.cfop, icmsOrigin: setup.icmsOrigin, icmsCst: setup.icmsCst, customer, draft });
    const ref = `mercearia${randomUUID().replace(/-/g, '')}`;

    // Grava ANTES de enviar: se a resposta se perder, a referência fica para consultar (nunca emite duas).
    const doc = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM sale WHERE id = ${saleId} FOR UPDATE`;
      if (await tx.fiscalDocument.count({ where: { saleId, tenantId: ctx.tenantId, status: { in: ACTIVE } } })) throw new ConflictError('FISCAL_ALREADY_ISSUED', 'Esta venda já tem uma nota autorizada ou em processamento.');
      return tx.fiscalDocument.create({
        data: {
          tenantId: ctx.tenantId,
          storeId: sale.storeId,
          saleId,
          ref,
          environment: setup.environment,
          total: draft.total,
          customerName: preview.customer.name,
          customerDocument: customer?.document ?? null,
          payload: payload as Prisma.InputJsonValue,
          userId: ctx.userId,
        },
      });
    });

    let saved: DocRow;
    try {
      saved = await this.apply(doc, await this.focus.emitNfce(setup.token!, setup.environment, ref, payload));
    } catch (e) {
      if (!(e instanceof FocusUnreachable)) throw e;
      this.logger.warn(`Sem resposta da Focus NFe para ${ref}: ${e.message}`);
      saved = await this.prisma.fiscalDocument.update({ where: { id: doc.id }, data: { message: 'Sem resposta da Focus NFe. Clique em Atualizar para saber se a nota saiu.' } });
    }
    await this.audit.record(ctx, 'fiscal.emit', 'sale', saleId, { documentId: doc.id, status: saved.status, environment: saved.environment, total: draft.total });
    return (await this.toDocs(ctx, [saved]))[0]!;
  }

  /** Pergunta de novo à Focus NFe como está a nota. */
  async refresh(ctx: RequestContext, id: string): Promise<FiscalDocument> {
    const doc = await this.findDoc(ctx, id);
    const s = await this.setup(ctx.tenantId, doc.storeId, doc.environment as FiscalEnvironment);
    if (!s.token) throw new DomainError('FISCAL_NO_TOKEN', 'O token desse ambiente não está mais gravado na configuração fiscal.');
    const r = await this.reach(() => this.focus.getNfce(s.token!, s.environment, doc.ref));
    const saved =
      r.http === 404
        ? await this.prisma.fiscalDocument.update({ where: { id }, data: { status: 'error', message: 'A nota não chegou à Focus NFe. Pode emitir de novo.' } })
        : await this.apply(doc, r);
    return (await this.toDocs(ctx, [saved]))[0]!;
  }

  async cancel(ctx: RequestContext, id: string, reason: string): Promise<FiscalDocument> {
    const doc = await this.findDoc(ctx, id);
    if (doc.status !== 'authorized') throw new ConflictError('FISCAL_NOT_AUTHORIZED', 'Só dá para cancelar nota autorizada.');
    const s = await this.setup(ctx.tenantId, doc.storeId, doc.environment as FiscalEnvironment);
    if (!s.token) throw new DomainError('FISCAL_NO_TOKEN', 'O token desse ambiente não está mais gravado na configuração fiscal.');
    const r = await this.reach(() => this.focus.cancelNfce(s.token!, s.environment, doc.ref, reason));
    if (r.body.status !== 'cancelado') throw new DomainError('FISCAL_CANCEL_REFUSED', `A SEFAZ não cancelou: ${focusMessage(r)}`);
    const saved = await this.prisma.fiscalDocument.update({
      where: { id },
      data: { status: 'canceled', canceledAt: new Date(), cancelReason: reason, canceledById: ctx.userId, sefazStatus: r.body.status_sefaz ?? doc.sefazStatus, message: r.body.mensagem_sefaz ?? 'Cancelada' },
    });
    await this.audit.record(ctx, 'fiscal.cancel', 'sale', doc.saleId, { documentId: id, reason });
    return (await this.toDocs(ctx, [saved]))[0]!;
  }

  async list(ctx: RequestContext, q: FiscalListQuery): Promise<Page<FiscalDocument>> {
    const where: Prisma.FiscalDocumentWhereInput = { tenantId: ctx.tenantId };
    if (ctx.storeIds.length) where.storeId = { in: q.storeId ? ctx.storeIds.filter((s) => s === q.storeId) : ctx.storeIds };
    else if (q.storeId) where.storeId = q.storeId;
    if (q.status !== 'all') where.status = q.status;
    if (q.from || q.to) where.createdAt = { ...(q.from ? { gte: brStart(q.from) } : {}), ...(q.to ? { lt: new Date(brStart(q.to).getTime() + 86_400_000) } : {}) };
    const [total, rows] = await Promise.all([
      this.prisma.fiscalDocument.count({ where }),
      this.prisma.fiscalDocument.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    return { items: await this.toDocs(ctx, rows), total, page: q.page, pageSize: q.pageSize };
  }

  // ------------------------------------------------------------ apoio

  /** Lê a venda e monta o que iria na nota. */
  private async prepare(ctx: RequestContext, saleId: string) {
    const sale = await this.prisma.sale.findFirst({
      where: { id: saleId, tenantId: ctx.tenantId },
      include: { items: { orderBy: { position: 'asc' } }, customer: { select: { name: true, document: true } } },
    });
    if (!sale) throw new NotFoundError('venda', saleId);
    if (!canUseStore(ctx, sale.storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');

    const productIds = [...new Set(sale.items.map((i) => i.productId))];
    const [setup, products, movements, docs] = await Promise.all([
      this.setup(ctx.tenantId, sale.storeId),
      this.prisma.product.findMany({ where: { id: { in: productIds }, tenantId: ctx.tenantId }, select: { id: true, kind: true, ncm: true, cest: true, unit: true, sku: true, barcode: true } }),
      // O que entrou no caixa por esta venda (sem os estornados).
      this.prisma.cashMovement.findMany({ where: { tenantId: ctx.tenantId, saleId, type: 'recebimento', reversal: null }, include: { method: { select: { kind: true } } }, orderBy: { createdAt: 'asc' } }),
      this.prisma.fiscalDocument.findMany({ where: { tenantId: ctx.tenantId, saleId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const byId = new Map(products.map((p) => [p.id, p]));
    // Desconto do caixa e cashback usado entram como desconto, repartido entre os itens.
    const discounts = spread(sale.items.map((i) => Number(i.total)), Number(sale.discount) + Number(sale.cashbackUsed));
    const draft: NfceDraft = draftNfce(
      sale.items.map((i, n) => ({ description: i.description, quantity: Number(i.quantity), unitPrice: Number(i.unitPrice), discount: discounts[n]!, product: byId.get(i.productId) ?? null })),
      movements.map((m) => ({ kind: m.method?.kind ?? 'outro', amount: Number(m.amount) })),
      setup.defaultNcm,
    );

    const problems: string[] = [];
    if (!setup.ready) problems.push(`A nota fiscal desta loja ainda não está configurada: ${setup.missing.join('; ')}.`);
    if (sale.status === 'canceled') problems.push('Esta venda está cancelada.');
    if (docs.some((d) => ACTIVE.includes(d.status as FiscalStatus))) problems.push('Esta venda já tem uma nota autorizada ou em processamento.');
    else problems.push(...draft.problems);

    const preview: FiscalPreview = {
      ready: setup.ready,
      missing: setup.missing,
      environment: setup.environment,
      customer: { name: sale.customer?.name ?? 'Consumidor', document: sale.customer?.document ?? null },
      items: draft.items.map(({ description, ncm, quantity, unitPrice, discount, total }) => ({ description, ncm, quantity, unitPrice, discount, total })),
      excluded: draft.excluded,
      payments: draft.payments,
      total: draft.total,
      problems,
      documents: await this.toDocs(ctx, docs),
    };
    return { preview, draft, sale, setup };
  }

  /** Configuração da loja já com o token aberto. `environment` força o ambiente (nota antiga). */
  private async setup(tenantId: string, storeId: string, environment?: FiscalEnvironment) {
    const [store, row] = await Promise.all([
      this.prisma.store.findFirst({ where: { id: storeId, tenantId }, select: { id: true, name: true, cnpj: true } }),
      this.prisma.fiscalConfig.findFirst({ where: { storeId, tenantId } }),
    ]);
    if (!store) throw new NotFoundError('loja', storeId);
    const config = this.toConfig(store, row);
    const env = environment ?? config.environment;
    const token = open(env === 'producao' ? row?.tokenProducao : row?.tokenHomologacao);
    return { ...config, environment: env, token, ready: config.ready && Boolean(token) };
  }

  private toConfig(store: StoreRow, row: ConfigRow | null): FiscalConfig {
    const c = row ?? DEFAULTS;
    const environment = (c.environment === 'producao' ? 'producao' : 'homologacao') as FiscalEnvironment;
    // "Gravado" só conta se ainda abre com o segredo atual do servidor.
    const tokenHomologacaoSet = Boolean(open(row?.tokenHomologacao));
    const tokenProducaoSet = Boolean(open(row?.tokenProducao));
    const missing: string[] = [];
    if (!c.enabled) missing.push('ligar a emissão nesta loja');
    if (!store.cnpj) missing.push('informar o CNPJ no cadastro da loja');
    if (!(environment === 'producao' ? tokenProducaoSet : tokenHomologacaoSet)) missing.push(`gravar o token de ${environment === 'producao' ? 'produção' : 'homologação'} da Focus NFe`);
    return {
      storeId: store.id,
      storeName: store.name,
      cnpj: store.cnpj,
      enabled: c.enabled,
      autoEmit: c.autoEmit,
      environment,
      tokenHomologacaoSet,
      tokenProducaoSet,
      cfop: c.cfop,
      icmsOrigin: c.icmsOrigin,
      icmsCst: c.icmsCst,
      defaultNcm: c.defaultNcm,
      ready: missing.length === 0,
      missing,
    };
  }

  /** Grava na nota o que a Focus NFe respondeu. */
  private apply(doc: DocRow, r: FocusReply): Promise<DocRow> {
    const env = doc.environment as FiscalEnvironment;
    const b = r.body;
    const status: FiscalStatus =
      b.status === 'autorizado' ? 'authorized' : b.status === 'cancelado' ? 'canceled' : b.status === 'processando_autorizacao' ? 'processing' : b.status === 'erro_autorizacao' || b.status === 'denegado' ? 'rejected' : r.http === 401 || r.http === 403 ? 'error' : r.http >= 400 ? 'rejected' : (doc.status as FiscalStatus);
    return this.prisma.fiscalDocument.update({
      where: { id: doc.id },
      data: {
        status,
        number: b.numero ?? doc.number,
        series: b.serie ?? doc.series,
        accessKey: b.chave_nfe?.replace(/^NFe/, '') ?? doc.accessKey,
        sefazStatus: b.status_sefaz ?? doc.sefazStatus,
        message: status === 'authorized' ? (b.mensagem_sefaz ?? 'Autorizada') : status === 'processing' ? 'Aguardando a SEFAZ.' : focusMessage(r),
        xmlUrl: this.focus.fileUrl(env, b.caminho_xml_nota_fiscal) ?? doc.xmlUrl,
        danfeUrl: this.focus.fileUrl(env, b.caminho_danfe) ?? doc.danfeUrl,
        qrcodeUrl: b.qrcode_url ?? doc.qrcodeUrl,
        ...(status === 'authorized' && !doc.authorizedAt ? { authorizedAt: new Date() } : {}),
        ...(status === 'canceled' && !doc.canceledAt ? { canceledAt: new Date() } : {}),
      },
    });
  }

  private async reach(call: () => Promise<FocusReply>): Promise<FocusReply> {
    try {
      return await call();
    } catch (e) {
      if (e instanceof FocusUnreachable) throw new DomainError('FOCUS_UNREACHABLE', `Não consegui falar com a Focus NFe (${e.message}). Tente de novo em instantes.`, undefined, 502);
      throw e;
    }
  }

  private async findDoc(ctx: RequestContext, id: string): Promise<DocRow> {
    const doc = await this.prisma.fiscalDocument.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!doc) throw new NotFoundError('nota fiscal', id);
    if (!canUseStore(ctx, doc.storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
    return doc;
  }

  private async toDocs(ctx: RequestContext, rows: DocRow[]): Promise<FiscalDocument[]> {
    if (!rows.length) return [];
    const [stores, sales, users] = await Promise.all([
      this.prisma.store.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
      this.prisma.sale.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.saleId))] }, tenantId: ctx.tenantId }, select: { id: true, number: true } }),
      this.prisma.appUser.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true } }),
    ]);
    const name = <T extends { id: string }>(list: T[], id: string) => list.find((x) => x.id === id);
    return rows.map((r) => ({
      id: r.id,
      kind: 'nfce',
      storeId: r.storeId,
      storeName: name(stores, r.storeId)?.name ?? '',
      saleId: r.saleId,
      saleNumber: name(sales, r.saleId)?.number ?? null,
      customerName: r.customerName,
      environment: r.environment as FiscalEnvironment,
      status: r.status as FiscalStatus,
      number: r.number,
      series: r.series,
      accessKey: r.accessKey,
      total: Number(r.total),
      message: r.message,
      danfeUrl: r.danfeUrl,
      xmlUrl: r.xmlUrl,
      createdAt: r.createdAt.toISOString(),
      userName: name(users, r.userId)?.name ?? null,
      canceledAt: r.canceledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason,
    }));
  }
}

/** Reparte um desconto entre as linhas, proporcional ao valor de cada uma (centavo a centavo, sem sobra). */
export function spread(totals: number[], discount: number): number[] {
  const c = totals.map((t) => Math.round(t * 100));
  const sum = c.reduce((a, b) => a + b, 0);
  const d = Math.min(Math.round(discount * 100), sum);
  if (!d || !sum) return totals.map(() => 0);
  const parts = c.map((v) => Math.floor((v * d) / sum));
  let rest = d - parts.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % parts.length) {
    if (parts[i]! < c[i]!) {
      parts[i]!++;
      rest--;
    }
  }
  return parts.map((p) => p / 100);
}
