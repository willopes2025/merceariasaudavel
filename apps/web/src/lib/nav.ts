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
      { label: 'Metas', path: '/metas', phase: 0, permission: 'report.view' },
      { label: 'Resumo do período', path: '/resumo', phase: 0, permission: 'report.view' },
      { label: 'Câmeras com IA', path: '/cameras', phase: 3, permission: 'report.view', description: 'As câmeras Intelbras contam quem entra na loja e o sistema mostra a conversão real do balcão, os horários de pico e as filas. Contagem anônima, sem reconhecimento facial.' },
    ],
  },
  {
    key: 'vender',
    label: 'Vender',
    items: [
      { label: 'Caixa (PDV)', path: '/vender', phase: 0, permission: 'sale.create' },
      { label: 'Vendas', path: '/vendas', phase: 0, permission: 'sale.create' },
      { label: 'Abrir e fechar caixa', path: '/caixa', phase: 0, permission: 'cash.operate' },
      { label: 'App da cliente', path: '/app', phase: 2, description: 'Aplicativo na Play Store e na App Store: quem instala vira membro, paga o preço de membro, tem carteirinha com QR, cashback, notificações e pede shake para buscar pronto.' },
      { label: 'Totem e cardápio QR', path: '/totem', phase: 2, description: 'A cliente monta o shake ou o sorvete, paga sozinha e o pedido vai para a tela de preparo.' },
      { label: 'Loja online', path: '/loja-online', phase: 2, description: 'Site de vendas ligado ao mesmo estoque, com frete, retirada na loja e recuperação de carrinho pelo WhatsApp.' },
      { label: 'Marketplaces e iFood', path: '/marketplaces', phase: 2, description: 'Mercado Livre, Shopee, Amazon, iFood e 99Food com estoque e preço sincronizados e os pedidos caindo na mesma central.' },
    ],
  },
  {
    key: 'operar',
    label: 'Operar',
    items: [
      { label: 'Produtos', path: '/produtos', phase: 0, permission: 'stock.view' },
      { label: 'Estoque', path: '/estoque', phase: 0, permission: 'stock.view' },
      { label: 'Validades', path: '/validades', phase: 0, permission: 'stock.view' },
      { label: 'Contagem de insumos', path: '/insumos/contagem', phase: 0, permission: 'stock.loss' },
      { label: 'Perdas e fichas técnicas', path: '/insumos/perdas', phase: 0, permission: 'report.view' },
      { label: 'Inteligência de estoque', path: '/inteligencia-estoque', phase: 3, permission: 'stock.view', description: 'Curva ABC, giro, previsão de falta e o pedido de compra sugerido por fornecedor.' },
      { label: 'Entregas', path: '/entregas', phase: 2, description: 'Motoboy com rota, iFood, 99Food, Correios e retirada na loja num lugar só.' },
    ],
  },
  {
    key: 'crescer',
    label: 'Crescer',
    items: [
      { label: 'Clientes e membros', path: '/clientes', phase: 0, permission: 'customer.view' },
      { label: 'WhatsApp com IA', path: '/whatsapp', phase: 2, description: 'Inbox da equipe, catálogo na conversa e agente de IA que tira dúvida e monta o carrinho.' },
      { label: 'Recompra automática', path: '/recompra', phase: 3, description: 'Avisa a cliente antes do whey acabar, com o mesmo pedido pronto para repetir.' },
      { label: 'Parceiros (nutris e personais)', path: '/parceiros', phase: 3, description: 'Cupom de cada parceiro, comissão automática e prescrição com um clique.' },
      { label: 'Montador de kit', path: '/montador', phase: 3, description: 'A cliente diz o objetivo e a IA monta a cesta com o que tem em estoque.' },
      { label: 'Campanhas', path: '/campanhas', phase: 3, description: 'Disparos segmentados e rastreio de vendas vindas do Meta Ads e do Google Ads.' },
    ],
  },
  {
    key: 'financeiro',
    label: 'Financeiro e fiscal',
    items: [
      { label: 'Contas a pagar', path: '/pagar', phase: 0, permission: 'finance.view' },
      { label: 'Notas fiscais', path: '/fiscal', phase: 0, permission: 'fiscal.view' },
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
      { label: 'Nota fiscal', path: '/configuracoes/fiscal', phase: 0, permission: 'settings.manage' },
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
