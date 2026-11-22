import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { addDays, broadcastSegmentSchema, type AdsReport, type Broadcast, type BroadcastInput, type BroadcastPreview, type BroadcastSegment } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { ConflictError, DomainError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { runWithContextScope, setContext, type RequestContext } from '../../common/tenancy/request-context';
import { WhatsappSender } from '../notify/whatsapp.sender';

const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** No máximo de pessoas por disparo: acima disso o risco de o número ser bloqueado é alto. */
const LIMITE = 2000;

interface Alvo {
  id: string;
  name: string;
  phone: string;
  cashback: Prisma.Decimal;
}

/** Troca {nome} e {cashback} na mensagem. */
export function personalizar(texto: string, nome: string, cashback: number) {
  const primeiro = (nome.trim().split(/\s+/)[0] ?? '').replace(/^./, (c) => c.toUpperCase());
  return texto.replace(/\{nome\}/gi, primeiro).replace(/\{cashback\}/gi, `R$ ${cashback.toFixed(2).replace('.', ',')}`);
}

/**
 * Disparos de WhatsApp para grupos de clientes e o relatório de onde vieram cadastros e pedidos (UTM dos anúncios).
 * Só recebe quem tem celular, está ativa e não pediu para não receber mensagens.
 */
@Injectable()
export class BroadcastService {
  private readonly logger = new Logger('Disparos');
  private readonly rodando = new Set<string>();
  /** Intervalo entre mensagens (ms). Devagar de propósito, para o número não ser bloqueado. */
  private readonly pausa = Number(process.env.BROADCAST_INTERVAL_MS ?? 4000);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly sender: WhatsappSender,
  ) {}

  private async alvos(tenantId: string, seg: BroadcastSegment): Promise<Alvo[]> {
    const dias = seg.days;
    const filtro = {
      todos: Prisma.empty,
      membros: Prisma.sql`AND c.is_member`,
      nao_membros: Prisma.sql`AND NOT c.is_member`,
      com_cashback: Prisma.sql`AND c.cashback_balance > 0`,
      aniversariantes: Prisma.sql`AND c.birth_date IS NOT NULL AND EXTRACT(MONTH FROM c.birth_date) = EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Sao_Paulo'))`,
      recentes: Prisma.sql`AND EXISTS (SELECT 1 FROM sale s WHERE s.customer_id = c.id AND s.status = 'completed' AND s.created_at >= now() - make_interval(days => ${dias}))`,
      sumidos: Prisma.sql`AND EXISTS (SELECT 1 FROM sale s WHERE s.customer_id = c.id AND s.status = 'completed')
                          AND NOT EXISTS (SELECT 1 FROM sale s WHERE s.customer_id = c.id AND s.status = 'completed' AND s.created_at >= now() - make_interval(days => ${dias}))`,
    }[seg.kind];
    const categoria = seg.categoryId
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM sale_item si JOIN sale s ON s.id = si.sale_id WHERE s.customer_id = c.id AND s.status = 'completed' AND si.category_id = ${seg.categoryId})`
      : Prisma.empty;
    return this.prisma.$queryRaw<Alvo[]>`
      SELECT c.id, c.name, c.phone, c.cashback_balance AS cashback FROM customer c
       WHERE c.tenant_id = ${tenantId} AND c.active AND c.allow_whatsapp AND c.phone IS NOT NULL AND length(c.phone) >= 12 ${filtro} ${categoria}
       ORDER BY c.name LIMIT ${LIMITE + 1}`;
  }

  async preview(ctx: RequestContext, seg: BroadcastSegment): Promise<BroadcastPreview> {
    const a = await this.alvos(ctx.tenantId, seg);
    return { count: a.length, sample: a.slice(0, 8).map((x) => ({ name: x.name, phone: x.phone })) };
  }

  async list(ctx: RequestContext): Promise<Broadcast[]> {
    const rows = await this.prisma.broadcast.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: 'desc' }, take: 100 });
    // Resultado: compras de quem recebeu, nos 7 dias depois do envio.
    const depois = await this.prisma.$queryRaw<Array<{ id: string; n: bigint; v: Prisma.Decimal | null }>>`
      SELECT r.broadcast_id AS id, COUNT(DISTINCT s.id) AS n, SUM(s.total + s.cashback_used) AS v
        FROM broadcast_recipient r JOIN sale s ON s.customer_id = r.customer_id AND s.status = 'completed'
         AND s.created_at >= r.sent_at AND s.created_at < r.sent_at + interval '7 days'
       WHERE r.tenant_id = ${ctx.tenantId} AND r.status = 'enviado' GROUP BY 1`;
    const res = new Map(depois.map((d) => [d.id, d]));
    return rows.map((b) => ({
      id: b.id,
      name: b.name,
      message: b.message,
      segment: broadcastSegmentSchema.parse(b.segment),
      status: b.status as Broadcast['status'],
      total: b.total,
      sent: b.sent,
      failed: b.failed,
      createdAt: b.createdAt.toISOString(),
      finishedAt: b.finishedAt?.toISOString() ?? null,
      salesAfter: Number(res.get(b.id)?.n ?? 0),
      revenueAfter: Math.round(num(res.get(b.id)?.v) * 100) / 100,
    }));
  }

  async recipients(ctx: RequestContext, id: string) {
    const rows = await this.prisma.broadcastRecipient.findMany({ where: { tenantId: ctx.tenantId, broadcastId: id }, orderBy: [{ status: 'asc' }, { name: 'asc' }], take: LIMITE });
    return rows.map((r) => ({ id: r.id, name: r.name, phone: r.phone, status: r.status, error: r.error, sentAt: r.sentAt?.toISOString() ?? null }));
  }

  /** Cria o disparo, congela a lista de quem recebe e começa a enviar em segundo plano. */
  async send(ctx: RequestContext, d: BroadcastInput) {
    if (!this.sender.enabled) throw new DomainError('WHATSAPP_OFF', 'O WhatsApp ainda não está conectado. Configure as chaves no servidor antes de disparar.');
    if (await this.prisma.broadcast.count({ where: { tenantId: ctx.tenantId, status: 'enviando' } })) throw new ConflictError('BROADCAST_RUNNING', 'Já tem um disparo em andamento. Espere terminar ou cancele.');
    const alvos = await this.alvos(ctx.tenantId, d.segment);
    if (!alvos.length) throw new DomainError('BROADCAST_EMPTY', 'Ninguém se encaixa nesse grupo.');
    if (alvos.length > LIMITE) throw new DomainError('BROADCAST_TOO_BIG', `O grupo passa de ${LIMITE} pessoas. Aperte o filtro e divida em mais de um disparo.`);
    const b = await this.prisma.broadcast.create({ data: { tenantId: ctx.tenantId, name: d.name, message: d.message, segment: d.segment, status: 'enviando', total: alvos.length, createdById: ctx.userId, startedAt: new Date() } });
    await this.prisma.broadcastRecipient.createMany({ data: alvos.map((a) => ({ tenantId: ctx.tenantId, broadcastId: b.id, customerId: a.id, name: a.name, phone: a.phone })), skipDuplicates: true });
    await this.audit.record(ctx, 'broadcast.send', 'broadcast', b.id, { nome: d.name, pessoas: alvos.length, grupo: d.segment.kind });
    void this.rodar(b.id, ctx.tenantId, ctx.userId);
    return { id: b.id, total: alvos.length };
  }

  async cancel(ctx: RequestContext, id: string) {
    const r = await this.prisma.broadcast.updateMany({ where: { id, tenantId: ctx.tenantId, status: 'enviando' }, data: { status: 'cancelado', finishedAt: new Date() } });
    if (!r.count) throw new NotFoundError('disparo em andamento', id);
    await this.audit.record(ctx, 'broadcast.cancel', 'broadcast', id);
    return { ok: true };
  }

  /** Envia um por um, com pausa. Para se o disparo for cancelado ou se o canal cair (muitas falhas seguidas). */
  private async rodar(id: string, tenantId: string, userId: string | null) {
    if (this.rodando.has(id)) return;
    this.rodando.add(id);
    try {
      let seguidas = 0;
      for (;;) {
        const b = await this.prisma.broadcast.findFirst({ where: { id, tenantId } });
        if (!b || b.status !== 'enviando') return;
        const r = await this.prisma.broadcastRecipient.findFirst({ where: { broadcastId: id, tenantId, status: 'pendente' }, orderBy: { name: 'asc' } });
        if (!r) break;
        const c = r.customerId ? await this.prisma.customer.findFirst({ where: { id: r.customerId, tenantId }, select: { cashbackBalance: true, allowWhatsapp: true, active: true } }) : null;
        const pode = !c || (c.allowWhatsapp && c.active);
        const res = pode ? await this.sender.sendText(r.phone, personalizar(b.message, r.name, num(c?.cashbackBalance)), { tenantId, author: 'sistema', userId }) : ({ ok: false, reason: 'Pediu para não receber mensagens.' } as const);
        await this.prisma.broadcastRecipient.update({ where: { id: r.id }, data: res.ok ? { status: 'enviado', sentAt: new Date() } : { status: 'falhou', error: res.reason.slice(0, 200) } });
        await this.prisma.broadcast.update({ where: { id }, data: res.ok ? { sent: { increment: 1 } } : { failed: { increment: 1 } } });
        seguidas = res.ok || !pode ? 0 : seguidas + 1;
        if (seguidas >= 8) {
          await this.prisma.broadcast.update({ where: { id }, data: { status: 'cancelado', finishedAt: new Date() } });
          this.logger.error(`disparo ${id} parou: 8 falhas seguidas (${res.ok ? '' : res.reason})`);
          return;
        }
        await espera(this.pausa);
      }
      await this.prisma.broadcast.updateMany({ where: { id, status: 'enviando' }, data: { status: 'concluido', finishedAt: new Date() } });
    } catch (e) {
      this.logger.error(`disparo ${id} falhou: ${(e as Error).message}`);
    } finally {
      this.rodando.delete(id);
    }
  }

  /** Disparo que ficou pela metade (servidor reiniciou) continua de onde parou. */
  @Cron('20 * * * * *')
  async retomar() {
    const parados = await this.prisma.broadcast.findMany({ where: { status: 'enviando', id: { notIn: [...this.rodando] } }, select: { id: true, tenantId: true, createdById: true } });
    for (const b of parados) {
      runWithContextScope(() => {
        setContext({ tenantId: b.tenantId, userId: b.createdById ?? '', storeIds: [], permissions: [] } as RequestContext);
        void this.rodar(b.id, b.tenantId, b.createdById);
      });
    }
  }

  /** De onde vieram cadastros e pedidos do app (UTM dos anúncios) no período. */
  async ads(ctx: RequestContext, from: string, to: string): Promise<AdsReport> {
    const de = new Date(`${from}T03:00:00Z`);
    const ate = new Date(`${addDays(to, 1)}T03:00:00Z`);
    const rows = await this.prisma.$queryRaw<Array<{ source: string; campaign: string; signups: bigint; orders: bigint; revenue: Prisma.Decimal | null }>>`
      SELECT source, campaign, SUM(signups) AS signups, SUM(orders) AS orders, SUM(revenue) AS revenue FROM (
        SELECT COALESCE(NULLIF(c.origin->>'source', ''), 'direto') AS source, COALESCE(c.origin->>'campaign', '') AS campaign, 1 AS signups, 0 AS orders, 0::numeric AS revenue
          FROM customer c WHERE c.tenant_id = ${ctx.tenantId} AND c.origin IS NOT NULL AND c.created_at >= ${de} AND c.created_at < ${ate}
        UNION ALL
        SELECT COALESCE(NULLIF(o.origin->>'source', ''), 'direto'), COALESCE(o.origin->>'campaign', ''), 0, 1, COALESCE(s.total + s.cashback_used, 0)
          FROM "order" o LEFT JOIN sale s ON s.id = o.sale_id AND s.status = 'completed'
         WHERE o.tenant_id = ${ctx.tenantId} AND o.origin IS NOT NULL AND o.status <> 'cancelado' AND o.created_at >= ${de} AND o.created_at < ${ate}
      ) x GROUP BY 1, 2 ORDER BY revenue DESC, signups DESC LIMIT 200`;
    return { rows: rows.map((r) => ({ source: r.source, campaign: r.campaign, signups: Number(r.signups), orders: Number(r.orders), revenue: Math.round(num(r.revenue) * 100) / 100 })) };
  }
}
