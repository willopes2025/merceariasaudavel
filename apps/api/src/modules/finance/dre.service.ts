import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SALE_CHANNELS, addDays, todayBR, type Cashflow, type CashflowQuery, type Dre, type DreEntry, type DreGroup, type DreLine, type DreQuery, type DreView } from '@mercearia/contracts';
import { ForbiddenError, NotFoundError } from '../../common/errors/domain-error';
import { PrismaService } from '../../common/prisma/prisma.service';
import { canUseStore, type RequestContext } from '../../common/tenancy/request-context';
import { LedgerService, cmpCode } from './ledger.service';
import { ReceivablesService } from './receivables.service';

const asDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
const brStart = (iso: string) => new Date(`${iso}T00:00:00-03:00`);
const num = (v: Prisma.Decimal | number | bigint | null | undefined) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86400_000);
const OUTROS = 'sem_canal';
/** Conta do plano onde ficam os impostos sobre vendas lançados (some da competência quando há alíquota estimada). */
const CONTA_IMPOSTOS = '2.6';

type Valores = Record<string, number>;
type Conta = { id: string; code: string; name: string; dreLine: string; cashOnly: boolean };
type Opts = Partial<Pick<DreLine, 'parent' | 'code' | 'accountId' | 'auto' | 'allocated'>>;

/** Monta as linhas somando por canal; o total é a soma dos canais. */
class Montador {
  readonly lines: DreLine[] = [];
  constructor(readonly canais: string[]) {}
  add(key: string, label: string, level: DreLine['level'], sign: 1 | -1, porCanal: Valores, o: Opts = {}) {
    const values: Valores = { total: 0 };
    for (const c of this.canais) {
      values[c] = r2(porCanal[c] ?? 0);
      values.total = r2(values.total! + values[c]!);
    }
    const l: DreLine = { key, label, level, sign, values, ...o };
    this.lines.push(l);
    return l;
  }
  /** Soma (com sinal) de linhas. */
  soma(keys: string[]): Valores {
    const out: Valores = {};
    const ls = keys.map((k) => this.lines.find((l) => l.key === k)).filter((l): l is DreLine => !!l);
    for (const c of [...this.canais, 'total']) out[c] = r2(ls.reduce((s, l) => s + (l.values[c] ?? 0) * l.sign, 0));
    return out;
  }
  /** Grupo: abre espaço, deixa os filhos entrarem e fecha com a soma deles. */
  grupo(key: string, label: string, sign: 1 | -1, filhos: () => string[]) {
    const pos = this.lines.length;
    const keys = filhos();
    const soma = this.soma(keys);
    const l = this.add(key, label, 1, sign, sign < 0 ? negar(soma) : soma);
    this.lines.splice(pos, 0, this.lines.pop()!);
    return l;
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

function negar(v: Valores): Valores {
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, -x]));
}

/**
 * DRE gerencial nas duas visões, em árvore (grupo → conta → detalhe) e com colunas por canal de venda:
 *  - Competência: a venda conta no dia em que foi feita; despesas pelo mês de competência do lançamento.
 *    O que vem das vendas é calculado (receita por categoria, descontos, CMV, taxas, comissões, cashback);
 *    o resto vem dos lançamentos nas contas do plano de contas.
 *  - Caixa: o que caiu na conta (já sem taxa) e o que foi pago, pela data do pagamento.
 */
