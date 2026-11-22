import { Prisma } from '@prisma/client';

/**
 * Motor de consultas do Assistente (portado da Plataforma Aritana): conjuntos de dados pré-definidos (o SQL é fixo,
 * escrito aqui), com dimensões para agrupar e filtrar, métricas e colunas. O assistente só escolhe os nomes; os
 * valores dos filtros, das datas e da organização vão como parâmetros. Nenhum SQL vindo da IA é executado.
 * Valores em R$ (a Mercearia guarda em reais, com centavos).
 */
export type TipoMetrica = 'reais' | 'numero' | 'pct';
export interface Conjunto {
  descricao: string;
  /** Pode consultar quem tem alguma destas permissões. */
  permissoes: string[];
  /** FROM … JOIN … (fixo). */
  de: string;
  /** Coluna da organização (filtro obrigatório). */
  tenant: string;
  /** Filtro fixo (ex.: só vendas concluídas). */
  onde?: string;
  /** Coluna de data para o período. */
  data?: { expr: string; tipo: 'timestamp' | 'date'; rotulo: string };
  dimensoes: Record<string, string>;
  metricas: Record<string, { expr: string; tipo: TipoMetrica }>;
  colunas: Record<string, string | { expr: string; tipo?: TipoMetrica | 'data' }>;
}

/** As datas do banco são em UTC: o dia é o de Brasília. */
const SP = "at time zone 'UTC' at time zone 'America/Sao_Paulo'";
const tempo = (col: string) => ({
  dia: `to_char((${col} ${SP})::date, 'DD/MM/YYYY')`,
  mes: `to_char((${col} ${SP})::date, 'YYYY-MM')`,
  dia_semana: `(array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[extract(dow from (${col} ${SP}))::int + 1]`,
  hora: `lpad(extract(hour from (${col} ${SP}))::int::text, 2, '0') || 'h'`,
});
const tempoData = (col: string) => ({ dia: `to_char(${col}, 'DD/MM/YYYY')`, mes: `to_char(${col}, 'YYYY-MM')`, dia_semana: `(array['domingo','segunda','terça','quarta','quinta','sexta','sábado'])[extract(dow from ${col})::int + 1]` });
const simNao = (expr: string) => `case when ${expr} then 'sim' else 'não' end`;

