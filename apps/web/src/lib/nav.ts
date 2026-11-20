/**
 * Menu do Mercearia: os 12 grupos do documento de arquitetura. Cada item diz em
 * que fase fica pronto; o que ainda não existe abre uma página "em construção"
 * explicando o que vai ter ali. Assim o menu já mostra o sistema inteiro.
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
    key: 'visao-geral',
    label: 'Visão Geral',
    items: [
      { label: 'Painel', path: '/', phase: 0 },
      { label: 'Painel estratégico', path: '/painel-estrategico', phase: 7, permission: 'report.view', description: 'Faturamento, conversão por operação, ticket médio e O.S. atrasadas das duas lojas.' },
    ],
  },
  {
    key: 'atendimento',
    label: 'Atendimento',
    items: [
      { label: 'Inbox', path: '/inbox', phase: 6, permission: 'crm.inbox', description: 'WhatsApp oficial, QR, Instagram e Messenger numa caixa só, com a ficha do cliente ao lado.' },
      { label: 'Tarefas', path: '/tarefas', phase: 6, description: 'Tarefas da equipe ligadas a cliente, O.S. ou cobrança.' },
      { label: 'Agenda de exames', path: '/agenda', phase: 6, description: 'Agenda do CSV e das ações do Programa Seven.' },
      { label: 'Chat interno', path: '/chat-interno', phase: 6, description: 'Conversa entre a equipe.' },
    ],
  },
  {
    key: 'vendas-crm',
    label: 'Vendas e CRM',
    items: [
      { label: 'Funis', path: '/funis', phase: 6, permission: 'crm.inbox', description: 'Um funil por operação, com cadência automática.' },
      { label: 'Orçamentos', path: '/orcamentos', phase: 0, permission: 'quote.manage', description: 'Orçamento de lente e armação, que vira O.S. com um clique.' },
      { label: 'Vendas (PDV)', path: '/vendas', phase: 3, permission: 'sale.create', description: 'Venda no balcão, importando a O.S., com várias formas de pagamento.' },
      { label: 'Promoções e cashback', path: '/promocoes', phase: 3, description: 'Regras de promoção e saldo de cashback por cliente.' },
    ],
  },
  {
    key: 'os',
    label: 'Ordens de Serviço',
    items: [
      { label: 'Ordens de serviço', path: '/os', phase: 0, permission: 'service_order.view', description: 'Lista com filtros por etapa, situação, loja, laboratório e prazo de entrega.' },
      { label: 'Quadro por etapas', path: '/os/etapas', phase: 0, permission: 'service_order.view', description: 'As 18 etapas da O.S. em colunas, com aviso automático ao cliente a cada mudança.' },
      { label: 'Consertos', path: '/os/consertos', phase: 0, permission: 'service_order.view', description: 'O.S. de serviço: objeto, defeito relatado e serviço a realizar.' },
    ],
  },
  {
    key: 'programa-seven',
    label: 'Programa Seven',
    items: [
      { label: 'Eventos', path: '/seven/eventos', phase: 0, permission: 'seven.operate' },
      { label: 'Painel do dia', path: '/seven/painel-do-dia', phase: 0, permission: 'seven.operate' },
      { label: 'Instituições', path: '/seven/instituicoes', phase: 0, permission: 'seven.operate' },
    ],
  },
  {
    key: 'clientes',
    label: 'Clientes',
    items: [
      { label: 'Clientes', path: '/clientes', phase: 0, permission: 'customer.view' },
      { label: 'Receitas', path: '/receitas', phase: 0, permission: 'prescription.view', description: 'Receitas com validade; as vencidas voltam para o funil de recompra.' },
    ],
  },
  {
    key: 'estoque',
    label: 'Produtos e Estoque',
    items: [
      { label: 'Produtos', path: '/produtos', phase: 0, permission: 'stock.view', description: 'Armações, lentes, acessórios e serviços, com grife, cor, tamanho e formato.' },
      { label: 'Tabelas de lentes', path: '/tabelas-lentes', phase: 4, permission: 'stock.view', description: 'Preço de lente por material, tratamento e faixa de grau.' },
      { label: 'Estoque', path: '/estoque', phase: 0, permission: 'stock.view', description: 'Posição por loja, entrada por XML, transferência, acerto e inventário.' },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro',
    items: [
      { label: 'Caixa', path: '/caixa', phase: 0, permission: 'cash.operate', description: 'Abertura e fechamento por gaveta, sangria e suprimento.' },
      { label: 'Contas a receber', path: '/receber', phase: 0, permission: 'finance.view', description: 'Crediário com boletos emitidos pela API do Asaas e baixa automática.' },
      { label: 'Contas a pagar', path: '/pagar', phase: 0, permission: 'finance.view', description: 'Fornecedores, laboratórios e despesas da loja.' },
      { label: 'Resumo do período', path: '/fluxo', phase: 0, permission: 'report.view', description: 'Fluxo de caixa e DRE por loja.' },
      { label: 'Cobrança', path: '/cobranca', phase: 0, permission: 'finance.view', description: 'Régua da Cobrança Seven: parcelas vencendo e em atraso.' },
    ],
  },
  {
    key: 'fiscal',
    label: 'Fiscal',
    items: [
      { label: 'Notas fiscais', path: '/fiscal', phase: 0, permission: 'fiscal.view', description: 'NFC-e pela Focus NFe.' },
    ],
  },
  {
    key: 'marketing',
    label: 'Marketing e Automação',
    items: [
      { label: 'Disparos', path: '/disparos', phase: 6, permission: 'crm.campaigns', description: 'Campanhas por lista, com templates da Meta.' },
      { label: 'Formulários', path: '/formularios', phase: 6, permission: 'crm.campaigns', description: 'Formulários de captação que caem no funil certo.' },
      { label: 'Chatbots e agentes IA', path: '/automacoes', phase: 7, permission: 'crm.campaigns', description: 'Paola e os agentes de SDR, com cadência e passagem para humano.' },
    ],
  },
  {
    key: 'relatorios',
    label: 'Relatórios',
    items: [
      { label: 'Relatórios', path: '/relatorios', phase: 7, permission: 'report.view', description: 'Vendas, produtos vendidos e sem giro, receitas vencidas, aniversários, comissões e mais.' },
    ],
  },
  {
    key: 'configuracoes',
    label: 'Configurações',
    items: [
      { label: 'Lojas', path: '/configuracoes/lojas', phase: 0, permission: 'settings.manage' },
      { label: 'Operações', path: '/configuracoes/operacoes', phase: 0, permission: 'settings.manage' },
      { label: 'Origens do cliente', path: '/configuracoes/origens', phase: 0, permission: 'settings.manage' },
      { label: 'Convênios', path: '/configuracoes/convenios', phase: 0, permission: 'settings.manage' },
      { label: 'Médicos e optometristas', path: '/configuracoes/medicos', phase: 0, permission: 'settings.manage' },
      { label: 'Usuários', path: '/configuracoes/usuarios', phase: 0, permission: 'user.manage' },
      { label: 'Etapas de O.S.', path: '/configuracoes/etapas-os', phase: 0, permission: 'settings.manage' },
      { label: 'Fiscal', path: '/configuracoes/fiscal', phase: 0, permission: 'settings.manage' },
      { label: 'Importar do ssÓtica', path: '/configuracoes/importar', phase: 0, permission: 'settings.manage' },
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

/** Item do menu da página aberta (o mais específico vence: /os/etapas antes de /os). */
export function activePath(pathname: string): string | undefined {
  const paths = NAV.flatMap((g) => g.items.map((i) => i.path)).sort((a, b) => b.length - a.length);
  return paths.find((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(`${p}/`)));
}
