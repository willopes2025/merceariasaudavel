import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod/v4';
import { CUSTOMER_GOALS, PAYABLE_CATEGORIES, campaignSchema, formatMoney, normalizeText, payableSchema, purchaseOrderSchema, todayBR, type CampaignInput } from '@mercearia/contracts';
import { AuditService } from '../../common/audit.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { CampaignsService } from '../campaigns/campaigns.service';
import { FinanceService } from '../finance/finance.service';
import { GrowthService } from '../growth/growth.service';
import { computeRepurchase } from '../growth/repurchase';
import { ManagementService } from '../management/management.service';
import { WhatsappSender } from '../notify/whatsapp.sender';
import { PartnersService } from '../partners/partners.service';
import { stockIntelligence } from '../purchasing/intelligence';
import { PurchasingService } from '../purchasing/purchasing.service';
import type { DefinicaoFerramenta } from '../ai/ai.service';
import { CONJUNTOS, catalogoConjuntos, montarConsulta } from './data';
import { EmailService } from './email.service';
import { csv, descreverAgenda, proximaDaRotina, type Agenda } from './routines';
import { can, type AssistantUser } from './user';

/**
 * leitura: consulta, executa na hora.
 * acao: muda pouca coisa e é fácil de desfazer (pedido, ajuste de rotina): executa na hora e fica registrada.
 * confirmar: manda mensagem, mexe em preço, campanha, compra ou financeiro: o assistente prepara, mostra a prévia e só executa quando a pessoa confirma.
 */
export type Risco = 'leitura' | 'acao' | 'confirmar';

export interface Contexto {
  usuario: AssistantUser;
  sessaoId: string;
  /** Avança o progresso das ações em segundo plano (envio em lote). */
  progresso?: (feitos: number, total: number, falhas: number) => Promise<void>;
  /** Execução automática de uma rotina: e-mails para os endereços autorizados saem sem confirmação. */
  rotina?: { id: string; emails: string[]; aprovacao?: string };
  podeAutomatico?: boolean;
}

export interface Preparo {
  resumo: string;
  previa?: unknown;
  impedimento?: string;
}

export interface Ferramenta {
  nome: string;
  descricao: string;
  schema: z.ZodType;
  risco: Risco;
  permitido: (u: AssistantUser) => boolean;
  segundoPlano?: boolean;
  preparar?: (entrada: any, ctx: Contexto) => Promise<Preparo>;
  executar: (entrada: any, ctx: Contexto) => Promise<unknown>;
}

const uuid = z.string().uuid('Use o id (uuid) devolvido pelas consultas.');
const dataIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Data no formato AAAA-MM-DD');
const pode = (perm: string) => (u: AssistantUser) => can(u, perm);
const algum = (...perms: string[]) => (u: AssistantUser) => perms.some((p) => can(u, p));
const reais = (v: number | Prisma.Decimal | null | undefined) => formatMoney(Number(v ?? 0));
const dataBR = (d: string | Date | null | undefined) => {
  if (!d) return null;
  const s = typeof d === 'string' ? d : new Date(d.getTime() - 3 * 3_600_000).toISOString();
  return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
};
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400_000);
const desloca = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
/** Início/fim de um dia de Brasília em UTC (o banco guarda UTC). */
const inicioDia = (d: string) => new Date(`${d}T03:00:00Z`);
const variacao = (a: number, b: number) => (b ? `${a >= b ? '+' : ''}${(((a - b) / b) * 100).toFixed(1).replace('.', ',')}%` : a ? 'sem base de comparação' : '0%');
const telefoneOk = (t: string | null | undefined) => (t ?? '').replace(/\D/g, '').length >= 10;

/** Variáveis que o envio em lote preenche em cada mensagem. */
export const VARIAVEIS_LOTE = ['nome', 'primeiro_nome', 'cashback', 'cartao', 'loja'] as const;

/** Catálogo de ferramentas do Assistente da Mercearia. Cada uma usa os serviços que as telas já usam. */
@Injectable()
export class FerramentasAssistente {
  readonly lista: Ferramenta[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly email: EmailService,
    private readonly whatsapp: WhatsappSender,
    private readonly management: ManagementService,
    private readonly growth: GrowthService,
    private readonly finance: FinanceService,
    private readonly partners: PartnersService,
    private readonly campaigns: CampaignsService,
    private readonly purchasing: PurchasingService,
  ) {
    this.lista = [
      this.painelDoDia(),
      this.resumoNegocio(),
      this.consultarDados(),
      this.buscarProdutos(),
      this.alertasEstoque(),
      this.buscarClientes(),
      this.fichaCliente(),
      this.oportunidadesClientes(),
      this.consultarFinanceiro(),
      this.pedidosEmAndamento(),
      this.parceirosDoMes(),
      this.listarCampanhas(),
      this.criarCampanha(),
      this.ligarCampanha(),
      this.alterarPreco(),
      this.criarPedidoCompra(),
      this.lancarContaPagar(),
      this.enviarWhatsapp(),
      this.enviarWhatsappEmLote(),
      this.enviarEmail(),
      this.agendarRotina(),
      this.gerenciarRotinas(),
      this.registrarPedido(),
      this.listarPedidos(),
    ];
  }

  obter(nome: string) {
    return this.lista.find((f) => f.nome === nome);
  }

  /** As ferramentas que esta pessoa pode usar, no formato da API do Claude. */
  definicoes(u: AssistantUser): DefinicaoFerramenta[] {
    return this.lista
      .filter((f) => f.permitido(u))
      .map((f) => {
        const { $schema: _, ...input_schema } = z.toJSONSchema(f.schema) as Record<string, unknown>;
        const aviso = f.risco === 'confirmar' ? ' [Pede confirmação: o sistema mostra a prévia e só executa quando a pessoa confirmar.]' : '';
        return { name: f.nome, description: f.descricao + aviso, input_schema };
      });
  }

  private async lojaPadrao(u: AssistantUser): Promise<string> {
    const s = await this.prisma.store.findFirst({ where: { tenantId: u.ctx.tenantId, active: true, ...(u.ctx.storeIds.length ? { id: { in: u.ctx.storeIds } } : {}) }, orderBy: { createdAt: 'asc' }, select: { id: true } });
    if (!s) throw new BadRequestException('Nenhuma loja ativa.');
    return s.id;
  }

  // ───────────── Consultas ─────────────

  private painelDoDia(): Ferramenta {
    return {
      nome: 'painel_do_dia',
      descricao: 'O painel de hoje: vendido, número de vendas, ticket médio, faturamento de membros, perdas do mês, meta do mês (com projeção e quanto falta), mais vendidos de hoje, ranking da equipe no mês, produtos abaixo do mínimo e lotes vencendo. Use para "como estamos hoje?", "vamos bater a meta?".',
      schema: z.object({}),
      risco: 'leitura',
      permitido: pode('report.view'),
      executar: async (_e, ctx) => this.management.dashboard(ctx.usuario.ctx),
    };
  }

