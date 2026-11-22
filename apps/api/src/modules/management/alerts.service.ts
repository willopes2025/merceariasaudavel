import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PERMISSIONS, addDays, formatMoney, todayBR, type Alert } from '@mercearia/contracts';
import { PrismaService } from '../../common/prisma/prisma.service';
import type { RequestContext } from '../../common/tenancy/request-context';

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const s = (q: number, um: string, varios: string) => `${q} ${q === 1 ? um : varios}`;

/** Central de avisos: o que pede atenção agora, só do que a pessoa tem permissão para ver. */
@Injectable()
export class AlertsService {
  private readonly logger = new Logger('Avisos');
  constructor(private readonly prisma: PrismaService) {}

  async list(ctx: RequestContext): Promise<Alert[]> {
    const pode = (p: string) => ctx.permissions.includes('*') || ctx.permissions.includes(p);
    const t = ctx.tenantId;
    const hoje = todayBR();
    const lojas = ctx.storeIds.length ? Prisma.sql`AND b.store_id IN (${Prisma.join(ctx.storeIds)})` : Prisma.empty;
    const out: Alert[] = [];
    const tarefas: Array<Promise<void>> = [];
    const add = (fn: () => Promise<void>) => tarefas.push(fn().catch((e) => this.logger.warn(`aviso não calculado: ${(e as Error).message.slice(0, 300)}`)));

    if (pode(PERMISSIONS.financeView)) {
      add(async () => {
        const [r] = await this.prisma.$queryRaw<Array<{ atrasadas: bigint; v_atrasadas: Prisma.Decimal | null; hoje: bigint; v_hoje: Prisma.Decimal | null }>>`
          SELECT COUNT(*) FILTER (WHERE due_date < ${d(hoje)}) AS atrasadas, SUM(amount) FILTER (WHERE due_date < ${d(hoje)}) AS v_atrasadas,
                 COUNT(*) FILTER (WHERE due_date = ${d(hoje)}) AS hoje, SUM(amount) FILTER (WHERE due_date = ${d(hoje)}) AS v_hoje
            FROM payable WHERE tenant_id = ${t} AND status = 'open' AND due_date <= ${d(hoje)}`;
        if (n(r?.atrasadas)) out.push({ key: 'pagar-atrasadas', level: 'urgente', title: `${s(n(r!.atrasadas), 'conta a pagar atrasada', 'contas a pagar atrasadas')}`, detail: `Somam ${formatMoney(Number(r!.v_atrasadas))}.`, path: '/pagar' });
        if (n(r?.hoje)) out.push({ key: 'pagar-hoje', level: 'atencao', title: `${s(n(r!.hoje), 'conta vence hoje', 'contas vencem hoje')}`, detail: `Somam ${formatMoney(Number(r!.v_hoje))}.`, path: '/pagar' });
      });
      add(async () => {
        const [r] = await this.prisma.$queryRaw<Array<{ q: bigint; v: Prisma.Decimal | null }>>`
          SELECT COUNT(*) AS q, SUM(net) AS v FROM receivable WHERE tenant_id = ${t} AND status = 'aberto' AND due_date < ${d(addDays(hoje, -2))}`;
        if (n(r?.q)) out.push({ key: 'receber-atrasados', level: 'atencao', title: `${s(n(r!.q), 'recebimento atrasado', 'recebimentos atrasados')}`, detail: `${formatMoney(Number(r!.v))} de cartão, Pix ou app já deviam ter caído. Confira e dê baixa.`, path: '/receber' });
      });
      add(async () => {
        const q = await this.prisma.bankLine.count({ where: { tenantId: t, status: 'pendente' } });
        if (q) out.push({ key: 'conciliacao', level: 'atencao', title: `${s(q, 'linha do banco sem conciliar', 'linhas do banco sem conciliar')}`, detail: 'Movimentações do extrato que o sistema ainda não reconheceu.', path: '/conciliacao' });
      });
    }
    if (pode(PERMISSIONS.stockView)) {
      add(async () => {
        const [r] = await this.prisma.$queryRaw<Array<{ q: bigint }>>`
          SELECT COUNT(*) AS q FROM (
            SELECT p.id FROM product p JOIN stock_balance b ON b.product_id = p.id
             WHERE p.tenant_id = ${t} AND p.active AND p.track_stock AND p.min_stock > 0 ${lojas}
             GROUP BY p.id, p.min_stock HAVING SUM(b.quantity) <= p.min_stock) x`;
        if (n(r?.q)) out.push({ key: 'estoque-minimo', level: 'atencao', title: `${s(n(r!.q), 'produto no estoque mínimo', 'produtos no estoque mínimo')}`, detail: 'Veja a compra sugerida.', path: '/inteligencia-estoque' });
      });
      add(async () => {
        const [r] = await this.prisma.$queryRaw<Array<{ vencidos: bigint; semana: bigint }>>`
          SELECT COUNT(*) FILTER (WHERE b.expires_at < ${d(hoje)}) AS vencidos, COUNT(*) FILTER (WHERE b.expires_at >= ${d(hoje)}) AS semana
            FROM stock_lot b WHERE b.tenant_id = ${t} AND b.quantity > 0 AND b.expires_at <= ${d(addDays(hoje, 7))} ${lojas}`;
        if (n(r?.vencidos)) out.push({ key: 'lotes-vencidos', level: 'urgente', title: `${s(n(r!.vencidos), 'lote vencido no estoque', 'lotes vencidos no estoque')}`, detail: 'Tire da prateleira e lance a perda.', path: '/validades' });
        if (n(r?.semana)) out.push({ key: 'lotes-vencendo', level: 'atencao', title: `${s(n(r!.semana), 'lote vence em até 7 dias', 'lotes vencem em até 7 dias')}`, detail: 'Vale uma oferta para girar.', path: '/validades' });
      });
    }
    if (pode(PERMISSIONS.customerView)) {
      add(async () => {
        const [ajuda, espera] = await Promise.all([
          this.prisma.waConversation.count({ where: { tenantId: t, status: 'aberta', needsHuman: true } }),
          this.prisma.waConversation.count({ where: { tenantId: t, status: 'aberta', unread: { gt: 0 }, aiEnabled: false } }),
        ]);
        if (ajuda) out.push({ key: 'wa-ajuda', level: 'urgente', title: `${s(ajuda, 'conversa do WhatsApp pede uma pessoa', 'conversas do WhatsApp pedem uma pessoa')}`, detail: 'A IA não soube resolver e passou para a equipe.', path: '/whatsapp' });
        if (espera) out.push({ key: 'wa-espera', level: 'atencao', title: `${s(espera, 'conversa esperando resposta', 'conversas esperando resposta')}`, detail: 'Clientes que escreveram e a IA está desligada na conversa.', path: '/whatsapp' });
      });
    }
    if (pode(PERMISSIONS.fiscalView)) {
      add(async () => {
        const q = await this.prisma.fiscalDocument.count({ where: { tenantId: t, status: { in: ['rejected', 'error'] }, createdAt: { gte: d(addDays(hoje, -7)) } } });
        if (q) out.push({ key: 'notas-rejeitadas', level: 'urgente', title: `${s(q, 'nota fiscal rejeitada', 'notas fiscais rejeitadas')} nos últimos 7 dias`, detail: 'Abra a nota para ver o motivo e emitir de novo.', path: '/fiscal' });
      });
    }
    if (pode(PERMISSIONS.orderPrepare)) {
      add(async () => {
        const q = await this.prisma.order.count({ where: { tenantId: t, status: { in: ['na_fila', 'preparando'] }, createdAt: { lt: new Date(Date.now() - 30 * 60_000), gte: new Date(Date.now() - 12 * 3_600_000) }, ...(ctx.storeIds.length ? { storeId: { in: ctx.storeIds } } : {}) } });
        if (q) out.push({ key: 'pedidos-parados', level: 'urgente', title: `${s(q, 'pedido parado há mais de 30 minutos', 'pedidos parados há mais de 30 minutos')}`, detail: 'Estão na fila ou em preparo.', path: '/preparo' });
      });
    }
    if (pode(PERMISSIONS.hrManage)) {
      add(async () => {
        const mes = addDays(`${hoje.slice(0, 7)}-01`, -1).slice(0, 7);
        const [r] = await this.prisma.$queryRaw<Array<{ q: bigint }>>`
          SELECT COUNT(*) AS q FROM employee e WHERE e.tenant_id = ${t} AND e.active AND e.clocks
             AND NOT EXISTS (SELECT 1 FROM clock_closing c WHERE c.employee_id = e.id AND c.month = ${mes})
             AND EXISTS (SELECT 1 FROM clock_record r WHERE r.employee_id = e.id AND r.at >= ${d(`${mes}-01`)} AND r.at < ${d(`${hoje.slice(0, 7)}-01`)})`;
        if (n(r?.q)) out.push({ key: 'ponto-fechar', level: 'atencao', title: `Ponto do mês passado ainda aberto para ${s(n(r!.q), 'pessoa', 'pessoas')}`, detail: 'Feche o mês para a equipe confirmar o espelho.', path: '/ponto' });
      });
    }
    await Promise.all(tarefas);
    return out.sort((a, b) => Number(b.level === 'urgente') - Number(a.level === 'urgente'));
  }
}
