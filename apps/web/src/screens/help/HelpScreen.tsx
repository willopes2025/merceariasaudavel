import { useState } from 'react';
import { Link } from 'react-router-dom';
import { can } from '../../lib/api';
import { PageHeader } from '../../components/ui';

interface Passo { titulo: string; texto: string; tela?: [string, string]; permissao?: string }
interface Capitulo { titulo: string; resumo: string; passos: Passo[] }

const MANUAL: Capitulo[] = [
  {
    titulo: 'Rotina do dia',
    resumo: 'O caminho de quem abre, vende e fecha a loja.',
    passos: [
      { titulo: 'Abrir o caixa', texto: 'Informe o dinheiro que está na gaveta. Sem caixa aberto o sistema não deixa vender.', tela: ['/caixa', 'Abrir e fechar caixa'], permissao: 'cash.operate' },
      { titulo: 'Vender', texto: 'Busque o produto pelo nome ou passe o código de barras. Identifique a cliente pelo celular para ela pagar o preço de membro e juntar cashback. No fim, escolha a forma de pagamento.', tela: ['/vender', 'Caixa (PDV)'], permissao: 'sale.create' },
      { titulo: 'Pedidos do app e do totem', texto: 'Chegam na tela de preparo. Toque no pedido para andar: na fila, preparando, pronto, entregue.', tela: ['/preparo', 'Tela de preparo'], permissao: 'order.prepare' },
      { titulo: 'Bater o ponto', texto: 'Cada pessoa bate pelo próprio login, ou no aparelho da loja com o PIN.', tela: ['/bater-ponto', 'Bater ponto'] },
      { titulo: 'Fechar o caixa', texto: 'Conte o dinheiro e informe o valor. O sistema mostra a diferença e guarda o fechamento.', tela: ['/caixa', 'Abrir e fechar caixa'], permissao: 'cash.close' },
      { titulo: 'Olhar os avisos', texto: 'O sino no alto da tela junta o que pede atenção: conta vencida, lote vencendo, produto no mínimo, conversa esperando, nota rejeitada.' },
    ],
  },
  {
    titulo: 'Produtos e estoque',
    resumo: 'O saldo só muda por movimentação: entrada, venda, perda ou contagem.',
    passos: [
      { titulo: 'Cadastrar produto', texto: 'Nome, categoria, preço normal e preço de membro, custo e estoque mínimo. Para trazer muitos de uma vez, use a importação por planilha.', tela: ['/produtos', 'Produtos'], permissao: 'stock.view' },
      { titulo: 'Dar entrada', texto: 'Pela nota do fornecedor (XML) ou manualmente, informando lote e validade quando o produto controla lote.', tela: ['/estoque', 'Estoque'], permissao: 'stock.view' },
      { titulo: 'Validades', texto: 'Lista o que vence nos próximos dias. O sistema sempre baixa primeiro o lote que vence primeiro.', tela: ['/validades', 'Validades'], permissao: 'stock.view' },
      { titulo: 'Shakes e sorvetes', texto: 'Produto preparado usa ficha técnica: cada venda baixa os insumos. A contagem do dia mostra a perda real.', tela: ['/insumos/contagem', 'Contagem de insumos'], permissao: 'stock.loss' },
      { titulo: 'Comprar', texto: 'A inteligência de estoque sugere o que comprar pelo giro; daí sai o pedido de compra para o fornecedor.', tela: ['/inteligencia-estoque', 'Inteligência de estoque'], permissao: 'stock.view' },
    ],
  },
  {
    titulo: 'Clientes e vendas a mais',
    resumo: 'Clube, cashback, campanhas, WhatsApp e parceiros.',
    passos: [
      { titulo: 'Clube e cashback', texto: 'Membro paga o preço de membro e junta cashback para a próxima compra. As regras ficam em Configurações.', tela: ['/configuracoes/clube', 'Clube e cashback'], permissao: 'settings.manage' },
      { titulo: 'Recompra', texto: 'Mostra quem está na hora de comprar de novo, pelo ritmo da cliente ou pela duração do produto, e quem sumiu.', tela: ['/recompra', 'Recompra e relacionamento'], permissao: 'customer.view' },
      { titulo: 'Campanhas e cupons', texto: 'Oferta por produto ou categoria, cupom com limite de uso e cashback turbinado.', tela: ['/campanhas', 'Campanhas e cupons'], permissao: 'campaign.manage' },
      { titulo: 'WhatsApp com IA', texto: 'A IA responde as clientes, consulta preço e estoque e monta o carrinho. Quando não sabe, passa para a equipe.', tela: ['/whatsapp', 'WhatsApp com IA'], permissao: 'customer.view' },
      { titulo: 'Disparos', texto: 'Mensagem para um grupo de clientes, com o nome de cada uma. Depois mostra quanto voltou em venda.', tela: ['/disparos', 'Disparos e anúncios'], permissao: 'campaign.manage' },
      { titulo: 'iFood', texto: 'Os pedidos entram sozinhos na tela de preparo e viram venda. O produto é reconhecido pelo código PDV do cardápio do iFood.', tela: ['/marketplaces', 'iFood e marketplaces'], permissao: 'order.prepare' },
      { titulo: 'Fluxo de pessoas', texto: 'Quantas pessoas entraram, quantas compraram e os horários de pico, pela contagem das câmeras ou digitada.', tela: ['/cameras', 'Câmeras'], permissao: 'report.view' },
      { titulo: 'Parceiros', texto: 'Nutricionistas e personais indicam com um código: a cliente ganha desconto e o parceiro, comissão.', tela: ['/parceiros', 'Parceiros'], permissao: 'partner.manage' },
    ],
  },
  {
    titulo: 'Financeiro',
    resumo: 'O que vem das vendas o sistema calcula sozinho; você lança as despesas.',
    passos: [
      { titulo: 'Contas a pagar', texto: 'Lance cada despesa com a conta do plano de contas, o vencimento e, se quiser, o fornecedor. Ao pagar, escolha de qual conta saiu o dinheiro.', tela: ['/pagar', 'Contas a pagar'], permissao: 'finance.view' },
      { titulo: 'Contas a receber', texto: 'Cartão, Pix e app viram recebíveis com a taxa e o prazo de cada forma de pagamento. Dê baixa quando cair.', tela: ['/receber', 'Contas a receber'], permissao: 'finance.view' },
      { titulo: 'Contas e bancos', texto: 'Caixa, contas bancárias e carteiras, com saldo e extrato. Informe o saldo inicial e a data.', tela: ['/contas', 'Contas e bancos'], permissao: 'finance.view' },
      { titulo: 'Conciliação bancária', texto: 'Suba o extrato do banco em OFX. O sistema casa o que reconhece e você resolve o resto linha a linha.', tela: ['/conciliacao', 'Conciliação bancária'], permissao: 'finance.view' },
      { titulo: 'DRE', texto: 'Resultado por competência (quando vendeu) ou por caixa (quando o dinheiro entrou), por canal de venda. Clique numa linha para abrir os lançamentos.', tela: ['/dre', 'DRE'], permissao: 'finance.view' },
      { titulo: 'Orçamento', texto: 'Defina quanto espera em cada linha do DRE no mês e acompanhe o que passou do combinado.', tela: ['/orcamento', 'Orçamento'], permissao: 'finance.view' },
      { titulo: 'Fluxo de caixa', texto: 'O que já entrou e saiu e o que está previsto, dia a dia, com o saldo projetado.', tela: ['/fluxo', 'Fluxo de caixa'], permissao: 'finance.view' },
    ],
  },
  {
    titulo: 'Equipe',
    resumo: 'Cadastro, ponto, folha e comissões.',
    passos: [
      { titulo: 'Funcionários', texto: 'Cadastro com escala de trabalho, salário, comissão sobre vendas e o usuário do sistema de cada pessoa.', tela: ['/funcionarios', 'Funcionários'], permissao: 'hr.manage' },
      { titulo: 'Ponto', texto: 'Veja quem está trabalhando, corrija batidas com motivo, lance atestado e férias, feche o mês e gere o arquivo AFD.', tela: ['/ponto', 'Ponto'], permissao: 'hr.manage' },
      { titulo: 'Comissões', texto: 'Quanto cada pessoa vendeu no período e a comissão pelo percentual do cadastro.', tela: ['/comissoes', 'Comissões'], permissao: 'finance.view' },
      { titulo: 'Usuários e permissões', texto: 'Cada pessoa entra com o próprio e-mail e só vê o que o papel dela permite.', tela: ['/configuracoes/usuarios', 'Usuários'], permissao: 'user.manage' },
      { titulo: 'Auditoria', texto: 'Mostra quem alterou o quê e quando. Não dá para apagar.', tela: ['/configuracoes/auditoria', 'Auditoria'], permissao: 'user.manage' },
    ],
  },
  {
    titulo: 'Primeira configuração',
    resumo: 'O que deixar pronto antes de usar de verdade.',
    passos: [
      { titulo: '1. Loja e nota fiscal', texto: 'CNPJ, endereço e os dados para emitir NFC-e.', tela: ['/configuracoes/lojas', 'Loja'], permissao: 'settings.manage' },
      { titulo: '2. Produtos e clientes', texto: 'Traga a planilha do sistema antigo.', tela: ['/configuracoes/importar', 'Importar planilha'], permissao: 'settings.manage' },
      { titulo: '3. Taxas e prazos', texto: 'Em Contas a receber, informe a taxa e o prazo de cada forma de pagamento da sua maquininha.', tela: ['/receber', 'Contas a receber'], permissao: 'finance.view' },
      { titulo: '4. Saldos iniciais', texto: 'Cadastre as contas bancárias com o saldo de hoje.', tela: ['/contas', 'Contas e bancos'], permissao: 'finance.view' },
      { titulo: '5. Equipe', texto: 'Cadastre os funcionários, a escala e o local da loja para o ponto.', tela: ['/funcionarios', 'Funcionários'], permissao: 'hr.manage' },
      { titulo: '6. Entrega e pagamento online', texto: 'Bairros e taxas de entrega, e o Mercado Pago para pagar pelo app.', tela: ['/configuracoes/entrega', 'Entrega'], permissao: 'settings.manage' },
    ],
  },
];