  private resumoNegocio(): Ferramenta {
    const schema = z.object({ de: dataIso.describe('Primeiro dia do período'), ate: dataIso.describe('Último dia (inclusive)') });
    return {
      nome: 'resumo_negocio',
      descricao:
        'Visão geral do período comparada com o período anterior de mesmo tamanho: faturamento, vendas, ticket médio, itens por venda, faturamento de membros, descontos e cupons, cashback usado e gerado, pedidos do app/loja online, clientes novos e membros novos, perdas de estoque e lucro bruto. Use para conversar sobre resultados ("como foi o mês?", "estamos melhor que no mês passado?").',
      schema,
      risco: 'leitura',
      permitido: pode('report.view'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        if (e.ate < e.de) throw new BadRequestException('A data final é antes da inicial.');
        const t = ctx.usuario.ctx.tenantId;
        const dias = diasEntre(e.de, e.ate) + 1;
        const ant = { de: desloca(e.de, -dias), ate: desloca(e.de, -1) };
        const numeros = async (de: string, ate: string) => {
          const from = inicioDia(de);
          const to = inicioDia(desloca(ate, 1));
          const [v] = await this.prisma.$queryRaw<Array<{ vendas: bigint; total: Prisma.Decimal | null; membros: Prisma.Decimal | null; desconto: Prisma.Decimal | null; cupom: Prisma.Decimal | null; cb_usado: Prisma.Decimal | null; cb_gerado: Prisma.Decimal | null; itens: Prisma.Decimal | null; lucro: Prisma.Decimal | null }>>`
            SELECT count(*) AS vendas, sum(total) AS total, sum(total) FILTER (WHERE member_pricing) AS membros, sum(discount) AS desconto, sum(coupon_discount) AS cupom,
                   sum(cashback_used) AS cb_usado, sum(cashback_earned) AS cb_gerado, avg(items_count) AS itens, sum(total - delivery_fee - coalesce(cost_total, 0)) AS lucro
              FROM sale WHERE tenant_id = ${t} AND status = 'completed' AND created_at >= ${from} AND created_at < ${to}`;
          const [o] = await this.prisma.$queryRaw<Array<{ pedidos: bigint; online: bigint }>>`
            SELECT count(*) FILTER (WHERE channel = 'app') AS pedidos, count(*) FILTER (WHERE channel = 'app' AND status NOT IN ('cancelado', 'aguardando_pagamento')) AS online
              FROM "order" WHERE tenant_id = ${t} AND created_at >= ${from} AND created_at < ${to}`;
          const [c] = await this.prisma.$queryRaw<Array<{ clientes: bigint; membros: bigint }>>`
            SELECT count(*) AS clientes, count(*) FILTER (WHERE is_member AND member_since >= ${from} AND member_since < ${to}) AS membros
              FROM customer WHERE tenant_id = ${t} AND created_at >= ${from} AND created_at < ${to}`;
          const [p] = await this.prisma.$queryRaw<Array<{ perdas: Prisma.Decimal | null }>>`
            SELECT sum(abs(mv.delta) * coalesce(mv.unit_cost, p.cost, 0)) AS perdas FROM stock_movement mv JOIN product p ON p.id = mv.product_id
             WHERE mv.tenant_id = ${t} AND mv.type = 'perda' AND mv.created_at >= ${from} AND mv.created_at < ${to}`;
          const n = (x: unknown) => Number(x ?? 0);
          return { vendas: n(v?.vendas), total: n(v?.total), membros: n(v?.membros), desconto: n(v?.desconto), cupom: n(v?.cupom), cbUsado: n(v?.cb_usado), cbGerado: n(v?.cb_gerado), itens: n(v?.itens), lucro: n(v?.lucro), pedidosApp: n(o?.pedidos), pedidosPagos: n(o?.online), clientesNovos: n(c?.clientes), membrosNovos: n(c?.membros), perdas: n(p?.perdas) };
        };
        const [a, b] = await Promise.all([numeros(e.de, e.ate), numeros(ant.de, ant.ate)]);
        const ticket = (x: { vendas: number; total: number }) => (x.vendas ? x.total / x.vendas : 0);
        const pctMembros = (x: { total: number; membros: number }) => (x.total ? `${((x.membros / x.total) * 100).toFixed(1).replace('.', ',')}%` : '0%');
        return {
          periodo: `${dataBR(e.de)} a ${dataBR(e.ate)}`,
          comparadoCom: `${dataBR(ant.de)} a ${dataBR(ant.ate)}`,
          faturamento: { valor: reais(a.total), anterior: reais(b.total), variacao: variacao(a.total, b.total) },
          vendas: { quantidade: a.vendas, anterior: b.vendas, variacao: variacao(a.vendas, b.vendas), ticketMedio: reais(ticket(a)), ticketMedioAnterior: reais(ticket(b)), itensPorVenda: a.itens.toFixed(1).replace('.', ',') },
          membros: { faturamentoDeMembros: pctMembros(a), anterior: pctMembros(b), membrosNovos: a.membrosNovos, membrosNovosAnterior: b.membrosNovos, clientesNovos: a.clientesNovos },
          descontos: { total: reais(a.desconto), cupons: reais(a.cupom), anterior: reais(b.desconto) },
          cashback: { usado: reais(a.cbUsado), gerado: reais(a.cbGerado) },
          appELojaOnline: { pedidos: a.pedidosApp, pagos: a.pedidosPagos, anterior: b.pedidosApp },
          lucroBruto: { valor: reais(a.lucro), anterior: reais(b.lucro), variacao: variacao(a.lucro, b.lucro) },
          perdasDeEstoque: { valorACusto: reais(a.perdas), anterior: reais(b.perdas) },
        };
      },
    };
  }

