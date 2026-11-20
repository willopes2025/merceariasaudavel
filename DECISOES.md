# Decisões do VISIO

Leia antes de mexer. Cada linha é uma decisão já tomada; mudar exige combinar com o Wil.

## Sistema
- VISIO é um sistema **novo e separado**: repositório próprio, banco próprio, VPS própria (Hostinger).
- Tecnologia igual à do Soul ERP: NestJS + Prisma + PostgreSQL, React, Docker + Caddy. **Sem Supabase.**
- Primeiro só para o grupo (lojas Programa Seven e James & Jesse's).

## Widezap
- O VISIO **não depende do Widezap e não fala com ele**. Nenhum código, variável ou
  passo de instalação do VISIO envolve o Widezap.
- O Widezap continua existindo como sistema à parte, onde a equipe atende hoje.
- As funções do Widezap (inbox, funis, disparos) serão **reconstruídas dentro do
  VISIO na Fase 6**. O código do Widezap serve só de referência.

## WhatsApp
- Todo envio passa por um único arquivo: `apps/api/src/modules/notify/whatsapp.sender.ts`.
- Hoje está **desligado**. Desligado significa: nada sai, a tela não oferece envio,
  e os avisos de etapa ficam registrados na O.S. como "não enviada".
- O WhatsApp próprio (número por QR Code ou oficial da Meta) entra como provedor
  nesse mesmo arquivo. O resto do sistema não muda.

## ssÓtica
- É a origem dos dados na migração (clientes já; produtos, O.S. e parcelas depois).
- Só leitura. Respeitar 60 consultas por minuto.

## Integrações definidas
- Nota fiscal: Focus NFe (Fase 5).
- Crediário: continua, com boletos pela API do Asaas e baixa automática (Fase 3B).
  Integração **direta** VISIO ↔ Asaas (decidido em 20/11/2026), **uma conta Asaas só** para as duas lojas.

## Crediário (Fase 3B)
- Até 12 parcelas mensais; o vendedor escolhe o 1º vencimento. Entrada é recebida no caixa.
- "No crediário" da O.S. = soma das parcelas em aberto. Parcela paga vira "pago".
- Com Asaas ligado, cada parcela tem um boleto (com Pix). Pagou no Asaas: baixa
  automática pelo webhook, com a data real do pagamento. Pagou na loja: entra no
  caixa e o boleto é baixado no Asaas.
- Multa e juros: os da conta Asaas. O VISIO não envia valores próprios.
- O banco grava primeiro; o Asaas é chamado depois. Falha do Asaas nunca desfaz o
  crediário: fica o alerta na parcela e dá para tentar de novo.
- Asaas começa em sandbox (`ASAAS_ENV=sandbox`). Produção só depois de um teste conferido.

## Produtos e estoque (Fase 4A)
- O saldo só muda por movimentação (`applyStock`); movimentação não se altera nem se apaga.
- A peça sai do estoque quando a O.S. é aberta; volta se a O.S. for cancelada.
  Entregue e perda não devolvem. Editar a O.S. acerta pela diferença.
- Venda sem estoque avisa, mas não bloqueia (o saldo pode ficar negativo).
- Lente sob encomenda e serviço não controlam estoque.
- Item da O.S. pode ser digitado à mão; só item ligado a produto mexe no estoque.

## Caixa (Fase 3A)
- Um caixa aberto por loja de cada vez. Todo recebimento de O.S. entra no caixa aberto.
- O "pago" da O.S. só muda pelo caixa (recebimento ou estorno), nunca pelo formulário.
- Lançamento do caixa não se altera nem se apaga; erro se corrige com estorno.
- Vendedor recebe; estornar e fechar caixa é de gerente, caixa ou proprietário.
- O.S.: as 18 etapas da Central Seven, configuráveis.

## Regras de código
- Datas "de hoje" sempre com `todayBR()` (horário de Brasília). O servidor roda em UTC.
- Dinheiro somado em centavos (`osTotals`). Total sempre calculado no servidor.
- Toda tabela nova: `tenant_id` + política de RLS na migração.
- Dentro de `$transaction(async (tx) => ...)` usar só `tx`, nunca `this.prisma`.
- Nada de `$transaction([...])` em lote: usar `Promise.all` ou transação interativa.
- Recurso opcional (como WhatsApp) entra em `GET /v1/health/features`; a tela só
  oferece o que o servidor diz que está ligado.
- Exemplo em documentação nunca pode funcionar como valor: variável com texto
  de exemplo deve ser recusada ou ignorada.
- Toda entrega: testes ponta a ponta (`npm run e2e`) passando antes do PR.

## Carga de produtos por planilha (Fase 4C)

- A planilha é a exportação de produtos do ssÓtica (.xlsx). O navegador lê o arquivo e manda as linhas para `POST /v1/products/import`; o servidor decide tudo.
- Sempre simula antes (`dryRun` é o padrão). O botão de importar só libera depois da simulação.
- Produto que já existe (mesma referência) **não é alterado** — só recebe NCM/CEST/unidade/fornecedor se estiverem vazios. Importar duas vezes não duplica.
- Estoque da planilha só entra para produto novo, só se for positivo e só se a loja for escolhida. Negativo vira zero, com aviso.

## Estoque compartilhado

- Uma loja pode usar o estoque de outra (`store.stock_store_id`). No Grupo Seven, a James & Jesse's usa o estoque da Programa Seven.
- A troca acontece num lugar só (`stockStoreOf` em `products/stock.ts`): toda entrada, saída, venda e carga cai na loja que guarda o estoque. Não há corrente (A usa B que usa C).
- A tela mostra uma coluna só, com o nome das duas lojas. Transferência entre lojas que dividem o estoque é recusada.

## Fiscal (Fase 5A): NFC-e pela Focus NFe

- Configuração **por loja**, na tela Configurações → Fiscal. Nasce desligada; só emite com a loja ligada, CNPJ no cadastro e token do ambiente gravado.
- Os tokens da Focus ficam no banco **cifrados** (AES-256-GCM com chave derivada do `JWT_SECRET`) e nunca voltam para a tela nem entram no histórico. Trocar o `JWT_SECRET` obriga a colar os tokens de novo.
- Texto de exemplo não é aceito como token (`looksLikeFocusToken`).
- Certificado digital e CSC ficam só na Focus NFe.
- A nota é gravada **antes** de ser enviada, com uma referência única. Se a resposta se perder, fica "Processando" e o botão Atualizar consulta pela mesma referência: nunca emite duas vezes.
- Uma nota ativa (autorizada ou processando) por O.S. Rejeitada ou cancelada libera nova emissão.
- Serviço não entra na NFC-e. Pagamentos da nota: o que já entrou no caixa, por forma; o resto vai como "crédito loja" (05). A soma sempre bate com o total.
- Nota fiscal não se apaga (sem DELETE para `mercearia_app`).
- `FOCUS_NFE_BASE_URL` existe só para os testes.

## Entrada de mercadoria por XML (Fase 5B)

- O servidor é quem lê o XML da NF-e do fornecedor (`products/nfe-xml.ts`); a tela só escolhe, item a item: cadastrar novo, vincular a um produto existente ou ignorar. A prévia não grava nada.
- Uma nota entra uma vez só: chave de acesso única em `stock_entry` (tabela só de inserção).
- A entrada inteira é uma transação: se um item falha, nada fica gravado.
- O custo do produto passa a ser o da última compra; preço de venda nunca muda. NCM e unidade só entram se estavam vazios.
- O VISIO lembra a ligação "código do fornecedor → produto" (`supplier_product`) para a nota seguinte do mesmo CNPJ. Sem essa memória, só casa por código de barras igual ao código do produto.
- Quantidade quebrada (1,5) não entra: o estoque é em peças inteiras.
- As duplicatas da nota viram contas a pagar (categoria Fornecedor), se a pessoa deixar marcado.