@Injectable()
export class DreService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly receivables: ReceivablesService,
    private readonly ledger: LedgerService,
  ) {}

  private lojas(ctx: RequestContext, storeId?: string) {
    if (storeId && !canUseStore(ctx, storeId)) throw new ForbiddenError('STORE_NOT_ALLOWED', 'Você não trabalha nessa loja.');
    return storeId ? [storeId] : ctx.storeIds;
  }

  async dre(ctx: RequestContext, q: DreQuery): Promise<Dre> {
    await this.receivables.sync(ctx.tenantId);
    const lojas = this.lojas(ctx, q.storeId);
    const contas = (await this.prisma.chartAccount.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, code: true, name: true, dreLine: true, cashOnly: true } })).sort((a, b) => cmpCode(a.code, b.code));
    const montar = (de: string, ate: string) => (q.view === 'caixa' ? this.caixa(ctx.tenantId, lojas, de, ate, contas) : this.competencia(ctx.tenantId, lojas, de, ate, contas));
    const atual = await montar(q.from, q.to);
    const dias = diasEntre(q.from, q.to) + 1;
    const pAte = addDays(q.from, -1);
    const pDe = addDays(q.from, -dias);
    const ant = await montar(pDe, pAte);
    const previous: Valores = {};
    for (const l of ant.lines) previous[l.key] = l.values.total ?? 0;
    return { from: q.from, to: q.to, view: q.view, columns: atual.columns, lines: atual.lines, previous: { from: pDe, to: pAte, values: previous }, notes: atual.notes };
  }

  private colunas(canais: string[]) {
    return [{ key: 'total', label: 'Total' }, ...canais.map((c) => ({ key: c, label: c === OUTROS ? 'Sem canal' : ((SALE_CHANNELS as Record<string, string>)[c] ?? c) }))];
  }

  /** Lançamentos por conta do plano no período (contas a pagar e recebimentos avulsos). */
  private async porConta(tenantId: string, lojas: string[], from: string, to: string, view: DreView) {
    const lojaP = lojas.length ? Prisma.sql`AND (p.store_id IS NULL OR p.store_id IN (${Prisma.join(lojas)}))` : Prisma.empty;
    const lojaR = lojas.length ? Prisma.sql`AND (r.store_id IS NULL OR r.store_id IN (${Prisma.join(lojas)}))` : Prisma.empty;
    const [de, ate] = [asDate(from), asDate(to)];
    const pagar =
      view === 'caixa'
        ? await this.prisma.$queryRaw<Array<{ id: string | null; v: Prisma.Decimal }>>`SELECT p.chart_account_id AS id, SUM(p.amount) AS v FROM payable p WHERE p.tenant_id = ${tenantId} AND p.status = 'paid' AND p.paid_date BETWEEN ${de} AND ${ate} ${lojaP} GROUP BY 1`
        : await this.prisma.$queryRaw<Array<{ id: string | null; v: Prisma.Decimal }>>`SELECT p.chart_account_id AS id, SUM(p.amount) AS v FROM payable p WHERE p.tenant_id = ${tenantId} AND p.status <> 'canceled' AND COALESCE(p.competence, p.due_date) BETWEEN ${de} AND ${ate} ${lojaP} GROUP BY 1`;
    const receber =
      view === 'caixa'
        ? await this.prisma.$queryRaw<Array<{ id: string | null; v: Prisma.Decimal }>>`SELECT r.chart_account_id AS id, SUM(r.received_amount) AS v FROM receivable r WHERE r.tenant_id = ${tenantId} AND r.kind = 'avulso' AND r.status = 'recebido' AND r.received_date BETWEEN ${de} AND ${ate} ${lojaR} GROUP BY 1`
        : await this.prisma.$queryRaw<Array<{ id: string | null; v: Prisma.Decimal }>>`SELECT r.chart_account_id AS id, SUM(r.net) AS v FROM receivable r WHERE r.tenant_id = ${tenantId} AND r.kind = 'avulso' AND r.status <> 'cancelado' AND r.due_date BETWEEN ${de} AND ${ate} ${lojaR} GROUP BY 1`;
    return { pagar: new Map(pagar.map((x) => [x.id ?? '', num(x.v)])), receber: new Map(receber.map((x) => [x.id ?? '', num(x.v)])) };
  }

  /**
   * Linhas das contas do plano de um grupo do DRE: conta folha no nível 2; conta com contas abaixo vira subgrupo
   * (nível 2) e as de baixo ficam no nível 3. Devolve as chaves de nível 2 (para somar no grupo).
   */
  private contasDoGrupo(m: Montador, contas: Conta[], grupos: DreGroup[], valor: (c: Conta) => number, sinal: (c: Conta) => 1 | -1, pesos: Valores, pular: (c: Conta) => boolean = () => false): string[] {
    const doGrupo = contas.filter((c) => grupos.includes(c.dreLine as DreGroup));
    const temFilho = (c: Conta) => contas.some((x) => x.code.startsWith(`${c.code}.`));
    const keys: string[] = [];
    const rateado = m.canais.length > 1;
    for (const c of doGrupo) {
      const prof = c.code.split('.').length;
      if (prof === 1 && temFilho(c)) continue; // a raiz (ex.: "5 Despesas operacionais") é a própria seção
      const paiCodigo = c.code.split('.').slice(0, 2).join('.');
      const pai = prof > 2 ? doGrupo.find((x) => x.code === paiCodigo) : undefined;
      if (temFilho(c)) {
        if (prof > 2) continue; // subgrupo de 3º nível: as folhas dele sobem para o subgrupo de 2º nível
        const filhos = doGrupo.filter((x) => x.code.startsWith(`${c.code}.`) && !temFilho(x) && !pular(x));
        const pos = m.lines.length;
        const fk = filhos.map((f) => {
          m.add(`acc_${f.id}`, f.name, 3, sinal(f), ratear(valor(f), pesos, m.canais), { parent: `acc_${c.id}`, code: f.code, accountId: f.id, ...(rateado ? { allocated: true } : {}) });
          return `acc_${f.id}`;
        });
        const soma = m.soma(fk);
        m.add(`acc_${c.id}`, c.name, 2, sinal(c), sinal(c) < 0 ? negar(soma) : soma, { code: c.code });
        m.lines.splice(pos, 0, m.lines.pop()!);
        keys.push(`acc_${c.id}`);
      } else if (!pai && !pular(c)) {
        m.add(`acc_${c.id}`, c.name, 2, sinal(c), ratear(valor(c), pesos, m.canais), { code: c.code, accountId: c.id, ...(rateado ? { allocated: true } : {}) });
        keys.push(`acc_${c.id}`);
      }
    }
    return keys;
  }

  private async competencia(tenantId: string, lojas: string[], from: string, to: string, contas: Conta[]) {
    const periodo = { gte: brStart(from), lt: brStart(addDays(to, 1)) };
    const lojaVenda = lojas.length ? Prisma.sql`AND s.store_id IN (${Prisma.join(lojas)})` : Prisma.empty;
    const lojaEstoque = lojas.length ? Prisma.sql`AND m.store_id IN (SELECT COALESCE(stock_store_id, id) FROM store WHERE id IN (${Prisma.join(lojas)}))` : Prisma.empty;
    const noPeriodo = Prisma.sql`s.tenant_id = ${tenantId} AND s.status = 'completed' AND s.created_at >= ${periodo.gte} AND s.created_at < ${periodo.lt} ${lojaVenda}`;
    const [vendas, categorias, taxas, perdas, lanc, cfg] = await Promise.all([
      this.prisma.$queryRaw<Array<Record<string, Prisma.Decimal | string | bigint>>>`
        SELECT s.channel, COUNT(*) AS qtd, SUM(s.gross_total) AS tabela, SUM(s.delivery_fee) AS entrega, SUM(s.member_savings) AS membro, SUM(s.promo_savings) AS promo,
               SUM(s.coupon_discount) AS cupom, SUM(s.partner_discount) AS parceiro, SUM(s.total + s.cashback_used - s.delivery_fee) AS mercadoria,
               SUM(s.cost_total) AS cmv, SUM(s.cashback_earned) AS cashback, SUM(s.partner_commission) AS comissao
          FROM sale s WHERE ${noPeriodo} GROUP BY s.channel`,
      this.prisma.$queryRaw<Array<{ channel: string; id: string | null; name: string | null; tabela: Prisma.Decimal; custo: Prisma.Decimal }>>`
        SELECT s.channel, c.id, c.name, SUM(i.list_price * i.quantity) AS tabela, SUM(i.unit_cost * i.quantity) AS custo
          FROM sale_item i JOIN sale s ON s.id = i.sale_id LEFT JOIN product_category c ON c.id = i.category_id
         WHERE ${noPeriodo} GROUP BY s.channel, c.id, c.name`,
      this.prisma.$queryRaw<Array<{ channel: string; metodo: string | null; fee: Prisma.Decimal }>>`
        SELECT s.channel, pm.name AS metodo, SUM(r.fee) AS fee FROM receivable r JOIN sale s ON s.id = r.sale_id LEFT JOIN payment_method pm ON pm.id = r.method_id
         WHERE r.tenant_id = ${tenantId} AND r.kind = 'venda' AND ${noPeriodo} GROUP BY s.channel, pm.name HAVING SUM(r.fee) <> 0`,
      this.prisma.$queryRaw<Array<{ value: Prisma.Decimal | null }>>`
        SELECT SUM(-m.delta * m.unit_cost) AS value FROM stock_movement m
         WHERE m.tenant_id = ${tenantId} AND m.type IN ('perda', 'contagem') AND m.created_at >= ${periodo.gte} AND m.created_at < ${periodo.lt} ${lojaEstoque}`,
      this.porConta(tenantId, lojas, from, to, 'competencia'),
      this.receivables.config(tenantId),
    ]);
    const ordem = Object.keys(SALE_CHANNELS);
    const canaisVenda = [...new Set(vendas.map((v) => String(v.channel)))].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
    const canais = canaisVenda.length ? canaisVenda : [OUTROS];
    const por = (campo: string): Valores => Object.fromEntries(vendas.map((v) => [String(v.channel), num(v[campo] as Prisma.Decimal)]));
    const m = new Montador(canais);
    const [tabela, mercadoria, entrega, membro, promo, cupom, parceiro, cmv] = [por('tabela'), por('mercadoria'), por('entrega'), por('membro'), por('promo'), por('cupom'), por('parceiro'), por('cmv')];
    const faturado: Valores = Object.fromEntries(canais.map((c) => [c, (mercadoria[c] ?? 0) + (entrega[c] ?? 0)]));
    const notes: string[] = [];
    const valor = (c: Conta) => (c.dreLine === 'receita' || c.dreLine === 'financeira_receita' ? (lanc.receber.get(c.id) ?? 0) - (lanc.pagar.get(c.id) ?? 0) : (lanc.pagar.get(c.id) ?? 0) - (lanc.receber.get(c.id) ?? 0));
    const sinal = (c: Conta): 1 | -1 => (c.dreLine === 'receita' || c.dreLine === 'financeira_receita' ? 1 : -1);
    const soCaixa = (c: Conta) => c.cashOnly;

    /** Detalhe por categoria de produto (o que não fecha com o total vira "Ajustes"). */
    const porCategoria = (parent: string, campo: 'tabela' | 'custo', total: Valores, sign: 1 | -1) => {
      const nomes = [...new Map(categorias.map((c) => [c.id ?? '', c.name ?? 'Sem categoria'])).entries()];
      const soma: Valores = {};
      const linhas = nomes
        .map(([id, nome]) => {
          const v: Valores = {};
          for (const c of categorias.filter((x) => (x.id ?? '') === id)) v[c.channel] = (v[c.channel] ?? 0) + num(c[campo]);
          return { id, nome, v, t: Object.values(v).reduce((a, b) => a + b, 0) };
        })
        .sort((a, b) => b.t - a.t);
      for (const l of linhas) {
        m.add(`${parent}_cat_${l.id || 'sem'}`, l.nome, 3, sign, l.v, { parent, auto: true });
        for (const c of canais) soma[c] = (soma[c] ?? 0) + r2(l.v[c] ?? 0);
      }
      const resto: Valores = Object.fromEntries(canais.map((c) => [c, r2((total[c] ?? 0) - (soma[c] ?? 0))]));
      if (Object.values(resto).some((x) => Math.abs(x) > 0.009)) m.add(`${parent}_cat_ajuste`, 'Opcionais e ajustes', 3, sign, resto, { parent, auto: true });
    };

    // Receita bruta
    m.grupo('receita_bruta', 'Receita bruta', 1, () => {
      m.add('vendas_tabela', 'Vendas de mercadorias (preço de tabela)', 2, 1, tabela, { auto: true });
      porCategoria('vendas_tabela', 'tabela', tabela, 1);
      m.add('entrega', 'Taxas de entrega', 2, 1, entrega, { auto: true });
      return ['vendas_tabela', 'entrega', ...this.contasDoGrupo(m, contas, ['receita'], valor, sinal, mercadoria)];
    });
    // Deduções
    const manuais: Valores = Object.fromEntries(canais.map((c) => [c, (tabela[c] ?? 0) - (membro[c] ?? 0) - (promo[c] ?? 0) - (cupom[c] ?? 0) - (parceiro[c] ?? 0) - (mercadoria[c] ?? 0)]));
    m.grupo('deducoes', 'Deduções da receita', -1, () => {
      m.add('preco_membro', 'Preço de membro', 2, -1, membro, { auto: true });
      m.add('promocoes', 'Ofertas e promoções', 2, -1, promo, { auto: true });
      m.add('cupons', 'Cupons', 2, -1, cupom, { auto: true });
      m.add('desc_parceiro', 'Desconto de parceiros', 2, -1, parceiro, { auto: true });
      m.add('desc_manual', 'Descontos no caixa', 2, -1, manuais, { auto: true });
      const keys = ['preco_membro', 'promocoes', 'cupons', 'desc_parceiro', 'desc_manual'];
      if (cfg.impostoPct > 0) {
        m.add('impostos', `Impostos sobre vendas (estimado ${String(cfg.impostoPct).replace('.', ',')}%)`, 2, -1, Object.fromEntries(canais.map((c) => [c, ((faturado[c] ?? 0) * cfg.impostoPct) / 100])), { auto: true });
        keys.push('impostos');
        notes.push(`Impostos sobre vendas estimados pela alíquota de ${String(cfg.impostoPct).replace('.', ',')}%; as guias lançadas na conta ${CONTA_IMPOSTOS} entram só na visão de caixa.`);
      } else notes.push('Para estimar os impostos sobre as vendas (ex.: Simples Nacional), informe a alíquota em Configurar. Sem ela, valem as guias lançadas em contas a pagar.');
      return [...keys, ...this.contasDoGrupo(m, contas, ['deducao'], valor, sinal, faturado, (c) => cfg.impostoPct > 0 && c.code === CONTA_IMPOSTOS)];
    });
    m.add('receita_liquida', 'Receita líquida', 0, 1, m.soma(['receita_bruta', 'deducoes']));
    // Custos
    m.grupo('custos', 'Custos', -1, () => {
      m.add('cmv', 'Custo das mercadorias vendidas (CMV)', 2, -1, cmv, { auto: true });
      porCategoria('cmv', 'custo', cmv, -1);
      m.add('perdas', 'Perdas e acertos de estoque', 2, -1, ratear(num(perdas[0]?.value), mercadoria, canais), { auto: true, ...(canais.length > 1 ? { allocated: true } : {}) });
      return ['cmv', 'perdas', ...this.contasDoGrupo(m, contas, ['custo'], valor, sinal, mercadoria, soCaixa)];
    });
    m.add('lucro_bruto', 'Lucro bruto', 0, 1, m.soma(['receita_liquida', 'custos']));
    // Despesas de venda
    m.grupo('despesas_venda', 'Despesas de venda', -1, () => {
      const totalTaxas: Valores = {};
      for (const t of taxas) totalTaxas[t.channel] = (totalTaxas[t.channel] ?? 0) + num(t.fee);
      m.add('taxas', 'Taxas de cartão, Pix e app', 2, -1, totalTaxas, { auto: true });
      for (const nome of [...new Set(taxas.map((t) => t.metodo ?? 'Outras'))]) {
        const v: Valores = {};
        for (const t of taxas.filter((x) => (x.metodo ?? 'Outras') === nome)) v[t.channel] = (v[t.channel] ?? 0) + num(t.fee);
        m.add(`taxas_${nome}`, nome, 3, -1, v, { parent: 'taxas', auto: true });
      }
      m.add('comissoes', 'Comissão de parceiros', 2, -1, por('comissao'), { auto: true });
      m.add('cashback', 'Cashback concedido', 2, -1, por('cashback'), { auto: true });
      return ['taxas', 'comissoes', 'cashback', ...this.contasDoGrupo(m, contas, ['despesa_venda'], valor, sinal, mercadoria, soCaixa)];
    });
    m.grupo('despesas_operacionais', 'Despesas operacionais', -1, () => this.contasDoGrupo(m, contas, ['despesa_operacional'], valor, sinal, mercadoria, soCaixa));
    m.add('resultado_operacional', 'Resultado operacional', 0, 1, m.soma(['lucro_bruto', 'despesas_venda', 'despesas_operacionais']));
    m.grupo('resultado_financeiro', 'Resultado financeiro', 1, () => this.contasDoGrupo(m, contas, ['financeira_receita', 'financeira_despesa'], valor, sinal, mercadoria, soCaixa));
    m.grupo('impostos_lucro', 'Impostos sobre o lucro', -1, () => this.contasDoGrupo(m, contas, ['imposto_lucro'], valor, sinal, mercadoria, soCaixa));
    m.add('resultado', 'Resultado líquido (lucro ou prejuízo)', 0, 1, m.soma(['resultado_operacional', 'resultado_financeiro', 'impostos_lucro']));

    const semConta = (lanc.pagar.get('') ?? 0) + contas.filter((c) => contas.some((x) => x.code.startsWith(`${c.code}.`))).reduce((s, c) => s + (lanc.pagar.get(c.id) ?? 0), 0);
    if (semConta > 0.009) notes.push(`Há ${semConta.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em contas a pagar sem conta do plano (ou lançadas em um grupo): elas não aparecem no DRE. Classifique em Contas a pagar.`);
    const foraCompetencia = contas.filter((c) => c.cashOnly).reduce((s, c) => s + (lanc.pagar.get(c.id) ?? 0), 0);
    if (foraCompetencia > 0.009) notes.push('Compras de mercadoria e insumos e o pagamento de comissões não entram na competência: o custo aparece no CMV quando o produto é vendido, e a comissão quando a venda acontece. Eles aparecem na visão de caixa.');
    const fora = contas.filter((c) => c.dreLine === 'fora').reduce((s, c) => s + (lanc.pagar.get(c.id) ?? 0), 0);
    if (fora > 0.009) notes.push('Investimentos, parcelas de empréstimo e retiradas dos sócios ficam fora do resultado (aparecem na visão de caixa).');
    notes.push('Despesas entram pela competência do lançamento (padrão: o vencimento). Nas colunas por canal, o que não é direto do canal é rateado pela receita (÷).');
    if (vendas.some((v) => num(v.cmv as Prisma.Decimal) === 0 && num(v.mercadoria as Prisma.Decimal) > 0)) notes.push('Produtos sem custo cadastrado deixam o CMV menor do que o real.');
    return { columns: this.colunas(canais), lines: m.lines, notes };
  }

  private async caixa(tenantId: string, lojas: string[], from: string, to: string, contas: Conta[]) {
    const lojaRec = lojas.length ? Prisma.sql`AND (r.store_id IS NULL OR r.store_id IN (${Prisma.join(lojas)}))` : Prisma.empty;
    const [entradas, lanc] = await Promise.all([
      this.prisma.$queryRaw<Array<{ channel: string | null; metodo: string | null; valor: Prisma.Decimal; taxa: Prisma.Decimal }>>`
        SELECT s.channel, pm.name AS metodo, SUM(r.received_amount) AS valor, SUM(r.fee) AS taxa
          FROM receivable r LEFT JOIN sale s ON s.id = r.sale_id LEFT JOIN payment_method pm ON pm.id = r.method_id
         WHERE r.tenant_id = ${tenantId} AND r.kind <> 'avulso' AND r.status = 'recebido' AND r.received_date >= ${asDate(from)} AND r.received_date <= ${asDate(to)} ${lojaRec}
         GROUP BY s.channel, pm.name`,
      this.porConta(tenantId, lojas, from, to, 'caixa'),
    ]);
    const canalDe = (c: string | null) => c ?? OUTROS;
    const ordem = [...Object.keys(SALE_CHANNELS), OUTROS];
    const canaisEntrada = [...new Set(entradas.map((e) => canalDe(e.channel)))].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b));
    const canais = canaisEntrada.length ? canaisEntrada : [OUTROS];
    const m = new Montador(canais);
    const pesos: Valores = {};
    for (const e of entradas) pesos[canalDe(e.channel)] = (pesos[canalDe(e.channel)] ?? 0) + num(e.valor);
    // No caixa, o que entra numa conta é entrada e o que sai é saída, qualquer que seja o grupo.
    const entra = (c: Conta) => lanc.receber.get(c.id) ?? 0;
    const sai = (c: Conta) => lanc.pagar.get(c.id) ?? 0;
    const liquido = (c: Conta) => (c.dreLine === 'receita' || c.dreLine === 'financeira_receita' ? entra(c) - sai(c) : sai(c) - entra(c));
    const sinal = (c: Conta): 1 | -1 => (c.dreLine === 'receita' || c.dreLine === 'financeira_receita' ? 1 : -1);
    m.grupo('entradas', 'Entradas (já sem as taxas)', 1, () => {
      m.add('vendas_recebidas', 'Recebimentos de vendas', 2, 1, pesos, { auto: true });
      [...new Set(entradas.map((e) => e.metodo ?? 'Outros'))].forEach((nome, i) => {
        const v: Valores = {};
        for (const e of entradas.filter((x) => (x.metodo ?? 'Outros') === nome)) v[canalDe(e.channel)] = (v[canalDe(e.channel)] ?? 0) + num(e.valor);
        m.add(`in_${i}`, nome, 3, 1, v, { parent: 'vendas_recebidas', auto: true });
      });
      return ['vendas_recebidas', ...this.contasDoGrupo(m, contas, ['receita'], liquido, sinal, pesos)];
    });
    const saidas: Array<[string, string, DreGroup[]]> = [
      ['deducoes', 'Impostos e devoluções', ['deducao']],
      ['custos', 'Compras e custos', ['custo']],
      ['despesas_venda', 'Despesas de venda', ['despesa_venda']],
      ['despesas_operacionais', 'Despesas operacionais', ['despesa_operacional']],
      ['impostos_lucro', 'Impostos sobre o lucro', ['imposto_lucro']],
    ];
    for (const [key, label, grupos] of saidas) m.grupo(key, label, -1, () => this.contasDoGrupo(m, contas, grupos, liquido, sinal, pesos));
    m.grupo('resultado_financeiro', 'Resultado financeiro', 1, () => this.contasDoGrupo(m, contas, ['financeira_receita', 'financeira_despesa'], liquido, sinal, pesos));
    m.add('resultado', 'Geração de caixa da operação', 0, 1, m.soma(['entradas', ...saidas.map((s) => s[0]), 'resultado_financeiro']));
    m.grupo('fora', 'Investimentos, empréstimos e sócios', -1, () => this.contasDoGrupo(m, contas, ['fora'], liquido, sinal, pesos));
    m.add('variacao_caixa', 'Variação do caixa no período', 0, 1, m.soma(['resultado', 'fora']));
    const taxas = entradas.reduce((s, e) => s + num(e.taxa), 0);
    const notes = [
      `Entradas pela data em que o dinheiro caiu (cartão no prazo da maquininha), já sem ${taxas ? `as taxas (${taxas.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} no período)` : 'as taxas'}. Saídas pela data do pagamento.`,
      'Nas colunas por canal, as saídas são rateadas pelas entradas de cada canal (÷).',
    ];
    const semConta = lanc.pagar.get('') ?? 0;
    if (semConta > 0.009) notes.push(`Há ${semConta.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} pagos sem conta do plano: não aparecem aqui. Classifique em Contas a pagar.`);
    return { columns: this.colunas(canais), lines: m.lines, notes };
  }

  /** Lançamentos de uma conta do plano no período (o que está por trás da linha do DRE). */
  async entries(ctx: RequestContext, accountId: string, from: string, to: string, view: DreView): Promise<DreEntry[]> {
    const conta = await this.prisma.chartAccount.findFirst({ where: { id: accountId, tenantId: ctx.tenantId } });
    if (!conta) throw new NotFoundError('conta do plano', accountId);
    const [de, ate] = [asDate(from), asDate(to)];
    const lojas = ctx.storeIds.length ? { OR: [{ storeId: null }, { storeId: { in: ctx.storeIds } }] } : {};
    const [pagar, receber] = await Promise.all([
      this.prisma.payable.findMany({
        where: { tenantId: ctx.tenantId, chartAccountId: accountId, ...lojas, ...(view === 'caixa' ? { status: 'paid', paidDate: { gte: de, lte: ate } } : { status: { not: 'canceled' }, competence: { gte: de, lte: ate } }) },
        orderBy: view === 'caixa' ? { paidDate: 'asc' } : { competence: 'asc' },
        take: 500,
      }),
      this.prisma.receivable.findMany({
        where: { tenantId: ctx.tenantId, chartAccountId: accountId, kind: 'avulso', ...lojas, ...(view === 'caixa' ? { status: 'recebido', receivedDate: { gte: de, lte: ate } } : { status: { not: 'cancelado' }, dueDate: { gte: de, lte: ate } }) },
        take: 500,
      }),
    ]);
    const d = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : '');
    return [
      ...pagar.map((p): DreEntry => ({ id: p.id, kind: 'pagar', date: d(view === 'caixa' ? p.paidDate : (p.competence ?? p.dueDate)), description: p.description, who: p.supplier, amount: num(p.amount), status: p.status === 'paid' ? 'paga' : d(p.dueDate) < todayBR() ? 'vencida' : 'a vencer' })),
      ...receber.map((r): DreEntry => ({ id: r.id, kind: 'receber', date: d(view === 'caixa' ? r.receivedDate : r.dueDate), description: r.description, who: null, amount: num(view === 'caixa' ? r.receivedAmount : r.net), status: r.status === 'recebido' ? 'recebido' : 'a receber' })),
    ].sort((a, b) => a.date.localeCompare(b.date));
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
    const contas = q.opening === undefined ? await this.ledger.balanceAt(t, addDays(q.from, -1)) : null;
    const opening = q.opening ?? contas?.balance ?? 0;
    let saldo = opening;
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
    return { from: q.from, to: q.to, opening, openingFromAccounts: q.opening === undefined && !!contas?.accounts, days, totals: { in: r2(tin), out: r2(tout), net: r2(tin - tout) }, overdue: { receivables: num(atrasados[0]?.rec), payables: num(atrasados[0]?.pag) } };
  }
}