/** Manual dentro do sistema: o passo a passo de cada área, com atalho para a tela. */
export function HelpScreen() {
  const [busca, setBusca] = useState('');
  const termo = busca.trim().toLowerCase();
  const capitulos = MANUAL.map((c) => ({ ...c, passos: c.passos.filter((p) => !termo || `${p.titulo} ${p.texto} ${c.titulo}`.toLowerCase().includes(termo)) })).filter((c) => c.passos.length);
  return (
    <div className="max-w-4xl space-y-4">
      <PageHeader title="Ajuda" subtitle="Como usar cada parte do sistema. Clique no atalho para ir direto à tela." />
      <input className="input max-w-md" placeholder="Buscar no manual (ex.: caixa, cashback, extrato)" value={busca} onChange={(e) => setBusca(e.target.value)} />
      {!capitulos.length && <div className="card p-6 text-sm text-ink-soft">Nada encontrado para "{busca}". Pergunte ao Assistente: ele conhece os dados da loja.</div>}
      {capitulos.map((c) => (
        <section key={c.titulo} className="card p-5">
          <h2 className="font-display text-lg text-ink">{c.titulo}</h2>
          <p className="mb-3 text-sm text-ink-soft">{c.resumo}</p>
          <ul className="divide-y divide-slate-100">
            {c.passos.map((p) => (
              <li key={p.titulo} className="flex flex-wrap items-start justify-between gap-x-6 gap-y-1 py-3">
                <div className="min-w-0 flex-1 basis-80"><div className="font-medium text-ink">{p.titulo}</div><div className="text-sm text-ink-soft">{p.texto}</div></div>
                {p.tela && can(p.permissao) && <Link to={p.tela[0]} className="shrink-0 text-sm text-brand hover:underline">Ir para {p.tela[1]} →</Link>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
