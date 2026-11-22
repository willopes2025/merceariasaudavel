import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PAYABLE_CATEGORIES, SALE_CHANNELS, addDays, todayBR, type Cashflow, type CashflowQuery, type Dre, type DreLine, type DreQuery } from '@mercearia/contracts';
import { ForbiddenError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { ReceivablesService } from './receivables.service';

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const brStart = (iso: string) => new Date(`${iso}T00:00:00-03:00`);
const num = (v: Prisma.Decimal | number | bigint | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400_000);
/** Categorias que viram custo da mercadoria (CMV) na competência: não entram como despesa. */
const DE_MERCADORIA = new Set(['fornecedor', 'insumos']);
const OUTROS = 'sem_canal';

type Valores = Record<string, number>;

/** Monta uma linha somando os valores por canal; o total é a soma dos canais. */
class Montador {
  readonly lines: DreLine[] = [];
  constructor(private readonly canais: string[]) {}
  add(key: string, label: string, level: 0 | 1 | 2, sign: 1 | -1, porCanal: Valores, allocated = false) {
    const values: Valores = { total: 0 };
    for (const c of this.canais) {
      values[c] = r2(porCanal[c] ?? 0);
      values.total = r2(values.total! + values[c]!);
    }
    const l: DreLine = { key, label, level, sign, values, ...(allocated ? { allocated: true } : {}) };
    this.lines.push(l);
    return l;
  }
  soma(keys: string[]): Valores {
    const out: Valores = {};
    for (const c of [...this.canais, 'total']) out[c] = r2(keys.reduce((s, k) => s + (this.lines.find((l) => l.key === k)?.values[c] ?? 0) * (this.lines.find((l) => l.key === k)?.sign ?? 1), 0));
    return out;
  }
}

/** Rateia um valor entre os canais pela participação (a soma bate centavo a centavo). */
function ratear(total: number, pesos: Valores, canais: string[]): Valores {
  const soma = canais.reduce((s, c) => s + Math.max(0, pesos[c] ?? 0), 0);
  const out: Valores = {};
  if (soma <= 0) {
    out[canais.includes(OUTROS) ? OUTROS : canais[0]!] = total;
    return out;
  }
  let usado = 0;
  canais.forEach((c, i) => {
    const v = i === canais.length - 1 ? r2(total - usado) : r2((total * Math.max(0, pesos[c] ?? 0)) / soma);
    out[c] = v;
    usado = r2(usado + v);
  });
  return out;
}

/**
 * DRE gerencial nas duas visões, com colunas por canal de venda:
 *  - Competência: a venda conta no dia em que foi feita (receita, descontos, impostos, CMV, taxas, comissões, cashback
 *    e despesas pelo vencimento). Custos de cada venda vão direto para o canal dela; despesas fixas são rateadas pela receita.
 *  - Caixa: o que caiu na conta (recebíveis recebidos, já sem taxa) menos o que foi pago, no dia do pagamento.
 * E o fluxo de caixa diário (realizado + previsto).
 */
@Injectable()
export class DreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receivables: ReceivablesService,
  ) {}

  private lojas(ctx: RequestContext, storeId?: string) {
    if (storeId && !canUseStore(ctx, storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
    return storeId ? [storeId] : ctx.storeIds;
  }

  async dre(ctx: RequestContext, q: DreQuery): Promise<Dre> {
    await this.receivables.sync(ctx.tenantId);
    const lojas = this.lojas(ctx, q.storeId);
    const atual = q.view === 'caixa' ? await this.caixa(ctx.tenantId, lojas, q.from, q.to) : await this.competencia(ctx.tenantId, lojas, q.from, q.to);
    const dias = diasEntre(q.from, q.to) + 1;
    const pAte = addDays(q.from, -1);
    const pDe = addDays(q.from, -dias);
    const ant = q.view === 'caixa' ? await this.caixa(ctx.tenantId, lojas, pDe, pAte) : await this.competencia(ctx.tenantId, lojas, pDe, pAte);
    const previous: Valores = {};
    for (const l of ant.lines) previous[l.key] = l.values.total ?? 0;
    return { from: q.from, to: q.to, view: q.view, columns: atual.columns, lines: atual.lines, previous: { from: pDe, to: pAte, values: previous }, notes: atual.notes };
  }

  private colunas(canais: string[]) {
    return [{ key: 'total', label: 'Total' }, ...canais.map((c) => ({ key: c, label: c === OUTROS ? 'Sem canal' : ((SALE_CHANNELS as Record<string, string>)[c] ?? c) }))];
  }

  private async competencia(tenantId: string, lojas: string[], from: string, to: string) {
    const periodo = { gte: brStart(from), lt: brStart(addDays(to, 1)) };
    const lojaVenda = lojas.length ? Prisma.sql`AND s.store_id IN (${Prisma.join(lojas)})` : Prisma.empty;
    const lojaEstoque = lojas.length ? Prisma.sql`AND m.store_id IN (SELECT COALESCE(stock_store_id, id) FROM store WHERE id IN (${Prisma.join(lojas)}))` : Prisma.empty;
    const lojaConta = lojas.length ? Prisma.sql`AND (p.store_id IS NULL OR p.store_id IN (${Prisma.join(lojas)}))` : Prisma.empty;
    const [vendas, taxas, perdas, contas, cfg] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, Prisma.Decimal | string | bigint>>>`
        SELECT s.channel, COUNT(*) AS qtd, SUM(s.gross_total) AS tabela, SUM(s.delivery_fee) AS entrega, SUM(s.member_savings) AS membro, SUM(s.promo_savings) AS promo,
               SUM(s.coupon_discount) AS cupom, SUM(s.partner_discount) AS parceiro, SUM(s.total + s.cashback_used - s.delivery_fee) AS mercadoria,
               SUM(s.cost_total) AS cmv, SUM(s.cashback_earned) AS cashback, SUM(s.partner_commission) AS comissao
          FROM sale s WHERE s.tenant_id = ${tenantId} AND s.status = 'completed' AND s.created_at >= ${periodo.gte} AND s.created_at < ${periodo.lt} ${lojaVenda}
         GROUP BY s.channel`,
      this.prisma.$queryRaw<Array<{ channel: string; fee: Prisma.Decimal }>>`
        SELECT s.channel, SUM(r.fee) AS fee FROM receivable r JOIN sale s ON s.id = r.sale_id
         WHERE r.tenant_id = ${tenantId} AND r.kind = 'venda' AND s.status = 'completed' AND s.created_at >= ${periodo.gte} AND s.created_at < ${periodo.lt} ${lojaVenda}
         GROUP BY s.channel`,
      this.prisma.$queryRaw<Array<{ value: Prisma.Decimal | null }>>`
        SELECT SUM(-m.delta * m.unit_cost) AS value FROM stock_movement m
         WHERE m.tenant_id = ${tenantId} AND m.type IN ('perda', 'contagem') AND m.created_at >= ${periodo.gte} AND m.created_at < ${periodo.lt} ${lojaEstoque}`,
      this.prisma.$queryRaw<Array<{ category: string; amount: Prisma.Decimal }>>`
        SELECT p.category, SUM(p.amount) AS amount FROM payable p
         WHERE p.tenant_id = ${tenantId} AND p.status <> 'canceled' AND p.due_date >= ${asDate(from)} AND p.due_date <= ${asDate(to)} ${lojaConta}
         GROUP BY p.category`,
      this.receivables.config(tenantId),
    ]);
    const canaisVenda = [...new Set(vendas.map((v) => String(v.channel)))].sort((a, b) => Object.keys(SALE_CHANNELS).indexOf(a) - Object.keys(SALE_CHANNELS).indexOf(b));
    const canais = canaisVenda.length ? canaisVenda : [OUTROS];
    const por = (campo: string): Valores => Object.fromEntries(vendas.map((v) => [String(v.channel), num(v[campo] as Prisma.Decimal)]));
    const m = new Montador(canais);
    const mercadoria = por('mercadoria');
    const entrega = por('entrega');
    const faturado: Valores = Object.fromEntries(canais.map((c) => [c, (mercadoria[c] ?? 0) + (entrega[c] ?? 0)]));

    // Receita bruta
    m.add('vendas_tabela', 'Vendas a preço de tabela', 2, 1, por('tabela'));
    m.add('entrega', 'Taxas de entrega', 2, 1, entrega);
    m.add('receita_bruta', 'Receita bruta', 1, 1, m.soma(['vendas_tabela', 'entrega']));
    // Deduções
    const tabela = por('tabela');
    const membro = por('membro');
    const promo = por('promo');
    const cupom = por('cupom');
    const parceiro = por('parceiro');
    const manuais: Valores = Object.fromEntries(canais.map((c) => [c, (tabela[c] ?? 0) - (membro[c] ?? 0) - (promo[c] ?? 0) - (cupom[c] ?? 0) - (parceiro[c] ?? 0) - (mercadoria[c] ?? 0)]));
    m.add('preco_membro', 'Preço de membro', 2, -1, membro);
    m.add('promocoes', 'Ofertas e promoções', 2, -1, promo);
    m.add('cupons', 'Cupons', 2, -1, cupom);
    m.add('desc_parceiro', 'Desconto de parceiros', 2, -1, parceiro);
    m.add('desc_manual', 'Descontos no caixa', 2, -1, manuais);
    const impostoConta = contas.filter((c) => c.category === 'impostos').reduce((s, c) => s + num(c.amount), 0);
    const notes: string[] = [];
    if (cfg.impostoPct > 0) {
      m.add('impostos', `Impostos sobre vendas (estimado ${String(cfg.impostoPct).replace('.', ',')}%)`, 2, -1, Object.fromEntries(canais.map((c) => [c, ((faturado[c] ?? 0) * cfg.impostoPct) / 100])));
      if (impostoConta) notes.push('Com a alíquota configurada, os impostos lançados em contas a pagar entram só na visão de caixa.');
    } else {
      m.add('impostos', 'Impostos (lançados em contas a pagar)', 2, -1, ratear(impostoConta, faturado, canais), canais.length > 1);
      notes.push('Para estimar os impostos sobre as vendas (ex.: Simples Nacional), informe a alíquota em Configurar.');
    }
    m.add('deducoes', 'Deduções', 1, -1, negar(m.soma(['preco_membro', 'promocoes', 'cupons', 'desc_parceiro', 'desc_manual', 'impostos'])));
    m.add('receita_liquida', 'Receita líquida', 0, 1, m.soma(['receita_bruta', 'deducoes']));
    // Custos
    m.add('cmv', 'Custo das mercadorias vendidas (CMV)', 2, -1, por('cmv'));
    m.add('perdas', 'Perdas e acertos de estoque', 2, -1, ratear(num(perdas[0]?.value), mercadoria, canais), canais.length > 1);
    m.add('custos', 'Custos', 1, -1, negar(m.soma(['cmv', 'perdas'])));
    m.add('lucro_bruto', 'Lucro bruto', 0, 1, m.soma(['receita_liquida', 'custos']));
    // Despesas de venda (diretas do canal)
    m.add('taxas', 'Taxas de cartão, Pix e app', 2, -1, Object.fromEntries(taxas.map((t) => [t.channel, num(t.fee)])));
    m.add('comissoes', 'Comissão de parceiros', 2, -1, por('comissao'));
    m.add('cashback', 'Cashback concedido', 2, -1, por('cashback'));
    m.add('despesas_venda', 'Despesas de venda', 1, -1, negar(m.soma(['taxas', 'comissoes', 'cashback'])));
    // Despesas operacionais (rateadas pela receita)
    const opKeys: string[] = [];
    for (const c of contas.filter((x) => !DE_MERCADORIA.has(x.category) && x.category !== 'impostos').sort((a, b) => num(b.amount) - num(a.amount))) {
      const k = `desp_${c.category}`;
      opKeys.push(k);
      m.add(k, (PAYABLE_CATEGORIES as Record<string, string>)[c.category] ?? c.category, 2, -1, ratear(num(c.amount), mercadoria, canais), canais.length > 1);
    }
    m.add('despesas_operacionais', 'Despesas operacionais', 1, -1, negar(m.soma(opKeys)));
    m.add('resultado', 'Resultado (lucro ou prejuízo)', 0, 1, m.soma(['lucro_bruto', 'despesas_venda', 'despesas_operacionais']));
    const mercadoriaConta = contas.filter((x) => DE_MERCADORIA.has(x.category)).reduce((s, c) => s + num(c.amount), 0);
    if (mercadoriaConta) notes.push('Compras de mercadoria e insumos lançadas em contas a pagar não entram aqui: na competência, o custo aparece no CMV quando o produto é vendido. Elas aparecem na visão de caixa.');
    notes.push('Despesas entram pelo mês de vencimento. Nas colunas por canal, perdas e despesas fixas são rateadas pela receita de cada canal (marcadas com ÷).');
    if (vendas.some((v) => num(v.cmv as Prisma.Decimal) === 0 && num(v.mercadoria as Prisma.Decimal) > 0)) notes.push('Produtos sem custo cadastrado deixam o CMV menor do que o real.');
    return { columns: this.colunas(canais), lines: m.lines, notes };
  }

  private async caixa(tenantId: string, lojas: string[], from: string, to: string) {
    const lojaRec = lojas.length ? Prisma.sql`AND (r.store_id IS NULL OR r.store_id IN (${Prisma.join(lojas)}))` : Prisma.empty;
    const lojaConta = lojas.length ? Prisma.sql`AND (p.store_id IS NULL OR p.store_id IN (${Prisma.join(lojas)}))` : Prisma.empty;
    const [entradas, saidas] = await Promise.all([
      this.prisma.$queryRaw<Array<{ channel: string | null; metodo: string | null; kind: string | null; valor: Prisma.Decimal; taxa: Prisma.Decimal }>>`
        SELECT s.channel, pm.name AS metodo, pm.kind, SUM(r.received_amount) AS valor, SUM(r.fee) AS taxa
          FROM receivable r LEFT JOIN sale s ON s.id = r.sale_id LEFT JOIN payment_method pm ON pm.id = r.method_id
         WHERE r.tenant_id = ${tenantId} AND r.status = 'recebido' AND r.received_date >= ${asDate(from)} AND r.received_date <= ${asDate(to)} ${lojaRec}
         GROUP BY s.channel, pm.name, pm.kind`,
      this.prisma.$queryRaw<Array<{ category: string; amount: Prisma.Decimal }>>`
        SELECT p.category, SUM(p.amount) AS amount FROM payable p
         WHERE p.tenant_id = ${tenantId} AND p.status = 'paid' AND p.paid_date >= ${asDate(from)} AND p.paid_date <= ${asDate(to)} ${lojaConta}
         GROUP BY p.category`,
    ]);
    const canalDe = (c: string | null) => c ?? OUTROS;
    const ordem = [...Object.keys(SALE_CHANNELS), OUTROS];
    const canaisEntrada = [...new Set(entradas.map((e) => canalDe(e.channel)))].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
    const canais = canaisEntrada.length ? canaisEntrada : [OUTROS];
    const m = new Montador(canais);
    const metodos = [...new Set(entradas.map((e) => e.metodo ?? 'Outros recebimentos'))];
    const chaves: string[] = [];
    for (const nome of metodos) {
      const k = `in_${chaves.length}`;
      chaves.push(k);
      const porCanal: Valores = {};
      for (const e of entradas.filter((x) => (x.metodo ?? 'Outros recebimentos') === nome)) porCanal[canalDe(e.channel)] = (porCanal[canalDe(e.channel)] ?? 0) + num(e.valor);
      m.add(k, nome, 2, 1, porCanal);
    }
    const totalEntradas = m.add('entradas', 'Entradas (já sem as taxas)', 1, 1, m.soma(chaves));
    const pesos: Valores = Object.fromEntries(canais.map((c) => [c, totalEntradas.values[c] ?? 0]));
    const saidaKeys: string[] = [];
    for (const s of [...saidas].sort((a, b) => num(b.amount) - num(a.amount))) {
      const k = `out_${s.category}`;
      saidaKeys.push(k);
      m.add(k, (PAYABLE_CATEGORIES as Record<string, string>)[s.category] ?? s.category, 2, -1, ratear(num(s.amount), pesos, canais), canais.length > 1);
    }
    m.add('saidas', 'Saídas (contas pagas)', 1, -1, negar(m.soma(saidaKeys)));
    m.add('resultado', 'Geração de caixa', 0, 1, m.soma(['entradas', 'saidas']));
    const taxas = entradas.reduce((s, e) => s + num(e.taxa), 0);
    const notes = [
      `Entradas pela data em que o dinheiro caiu (cartão no prazo da maquininha), já sem ${taxas ? `as taxas (${taxas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} no período)` : 'as taxas'}. Saídas pela data do pagamento.`,
      'Nas colunas por canal, as saídas são rateadas pelas entradas de cada canal (marcadas com ÷).',
    ];
    return { columns: this.colunas(canais), lines: m.lines, notes };
  }

  /** Fluxo de caixa diário: realizado até hoje e previsto daqui para frente. */
  async cashflow(ctx: RequestContext, q: CashflowQuery): Promise<Cashflow> {
    await this.receivables.sync(ctx.tenantId);
    const t = ctx.tenantId;
    const hoje = todayBR();
    const lojaRec = ctx.storeIds.length ? Prisma.sql`AND (r.store_id IS NULL OR r.store_id IN (${Prisma.join(ctx.storeIds)}))` : Prisma.empty;
    const lojaConta = ctx.storeIds.length ? Prisma.sql`AND (p.store_id IS NULL OR p.store_id IN (${Prisma.join(ctx.storeIds)}))` : Prisma.empty;
    const de = asDate(q.from);
    const ate = asDate(q.to);
    const [recebido, previsto, pago, aPagar, atrasados] = await Promise.all([
      this.prisma.$queryRaw<Array<{ d: Date; v: Prisma.Decimal }>>`SELECT received_date AS d, SUM(received_amount) AS v FROM receivable r WHERE tenant_id = ${t} AND status = 'recebido' AND received_date BETWEEN ${de} AND ${ate} ${lojaRec} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ d: Date; v: Prisma.Decimal }>>`SELECT due_date AS d, SUM(net) AS v FROM receivable r WHERE tenant_id = ${t} AND status = 'aberto' AND due_date BETWEEN ${de} AND ${ate} AND due_date >= ${asDate(hoje)} ${lojaRec} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ d: Date; v: Prisma.Decimal }>>`SELECT paid_date AS d, SUM(amount) AS v FROM payable p WHERE tenant_id = ${t} AND status = 'paid' AND paid_date BETWEEN ${de} AND ${ate} ${lojaConta} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ d: Date; v: Prisma.Decimal }>>`SELECT due_date AS d, SUM(amount) AS v FROM payable p WHERE tenant_id = ${t} AND status = 'open' AND due_date BETWEEN ${de} AND ${ate} AND due_date >= ${asDate(hoje)} ${lojaConta} GROUP BY 1`,
      this.prisma.$queryRaw<Array<{ rec: Prisma.Decimal | null; pag: Prisma.Decimal | null }>>`
        SELECT (SELECT SUM(net) FROM receivable r WHERE tenant_id = ${t} AND status = 'aberto' AND due_date < ${asDate(hoje)} ${lojaRec}) AS rec,
               (SELECT SUM(amount) FROM payable p WHERE tenant_id = ${t} AND status = 'open' AND due_date < ${asDate(hoje)} ${lojaConta}) AS pag`,
    ]);
    const mapa = (rows: Array<{ d: Date; v: Prisma.Decimal }>) => new Map(rows.map((r) => [r.d.toISOString().slice(0, 10), num(r.v)]));
    const [mr, mp, mpg, map] = [mapa(recebido), mapa(previsto), mapa(pago), mapa(aPagar)];
    const days: Cashflow['days'] = [];
    let saldo = q.opening;
    let tin = 0;
    let tout = 0;
    for (let d = q.from; d <= q.to && days.length < 400; d = addDays(d, 1)) {
      const inDone = r2(mr.get(d) ?? 0);
      const inExpected = r2(mp.get(d) ?? 0);
      const outDone = r2(mpg.get(d) ?? 0);
      const outExpected = r2(map.get(d) ?? 0);
      const net = r2(inDone + inExpected - outDone - outExpected);
      saldo = r2(saldo + net);
      tin += inDone + inExpected;
      tout += outDone + outExpected;
      days.push({ date: d, inDone, inExpected, outDone, outExpected, net, balance: saldo });
    }
    return { from: q.from, to: q.to, opening: q.opening, days, totals: { in: r2(tin), out: r2(tout), net: r2(tin - tout) }, overdue: { receivables: num(atrasados[0]?.rec), payables: num(atrasados[0]?.pag) } };
  }
}

/** Grupos de dedução/despesa somam valores positivos (o sinal vai na linha). */
function negar(v: Valores): Valores {
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, -x]));
}
