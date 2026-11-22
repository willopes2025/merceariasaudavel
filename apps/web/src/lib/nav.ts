/**
 * Menu da Mercearia Saudável: as áreas da proposta (Vender, Operar, Crescer,
 * Gerir). Cada item diz em que fase fica pronto; o que ainda não existe abre
 * uma página "em construção" explicando o que vai ter ali.
 */
export interface NavItem {
  label: string;
  path: string;
  /** Permissão para ver o item (o servidor confere de novo). */
  permission?: string;
  /** 0 = pronto. Maior = fase em que entra. */
  phase: number;
  /** O que vai ter na tela (mostrado enquanto não fica pronta). */
  description?: string;
}

export interface NavGroup {
  key: string;
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    key: 'inicio',
    label: 'Gestão',
    items: [
      { label: 'Painel do dia', path: '/', phase: 0 },
      { label: 'Assistente', path: '/assistente', phase: 0, permission: 'assistant.use' },
      { label: 'Metas', path: '/metas', phase: 0, permission: 'report.view' },
      { label: 'Resumo do período', path: '/resumo', phase: 0, permission: 'report.view' },
      { label: 'Câmeras: fluxo e conversão', path: '/cameras', phase: 0, permission: 'report.view' },
    ],
  },
  {
    key: 'vender',
    label: 'Vender',
    items: [
      { label: 'Caixa (PDV)', path: '/vender', phase: 0, permission: 'sale.create' },
      { label: 'Vendas', path: '/vendas', phase: 0, permission: 'sale.create' },
      { label: 'Abrir e fechar caixa', path: '/caixa', phase: 0, permission: 'cash.operate' },
      { label: 'App e cardápio', path: '/app-cardapio', phase: 0, permission: 'customer.view' },
      { label: 'Pagamento no app e no totem', path: '/pagamento-online', phase: 0, permission: 'settings.manage' },
      { label: 'Loja online', path: '/loja-online', phase: 0, permission: 'report.view' },
      { label: 'iFood e marketplaces', path: '/marketplaces', phase: 0, permission: 'order.prepare' },
    ],
  },
  {
    key: 'operar',
    label: 'Operar',
    items: [
      { label: 'Tela de preparo', path: '/preparo', phase: 0, permission: 'order.prepare' },
      { label: 'Produtos', path: '/produtos', phase: 0, permission: 'stock.view' },
      { label: 'Estoque', path: '/estoque', phase: 0, permission: 'stock.view' },
      { label: 'Validades', path: '/validades', phase: 0, permission: 'stock.view' },
      { label: 'Contagem de insumos', path: '/insumos/contagem', phase: 0, permission: 'stock.loss' },
      { label: 'Perdas e fichas técnicas', path: '/insumos/perdas', phase: 0, permission: 'report.view' },
      { label: 'Inteligência de estoque', path: '/inteligencia-estoque', phase: 0, permission: 'stock.view' },
      { label: 'Pedidos de compra', path: '/compras', phase: 0, permission: 'purchase.manage' },
      { label: 'Fornecedores', path: '/fornecedores', phase: 0, permission: 'stock.view' },
      { label: 'Entregas', path: '/entregas', phase: 0, permission: 'order.prepare' },
    ],
  },
  {
    key: 'crescer',
    label: 'Crescer',
    items: [
      { label: 'Clientes e membros', path: '/clientes', phase: 0, permission: 'customer.view' },
      { label: 'WhatsApp com IA', path: '/whatsapp', phase: 0, permission: 'customer.view' },
      { label: 'Recompra e relacionamento', path: '/recompra', phase: 0, permission: 'customer.view' },
      { label: 'Campanhas e cupons', path: '/campanhas', phase: 0, permission: 'campaign.manage' },
      { label: 'Parceiros (nutris e personais)', path: '/parceiros', phase: 0, permission: 'partner.manage' },
      { label: 'Kits', path: '/kits', phase: 0, permission: 'partner.manage' },
      { label: 'Disparos e anúncios', path: '/disparos', phase: 0, permission: 'campaign.manage' },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro e fiscal',
    items: [
      { label: 'DRE', path: '/dre', phase: 0, permission: 'finance.view' },
      { label: 'Fluxo de caixa', path: '/fluxo', phase: 0, permission: 'finance.view' },
      { label: 'Contas a receber', path: '/receber', phase: 0, permission: 'finance.view' },
      { label: 'Contas a pagar', path: '/pagar', phase: 0, permission: 'finance.view' },
      { label: 'Contas e bancos', path: '/contas', phase: 0, permission: 'finance.view' },
      { label: 'Conciliação bancária', path: '/conciliacao', phase: 0, permission: 'finance.view' },
      { label: 'Orçamento', path: '/orcamento', phase: 0, permission: 'finance.view' },
      { label: 'Plano de contas', path: '/plano-de-contas', phase: 0, permission: 'finance.view' },
      { label: 'Notas fiscais', path: '/fiscal', phase: 0, permission: 'fiscal.view' },
    ],
  },
  {
    key: 'equipe',
    label: 'Equipe',
    items: [
      { label: 'Bater ponto', path: '/bater-ponto', phase: 0 },
      { label: 'Ponto', path: '/ponto', phase: 0, permission: 'hr.manage' },
      { label: 'Funcionários', path: '/funcionarios', phase: 0, permission: 'hr.manage' },
      { label: 'Comissões', path: '/comissoes', phase: 0, permission: 'finance.view' },
    ],
  },
  {
    key: 'configuracoes',
    label: 'Configurações',
    items: [
      { label: 'Loja', path: '/configuracoes/lojas', phase: 0, permission: 'settings.manage' },
      { label: 'Usuários', path: '/configuracoes/usuarios', phase: 0, permission: 'user.manage' },
      { label: 'Clube e cashback', path: '/configuracoes/clube', phase: 0, permission: 'settings.manage' },
      { label: 'Categorias', path: '/configuracoes/categorias', phase: 0, permission: 'product.manage' },
      { label: 'Telas de TV', path: '/configuracoes/tv', phase: 0, permission: 'goal.manage' },
      { label: 'Entrega', path: '/configuracoes/entrega', phase: 0, permission: 'settings.manage' },
      { label: 'Nota fiscal', path: '/configuracoes/fiscal', phase: 0, permission: 'settings.manage' },
      { label: 'Importar planilha', path: '/configuracoes/importar', phase: 0, permission: 'settings.manage' },
      { label: 'Auditoria', path: '/configuracoes/auditoria', phase: 0, permission: 'user.manage' },
      { label: 'Ajuda', path: '/ajuda', phase: 0 },
    ],
  },
];

/** Só o que a pessoa pode ver; grupo vazio some. */
export function visibleNav(can: (permission?: string) => boolean): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => can(i.permission)) })).filter((g) => g.items.length > 0);
}

/** Itens que ainda não têm tela: viram a página "em construção". */
export function upcomingItems(): NavItem[] {
  return NAV.flatMap((g) => g.items).filter((i) => i.phase > 0);
}

/** Item do menu da página aberta (o mais específico vence). */
export function activePath(pathname: string): string | undefined {
  const paths = NAV.flatMap((g) => g.items.map((i) => i.path)).sort((a, b) => b.length - a.length);
  return paths.find((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)));
}
