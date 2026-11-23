import { z } from 'zod';

/** Pendências de implantação: o que a loja precisa enviar ou configurar para o sistema operar com dados reais. */

export const SETUP_STATUS = { pendente: 'Pendente', recebido: 'Recebido', concluido: 'Concluído', nao_se_aplica: 'Não se aplica' } as const;
export type SetupStatus = keyof typeof SETUP_STATUS;

export interface SetupDef {
  key: string;
  title: string;
  /** Tela onde o item é configurado. */
  path?: string;
}
export const SETUP_GROUPS: Array<{ group: string; hint?: string; items: SetupDef[] }> = [
  {
    group: 'Empresa e nota fiscal',
    items: [
      { key: 'empresa.dados', title: 'Razão social, nome fantasia, CNPJ e inscrição estadual', path: '/configuracoes/lojas' },
      { key: 'empresa.endereco', title: 'Endereço completo da loja, telefone e e-mail de contato', path: '/configuracoes/lojas' },
      { key: 'empresa.regime', title: 'Regime tributário e alíquota média de imposto sobre a venda', path: '/dre' },
      { key: 'fiscal.certificado', title: 'Certificado digital A1 da empresa (arquivo e senha)', path: '/configuracoes/fiscal' },
      { key: 'fiscal.csc', title: 'Código CSC e ID do CSC, gerados no site da SEFAZ', path: '/configuracoes/fiscal' },
      { key: 'fiscal.serie', title: 'Série e próximo número da NFC-e', path: '/configuracoes/fiscal' },
      { key: 'fiscal.contador', title: 'Nome e contato do contador, para confirmar NCM e tributação' },
      { key: 'empresa.logo', title: 'Logo em boa resolução' },
    ],
  },
  {
    group: 'Produtos e estoque',
    items: [
      { key: 'produtos.planilha', title: 'Planilha de produtos: nome, código, código de barras, categoria, preços, custo, estoque, NCM e unidade', path: '/configuracoes/importar' },
      { key: 'produtos.minimo', title: 'Estoque mínimo de cada produto', path: '/produtos' },
      { key: 'produtos.lotes', title: 'Produtos que controlam lote e validade, com os lotes e vencimentos do estoque atual', path: '/estoque' },
      { key: 'produtos.fichas', title: 'Fichas técnicas dos shakes e sorvetes: insumos e quantidade por preparo', path: '/produtos' },
      { key: 'produtos.opcoes', title: 'Opções de montagem: tamanhos, sabores, adicionais e preços', path: '/produtos' },
      { key: 'produtos.fotos', title: 'Fotos dos produtos, para o app e a loja online', path: '/produtos' },
      { key: 'produtos.fornecedores', title: 'Lista de fornecedores: nome, CNPJ, contato e prazo de entrega', path: '/fornecedores' },
    ],
  },
  {
    group: 'Clientes e clube',
    items: [
      { key: 'clientes.planilha', title: 'Planilha de clientes: nome, celular, e-mail, CPF, nascimento e se já é membro', path: '/configuracoes/importar' },
      { key: 'clientes.clube', title: 'Regras do clube: percentual de cashback, validade do saldo e como virar membro', path: '/configuracoes/clube' },
      { key: 'clientes.parceiros', title: 'Parceiros (nutricionistas, personais): contato, desconto e comissão', path: '/parceiros' },
      { key: 'clientes.campanhas', title: 'Campanhas e cupons que já estão valendo', path: '/campanhas' },
    ],
  },
  {
    group: 'Financeiro',
    items: [
      { key: 'fin.taxas', title: 'Taxa e prazo de cada forma de pagamento na maquininha (débito, crédito, parcelado, Pix)', path: '/receber' },
      { key: 'fin.contas', title: 'Contas bancárias e o saldo de cada uma na data de início', path: '/contas' },
      { key: 'fin.pagar', title: 'Contas a pagar em aberto: descrição, valor, vencimento e fornecedor', path: '/pagar' },
      { key: 'fin.fixas', title: 'Despesas fixas do mês: aluguel, energia, internet, salários, contador', path: '/pagar' },
      { key: 'fin.ofx', title: 'Extrato de cada banco em OFX, para a primeira conciliação', path: '/conciliacao' },
      { key: 'fin.ifood', title: 'Comissão do iFood e prazo de repasse, se a loja vende por lá', path: '/receber' },
    ],
  },
  {
    group: 'Equipe',
    items: [
      { key: 'equipe.funcionarios', title: 'De cada funcionário: nome, CPF, admissão, cargo e salário', path: '/funcionarios' },
      { key: 'equipe.escala', title: 'Escala de trabalho de cada pessoa: dias, horários e intervalo', path: '/funcionarios' },
      { key: 'equipe.comissao', title: 'Percentual de comissão sobre vendas, para quem recebe', path: '/funcionarios' },
      { key: 'equipe.usuarios', title: 'E-mail de cada pessoa que vai acessar o sistema e o que cada uma pode fazer', path: '/configuracoes/usuarios' },
      { key: 'equipe.ponto', title: 'Regras de ponto: tolerância de atraso e banco de horas', path: '/ponto' },
      { key: 'equipe.feriados', title: 'Feriados locais', path: '/ponto' },
    ],
  },
  {
    group: 'Entrega e loja online',
    items: [
      { key: 'entrega.bairros', title: 'Bairros atendidos e a taxa de entrega de cada um', path: '/configuracoes/entrega' },
      { key: 'entrega.minimo', title: 'Pedido mínimo, se houver', path: '/configuracoes/entrega' },
      { key: 'entrega.horario', title: 'Horário de funcionamento da loja e da entrega', path: '/configuracoes/lojas' },
      { key: 'entrega.textos', title: 'Textos da loja online: apresentação e política de troca' },
      { key: 'entrega.dominio', title: 'Endereço (domínio) que as clientes vão usar para comprar' },
    ],
  },
  {
    group: 'Contas de terceiros',
    hint: 'Cada integração é opcional: sem a conta, a função fica desligada e o resto funciona. As chaves são cadastradas direto no servidor, nunca por mensagem.',
    items: [
      { key: 'int.mercadopago', title: 'Mercado Pago: conta da empresa e chave de acesso (pagamento pelo app)', path: '/configuracoes/entrega' },
      { key: 'int.whatsapp', title: 'WhatsApp: número de atendimento e provedor (Z-API ou API oficial da Meta)', path: '/whatsapp' },
      { key: 'int.ifood', title: 'iFood: chaves do Portal do Desenvolvedor e "código PDV" de cada item do cardápio', path: '/marketplaces' },
      { key: 'int.email', title: 'E-mail: servidor, usuário e senha da conta de envio' },
      { key: 'int.cameras', title: 'Câmeras: marca e modelo das câmeras e do gravador', path: '/cameras' },
      { key: 'int.assistente', title: 'Assistente: chave de acesso do serviço de inteligência artificial', path: '/assistente' },
    ],
  },
  {
    group: 'Equipamentos da loja',
    items: [
      { key: 'equip.caixa', title: 'Computador ou tablet do caixa: marca, modelo e sistema' },
      { key: 'equip.leitor', title: 'Leitor de código de barras' },
      { key: 'equip.impressora', title: 'Impressora de cupom: marca e modelo' },
      { key: 'equip.preparo', title: 'Aparelho para a tela de preparo', path: '/preparo' },
      { key: 'equip.totem', title: 'Aparelho para o totem de autoatendimento, se for usar' },
      { key: 'equip.ponto', title: 'Aparelho da loja para o ponto, ou cada pessoa pelo próprio celular', path: '/ponto' },
    ],
  },
];
export const SETUP_KEYS = SETUP_GROUPS.flatMap((g) => g.items.map((i) => i.key));

export const setupUpdateSchema = z.object({
  status: z.enum(Object.keys(SETUP_STATUS) as [SetupStatus, ...SetupStatus[]]),
  note: z.string().trim().max(500).nullish(),
});
export type SetupUpdateInput = z.infer<typeof setupUpdateSchema>;

export interface SetupItemRow extends SetupDef {
  status: SetupStatus;
  note: string | null;
  updatedBy: string | null;
  updatedAt: string | null;
  /** O que o sistema já enxerga sobre o item (ex.: "128 produtos cadastrados"). Vazio = não dá para conferir sozinho. */
  detected: string | null;
}
export interface SetupReport {
  groups: Array<{ group: string; hint?: string; items: SetupItemRow[] }>;
  total: number;
  /** Concluídos + não se aplica. */
  done: number;
  received: number;
}
