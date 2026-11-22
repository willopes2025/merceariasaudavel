import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { addDays, todayBR, type TrafficManualInput, type TrafficReport } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { DomainError, ForbiddenError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, runWithContextScope, setContext, type RequestContext } from '../../common/tenancy/request-context';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const r2 = (v: number) => Math.round(v * 100) / 100;
const conv = (vendas: number, pessoas: number) => (pessoas > 0 ? Math.min(100, r2((vendas / pessoas) * 100)) : null);

/**
 * Fluxo de pessoas: quantas entraram na loja por hora, comparado com as vendas do balcão (conversão).
 * A contagem vem das câmeras (qualquer câmera ou gravador que chame um endereço a cada pessoa contada) ou é
 * digitada. Contagem anônima: o sistema só recebe números, nunca imagem.
 */
@Injectable()
export class TrafficService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Chamada da câmera: soma na hora atual (horário de Brasília). */
  async fromCamera(slug: string, storeCode: string | undefined, entries: number, exits: number) {
    const tenant = await this.prisma.tenant.findFirst({ where: { slug, status: 'active' }, select: { id: true } });
    if (!tenant) throw new DomainError('TENANT_NOT_FOUND', 'Empresa não encontrada.');
    const loja = await this.prisma.store.findFirst({ where: { tenantId: tenant.id, active: true, ...(storeCode ? { code: storeCode } : {}) }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!loja) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    const agora = new Date(Date.now() - 3 * 3_600_000);
    const dia = agora.toISOString().slice(0, 10);
    const hora = agora.getUTCHours();
    await runWithContextScope(async () => {
      setContext({ tenantId: tenant.id, userId: '', storeIds: [], permissions: [] } as RequestContext);
      await this.prisma.$executeRaw`
        INSERT INTO foot_traffic (id, tenant_id, store_id, day, hour, entries, exits, source, updated_at)
        VALUES (gen_random_uuid()::text, ${tenant.id}, ${loja.id}, ${d(dia)}, ${hora}, ${entries}, ${exits}, 'camera', now())
        ON CONFLICT (store_id, day, hour) DO UPDATE SET entries = foot_traffic.entries + EXCLUDED.entries, exits = foot_traffic.exits + EXCLUDED.exits, source = 'camera', updated_at = now()`;
    });
    return { ok: true, day: dia, hour: hora };
  }

  async manual(ctx: RequestContext, input: TrafficManualInput) {
    if (!canUseStore(ctx, input.storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
    if (input.day > todayBR()) throw new DomainError('DAY_IN_FUTURE', 'O dia ainda não chegou.');
    if (!(await this.prisma.store.count({ where: { id: input.storeId, tenantId: ctx.tenantId } }))) throw new DomainError('STORE_NOT_FOUND', 'Loja não encontrada.');
    await this.prisma.$transaction(
      input.hours.map((h) =>
        this.prisma.footTraffic.upsert({
          where: { storeId_day_hour: { storeId: input.storeId, day: d(input.day), hour: h.hour } },
          create: { tenantId: ctx.tenantId, storeId: input.storeId, day: d(input.day), hour: h.hour, entries: h.entries, source: 'manual' },
          update: { entries: h.entries, source: 'manual' },
        }),
      ),
    );
    await this.audit.record(ctx, 'traffic.manual', 'foot_traffic', null, { dia: input.day, pessoas: input.hours.reduce((s, h) => s + h.entries, 0) });
    return { ok: true };
  }

  async day(ctx: RequestContext, storeId: string, day: string) {
    if (!canUseStore(ctx, storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
    const rows = await this.prisma.footTraffic.findMany({ where: { tenantId: ctx.tenantId, storeId, day: d(day) }, orderBy: { hour: 'asc' } });
    return rows.map((r) => ({ hour: r.hour, entries: r.entries, source: r.source }));
  }

  async report(ctx: RequestContext, from: string, to: string, storeId?: string): Promise<TrafficReport> {
    if (storeId && !canUseStore(ctx, storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
    const lojas = storeId ? [storeId] : ctx.storeIds;
    const lojaF = lojas.length ? Prisma.sql`AND f.store_id IN (${Prisma.join(lojas)})` : Prisma.empty;
    const lojaS = lojas.length ? Prisma.sql`AND s.store_id IN (${Prisma.join(lojas)})` : Prisma.empty;
    const [fluxo, vendas, ultima, tenant] = await Promise.all([
      this.prisma.$queryRaw<Array<{ day: Date; hour: number; entries: bigint }>>`
        SELECT f.day, f.hour, SUM(f.entries) AS entries FROM foot_traffic f WHERE f.tenant_id = ${ctx.tenantId} AND f.day BETWEEN ${d(from)} AND ${d(to)} ${lojaF} GROUP BY 1, 2`,
      // Só o balcão: pedido do app, do iFood e da loja online não passa pela porta.
      this.prisma.$queryRaw<Array<{ day: Date; hour: number; n: bigint; v: Prisma.Decimal }>>`
        SELECT (s.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date AS day,
               EXTRACT(HOUR FROM s.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::int AS hour, COUNT(*) AS n, SUM(s.total + s.cashback_used) AS v
          FROM sale s WHERE s.tenant_id = ${ctx.tenantId} AND s.status = 'completed' AND s.channel = 'loja'
           AND s.created_at >= ${new Date(`${from}T03:00:00Z`)} AND s.created_at < ${new Date(`${addDays(to, 1)}T03:00:00Z`)} ${lojaS} GROUP BY 1, 2`,
      this.prisma.footTraffic.findFirst({ where: { tenantId: ctx.tenantId, source: 'camera' }, orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } }),
      this.prisma.tenant.findUnique({ where: { id: ctx.tenantId }, select: { slug: true } }),
    ]);
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    const dias = new Map<string, { entries: number; sales: number; revenue: number }>();
    const horas = Array.from({ length: 24 }, () => ({ entries: 0, sales: 0 }));
    const dia = (k: string) => dias.get(k) ?? dias.set(k, { entries: 0, sales: 0, revenue: 0 }).get(k)!;
    // A conversão só vale onde houve contagem: venda em hora sem contagem não entra na conta.
    const contadas = new Set(fluxo.map((f) => `${iso(f.day)}|${f.hour}`));
    for (const f of fluxo) {
      dia(iso(f.day)).entries += Number(f.entries);
      horas[f.hour]!.entries += Number(f.entries);
    }
    for (const v of vendas) {
      if (!contadas.has(`${iso(v.day)}|${v.hour}`)) continue;
      const x = dia(iso(v.day));
      x.sales += Number(v.n);
      x.revenue = r2(x.revenue + Number(v.v));
      horas[v.hour]!.sales += Number(v.n);
    }
    const days = [...dias.entries()].sort(([a], [b]) => (a < b ? 1 : -1)).map(([day, x]) => ({ day, ...x, conversion: conv(x.sales, x.entries) }));
    const n = Math.max(1, days.length);
    const hours = horas.map((h, hour) => ({ hour, entries: r2(h.entries / n), sales: r2(h.sales / n), conversion: conv(h.sales, h.entries) })).filter((h) => h.entries > 0 || h.sales > 0);
    const tot = days.reduce((s, x) => ({ entries: s.entries + x.entries, sales: s.sales + x.sales, revenue: r2(s.revenue + x.revenue) }), { entries: 0, sales: 0, revenue: 0 });
    const segredo = process.env.TRAFFIC_SECRET?.trim();
    const base = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
    return {
      webhookUrl: segredo && tenant?.slug ? `${base}/v1/traffic/in/${tenant.slug}/${segredo}` : null,
      lastCameraAt: ultima?.updatedAt.toISOString() ?? null,
      totals: { ...tot, conversion: conv(tot.sales, tot.entries), ticket: tot.sales ? r2(tot.revenue / tot.sales) : null },
      days,
      hours,
      peakHour: hours.length ? hours.reduce((a, b) => (b.entries > a.entries ? b : a)).hour : null,
    };
  }
}