export const CONJUNTOS: Record<string, Conjunto> = {
  vendas_itens: {
    descricao: 'Itens vendidos (produtos, shakes, sorvetes): o que mais vende, por categoria, marca, vendedor, loja, canal, cliente membro ou não, dia e hora.',
    permissoes: ['report.view'],
    de: 'sale_item si join sale s on s.id = si.sale_id left join product p on p.id = si.product_id left join product_category c on c.id = si.category_id left join store st on st.id = s.store_id left join app_user u on u.id = s.seller_id left join customer cu on cu.id = s.customer_id',
    tenant: 's.tenant_id',
    onde: "s.status = 'completed'",
    data: { expr: 's.created_at', tipo: 'timestamp', rotulo: 'data da venda' },
    dimensoes: { produto: 'si.description', marca: "coalesce(p.brand, '—')", categoria: "coalesce(c.name, 'sem categoria')", tipo_produto: 'si.kind', loja: 'st.name', vendedor: "coalesce(u.name, '—')", canal: 's.channel', cliente: "coalesce(cu.name, 'sem cadastro')", membro: simNao('s.member_pricing'), ...tempo('s.created_at') },
    metricas: {
      quantidade: { expr: 'sum(si.quantity)', tipo: 'numero' },
      faturamento: { expr: 'sum(si.total)', tipo: 'reais' },
      custo: { expr: 'sum(coalesce(si.unit_cost, 0) * si.quantity)', tipo: 'reais' },
      lucro_bruto: { expr: 'sum(si.total) - sum(coalesce(si.unit_cost, 0) * si.quantity)', tipo: 'reais' },
      vendas: { expr: 'count(distinct s.id)', tipo: 'numero' },
      economia_ofertas: { expr: 'sum(si.promo_savings)', tipo: 'reais' },
    },
    colunas: { venda: 's.number', data: { expr: 's.created_at', tipo: 'data' }, produto: 'si.description', quantidade: 'si.quantity', total: { expr: 'si.total', tipo: 'reais' }, loja: 'st.name', vendedor: 'u.name', cliente: 'cu.name' },
  },
  vendas: {
    descricao: 'Vendas (cupons): faturamento, ticket médio, descontos, cupom, parceiro, economia de membro, cashback usado e gerado, por loja, vendedor, canal, dia e hora.',
    permissoes: ['report.view'],
    de: 'sale s left join store st on st.id = s.store_id left join app_user u on u.id = s.seller_id left join customer cu on cu.id = s.customer_id',
    tenant: 's.tenant_id',
    onde: "s.status = 'completed'",
    data: { expr: 's.created_at', tipo: 'timestamp', rotulo: 'data da venda' },
    dimensoes: { loja: 'st.name', vendedor: "coalesce(u.name, '—')", canal: 's.channel', membro: simNao('s.member_pricing'), com_cliente: simNao('s.customer_id is not null'), com_cupom: simNao('s.coupon_id is not null'), com_parceiro: simNao('s.partner_id is not null'), entrega: simNao('s.delivery_fee > 0'), ...tempo('s.created_at') },
    metricas: {
      vendas: { expr: 'count(*)', tipo: 'numero' },
      faturamento: { expr: 'sum(s.total)', tipo: 'reais' },
      ticket_medio: { expr: 'round(avg(s.total), 2)', tipo: 'reais' },
      itens_por_venda: { expr: 'round(avg(s.items_count), 1)', tipo: 'numero' },
      descontos: { expr: 'sum(s.discount)', tipo: 'reais' },
      economia_membros: { expr: 'sum(s.member_savings)', tipo: 'reais' },
      cashback_usado: { expr: 'sum(s.cashback_used)', tipo: 'reais' },
      cashback_gerado: { expr: 'sum(s.cashback_earned)', tipo: 'reais' },
      taxa_entrega: { expr: 'sum(s.delivery_fee)', tipo: 'reais' },
      lucro_bruto: { expr: 'sum(s.total - s.delivery_fee - coalesce(s.cost_total, 0))', tipo: 'reais' },
    },
    colunas: { numero: 's.number', data: { expr: 's.created_at', tipo: 'data' }, loja: 'st.name', vendedor: 'u.name', cliente: 'cu.name', canal: 's.channel', total: { expr: 's.total', tipo: 'reais' }, desconto: { expr: 's.discount', tipo: 'reais' } },
  },
  vendas_canceladas: {
    descricao: 'Vendas canceladas: quem cancelou, motivo, valor.',
    permissoes: ['report.view'],
    de: 'sale s left join store st on st.id = s.store_id left join app_user u on u.id = s.canceled_by_id',
    tenant: 's.tenant_id',
    onde: "s.status = 'canceled'",
    data: { expr: 's.canceled_at', tipo: 'timestamp', rotulo: 'data do cancelamento' },
    dimensoes: { loja: 'st.name', cancelou: "coalesce(u.name, '—')", motivo: "coalesce(s.cancel_reason, '—')", ...tempo('s.canceled_at') },
    metricas: { vendas: { expr: 'count(*)', tipo: 'numero' }, valor: { expr: 'sum(s.total)', tipo: 'reais' } },
    colunas: { numero: 's.number', cancelada: { expr: 's.canceled_at', tipo: 'data' }, total: { expr: 's.total', tipo: 'reais' }, cancelou: 'u.name', motivo: 's.cancel_reason' },
  },
  pagamentos: {
    descricao: 'Recebimentos do caixa por forma de pagamento (dinheiro, Pix, cartões, Pix/cartão online), já descontando estornos.',
    permissoes: ['report.view', 'finance.view'],
    de: 'cash_movement cm join payment_method pm on pm.id = cm.method_id join cash_session cs on cs.id = cm.session_id join store st on st.id = cs.store_id',
    tenant: 'cm.tenant_id',
    onde: "cm.type in ('recebimento', 'estorno')",
    data: { expr: 'cm.created_at', tipo: 'timestamp', rotulo: 'data do recebimento' },
    dimensoes: { forma: 'pm.name', tipo_forma: 'pm.kind', loja: 'st.name', ...tempo('cm.created_at') },
    metricas: { valor: { expr: "sum(case when cm.type = 'estorno' then -abs(cm.amount) else cm.amount end)", tipo: 'reais' }, recebimentos: { expr: "count(*) filter (where cm.type = 'recebimento')", tipo: 'numero' } },
    colunas: { data: { expr: 'cm.created_at', tipo: 'data' }, forma: 'pm.name', tipo: 'cm.type', valor: { expr: 'cm.amount', tipo: 'reais' }, loja: 'st.name' },
  },
  estoque: {
    descricao: 'Estoque atual por produto e loja, com valor a custo e a preço de venda e o que está abaixo do mínimo.',
    permissoes: ['stock.view'],
    de: 'stock_balance b join product p on p.id = b.product_id join store st on st.id = b.store_id left join product_category c on c.id = p.category_id',
    tenant: 'b.tenant_id',
    onde: 'p.active and p.track_stock',
    dimensoes: { produto: 'p.name', marca: "coalesce(p.brand, '—')", categoria: "coalesce(c.name, 'sem categoria')", tipo_produto: 'p.kind', loja: 'st.name', abaixo_do_minimo: simNao('p.min_stock > 0 and b.quantity < p.min_stock'), zerado: simNao('b.quantity <= 0') },
    metricas: { quantidade: { expr: 'sum(b.quantity)', tipo: 'numero' }, valor_custo: { expr: 'sum(greatest(b.quantity, 0) * coalesce(p.cost, 0))', tipo: 'reais' }, valor_venda: { expr: 'sum(greatest(b.quantity, 0) * p.price)', tipo: 'reais' }, produtos: { expr: 'count(distinct p.id)', tipo: 'numero' } },
    colunas: { produto: 'p.name', marca: 'p.brand', loja: 'st.name', quantidade: 'b.quantity', minimo: 'p.min_stock', unidade: 'p.unit', preco: { expr: 'p.price', tipo: 'reais' }, custo: { expr: 'p.cost', tipo: 'reais' } },
  },
  movimentos_estoque: {
    descricao: 'Entradas, saídas, perdas (com motivo), acertos, contagens, vendas e consumo do preparo no período.',
    permissoes: ['stock.view'],
    de: 'stock_movement mv join product p on p.id = mv.product_id join store st on st.id = mv.store_id left join product_category c on c.id = p.category_id left join app_user u on u.id = mv.user_id',
    tenant: 'mv.tenant_id',
    data: { expr: 'mv.created_at', tipo: 'timestamp', rotulo: 'data do movimento' },
    dimensoes: { tipo: 'mv.type', motivo: "coalesce(mv.reason, '—')", produto: 'p.name', categoria: "coalesce(c.name, 'sem categoria')", loja: 'st.name', quem: "coalesce(u.name, '—')", ...tempo('mv.created_at') },
    metricas: { quantidade: { expr: 'sum(abs(mv.delta))', tipo: 'numero' }, valor_custo: { expr: 'sum(abs(mv.delta) * coalesce(mv.unit_cost, p.cost, 0))', tipo: 'reais' }, movimentos: { expr: 'count(*)', tipo: 'numero' } },
    colunas: { data: { expr: 'mv.created_at', tipo: 'data' }, tipo: 'mv.type', produto: 'p.name', quantidade: 'mv.delta', motivo: 'mv.reason', observacao: 'mv.note', quem: 'u.name', loja: 'st.name' },
  },
  lotes_validade: {
    descricao: 'Lotes com validade em estoque (o que vence e quando).',
    permissoes: ['stock.view'],
    de: 'stock_lot l join product p on p.id = l.product_id join store st on st.id = l.store_id',
    tenant: 'l.tenant_id',
    onde: 'l.quantity > 0',
    data: { expr: 'l.expires_at', tipo: 'date', rotulo: 'data de validade' },
    dimensoes: { produto: 'p.name', loja: 'st.name', vencido: simNao("l.expires_at < (now() at time zone 'America/Sao_Paulo')::date"), ...tempoData('l.expires_at') },
    metricas: { quantidade: { expr: 'sum(l.quantity)', tipo: 'numero' }, valor_custo: { expr: 'sum(l.quantity * coalesce(p.cost, 0))', tipo: 'reais' }, lotes: { expr: 'count(*)', tipo: 'numero' } },
    colunas: { produto: 'p.name', lote: 'l.code', validade: { expr: 'l.expires_at', tipo: 'data' }, quantidade: 'l.quantity', loja: 'st.name' },
  },
  clientes: {
    descricao: 'Clientes e membros do clube: membro, como entrou (balcão ou app), objetivo, parceiro que indicou, origem do anúncio, aceita WhatsApp, mês do cadastro e do aniversário, saldo de cashback.',
    permissoes: ['customer.view'],
    de: 'customer cu left join partner pa on pa.id = cu.partner_id',
    tenant: 'cu.tenant_id',
    onde: 'cu.active',
    data: { expr: 'cu.created_at', tipo: 'timestamp', rotulo: 'data do cadastro' },
    dimensoes: { membro: simNao('cu.is_member'), entrou_por: "coalesce(cu.member_source, '—')", objetivo: "coalesce(cu.goal, '—')", parceiro: "coalesce(pa.name, 'sem parceiro')", origem: "coalesce(nullif(cu.origin->>'source', ''), case when cu.origin->>'gclid' is not null then 'google' when cu.origin->>'fbclid' is not null then 'facebook' end, '(direto)')", aceita_whatsapp: simNao('cu.allow_whatsapp'), mes_aniversario: "coalesce(to_char(cu.birth_date, 'MM'), '—')", ...tempo('cu.created_at') },
    metricas: { clientes: { expr: 'count(*)', tipo: 'numero' }, cashback_saldo: { expr: 'sum(cu.cashback_balance)', tipo: 'reais' } },
    colunas: { clienteId: 'cu.id', nome: 'cu.name', telefone: 'cu.phone', membro: simNao('cu.is_member'), cartao: 'cu.member_code', cashback: { expr: 'cu.cashback_balance', tipo: 'reais' }, desde: { expr: 'cu.created_at', tipo: 'data' } },
  },
  pedidos: {
    descricao: 'Pedidos do app, totem e balcão (preparo e entrega): situação, canal, retirada ou entrega, pagamento online, origem do anúncio, tempo.',
    permissoes: ['report.view', 'order.prepare'],
    de: '"order" o join store st on st.id = o.store_id',
    tenant: 'o.tenant_id',
    data: { expr: 'o.created_at', tipo: 'timestamp', rotulo: 'data do pedido' },
    dimensoes: { situacao: 'o.status', canal: 'o.channel', entrega_ou_retirada: 'o.fulfillment', pagou_online: "coalesce(o.pay_online, 'não')", loja: 'st.name', origem: "coalesce(nullif(o.origin->>'source', ''), case when o.origin->>'gclid' is not null then 'google' when o.origin->>'fbclid' is not null then 'facebook' end, '(direto)')", ...tempo('o.created_at') },
    metricas: { pedidos: { expr: 'count(*)', tipo: 'numero' }, valor_estimado: { expr: 'sum(o.estimate)', tipo: 'reais' }, taxa_entrega: { expr: 'sum(o.delivery_fee)', tipo: 'reais' }, minutos_ate_pronto: { expr: "round(avg(extract(epoch from (o.ready_at - o.paid_at)) / 60) filter (where o.ready_at is not null and o.paid_at is not null))", tipo: 'numero' } },
    colunas: { numero: 'o.number', data: { expr: 'o.created_at', tipo: 'data' }, nome: 'o.call_name', canal: 'o.channel', situacao: 'o.status', entrega: 'o.fulfillment', valor: { expr: 'o.estimate', tipo: 'reais' } },
  },
  campanhas_uso: {
    descricao: 'Vendas com cupom de campanha: quantas, desconto dado e faturamento por campanha.',
    permissoes: ['report.view', 'campaign.manage'],
    de: 'sale s join campaign cp on cp.id = s.coupon_id',
    tenant: 's.tenant_id',
    onde: "s.status = 'completed'",
    data: { expr: 's.created_at', tipo: 'timestamp', rotulo: 'data da venda' },
    dimensoes: { campanha: 'cp.name', codigo: "coalesce(cp.code, '—')", ...tempo('s.created_at') },
    metricas: { vendas: { expr: 'count(*)', tipo: 'numero' }, desconto: { expr: 'sum(s.coupon_discount)', tipo: 'reais' }, faturamento: { expr: 'sum(s.total)', tipo: 'reais' } },
    colunas: { numero: 's.number', data: { expr: 's.created_at', tipo: 'data' }, campanha: 'cp.name', desconto: { expr: 's.coupon_discount', tipo: 'reais' }, total: { expr: 's.total', tipo: 'reais' } },
  },
  parceiros: {
    descricao: 'Vendas por parceiro (nutricionistas, personais, influenciadores): faturamento, comissão e desconto dado.',
    permissoes: ['partner.manage', 'report.view'],
    de: 'sale s join partner pa on pa.id = s.partner_id',
    tenant: 's.tenant_id',
    onde: "s.status = 'completed'",
    data: { expr: 's.created_at', tipo: 'timestamp', rotulo: 'data da venda' },
    dimensoes: { parceiro: 'pa.name', tipo_parceiro: 'pa.kind', codigo: 'pa.code', ...tempo('s.created_at') },
    metricas: { vendas: { expr: 'count(*)', tipo: 'numero' }, faturamento: { expr: 'sum(s.total - s.delivery_fee)', tipo: 'reais' }, comissao: { expr: 'sum(s.partner_commission)', tipo: 'reais' }, desconto: { expr: 'sum(s.partner_discount)', tipo: 'reais' } },
    colunas: { numero: 's.number', data: { expr: 's.created_at', tipo: 'data' }, parceiro: 'pa.name', total: { expr: 's.total', tipo: 'reais' }, comissao: { expr: 's.partner_commission', tipo: 'reais' } },
  },
  contas_pagar: {
    descricao: 'Contas a pagar: categoria, situação (open = em aberto, paid = paga, canceled = cancelada), fornecedor, vencimento.',
    permissoes: ['finance.view'],
    de: 'payable py left join store st on st.id = py.store_id',
    tenant: 'py.tenant_id',
    data: { expr: 'py.due_date', tipo: 'date', rotulo: 'vencimento' },
    dimensoes: { categoria: 'py.category', situacao: 'py.status', fornecedor: "coalesce(py.supplier, '—')", loja: "coalesce(st.name, 'geral')", vencida: simNao("py.status = 'open' and py.due_date < (now() at time zone 'America/Sao_Paulo')::date"), ...tempoData('py.due_date') },
    metricas: { valor: { expr: 'sum(py.amount)', tipo: 'reais' }, contas: { expr: 'count(*)', tipo: 'numero' } },
    colunas: { descricao: 'py.description', fornecedor: 'py.supplier', categoria: 'py.category', vencimento: { expr: 'py.due_date', tipo: 'data' }, valor: { expr: 'py.amount', tipo: 'reais' }, situacao: 'py.status', paga_em: { expr: 'py.paid_date', tipo: 'data' } },
  },
  caixas: {
    descricao: 'Caixas abertos e fechados, quem operou e a diferença no fechamento (sobra ou falta).',
    permissoes: ['report.view', 'finance.view'],
    de: 'cash_session cs join store st on st.id = cs.store_id left join app_user u on u.id = cs.opened_by_id',
    tenant: 'cs.tenant_id',
    data: { expr: 'cs.opened_at', tipo: 'timestamp', rotulo: 'abertura do caixa' },
    dimensoes: { loja: 'st.name', situacao: 'cs.status', operador: "coalesce(u.name, '—')", ...tempo('cs.opened_at') },
    metricas: { caixas: { expr: 'count(*)', tipo: 'numero' }, diferenca: { expr: 'sum(coalesce(cs.difference, 0))', tipo: 'reais' }, com_diferenca: { expr: 'count(*) filter (where coalesce(cs.difference, 0) <> 0)', tipo: 'numero' } },
    colunas: { loja: 'st.name', operador: 'u.name', situacao: 'cs.status', aberto: { expr: 'cs.opened_at', tipo: 'data' }, fechado: { expr: 'cs.closed_at', tipo: 'data' }, diferenca: { expr: 'cs.difference', tipo: 'reais' }, observacao: 'cs.notes' },
  },
  compras: {
    descricao: 'Pedidos de compra aos fornecedores: situação (rascunho, enviado, recebido, cancelado), fornecedor e valor.',
    permissoes: ['purchase.manage', 'stock.view'],
    de: 'purchase_order po join supplier sp on sp.id = po.supplier_id',
    tenant: 'po.tenant_id',
    data: { expr: 'po.created_at', tipo: 'timestamp', rotulo: 'data do pedido' },
    dimensoes: { fornecedor: 'sp.name', situacao: 'po.status', ...tempo('po.created_at') },
    metricas: { pedidos: { expr: 'count(*)', tipo: 'numero' }, total: { expr: 'sum(po.total)', tipo: 'reais' } },
    colunas: { numero: 'po.number', fornecedor: 'sp.name', situacao: 'po.status', total: { expr: 'po.total', tipo: 'reais' }, previsto: { expr: 'po.expected_on', tipo: 'data' }, criado: { expr: 'po.created_at', tipo: 'data' } },
  },
  cashback: {
    descricao: 'Movimento do cashback do clube: créditos, usos e expirados.',
    permissoes: ['customer.view'],
    de: 'cashback_entry ce join customer cu on cu.id = ce.customer_id',
    tenant: 'ce.tenant_id',
    data: { expr: 'ce.created_at', tipo: 'timestamp', rotulo: 'data do lançamento' },
    dimensoes: { tipo: 'ce.type', cliente: 'cu.name', ...tempo('ce.created_at') },
    metricas: { valor: { expr: 'sum(ce.amount)', tipo: 'reais' }, lancamentos: { expr: 'count(*)', tipo: 'numero' } },
    colunas: { data: { expr: 'ce.created_at', tipo: 'data' }, cliente: 'cu.name', tipo: 'ce.type', valor: { expr: 'ce.amount', tipo: 'reais' }, saldo: { expr: 'ce.balance_after', tipo: 'reais' } },
  },
};