  private consultarDados(): Ferramenta {
    const nomes = Object.keys(CONJUNTOS) as [string, ...string[]];
    const schema = z.object({
      conjunto: z.enum(nomes),
      modo: z.enum(['resumo', 'lista']).optional().describe('resumo = métricas agrupadas (padrão); lista = linhas com detalhes (até 200)'),
      metricas: z.array(z.string()).max(6).optional().describe('Nomes das métricas do conjunto (padrão: a primeira)'),
      agruparPor: z.array(z.string()).max(2).optional().describe('Até 2 dimensões do conjunto'),
      filtros: z.array(z.object({ campo: z.string().describe('Uma dimensão do conjunto'), operador: z.enum(['igual', 'contem', 'diferente']), valor: z.string().max(120) })).max(6).optional(),
      de: dataIso.optional().describe('Início do período (quando o conjunto tem período)'),
      ate: dataIso.optional(),
      ordenarPor: z.string().optional().describe('Métrica, dimensão ou coluna'),
      ordem: z.enum(['asc', 'desc']).optional(),
      limite: z.number().int().min(1).max(200).optional(),
    });
    return {
      nome: 'consultar_dados',
      descricao: `Consulta flexível em qualquer área do sistema: escolha o conjunto, as métricas, até 2 dimensões para agrupar, filtros e período (ex.: produtos mais vendidos do mês por categoria; vendas por hora; estoque abaixo do mínimo; perdas por motivo; clientes por origem; pedidos do app por situação). Os valores em R$ já vêm formatados. Conjuntos:\n${catalogoConjuntos(nomes)}`,
      schema,
      risco: 'leitura',
      permitido: (u) => nomes.some((n) => CONJUNTOS[n]!.permissoes.some((p) => can(u, p))),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const c = CONJUNTOS[e.conjunto]!;
        if (!c.permissoes.some((p) => can(ctx.usuario, p))) throw new BadRequestException(`Sem acesso a "${e.conjunto}".`);
        let montada: ReturnType<typeof montarConsulta>;
        try {
          montada = montarConsulta({ conjunto: e.conjunto, tenantId: ctx.usuario.ctx.tenantId, modo: e.modo ?? 'resumo', metricas: e.metricas ?? [], agruparPor: e.agruparPor ?? [], filtros: e.filtros ?? [], de: e.de, ate: e.ate, ordenarPor: e.ordenarPor, ordem: e.ordem ?? 'desc', limite: e.limite ?? 50 });
        } catch (err) {
          throw new BadRequestException((err as Error).message);
        }
        // Só leitura, com tempo máximo: uma consulta pesada não trava o sistema.
        const linhas = await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL transaction_read_only = on');
          await tx.$executeRawUnsafe('SET LOCAL statement_timeout = 8000');
          return tx.$queryRaw<Record<string, unknown>[]>(montada.consulta);
        });
        const fmt = (k: string, v: unknown) => {
          if (v == null) return null;
          const t = montada.tipos[k];
          if (t === 'reais') return reais(Number(v));
          if (t === 'pct') return `${Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
          if (t === 'data') return v instanceof Date ? (v.getUTCHours() || v.getUTCMinutes() ? v.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : dataBR(v.toISOString().slice(0, 10))) : v;
          if (typeof v === 'bigint') return Number(v);
          if (v instanceof Prisma.Decimal) return Number(v);
          return v;
        };
        return {
          conjunto: e.conjunto,
          ...(e.de || e.ate ? { periodo: `${dataBR(e.de ?? null) ?? 'início'} a ${dataBR(e.ate ?? null) ?? 'hoje'}` } : {}),
          linhas: linhas.map((l) => Object.fromEntries(Object.entries(l).map(([k, v]) => [k, fmt(k, v)]))),
          ...(linhas.length === (e.limite ?? 50) ? { observacao: 'Chegou no limite de linhas: pode haver mais (aumente o limite ou filtre).' } : {}),
        };
      },
    };
  }

  private buscarProdutos(): Ferramenta {
    const schema = z.object({ busca: z.string().trim().min(2).max(80).describe('Nome, marca, código de barras ou SKU'), limite: z.number().int().min(1).max(50).optional() });
    return {
      nome: 'buscar_produtos',
      descricao: 'Procura produtos pelo nome, marca ou código: devolve produtoId, preço, preço de membro, custo, estoque somado das lojas, mínimo e se aparece no app.',
      schema,
      risco: 'leitura',
      permitido: algum('stock.view', 'product.manage', 'sale.create'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const termo = normalizeText(e.busca);
        const ps = await this.prisma.product.findMany({
          where: { tenantId: ctx.usuario.ctx.tenantId, active: true, OR: [{ searchText: { contains: termo } }, { barcode: e.busca }, { sku: e.busca }] },
          include: { balances: true, category: { select: { name: true } } },
          take: e.limite ?? 15,
          orderBy: { name: 'asc' },
        });
        const verCusto = can(ctx.usuario, 'product.manage') || can(ctx.usuario, 'report.view');
        return {
          produtos: ps.map((p) => ({
            produtoId: p.id,
            nome: p.name,
            marca: p.brand,
            categoria: p.category?.name ?? null,
            tipo: p.kind,
            preco: reais(p.price),
            precoMembro: p.memberPrice == null ? null : reais(p.memberPrice),
            ...(verCusto ? { custo: p.cost == null ? null : reais(p.cost) } : {}),
            estoque: p.trackStock ? p.balances.reduce((s, b) => s + Number(b.quantity), 0) : null,
            minimo: Number(p.minStock ?? 0),
            unidade: p.unit,
            noApp: p.showInApp,
          })),
        };
      },
    };
  }

  private alertasEstoque(): Ferramenta {
    const schema = z.object({
      lojaId: uuid.optional().describe('Padrão: a primeira loja de quem pede'),
      dias: z.number().int().min(14).max(365).optional().describe('Período de venda usado no cálculo (padrão 60)'),
      limite: z.number().int().min(1).max(100).optional(),
    });
    return {
      nome: 'alertas_estoque',
      descricao: 'Inteligência de estoque: o que comprar agora (ponto de reposição pelo giro e prazo do fornecedor, com quantidade sugerida), o que vai vencer antes de vender, estoque parado e curva ABC. Use para "o que preciso comprar?", "o que está encalhado?", "o que vence logo?".',
      schema,
      risco: 'leitura',
      permitido: algum('stock.view', 'purchase.manage'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const storeId = e.lojaId ?? (await this.lojaPadrao(ctx.usuario));
        const r = await stockIntelligence(this.prisma as unknown as Prisma.TransactionClient, ctx.usuario.ctx.tenantId, { storeId, days: e.dias ?? 60, coverTarget: 21 });
        const lim = e.limite ?? 30;
        const linha = (x: (typeof r.rows)[number]) => ({ produtoId: x.productId, produto: x.name, estoque: x.stock, vendaPorDia: Number(x.dailyUse.toFixed(2)), diasDeCobertura: x.coverDays, fornecedor: x.supplierName, fornecedorId: x.supplierId, comprar: x.suggested, custoSugerido: reais(x.suggestedCost), jaPedido: x.onOrder, curva: x.abc });
        return {
          totais: { valorEmEstoque: reais(r.totals.stockValue), valorParado: reais(r.totals.idleValue), produtosEmFalta: r.totals.missing, produtosParaComprar: r.totals.toBuy, custoDaCompraSugerida: reais(r.totals.suggestedCost), valorEmRiscoDeVencer: reais(r.totals.expiryRiskValue) },
          comprarAgora: r.rows.filter((x) => x.status === 'comprar').slice(0, lim).map(linha),
          comprarEmBreve: r.rows.filter((x) => x.status === 'atencao').slice(0, lim).map(linha),
          riscoDeVencer: r.rows.filter((x) => x.expiryRisk).slice(0, lim).map((x) => ({ produto: x.name, quantidade: x.expiryRisk!.quantity, valor: reais(x.expiryRisk!.value), primeiraValidade: dataBR(x.expiryRisk!.firstDate) })),
          parados: r.rows.filter((x) => x.status === 'parado' || x.status === 'sem_giro').slice(0, lim).map((x) => ({ produto: x.name, estoque: x.stock, valor: reais(x.stockValue), diasSemSaida: x.daysSinceLastOut })),
        };
      },
    };
  }

  private buscarClientes(): Ferramenta {
    const schema = z.object({ busca: z.string().trim().min(2).max(80).describe('Nome, celular, CPF ou número do cartão de membro'), limite: z.number().int().min(1).max(50).optional() });
    return {
      nome: 'buscar_clientes',
      descricao: 'Procura clientes e membros pelo nome, celular, CPF ou cartão: devolve clienteId, telefone, se é membro, saldo de cashback e se aceita WhatsApp.',
      schema,
      risco: 'leitura',
      permitido: pode('customer.view'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const termo = normalizeText(e.busca);
        const digitos = e.busca.replace(/\D/g, '');
        const cs = await this.prisma.customer.findMany({
          where: { tenantId: ctx.usuario.ctx.tenantId, active: true, OR: [{ searchText: { contains: termo } }, ...(digitos.length >= 4 ? [{ phone: { contains: digitos } }, { document: digitos }] : []), { memberCode: e.busca.toUpperCase() }] },
          take: e.limite ?? 15,
          orderBy: { name: 'asc' },
        });
        return { clientes: cs.map((c) => ({ clienteId: c.id, nome: c.name, telefone: c.phone, membro: c.isMember, cartao: c.memberCode, cashback: reais(c.cashbackBalance), aceitaWhatsapp: c.allowWhatsapp })) };
      },
    };
  }

  private fichaCliente(): Ferramenta {
    const schema = z.object({ clienteId: uuid });
    return {
      nome: 'ficha_cliente',
      descricao: 'Ficha da cliente: contato, membro desde, objetivo, parceiro que indicou, cashback, aniversário, últimas compras (com itens), o que costuma comprar, quanto gastou nos últimos 12 meses e o que deve estar acabando (recompra).',
      schema,
      risco: 'leitura',
      permitido: pode('customer.view'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const t = ctx.usuario.ctx.tenantId;
        const c = await this.prisma.customer.findFirst({ where: { id: e.clienteId, tenantId: t }, include: { partner: { select: { name: true } } } });
        if (!c) throw new BadRequestException('Cliente não encontrada.');
        const ano = new Date(Date.now() - 365 * 86400_000);
        const [vendas, gasto, favoritos, recompra] = await Promise.all([
          this.prisma.sale.findMany({ where: { tenantId: t, customerId: c.id, status: 'completed' }, orderBy: { createdAt: 'desc' }, take: 5, include: { items: { select: { description: true, quantity: true } } } }),
          this.prisma.sale.aggregate({ where: { tenantId: t, customerId: c.id, status: 'completed', createdAt: { gte: ano } }, _sum: { total: true }, _count: true }),
          this.prisma.$queryRaw<Array<{ description: string; vezes: bigint }>>`
            SELECT si.description, count(DISTINCT s.id) AS vezes FROM sale_item si JOIN sale s ON s.id = si.sale_id
             WHERE s.tenant_id = ${t} AND s.customer_id = ${c.id} AND s.status = 'completed' AND s.created_at >= ${ano}
             GROUP BY 1 ORDER BY 2 DESC LIMIT 5`,
          computeRepurchase(this.prisma as unknown as Prisma.TransactionClient, t, { customerId: c.id }).catch(() => []),
        ]);
        return {
          clienteId: c.id,
          nome: c.name,
          telefone: c.phone,
          email: c.email,
          aceitaWhatsapp: c.allowWhatsapp,
          membro: c.isMember,
          membroDesde: dataBR(c.memberSince),
          cartao: c.memberCode,
          objetivo: c.goal ? (CUSTOMER_GOALS as Record<string, string>)[c.goal] ?? c.goal : null,
          parceiro: c.partner?.name ?? null,
          cashback: reais(c.cashbackBalance),
          aniversario: c.birthDate ? dataBR(c.birthDate)?.slice(0, 5) : null,
          ultimos12Meses: { compras: gasto._count, gasto: reais(gasto._sum.total) },
          maisCompra: favoritos.map((f) => ({ produto: f.description, vezes: Number(f.vezes) })),
          ultimasCompras: vendas.map((v) => ({ data: dataBR(v.createdAt), total: reais(v.total), itens: v.items.map((i) => `${Number(i.quantity)}× ${i.description}`).join(', ') })),
          deveEstarAcabando: recompra.slice(0, 5).map((r) => ({ produto: r.productName, ultimaCompra: dataBR(r.lastPurchase) })),
          observacoes: c.notes,
        };
      },
    };
  }

  private oportunidadesClientes(): Ferramenta {
    const schema = z.object({
      tipo: z.enum(['recompra', 'sumidas', 'aniversariantes']).describe('recompra = o produto que compram deve estar acabando; sumidas = sem comprar há X dias; aniversariantes = do mês'),
      dias: z.number().int().min(15).max(365).optional().describe('sumidas: dias sem comprar (padrão 45)'),
      mes: z.number().int().min(1).max(12).optional().describe('aniversariantes: mês (padrão o atual)'),
      limite: z.number().int().min(1).max(300).optional(),
    });
    return {
      nome: 'oportunidades_clientes',
      descricao: 'Listas de quem chamar: recompra (o produto que a cliente compra deve estar acabando), sumidas (não compram há X dias, com cashback esperando) e aniversariantes do mês. Devolve clienteId, telefone, se aceita WhatsApp e o motivo. Use antes de um envio de WhatsApp.',
      schema,
      risco: 'leitura',
      permitido: algum('customer.view', 'campaign.manage'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const lim = e.limite ?? 50;
        if (e.tipo === 'recompra') {
          const r = await computeRepurchase(this.prisma as unknown as Prisma.TransactionClient, ctx.usuario.ctx.tenantId);
          return { total: r.length, clientes: r.slice(0, lim).map((x) => ({ clienteId: x.customerId, nome: x.customerName, telefone: x.phone, aceitaWhatsapp: x.allowWhatsapp, produto: x.productName, produtoId: x.productId, ultimaCompra: dataBR(x.lastPurchase), cashback: reais(x.cashbackBalance) })) };
        }
        if (e.tipo === 'sumidas') {
          const r = await this.growth.lapsed(ctx.usuario.ctx, e.dias ?? 45);
          return { total: r.length, clientes: r.slice(0, lim).map((x) => ({ clienteId: x.customerId, nome: x.customerName, telefone: x.phone, aceitaWhatsapp: x.allowWhatsapp, diasSemComprar: x.daysAway, compras: x.purchases, gastoTotal: reais(x.totalSpent), cashback: reais(x.cashbackBalance), ultimoContato: dataBR(x.lastContactAt) })) };
        }
        const mes = e.mes ?? Number(todayBR().slice(5, 7));
        const r = await this.growth.birthdays(ctx.usuario.ctx, mes);
        return { total: r.length, mes, clientes: r.slice(0, lim).map((x) => ({ clienteId: x.customerId, nome: x.customerName, telefone: x.phone, aceitaWhatsapp: x.allowWhatsapp, dia: x.day, membro: x.isMember, ultimoContato: dataBR(x.lastContactAt) })) };
      },
    };
  }

  private consultarFinanceiro(): Ferramenta {
    const schema = z.object({
      situacao: z.enum(['a_vencer', 'vencido', 'em_aberto', 'pago']).optional().describe('Padrão: em_aberto (a vencer + vencido)'),
      de: dataIso.optional().describe('Início do período (vencimento; para "pago", a data do pagamento). Padrão: hoje'),
      ate: dataIso.optional().describe('Fim do período, inclusive. Padrão: 30 dias depois do início'),
      limite: z.number().int().min(1).max(200).optional(),
    });
    return {
      nome: 'consultar_financeiro',
      descricao: 'Contas a pagar por período e situação: o que vence hoje, na semana ou no mês, o que venceu e não foi pago, o que foi pago. Devolve total, quantidade, por categoria e a lista. Para o que entrou no caixa por forma de pagamento, use consultar_dados com o conjunto "pagamentos".',
      schema,
      risco: 'leitura',
      permitido: pode('finance.view'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const hoje = todayBR();
        const situacao = e.situacao ?? 'em_aberto';
        const de = e.de ?? (situacao === 'vencido' ? desloca(hoje, -365) : hoje);
        const ate = e.ate ?? (situacao === 'vencido' ? desloca(hoje, -1) : desloca(de, 30));
        const where: Prisma.PayableWhereInput = { tenantId: ctx.usuario.ctx.tenantId };
        if (situacao === 'pago') Object.assign(where, { status: 'paid', paidDate: { gte: new Date(`${de}T00:00:00Z`), lte: new Date(`${ate}T00:00:00Z`) } });
        else {
          Object.assign(where, { status: 'open', dueDate: { gte: new Date(`${de}T00:00:00Z`), lte: new Date(`${ate}T00:00:00Z`) } });
          if (situacao === 'a_vencer') where.dueDate = { gte: new Date(`${de < hoje ? hoje : de}T00:00:00Z`), lte: new Date(`${ate}T00:00:00Z`) };
          if (situacao === 'vencido') where.dueDate = { gte: new Date(`${de}T00:00:00Z`), lt: new Date(`${ate >= hoje ? hoje : desloca(ate, 1)}T00:00:00Z`) };
        }
        const contas = await this.prisma.payable.findMany({ where, orderBy: { dueDate: 'asc' }, take: 1000 });
        const porCategoria = new Map<string, number>();
        for (const c of contas) porCategoria.set(c.category, (porCategoria.get(c.category) ?? 0) + Number(c.amount));
        return {
          situacao,
          periodo: `${dataBR(de)} a ${dataBR(ate)}`,
          quantidade: contas.length,
          total: reais(contas.reduce((s, c) => s + Number(c.amount), 0)),
          porCategoria: [...porCategoria].map(([k, v]) => ({ categoria: (PAYABLE_CATEGORIES as Record<string, string>)[k] ?? k, valor: reais(v) })),
          contas: contas.slice(0, e.limite ?? 50).map((c) => ({ descricao: c.description, fornecedor: c.supplier, vencimento: dataBR(c.dueDate.toISOString().slice(0, 10)), valor: reais(c.amount), situacao: c.status === 'paid' ? `paga em ${dataBR(c.paidDate?.toISOString().slice(0, 10))}` : c.status === 'open' ? (c.dueDate.toISOString().slice(0, 10) < hoje ? 'vencida' : 'a vencer') : c.status })),
        };
      },
    };
  }

  private pedidosEmAndamento(): Ferramenta {
    const schema = z.object({ incluirEntregues: z.boolean().optional().describe('Também os entregues de hoje') });
    return {
      nome: 'pedidos_em_andamento',
      descricao: 'Pedidos do app, totem e balcão que ainda não terminaram: esperando pagamento, na fila, preparando, prontos e saindo para entrega, com há quantos minutos estão em cada situação.',
      schema,
      risco: 'leitura',
      permitido: algum('order.prepare', 'report.view'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const status = ['aguardando_pagamento', 'na_fila', 'preparando', 'pronto', 'saiu_entrega', ...(e.incluirEntregues ? ['entregue'] : [])];
        const os = await this.prisma.order.findMany({ where: { tenantId: ctx.usuario.ctx.tenantId, status: { in: status }, createdAt: { gte: new Date(Date.now() - 36 * 3_600_000) } }, orderBy: { createdAt: 'asc' }, take: 100 });
        const min = (d: Date | null) => (d ? Math.round((Date.now() - d.getTime()) / 60000) : null);
        const porSituacao: Record<string, number> = {};
        for (const o of os) porSituacao[o.status] = (porSituacao[o.status] ?? 0) + 1;
        return {
          porSituacao,
          pedidos: os.map((o) => ({ numero: o.number, nome: o.callName, canal: o.channel, situacao: o.status, entrega: o.fulfillment === 'entrega', valor: reais(o.estimate), minutosDesdeOPedido: min(o.createdAt), minutosNaFila: o.status === 'na_fila' ? min(o.paidAt) : null, minutosPreparando: o.status === 'preparando' ? min(o.startedAt) : null })),
        };
      },
    };
  }

  private parceirosDoMes(): Ferramenta {
    const schema = z.object({ mes: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('AAAA-MM (padrão: mês atual)') });
    return {
      nome: 'parceiros_do_mes',
      descricao: 'Parceiros (nutricionistas, personais, influenciadores) no mês: clientes indicadas, vendas, faturamento, comissão e se o mês já foi fechado.',
      schema,
      risco: 'leitura',
      permitido: pode('partner.manage'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const rows = await this.partners.list(ctx.usuario.ctx, e.mes ?? todayBR().slice(0, 7));
        return { parceiros: rows.map((p) => ({ nome: p.name, codigo: p.code, ativo: p.active, clientes: p.stats.customers, novas: p.stats.newCustomers, vendas: p.stats.sales, faturamento: reais(p.stats.revenue), comissao: reais(p.stats.commission), fechado: p.stats.closed })) };
      },
    };
  }

  private listarCampanhas(): Ferramenta {
    return {
      nome: 'listar_campanhas',
      descricao: 'Campanhas cadastradas (cupons, cashback em dobro, ofertas): situação, período, regras e quantas vezes foram usadas. Devolve campanhaId.',
      schema: z.object({}),
      risco: 'leitura',
      permitido: algum('campaign.manage', 'report.view'),
      executar: async (_e, ctx) => {
        const cs = await this.campaigns.list(ctx.usuario.ctx);
        return { campanhas: cs.map((c) => ({ campanhaId: c.id, nome: c.name, tipo: c.type, ativa: c.active, de: dataBR(c.startsOn), ate: dataBR(c.endsOn), codigo: c.code, descontoPct: c.discountPct, descontoReais: c.discountAmount, cashbackExtraPct: c.extraCashbackPct, publico: c.audience, usos: (c as { uses?: number }).uses ?? null })) };
      },
    };
  }

  // ───────────── Ações (com confirmação) ─────────────

  private criarCampanha(): Ferramenta {
    const schema = z.object({
      nome: z.string().trim().min(3).max(80),
      tipo: z.enum(['cupom', 'cashback', 'oferta']).describe('cupom = código com desconto; cashback = % a mais de cashback; oferta = preço promocional de produtos'),
      de: dataIso.describe('Primeiro dia'),
      ate: dataIso.describe('Último dia'),
      diasDaSemana: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('0 = domingo … 6 = sábado. Vazio = todos'),
      publico: z.enum(['todos', 'membros', 'aniversariantes']).optional().describe('aniversariantes só vale para cupom'),
      descricao: z.string().max(160).optional().describe('Texto curto que aparece no app'),
      codigo: z.string().max(20).optional().describe('cupom: código (3 a 20 letras, números ou hífen)'),
      descontoPct: z.number().min(0.01).max(100).optional().describe('cupom: desconto em % (ou descontoReais)'),
      descontoReais: z.number().min(0.01).optional().describe('cupom: desconto em R$'),
      compraMinima: z.number().min(0).optional(),
      usosPorCliente: z.number().int().min(1).optional(),
      cashbackExtraPct: z.number().min(0.01).max(100).optional().describe('cashback: % a mais'),
      categorias: z.array(uuid).max(100).optional().describe('cashback: só nestas categorias'),
      produtos: z.array(z.object({ produtoId: uuid, precoPromocional: z.number().min(0.01).optional() })).max(300).optional().describe('oferta: produtos com preço promocional; cashback: só nestes produtos'),
    });
    const montar = (e: z.infer<typeof schema>): CampaignInput =>
      campaignSchema.parse({
        name: e.nome,
        type: e.tipo,
        active: true,
        startsOn: e.de,
        endsOn: e.ate,
        weekdays: e.diasDaSemana ?? [],
        audience: e.publico ?? 'todos',
        description: e.descricao ?? null,
        code: e.codigo ?? null,
        discountPct: e.descontoPct ?? null,
        discountAmount: e.descontoReais ?? null,
        minPurchase: e.compraMinima ?? 0,
        maxPerCustomer: e.usosPorCliente ?? null,
        extraCashbackPct: e.cashbackExtraPct ?? null,
        scope: e.tipo === 'cashback' ? (e.produtos?.length ? 'produtos' : e.categorias?.length ? 'categorias' : 'tudo') : 'tudo',
        categoryIds: e.categorias ?? [],
        products: (e.produtos ?? []).map((p) => ({ productId: p.produtoId, promoPrice: p.precoPromocional ?? null })),
      });
    return {
      nome: 'criar_campanha',
      descricao: 'Cria uma campanha: cupom de desconto (código), cashback a mais (em tudo, categorias ou produtos) ou oferta com preço promocional. Ela aparece no caixa e no app no período escolhido. Use buscar_produtos antes para pegar os produtoId.',
      schema,
      risco: 'confirmar',
      permitido: pode('campaign.manage'),
      preparar: async (e: z.infer<typeof schema>) => {
        let c: CampaignInput;
        try {
          c = montar(e);
        } catch (err) {
          const issues = (err as { issues?: Array<{ message: string }> }).issues;
          return { resumo: '', impedimento: issues?.map((i) => i.message).join('; ') ?? (err as Error).message };
        }
        const regra = c.type === 'cupom' ? `cupom ${c.code} com ${c.discountPct != null ? `${c.discountPct}%` : reais(c.discountAmount)} de desconto${c.minPurchase ? ` acima de ${reais(c.minPurchase)}` : ''}` : c.type === 'cashback' ? `+${c.extraCashbackPct}% de cashback${c.scope !== 'tudo' ? ` (${c.scope})` : ''}` : `oferta em ${c.products.length} produto(s)`;
        return { resumo: `Criar a campanha "${c.name}": ${regra}, de ${dataBR(c.startsOn)} a ${dataBR(c.endsOn)}${c.audience !== 'todos' ? `, só para ${c.audience}` : ''}.`, previa: c.description ? [{ nome: 'Texto no app', texto: c.description }] : undefined };
      },
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const c = await this.campaigns.save(ctx.usuario.ctx, null, montar(e));
        return { criada: true, campanhaId: c.id, nome: c.name };
      },
    };
  }

  private ligarCampanha(): Ferramenta {
    const schema = z.object({ campanhaId: uuid, ativa: z.boolean().describe('true = liga, false = pausa') });
    return {
      nome: 'ligar_campanha',
      descricao: 'Liga ou pausa uma campanha existente (use listar_campanhas para o campanhaId).',
      schema,
      risco: 'confirmar',
      permitido: pode('campaign.manage'),
      preparar: async (e: z.infer<typeof schema>, ctx) => {
        const c = await this.prisma.campaign.findFirst({ where: { id: e.campanhaId, tenantId: ctx.usuario.ctx.tenantId }, select: { name: true, active: true } });
        if (!c) return { resumo: '', impedimento: 'Campanha não encontrada.' };
        if (c.active === e.ativa) return { resumo: '', impedimento: `A campanha "${c.name}" já está ${c.active ? 'ligada' : 'pausada'}.` };
        return { resumo: `${e.ativa ? 'Ligar' : 'Pausar'} a campanha "${c.name}".` };
      },
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const r = await this.prisma.campaign.updateMany({ where: { id: e.campanhaId, tenantId: ctx.usuario.ctx.tenantId }, data: { active: e.ativa } });
        if (!r.count) throw new BadRequestException('Campanha não encontrada.');
        await this.audit.record(ctx.usuario.ctx, e.ativa ? 'campaign.activate' : 'campaign.pause', 'campaign', e.campanhaId, { via: 'assistente' });
        return { ok: true, ativa: e.ativa };
      },
    };
  }

  private alterarPreco(): Ferramenta {
    const schema = z.object({
      produtoId: uuid,
      preco: z.number().min(0.01).max(1_000_000).optional().describe('Novo preço normal'),
      precoMembro: z.number().min(0).max(1_000_000).nullable().optional().describe('Novo preço de membro (null = sem preço de membro)'),
    });
    return {
      nome: 'alterar_preco',
      descricao: 'Muda o preço normal e/ou o preço de membro de um produto (vale no caixa, no app e na loja online na hora). Use buscar_produtos antes para conferir o preço atual.',
      schema,
      risco: 'confirmar',
      permitido: pode('product.manage'),
      preparar: async (e: z.infer<typeof schema>, ctx) => {
        if (e.preco === undefined && e.precoMembro === undefined) return { resumo: '', impedimento: 'Diga o novo preço ou o novo preço de membro.' };
        const p = await this.prisma.product.findFirst({ where: { id: e.produtoId, tenantId: ctx.usuario.ctx.tenantId }, select: { name: true, price: true, memberPrice: true, cost: true } });
        if (!p) return { resumo: '', impedimento: 'Produto não encontrado.' };
        const preco = e.preco ?? Number(p.price);
        const membro = e.precoMembro === undefined ? (p.memberPrice == null ? null : Number(p.memberPrice)) : e.precoMembro;
        if (membro != null && membro > preco) return { resumo: '', impedimento: 'O preço de membro não pode ser maior que o preço normal.' };
        const partes = [e.preco !== undefined ? `preço de ${reais(p.price)} para ${reais(preco)}` : null, e.precoMembro !== undefined ? `preço de membro de ${p.memberPrice == null ? 'nenhum' : reais(p.memberPrice)} para ${membro == null ? 'nenhum' : reais(membro)}` : null].filter(Boolean);
        const abaixoDoCusto = p.cost != null && (preco < Number(p.cost) || (membro != null && membro < Number(p.cost)));
        return { resumo: `"${p.name}": ${partes.join(' e ')}.${abaixoDoCusto ? ` Atenção: fica abaixo do custo (${reais(p.cost)}).` : ''}` };
      },
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const p = await this.prisma.product.findFirst({ where: { id: e.produtoId, tenantId: ctx.usuario.ctx.tenantId }, select: { price: true, memberPrice: true } });
        if (!p) throw new BadRequestException('Produto não encontrado.');
        const data: Prisma.ProductUpdateInput = {};
        if (e.preco !== undefined) data.price = e.preco;
        if (e.precoMembro !== undefined) data.memberPrice = e.precoMembro;
        const preco = e.preco ?? Number(p.price);
        const membro = e.precoMembro === undefined ? (p.memberPrice == null ? null : Number(p.memberPrice)) : e.precoMembro;
        if (membro != null && membro > preco) throw new BadRequestException('O preço de membro não pode ser maior que o preço normal.');
        await this.prisma.product.update({ where: { id: e.produtoId }, data });
        await this.audit.record(ctx.usuario.ctx, 'product.price', 'product', e.produtoId, { de: { preco: Number(p.price), membro: p.memberPrice == null ? null : Number(p.memberPrice) }, para: { preco, membro }, via: 'assistente' });
        return { ok: true, preco: reais(preco), precoMembro: membro == null ? null : reais(membro) };
      },
    };
  }

  private criarPedidoCompra(): Ferramenta {
    const schema = z.object({
      fornecedorId: uuid.describe('Fornecedor (alertas_estoque devolve fornecedorId)'),
      lojaId: uuid.optional(),
      itens: z.array(z.object({ produtoId: uuid, quantidade: z.number().positive(), custoUnitario: z.number().min(0).optional() })).min(1).max(300),
      observacao: z.string().max(500).optional(),
    });
    return {
      nome: 'criar_pedido_compra',
      descricao: 'Monta um pedido de compra em rascunho para um fornecedor (a equipe revisa e envia em Comprar › Pedidos de compra). Use alertas_estoque para as quantidades sugeridas.',
      schema,
      risco: 'confirmar',
      permitido: pode('purchase.manage'),
      preparar: async (e: z.infer<typeof schema>, ctx) => {
        const f = await this.prisma.supplier.findFirst({ where: { id: e.fornecedorId, tenantId: ctx.usuario.ctx.tenantId }, select: { name: true } });
        if (!f) return { resumo: '', impedimento: 'Fornecedor não encontrado.' };
        const ps = await this.prisma.product.findMany({ where: { tenantId: ctx.usuario.ctx.tenantId, id: { in: e.itens.map((i) => i.produtoId) } }, select: { id: true, name: true, cost: true } });
        if (ps.length !== new Set(e.itens.map((i) => i.produtoId)).size) return { resumo: '', impedimento: 'Algum produto não foi encontrado.' };
        const total = e.itens.reduce((s, i) => s + i.quantidade * (i.custoUnitario ?? Number(ps.find((p) => p.id === i.produtoId)?.cost ?? 0)), 0);
        return { resumo: `Pedido de compra (rascunho) para ${f.name}: ${e.itens.length} produto(s), cerca de ${reais(total)}.`, previa: [{ nome: 'Itens', texto: e.itens.map((i) => `${i.quantidade}× ${ps.find((p) => p.id === i.produtoId)?.name}`).join('\n') }] };
      },
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const ps = await this.prisma.product.findMany({ where: { tenantId: ctx.usuario.ctx.tenantId, id: { in: e.itens.map((i) => i.produtoId) } }, select: { id: true, cost: true } });
        const input = purchaseOrderSchema.parse({ storeId: e.lojaId ?? (await this.lojaPadrao(ctx.usuario)), supplierId: e.fornecedorId, items: e.itens.map((i) => ({ productId: i.produtoId, quantity: i.quantidade, unitCost: i.custoUnitario ?? Number(ps.find((p) => p.id === i.produtoId)?.cost ?? 0) })), notes: e.observacao ?? null });
        const po = await this.purchasing.saveOrder(ctx.usuario.ctx, null, input);
        return { criado: true, numero: po.number, total: reais(po.total), situacao: 'rascunho' };
      },
    };
  }

  private lancarContaPagar(): Ferramenta {
    const schema = z.object({
      descricao: z.string().trim().min(2).max(150),
      categoria: z.enum(Object.keys(PAYABLE_CATEGORIES) as [string, ...string[]]),
      valor: z.number().min(0.01),
      vencimento: dataIso,
      fornecedor: z.string().max(100).optional(),
      repetirMeses: z.number().int().min(1).max(24).optional().describe('Repetir todo mês por N meses (padrão 1)'),
    });
    return {
      nome: 'lancar_conta_pagar',
      descricao: `Lança uma conta a pagar (pode repetir todo mês). Categorias: ${Object.entries(PAYABLE_CATEGORIES).map(([k, v]) => `${k} = ${v}`).join('; ')}. Uma foto ou PDF de boleto anexado serve para ler os dados.`,
      schema,
      risco: 'confirmar',
      permitido: pode('finance.manage'),
      preparar: async (e: z.infer<typeof schema>) => ({ resumo: `Lançar "${e.descricao}" de ${reais(e.valor)}, vencendo em ${dataBR(e.vencimento)}${e.repetirMeses && e.repetirMeses > 1 ? `, repetindo por ${e.repetirMeses} meses` : ''} (${(PAYABLE_CATEGORIES as Record<string, string>)[e.categoria]}).` }),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const input = payableSchema.parse({ description: e.descricao, category: e.categoria, amount: e.valor, dueDate: e.vencimento, supplier: e.fornecedor ?? null, storeId: null, repeat: e.repetirMeses ?? 1 });
        const r = await this.finance.createPayable(ctx.usuario.ctx, input);
        return { lancadas: r.length, total: reais(r.reduce((s, p) => s + Number(p.amount), 0)) };
      },
    };
  }

  // ───────────── WhatsApp (pelo canal configurado no servidor) ─────────────

  private async loja(t: string) {
    const s = await this.prisma.store.findFirst({ where: { tenantId: t, active: true }, orderBy: { createdAt: 'asc' }, select: { name: true } });
    return s?.name ?? 'Mercearia Saudável';
  }

  private preencher(texto: string, c: { name: string; cashbackBalance: Prisma.Decimal | number; memberCode: string | null }, loja: string) {
    const vars: Record<string, string> = { nome: c.name, primeiro_nome: c.name.split(' ')[0] ?? c.name, cashback: reais(c.cashbackBalance), cartao: c.memberCode ?? '', loja };
    return texto.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
  }

  private enviarWhatsapp(): Ferramenta {
    const schema = z.object({ clienteId: uuid, texto: z.string().trim().min(2).max(2000), motivo: z.enum(['recompra', 'sumida', 'aniversario']).optional().describe('Registra o contato (some da lista de quem chamar)'), produtoId: uuid.optional() });
    return {
      nome: 'enviar_whatsapp',
      descricao: 'Manda uma mensagem de WhatsApp para uma cliente (pelo canal ligado no servidor). Respeita quem não aceita WhatsApp.',
      schema,
      risco: 'confirmar',
      permitido: (u) => this.whatsapp.enabled && can(u, 'customer.manage'),
      preparar: async (e: z.infer<typeof schema>, ctx) => {
        const c = await this.prisma.customer.findFirst({ where: { id: e.clienteId, tenantId: ctx.usuario.ctx.tenantId } });
        if (!c) return { resumo: '', impedimento: 'Cliente não encontrada.' };
        if (!c.allowWhatsapp) return { resumo: '', impedimento: `${c.name} não aceita mensagens de WhatsApp.` };
        if (!telefoneOk(c.phone)) return { resumo: '', impedimento: `${c.name} não tem celular válido.` };
        const texto = this.preencher(e.texto, c, await this.loja(ctx.usuario.ctx.tenantId));
        return { resumo: `Mandar WhatsApp para ${c.name}.`, previa: [{ nome: c.name, telefone: c.phone, texto }] };
      },
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const c = await this.prisma.customer.findFirst({ where: { id: e.clienteId, tenantId: ctx.usuario.ctx.tenantId } });
        if (!c?.phone || !c.allowWhatsapp) throw new BadRequestException('Cliente sem WhatsApp liberado.');
        const r = await this.whatsapp.sendText(c.phone, this.preencher(e.texto, c, await this.loja(ctx.usuario.ctx.tenantId)), { tenantId: ctx.usuario.ctx.tenantId, author: 'equipe', userId: ctx.usuario.id });
        if (!r.ok) throw new BadRequestException(r.reason);
        if (e.motivo) await this.growth.contact(ctx.usuario.ctx, { customerId: c.id, productId: e.produtoId ?? null, kind: e.motivo }).catch(() => undefined);
        await this.audit.record(ctx.usuario.ctx, 'assistant.whatsapp', 'customer', c.id, { via: 'assistente' });
        return { enviado: true, para: c.name };
      },
    };
  }

  private loteSchema = z.object({
    clienteIds: z.array(uuid).min(1).max(300),
    texto: z.string().trim().min(2).max(2000).describe(`Mensagem com variáveis opcionais: ${VARIAVEIS_LOTE.map((v) => `{${v}}`).join(', ')}`),
    motivo: z.enum(['recompra', 'sumida', 'aniversario']).optional().describe('Registra o contato de cada uma'),
  });

  private async montarLote(e: z.infer<FerramentasAssistente['loteSchema']>, ctx: Contexto) {
    const t = ctx.usuario.ctx.tenantId;
    const loja = await this.loja(t);
    const cs = await this.prisma.customer.findMany({ where: { tenantId: t, id: { in: e.clienteIds } } });
    const itens = cs.map((c) => ({ clienteId: c.id, nome: c.name, telefone: c.phone, texto: this.preencher(e.texto, c, loja), problema: !c.allowWhatsapp ? 'não aceita WhatsApp' : !telefoneOk(c.phone) ? 'sem celular válido' : null as string | null }));
    return { itens, faltando: new Set(e.clienteIds).size - cs.length };
  }

  /** Segundos entre uma mensagem e outra no envio em lote. */
  intervaloLote() {
    const n = Number(process.env.ASSISTENTE_INTERVALO_LOTE_S ?? 20);
    return Number.isFinite(n) ? Math.min(300, Math.max(3, n)) : 20;
  }

  private enviarWhatsappEmLote(): Ferramenta {
    return {
      nome: 'enviar_whatsapp_em_lote',
      descricao: 'Manda a mesma mensagem (com as variáveis preenchidas por cliente) para várias clientes pelo WhatsApp. Roda em segundo plano, espaçado para o número não ser bloqueado, com progresso na tela. Ex.: recompra, quem sumiu, aniversariantes, campanha.',
      schema: this.loteSchema,
      risco: 'confirmar',
      segundoPlano: true,
      permitido: (u) => this.whatsapp.enabled && can(u, 'customer.manage'),
      preparar: async (e, ctx) => {
        const l = await this.montarLote(e, ctx);
        const validos = l.itens.filter((i) => !i.problema).length;
        if (!validos) return { resumo: '', impedimento: 'Nenhuma das clientes aceita WhatsApp ou tem celular válido.' };
        const intervalo = this.intervaloLote();
        return {
          resumo: `Mandar WhatsApp para ${validos} cliente(s), uma mensagem a cada ~${intervalo}s: leva cerca de ${Math.max(1, Math.round((validos * intervalo) / 60))} min.${l.itens.length - validos ? ` ${l.itens.length - validos} ficam de fora (veja o motivo).` : ''}${l.faltando ? ` ${l.faltando} id(s) não encontrado(s).` : ''}`,
          previa: l.itens,
        };
      },
      executar: async (e, ctx) => {
        const l = await this.montarLote(e, ctx);
        const validos = l.itens.filter((i) => !i.problema);
        const intervalo = this.intervaloLote();
        const falhas: { nome: string; erro: string }[] = l.itens.filter((i) => i.problema).map((i) => ({ nome: i.nome, erro: i.problema! }));
        let enviados = 0;
        await ctx.progresso?.(0, validos.length, 0);
        for (const [n, i] of validos.entries()) {
          if (n > 0) await new Promise((r) => setTimeout(r, Math.round(intervalo * 1000 * (0.75 + Math.random() * 0.5))));
          const r = await this.whatsapp.sendText(i.telefone!, i.texto, { tenantId: ctx.usuario.ctx.tenantId, author: 'equipe', userId: ctx.usuario.id });
          if (r.ok) {
            enviados++;
            if (e.motivo) await this.growth.contact(ctx.usuario.ctx, { customerId: i.clienteId, productId: null, kind: e.motivo }).catch(() => undefined);
          } else falhas.push({ nome: i.nome, erro: r.reason.slice(0, 200) });
          await ctx.progresso?.(n + 1, validos.length, falhas.length - (l.itens.length - validos.length));
        }
        await this.audit.record(ctx.usuario.ctx, 'assistant.whatsapp_batch', 'customer', null, { enviados, falhas: falhas.length });
        return { enviados, naoEnviados: falhas.length, falhas };
      },
    };
  }

  // ───────────── E-mail, rotinas e pedidos ─────────────

  private emailSchema = z.object({
    para: z.array(z.string().trim().toLowerCase().email('E-mail inválido')).min(1).max(10),
    assunto: z.string().trim().min(3).max(200),
    texto: z.string().trim().min(1).max(20000).describe('Corpo do e-mail em texto simples (pode ter quebras de linha e listas com "- ")'),
    tabela: z
      .object({ nome: z.string().trim().min(1).max(60), colunas: z.array(z.string().max(60)).min(1).max(20), linhas: z.array(z.array(z.union([z.string(), z.number(), z.null()]))).max(500) })
      .optional()
      .describe('Tabela para anexar como planilha (CSV que abre no Excel), montada com o resultado das consultas'),
    anexosDaConversa: z.array(uuid).max(5).optional().describe('Arquivos que a pessoa anexou na conversa (anexoId) para encaminhar'),
  });

  private enviarEmail(): Ferramenta {
    return {
      nome: 'enviar_email',
      descricao: 'Envia um e-mail pelo servidor de e-mail do sistema, com planilha anexa opcional. Em rotina agendada, sai sem confirmação só para os e-mails autorizados na criação da rotina.',
      schema: this.emailSchema,
      risco: 'confirmar',
      permitido: pode('assistant.use'),
      preparar: async (e: z.infer<FerramentasAssistente['emailSchema']>, ctx) => {
        const daConversa = e.anexosDaConversa?.length ? await this.prisma.assistantAttachment.findMany({ where: { id: { in: e.anexosDaConversa }, userId: ctx.usuario.id, tenantId: ctx.usuario.ctx.tenantId }, select: { name: true } }) : [];
        if (daConversa.length !== (e.anexosDaConversa?.length ?? 0)) return { resumo: '', impedimento: 'Algum anexo da conversa não foi encontrado.' };
        const anexos = [e.tabela ? `planilha "${e.tabela.nome}"` : null, ...daConversa.map((a) => `"${a.name}"`)].filter(Boolean);
        return { resumo: `Enviar e-mail para ${e.para.join(', ')}: "${e.assunto}"${anexos.length ? `, com ${anexos.join(' e ')}` : ''}.`, previa: [{ nome: e.assunto, telefone: e.para.join(', '), texto: e.texto.slice(0, 3000) }] };
      },
      executar: async (e: z.infer<FerramentasAssistente['emailSchema']>, ctx) => {
        const anexos: { nome: string; conteudo: Buffer; mime: string }[] = [];
        const dia = todayBR();
        if (e.tabela) anexos.push({ nome: `${e.tabela.nome.replace(/[^\w\- ]+/g, '').trim() || 'planilha'}-${dia}.csv`, mime: 'text/csv', conteudo: csv(e.tabela.colunas, e.tabela.linhas) });
        if (e.anexosDaConversa?.length) {
          const linhas = await this.prisma.assistantAttachment.findMany({ where: { id: { in: e.anexosDaConversa }, userId: ctx.usuario.id, tenantId: ctx.usuario.ctx.tenantId } });
          for (const a of linhas) anexos.push({ nome: a.name, mime: a.mime, conteudo: Buffer.from(a.data) });
        }
        if (anexos.reduce((t, a) => t + a.conteudo.length, 0) > 20_000_000) throw new BadRequestException('Os anexos passam de 20 MB: o e-mail seria recusado.');
        const r = await this.email.enviar(e.para.join(', '), e.assunto, e.texto, anexos);
        await this.audit.record(ctx.usuario.ctx, ctx.rotina ? 'assistant.email_routine' : 'assistant.email', 'email', null, { para: e.para, assunto: e.assunto, anexos: anexos.map((a) => a.nome), rotinaId: ctx.rotina?.id ?? null });
        return { enviado: true, para: e.para, anexos: anexos.map((a) => a.nome), ...(r.simulado ? { aviso: 'O servidor de e-mail (SMTP) não está configurado: o envio foi só simulado. Configure SMTP_HOST, SMTP_USER, SMTP_PASS e SMTP_FROM no .env do servidor.' } : {}) };
      },
    };
  }

  private montarAgenda(e: { horario?: string; intervaloMinutos?: number; janela?: { inicio: string; fim: string }; dias?: number[] }): Agenda {
    const dias = e.dias?.length ? [...new Set(e.dias)].sort() : [0, 1, 2, 3, 4, 5, 6];
    if (e.intervaloMinutos) return { tipo: 'intervalo', horario: e.janela?.inicio?.padStart(5, '0') ?? '00:00', dias, intervaloMin: e.intervaloMinutos, janelaInicio: e.janela?.inicio?.padStart(5, '0') ?? null, janelaFim: e.janela?.fim?.padStart(5, '0') ?? null };
    if (!e.horario) throw new BadRequestException('Diga o horário (HH:MM) ou o intervalo em minutos.');
    return { tipo: 'horario', horario: e.horario.padStart(5, '0'), dias, intervaloMin: null, janelaInicio: null, janelaFim: null };
  }

  private agendaSchema = {
    horario: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Horário no formato HH:MM').optional().describe('Uma vez por dia neste horário (Brasília). Use isto OU intervaloMinutos.'),
    intervaloMinutos: z.number().int().min(15, 'O intervalo mínimo é de 15 minutos').max(10080).optional().describe('A cada quantos minutos (60 = de hora em hora). Mínimo 15.'),
    janela: z
      .object({ inicio: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/), fim: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/) })
      .optional()
      .describe('Só com intervalo: horário do dia em que pode rodar (ex.: 08:00 às 18:00)'),
    dias: z.array(z.number().int().min(0).max(6)).max(7).optional().describe('Dias da semana: 0 = domingo … 6 = sábado. Padrão: todos'),
  };

  /** Rotina gravada → agenda no formato das funções de horário. */
  static agendaDe(r: { kind: string; time: string; days: unknown; intervalMin: number | null; windowStart: string | null; windowEnd: string | null }): Agenda {
    return { tipo: r.kind, horario: r.time, dias: (r.days as number[]) ?? [], intervaloMin: r.intervalMin, janelaInicio: r.windowStart, janelaFim: r.windowEnd };
  }

  private agendarRotina(): Ferramenta {
    const schema = z.object({
      titulo: z.string().trim().min(3).max(80).describe('Nome curto, ex.: "Resumo do dia por e-mail"'),
      instrucao: z.string().trim().min(20).max(4000).describe('O que fazer em CADA execução, completo e sem depender desta conversa: o que consultar, como montar e para quem enviar (com os e-mails).'),
      ...this.agendaSchema,
      emails: z.array(z.string().trim().toLowerCase().email()).max(10).optional().describe('E-mails que podem receber o que a rotina mandar, sem pedir confirmação a cada execução'),
      aprovarAutomaticamente: z.boolean().optional().describe('true = a rotina executa tudo sozinha (WhatsApp, preços, campanhas) sem esperar confirmação. Só se a pessoa pedir.'),
    });
    const quando = (d: Date) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    return {
      nome: 'agendar_rotina',
      descricao:
        'Cria uma rotina (agente agendado) que você executa sozinho: uma vez por dia num horário, ou a cada X minutos/horas (com janela do dia e dias da semana opcionais). Ex.: "todo dia às 20h me mande o resumo do dia por e-mail", "toda segunda às 8h veja o que preciso comprar". Roda com as permissões de quem pediu; cada execução vira uma conversa. WhatsApp, preços e campanhas não saem sozinhos: esperam confirmação na conversa da rotina. E-mail sai sozinho só para os endereços autorizados aqui.',
      schema,
      risco: 'confirmar',
      permitido: pode('assistant.use'),
      preparar: async (e: z.infer<typeof schema>, ctx) => {
        if (e.aprovarAutomaticamente && !ctx.podeAutomatico) return { resumo: '', impedimento: 'Você não pode ligar a aprovação automática (regra da empresa em Assistente › Configurar).' };
        try {
          const a = this.montarAgenda(e);
          return {
            resumo: `Criar a rotina "${e.titulo}": ${descreverAgenda(a)} (primeira: ${quando(proximaDaRotina(a))}).${e.emails?.length ? ` E-mails autorizados: ${e.emails.join(', ')}.` : ''}${e.aprovarAutomaticamente ? ' Aprovação AUTOMÁTICA: executa tudo sozinha, sem esperar confirmação.' : ' Ações que mandam mensagem ou alteram vão esperar sua confirmação.'}`,
            previa: [{ nome: 'O que vai fazer em cada execução', texto: e.instrucao }],
          };
        } catch (err) {
          return { resumo: '', impedimento: (err as Error).message };
        }
      },
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const a = this.montarAgenda(e);
        if (e.aprovarAutomaticamente && !ctx.podeAutomatico) throw new BadRequestException('Sem permissão para aprovação automática.');
        const r = await this.prisma.assistantRoutine.create({
          data: { tenantId: ctx.usuario.ctx.tenantId, userId: ctx.usuario.id, title: e.titulo, instruction: e.instrucao, kind: a.tipo, time: a.horario, intervalMin: a.intervaloMin ?? null, windowStart: a.janelaInicio ?? null, windowEnd: a.janelaFim ?? null, days: a.dias, emails: e.emails ?? [], approval: e.aprovarAutomaticamente ? 'automatico' : 'perguntar', nextAt: proximaDaRotina(a) },
        });
        await this.audit.record(ctx.usuario.ctx, 'assistant.routine_create', 'assistant_routine', r.id, { titulo: e.titulo, agenda: descreverAgenda(a), emails: e.emails ?? [] });
        return { criada: true, rotinaId: r.id, quando: descreverAgenda(a), primeiraExecucao: quando(r.nextAt), observacao: 'A pessoa acompanha, duplica e pausa na aba Agentes do Assistente.' };
      },
    };
  }

  private gerenciarRotinas(): Ferramenta {
    const schema = z.object({
      acao: z.enum(['listar', 'pausar', 'retomar', 'excluir', 'duplicar', 'editar']),
      rotinaId: uuid.optional().describe('Obrigatório exceto em listar (use listar antes)'),
      titulo: z.string().trim().min(3).max(80).optional(),
      instrucao: z.string().trim().min(20).max(4000).optional(),
      ...this.agendaSchema,
      emails: z.array(z.string().trim().toLowerCase().email()).max(10).optional(),
      aprovarAutomaticamente: z.boolean().optional(),
    });
    return {
      nome: 'gerenciar_rotinas',
      descricao: 'Lista, pausa, retoma, exclui, duplica (com ajustes opcionais) ou edita as rotinas agendadas de quem está falando com você. A cópia nasce pausada para revisar.',
      schema,
      risco: 'acao',
      permitido: pode('assistant.use'),
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const t = ctx.usuario.ctx.tenantId;
        const fmt = (d: Date | null) => d?.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) ?? null;
        if (e.acao === 'listar') {
          const rs = await this.prisma.assistantRoutine.findMany({ where: { tenantId: t, userId: ctx.usuario.id }, orderBy: { createdAt: 'asc' } });
          return { rotinas: rs.map((r) => ({ rotinaId: r.id, titulo: r.title, quando: descreverAgenda(FerramentasAssistente.agendaDe(r)), ativa: r.active, aprovacao: r.approval === 'automatico' ? 'automática' : 'pede confirmação', proxima: r.active ? fmt(r.nextAt) : null, ultima: fmt(r.lastAt), emails: r.emails, instrucao: r.instruction })) };
        }
        if (!e.rotinaId) throw new BadRequestException('Diga qual rotina (rotinaId).');
        const r = await this.prisma.assistantRoutine.findFirst({ where: { id: e.rotinaId, tenantId: t, userId: ctx.usuario.id } });
        if (!r) throw new BadRequestException('Rotina não encontrada.');
        const atual = FerramentasAssistente.agendaDe(r);
        const mudouAgenda = e.horario || e.intervaloMinutos || e.janela || e.dias;
        const agenda: Agenda = mudouAgenda ? this.montarAgenda({ horario: e.horario ?? (e.intervaloMinutos ? undefined : r.time), intervaloMinutos: e.intervaloMinutos ?? (e.horario ? undefined : (r.intervalMin ?? undefined)), janela: e.janela ?? (r.windowStart && r.windowEnd ? { inicio: r.windowStart, fim: r.windowEnd } : undefined), dias: e.dias ?? (r.days as number[]) }) : atual;
        if (e.aprovarAutomaticamente && !ctx.podeAutomatico) throw new BadRequestException('Você não pode ligar a aprovação automática (regra da empresa em Assistente › Configurar).');
        const campos = { approval: e.aprovarAutomaticamente === undefined ? r.approval : e.aprovarAutomaticamente ? 'automatico' : 'perguntar', title: e.titulo ?? r.title, instruction: e.instrucao ?? r.instruction, kind: agenda.tipo, time: agenda.horario, intervalMin: agenda.intervaloMin ?? null, windowStart: agenda.janelaInicio ?? null, windowEnd: agenda.janelaFim ?? null, days: agenda.dias, emails: e.emails ?? (r.emails as string[]) };
        if (e.acao === 'duplicar') {
          const c = await this.prisma.assistantRoutine.create({ data: { tenantId: t, userId: ctx.usuario.id, ...campos, title: e.titulo ?? `${r.title} (cópia)`, active: false, nextAt: proximaDaRotina(agenda) } });
          return { duplicada: true, rotinaId: c.id, titulo: c.title, quando: descreverAgenda(agenda), ativa: false, observacao: 'A cópia nasce pausada: retome quando estiver certa.' };
        }
        if (e.acao === 'editar') {
          const c = await this.prisma.assistantRoutine.update({ where: { id: r.id }, data: { ...campos, nextAt: proximaDaRotina(agenda) } });
          return { editada: true, titulo: c.title, quando: descreverAgenda(agenda), proxima: fmt(c.nextAt) };
        }
        if (e.acao === 'excluir') await this.prisma.assistantRoutine.delete({ where: { id: r.id } });
        else await this.prisma.assistantRoutine.update({ where: { id: r.id }, data: { active: e.acao === 'retomar', ...(e.acao === 'retomar' ? { nextAt: proximaDaRotina(atual) } : {}) } });
        return { ok: true, rotina: r.title, acao: e.acao };
      },
    };
  }

  private registrarPedido(): Ferramenta {
    const schema = z.object({
      tipo: z.enum(['configurar', 'desenvolver']).describe('configurar = dá para montar com as configurações que o sistema já tem; desenvolver = precisa de tela, relatório, integração ou regra nova (código)'),
      titulo: z.string().trim().min(5).max(150),
      especificacao: z.string().trim().min(20).max(6000).describe('O que a pessoa quer, para quem, regras, exemplos e como saber que ficou pronto'),
      plano: z.array(z.string().max(300)).min(1).max(15).describe('Passos para entregar'),
      modulo: z.string().max(40).optional(),
      prioridade: z.enum(['baixa', 'normal', 'alta', 'urgente']).optional(),
    });
    return {
      nome: 'registrar_pedido',
      descricao: 'Registra uma necessidade que as ferramentas atuais não resolvem: vira um pedido com especificação e plano para a equipe da Wide (e um e-mail para o suporte, se configurado). Use depois de entender bem o pedido e de mostrar o plano à pessoa.',
      schema,
      risco: 'acao',
      permitido: () => true,
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const t = ctx.usuario.ctx.tenantId;
        const p = await this.prisma.$transaction(async (tx) => {
          const [n] = await tx.$queryRaw<Array<{ value: number }>>`
            INSERT INTO tenant_sequence (tenant_id, name, value) VALUES (${t}, 'assistant_request', 1)
            ON CONFLICT (tenant_id, name) DO UPDATE SET value = tenant_sequence.value + 1 RETURNING value`;
          return tx.assistantRequest.create({ data: { tenantId: t, number: Number(n!.value), sessionId: ctx.sessaoId, userId: ctx.usuario.id, kind: e.tipo, title: e.titulo, spec: e.especificacao, plan: e.plano, module: e.modulo ?? null, priority: e.prioridade ?? 'normal' } });
        });
        const destino = process.env.EMAIL_SUPORTE?.trim();
        const corpo = `${ctx.usuario.nome} pediu pelo Assistente (${e.tipo}).\n\n${e.especificacao}\n\nPlano sugerido:\n${e.plano.map((x, i) => `${i + 1}. ${x}`).join('\n')}`;
        if (destino) await this.email.enviar(destino, `[Mercearia] Pedido nº ${p.number} (assistente) · ${e.titulo}`, corpo).catch(() => undefined);
        return { pedido: p.number, status: 'novo' };
      },
    };
  }

  private listarPedidos(): Ferramenta {
    const schema = z.object({ status: z.enum(['novo', 'em_analise', 'em_andamento', 'pronto', 'recusado']).optional() });
    return {
      nome: 'listar_pedidos',
      descricao: 'Pedidos de configuração e desenvolvimento já registrados (os da pessoa; a gestão vê todos), com a situação de cada um.',
      schema,
      risco: 'leitura',
      permitido: () => true,
      executar: async (e: z.infer<typeof schema>, ctx) => {
        const todos = can(ctx.usuario, 'settings.manage');
        const r = await this.prisma.assistantRequest.findMany({ where: { tenantId: ctx.usuario.ctx.tenantId, ...(todos ? {} : { userId: ctx.usuario.id }), ...(e.status ? { status: e.status } : {}) }, orderBy: { createdAt: 'desc' }, take: 30, select: { number: true, kind: true, title: true, status: true, createdAt: true } });
        return { pedidos: r };
      },
    };
  }
}