export interface PedidoConsulta {
  conjunto: string;
  tenantId: string;
  modo: 'resumo' | 'lista';
  metricas: string[];
  agruparPor: string[];
  filtros: { campo: string; operador: 'igual' | 'contem' | 'diferente'; valor: string }[];
  de?: string;
  ate?: string;
  ordenarPor?: string;
  ordem: 'asc' | 'desc';
  limite: number;
}

const col = (c: string | { expr: string }) => (typeof c === 'string' ? c : c.expr);
const raw = Prisma.raw;

/** Monta a consulta só com pedaços deste arquivo; organização, filtros e datas vão como parâmetros. */
export function montarConsulta(p: PedidoConsulta): { consulta: Prisma.Sql; tipos: Record<string, TipoMetrica | 'data' | undefined> } {
  const c = CONJUNTOS[p.conjunto];
  if (!c) throw new Error(`Conjunto desconhecido: ${p.conjunto}. Use: ${Object.keys(CONJUNTOS).join(', ')}.`);
  for (const d of p.agruparPor) if (!c.dimensoes[d]) throw new Error(`"${d}" não é dimensão de ${p.conjunto}. Use: ${Object.keys(c.dimensoes).join(', ')}.`);
  for (const m of p.metricas) if (!c.metricas[m]) throw new Error(`"${m}" não é métrica de ${p.conjunto}. Use: ${Object.keys(c.metricas).join(', ')}.`);
  for (const f of p.filtros) if (!c.dimensoes[f.campo]) throw new Error(`Filtro "${f.campo}" não existe em ${p.conjunto}. Use: ${Object.keys(c.dimensoes).join(', ')}.`);
  if ((p.de || p.ate) && !c.data) throw new Error(`${p.conjunto} não tem período; filtre pelas dimensões.`);
  const condicoes: Prisma.Sql[] = [Prisma.sql`${raw(c.tenant)} = ${p.tenantId}`];
  if (c.onde) condicoes.push(raw(`(${c.onde})`));
  if (c.data && (p.de || p.ate)) {
    const expr = c.data.tipo === 'timestamp' ? `(${c.data.expr} ${SP})::date` : c.data.expr;
    if (p.de) condicoes.push(Prisma.sql`${raw(expr)} >= ${p.de}::date`);
    if (p.ate) condicoes.push(Prisma.sql`${raw(expr)} <= ${p.ate}::date`);
  }
  for (const f of p.filtros) {
    const e = raw(`(${c.dimensoes[f.campo]})::text`);
    if (f.operador === 'igual') condicoes.push(Prisma.sql`${e} ilike ${f.valor}`);
    else if (f.operador === 'diferente') condicoes.push(Prisma.sql`${e} not ilike ${f.valor}`);
    else condicoes.push(Prisma.sql`${e} ilike ${'%' + f.valor.replace(/[%_\\]/g, (x) => '\\' + x) + '%'}`);
  }
  const onde = Prisma.sql` where ${Prisma.join(condicoes, ' and ')}`;
  const limite = Math.min(Math.max(p.limite, 1), 200);
  const dir = raw(p.ordem === 'asc' ? 'asc' : 'desc');
  if (p.modo === 'lista') {
    const cols = Object.entries(c.colunas);
    const ordem = p.ordenarPor && c.colunas[p.ordenarPor] ? col(c.colunas[p.ordenarPor]!) : c.data ? c.data.expr : col(cols[0]![1]);
    const consulta = Prisma.sql`select ${raw(cols.map(([k, v]) => `${col(v)} as "${k}"`).join(', '))} from ${raw(c.de)}${onde} order by ${raw(ordem)} ${dir} nulls last limit ${limite}`;
    return { consulta, tipos: Object.fromEntries(cols.map(([k, v]) => [k, typeof v === 'string' ? undefined : v.tipo])) };
  }
  const metricas = p.metricas.length ? p.metricas : [Object.keys(c.metricas)[0]!];
  const sel = [...p.agruparPor.map((d) => `${c.dimensoes[d]} as "${d}"`), ...metricas.map((m) => `${c.metricas[m]!.expr} as "${m}"`)].join(', ');
  const grupo = p.agruparPor.length ? ` group by ${p.agruparPor.map((_, i) => i + 1).join(', ')}` : '';
  const ordemPor = p.ordenarPor && (p.agruparPor.includes(p.ordenarPor) || metricas.includes(p.ordenarPor)) ? `"${p.ordenarPor}"` : p.agruparPor.length ? `"${metricas[0]}"` : '1';
  const consulta = Prisma.sql`select ${raw(sel)} from ${raw(c.de)}${onde}${raw(grupo)} order by ${raw(ordemPor)} ${dir} nulls last limit ${limite}`;
  return { consulta, tipos: Object.fromEntries(metricas.map((m) => [m, c.metricas[m]!.tipo])) };
}

/** Lista compacta do catálogo, para a descrição da ferramenta. */
export function catalogoConjuntos(nomes: string[]) {
  return nomes
    .map((n) => {
      const c = CONJUNTOS[n]!;
      return `- ${n}: ${c.descricao} Dimensões: ${Object.keys(c.dimensoes).join(', ')}. Métricas: ${Object.keys(c.metricas).join(', ')}.${c.data ? ` Período: ${c.data.rotulo}.` : ''}`;
    })
    .join('\n');
}
