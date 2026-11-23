# Mercearia Saudável

Sistema da loja: caixa (PDV) com preço de membro e cashback, estoque com lote e
validade, shakes e sorvetes com ficha técnica e controle de perdas, metas,
painel do dia e TV. Mesma base técnica do Soul ERP e do VISIO: NestJS + Prisma +
PostgreSQL (com isolamento por RLS), React + Vite + Tailwind, Docker e Caddy na VPS.

Proposta e arquitetura completa: apresentação "Mercearia Saudável · Arquitetura do Sistema".

## O que tem (Fase 1 — loja física)

- **Caixa (PDV)**: leitor de código de barras, balança (granel por kg), cliente por
  celular/CPF, cadastro de membro na hora, preço de membro, desconto (só gerente),
  cashback, várias formas de pagamento com troco, NFC-e automática (Focus NFe).
- **Cancelamento**: estorna pelo caixa aberto, devolve o estoque nos mesmos lotes,
  desfaz o cashback e cancela a nota antes.
- **Produtos**: revenda, insumo e preparado; preço e preço de membro; lote e
  validade com saída FEFO; entrada pelo XML da nota (com o lote do fornecedor).
- **Shakes e sorvetes**: ficha técnica, baixa dos insumos na venda, contagem do
  fim do dia, perdas por motivo e margem de cada preparado.
- **Clube**: membro grátis, cashback com validade e limite de uso, extrato.
- **Gestão**: painel do dia, metas (loja, pessoa, categoria, produto; faturamento,
  ticket, itens por venda, novos membros, perda de insumos), resumo do período,
  tela de TV pública por link.
- O menu já mostra as abas das Fases 2 e 3 (totem com pedido, loja online,
  marketplaces, iFood, WhatsApp com IA, recompra, parceiros, câmeras).

## Fase 2a — app do cliente e cardápio

- **App do cliente** em `/app` (PWA instalável no Android e no iPhone): cadastro
  com nome, celular e PIN de 6 números = entra no clube. Cartão de membro com QR
  e código de 6 letras, saldo e extrato de cashback, compras, quanto já
  economizou, ofertas de membro, catálogo e perfil.
- **Cardápio público** em `/cardapio` (QR da mesa/vitrine) e **modo totem** em
  `/cardapio?totem=1` (letras grandes, QR para virar membro, volta ao começo sozinho).
- **Balcão**: o PDV acha o membro pelo código do cartão; na ficha da cliente,
  "Liberar app" gera um código provisório (primeiro acesso de quem já comprava
  ou PIN esquecido). Tela **Vender › App e cardápio** com os QR para imprimir.
- Produto ganhou descrição, foto (link) e "aparece no app".

## Fase 2b — montagem, pedidos e tela de preparo

- **Montagem do produto** (Produtos › produto › Montagem): grupos como Sabor
  (obrigatório, escolhe 1) e Adicionais (até N), cada opção com preço extra e
  insumo que baixa do estoque. Vale no caixa, no app e no totem; a nota sai com as escolhas.
- **Pedido pelo app** (cliente logada) e **pelo totem** (`/cardapio?totem=1`, nome
  para chamar + celular/cartão se for membro): paga no caixa em **Pedidos para cobrar**.
- **Tela de preparo** (`/preparo`): na fila → preparando → pronto → entregue,
  com bip de pedido novo. Venda no balcão com shake/sorvete entra sozinha na fila.
- **TV de retirada** (`/retirada`): números preparando e prontos, só primeiro nome.
- Configurações › Clube: liga/desliga pedidos do app/totem e o envio do balcão para o preparo.
- Pedido não pago em 3 h é cancelado sozinho.

## Estrutura

```
apps/api        NestJS 11 + Prisma 6 (cliente sem motor nativo + driver pg)
  prisma/       schema, migrações (com RLS) e seed
  src/modules/  iam, tenancy, customers, products, sales, cash, kitchen,
                management (metas, painel, TV), finance, fiscal, notify
apps/web        React 18 + Vite + Tailwind + TanStack Query
packages/contracts  schemas Zod e regras compartilhadas (API e telas)
scripts/        build-release, backup, atualizar, testes ponta a ponta
```

## Rodar no computador

```bash
npm install
cp apps/api/.env.example apps/api/.env      # ajuste DATABASE_URL
npm run db:deploy && npm run db:seed        # com SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
npm run dev                                  # API em :3000, sistema em :5180
npm test                                     # testes unitários
npm run e2e                                  # ponta a ponta contra um Postgres local (API com SHOP_SIGNUPS_PER_HOUR=200 PAY_PROVIDER=teste)
```

Sem acesso ao servidor de binários do Prisma, use `PRISMA_JS_ENGINE=1`.

## Publicar

Ver [DEPLOY.md](DEPLOY.md). Decisões já tomadas: [DECISOES.md](DECISOES.md).

## Fase 3a — recompra e campanhas

- **Recompra e relacionamento** (Crescer › Recompra): quem deve estar repondo
  cada produto (pelo ritmo da cliente ou pela duração cadastrada no produto),
  clientes sumidas (com quanto já gastaram e o cashback parado) e
  aniversariantes. Botão de WhatsApp com mensagem pronta (editável) e registro
  do contato. No app, a cliente vê "Hora de repor?".
- **Campanhas e cupons** (Crescer › Campanhas): cupom (% ou R$, compra mínima,
  usos no total e por cliente, só membros ou aniversariantes), cashback
  turbinado (+% em tudo, categorias ou produtos) e oferta (preço promocional).
  Período e dias da semana. Caixa, app e totem aplicam sozinhos; o caixa sugere
  o cupom do aniversariante. Cada campanha mostra vendas, faturamento e desconto.

## Fase 3b — inteligência de estoque e compras

- **Inteligência de estoque** (Operar): por loja, com o ritmo dos últimos 30 a 180 dias.
  - Curva ABC.
  - Saída por dia (venda + consumo do preparo).
  - Quantos dias o estoque dura e o giro por ano.
  - Situação: em falta, comprar agora, comprar em breve, parado, estoque demais.
  - Dinheiro parado e risco de vencer antes de vender.
- **Compra sugerida:** cobre o prazo do fornecedor, a folga escolhida e o
  estoque mínimo. Desconta o que já foi pedido e arredonda para o múltiplo de
  compra (caixa com 12). Sai agrupada por fornecedor e vira pedido com um clique.
- **Pedidos de compra:** rascunho → enviado (pelo WhatsApp do fornecedor, com o
  texto pronto) → recebido (pode dar entrada no estoque com os custos do pedido).
- **Fornecedores:** prazo de entrega, WhatsApp e pedido mínimo. Fornecedor de
  nota de entrada (XML) vira cadastro sozinho e fica como principal dos produtos da nota.

## Fase 2c — entrega

- **Configurações › Entrega:** liga/desliga, cidade, bairros atendidos (taxa,
  pedido mínimo, grátis acima de, prazo) e entregadores.
- **No app**, a cliente escolhe "Retirar na loja" ou "Receber em casa":
  - endereço salvo, com o bairro escolhido da lista de bairros atendidos;
  - taxa e prazo do bairro;
  - pagamento na entrega (Pix, cartão ou dinheiro com troco);
  - acompanhamento: confirmar → fila → preparo → a caminho → entregue.
- **Caixa:** registra o pedido com a taxa do bairro. A taxa soma no total, mas não
  gera cashback e fica fora da NFC-e.
- **Entregas (Operar):** aguardando o caixa → no preparo → prontos para sair
  (escolhe o entregador, "Saiu") → em rota → entregue.
- **Página do entregador** (`/entregador/<link>`), sem login: endereço com rota no
  Google Maps, ligar/WhatsApp, valor a cobrar e o botão "Entregue". "Link novo"
  derruba o antigo.

## Fase 3c — parceiros e kits

- **Parceiros (Crescer):** nutricionista, personal ou influenciador com código próprio
  (ex.: `NUTRIANA`), desconto para a cliente e comissão para o parceiro.
- A cliente fica **ligada ao parceiro** de dois jeitos:
  - cadastro no app pelo link de indicação (`/app?ref=CODIGO`);
  - código digitado no caixa ou no app.
- Cliente ligada ganha o desconto do parceiro em toda compra. Não acumula com cupom
  de campanha.
- A **comissão** é calculada sobre o que foi pago em produtos (sem taxa de entrega e
  sem cashback usado). Ela fica gravada na venda.
- **Portal do parceiro** (`/parceiro/<link>`), sem login:
  - código e botão para compartilhar no WhatsApp;
  - clientes indicadas (só o primeiro nome);
  - compras e comissão mês a mês;
  - kits do parceiro.
- **Fechar mês:** com o mês encerrado, lança a comissão em Contas a pagar
  ("Salários e comissões"). Cada mês fecha uma vez só.
- **Kits (Crescer):** cestas por objetivo ou receitadas por um parceiro. No app
  aparecem em "Kits prontos", com o botão "Pôr tudo no carrinho". O link do kit
  (`/app?ref=CODIGO&kit=…`) abre o app com o kit em destaque.

## Fase 2d — pagamento online (Mercado Pago)

- **Vender › Pagamento no app e no totem:** liga Pix no app, cartão no app e Pix no
  totem. A tela mostra se o Mercado Pago está ligado no servidor e o endereço do aviso
  (webhook).
- **App:** no carrinho a cliente escolhe Pix agora, Cartão agora ou No caixa / Na entrega.
  - Pix: QR e copia e cola na tela do pedido, com o prazo de 15 min.
  - Cartão: abre a página do Mercado Pago (o cartão não passa pela loja) e volta para o pedido.
- **Totem:** depois do pedido, mostra o QR do Pix. Quem preferir paga no caixa.
- **Pagou:** a venda é registrada sozinha no caixa aberto ("Pix online" / "Cartão
  online", com cashback, cupom, parceiro e NFC-e) e o pedido entra na fila do preparo.
- **Casos especiais:**
  - Caixa fechado quando o pagamento cai: o pedido aparece em "Pedidos para cobrar"
    com o botão "Registrar pagamento online". O caixa não consegue cobrar de novo.
  - Valor diferente do pedido: não vira venda. Cancelar o pedido devolve o dinheiro.
  - Pagamento que cai num pedido cancelado ou já cobrado no caixa é devolvido sozinho.
  - Cancelar uma venda paga online devolve o dinheiro pelo Mercado Pago.
- **Ligar:** no `.env` do servidor, `MP_ACCESS_TOKEN=APP_USR-...` e `MP_WEBHOOK_SECRET=...`
  (Webhooks do Mercado Pago, evento "Pagamentos"), depois `./scripts/atualizar.sh`.
  Para testar sem cobrar: `PAY_PROVIDER=teste` (aparece "Simular pagamento" no caixa).
- **Testes locais:** `npm run e2e` com a API rodando com `PAY_PROVIDER=teste`.

## Fase 2e — loja online

- **Vitrine aberta** em `/loja`, sem login: busca, categorias, ofertas, kits e carrinho.
  Cada produto tem página própria (`/loja/p/<id>/<nome>`), com o preço de membro em destaque.
- **Fechar o pedido:** a cliente entra ou vira membro grátis ali mesmo. O carrinho vai para
  o app (`/app`), onde ela escolhe retirada/entrega e paga (Pix/cartão online ou no caixa).
- **Google e redes:** o servidor monta título, descrição, foto (og:) e dados estruturados
  (Store/Product) de cada página. `robots.txt` deixa o Google ver só a loja, e `sitemap.xml`
  lista os produtos.
- **De onde vêm as vendas:** o link guarda utm_source/medium/campaign (e o gclid/fbclid dos
  anúncios) por 30 dias, e isso vai junto no cadastro e no pedido. **Vender › Loja online** tem:
  - gerador de link para cada divulgação (bio, stories, anúncios, Google, WhatsApp, panfleto com QR);
  - relatório de cadastros, pedidos, pagos e vendido por origem.
- **Pixel do Meta e Google Analytics 4:** basta colar os IDs. Eventos enviados: visita,
  produto visto, carrinho, cadastro, início da compra e compra paga. Só carregam depois que
  a cliente aceita os cookies (LGPD).

## Assistente (texto e voz)

Portado do assistente da Plataforma Aritana e adaptado à Mercearia. Fica em **Gestão › Assistente**
(permissão "Usar o Assistente": dono e gerente; atendente e caixa não veem).

- **Conversa por texto, voz ou anexo** (foto, PDF, planilha, Word, áudio, vídeo). Ele consulta o
  sistema com as permissões de quem pergunta e analisa os resultados como um gestor parceiro.
- **Consultas:** painel do dia, resumo do período comparado ao anterior, consulta livre em 15
  conjuntos de dados (vendas, itens, pagamentos, estoque, perdas, validade, clientes, pedidos do app,
  campanhas, parceiros, contas, caixas, compras, cashback), inteligência de estoque, ficha da cliente,
  recompra/sumidas/aniversariantes, contas a pagar, pedidos em andamento, parceiros e campanhas.
- **Ações com confirmação** (cartão com prévia; botão ou "pode"/"cancela"): criar e pausar campanha,
  mudar preço e preço de membro, pedido de compra em rascunho, lançar conta a pagar, e-mail com
  planilha e — quando o WhatsApp estiver ligado no servidor — mensagem e envio em lote espaçado.
  A gestão pode liberar o modo "Aprovar automaticamente".
- **Agentes agendados (rotinas):** "todo dia às 20h me manda o resumo do dia por e-mail". Rodam
  sozinhos com as permissões atuais de quem criou; cada execução vira uma conversa.
- **Pedidos:** o que ainda não existe vira pedido com especificação e plano para a equipe da Wide.
- **Chaves no `.env` do servidor:** `ANTHROPIC_API_KEY` (obrigatória para ligar), `OPENAI_API_KEY`
  (microfone e voz), `ELEVENLABS_API_KEY` (voz mais natural), `SMTP_*` (e-mail das rotinas).
- Teste dos conjuntos no banco: `ASSISTANT_DB_TEST=1 npx vitest run src/modules/assistant` (em apps/api).

## Fase 2f — WhatsApp com IA

Em **Crescer › WhatsApp com IA** (ver: quem vê clientes; responder: quem cadastra clientes; configurar: gestão).

- **Atendimento:** uma conversa por cliente (ligada ao cadastro pelo celular, com e sem o 9), filtros
  abertas / precisam da equipe / IA atendendo / minhas / resolvidas, assumir, resolver e reabrir.
  O que sai pelo celular da loja, pelo assistente e pela IA também aparece na conversa.
- **Produto e carrinho na conversa:** manda a ficha do produto com preço e link, ou monta um carrinho
  e manda o link `/loja?c=…`, que abre a loja online já com os itens (vale 7 dias).
- **Agente de IA:** responde sozinho com o catálogo do app (preço, preço de membro, ofertas, o que tem),
  monta o carrinho, informa entrega e clube, mostra o cashback e a situação dos pedidos da cliente, e chama
  a equipe em reclamação, troca, pagamento ou quando pedem uma pessoa. Para quando a equipe responde e
  depois de N respostas seguidas. Junta mensagens seguidas antes de responder.
- **Canal (no `.env` do servidor):** Z-API (`ZAPI_*` + `WHATSAPP_INBOUND_SECRET`) ou API oficial
  (`META_WA_*`). Na API oficial, fora das 24 h a tela pede um modelo aprovado. A URL de entrada para colar
  na Z-API ou na Meta aparece em **Configurar**.
- Testes: `scripts/e2e-whatsapp.mjs` com a API rodando em `WHATSAPP_PROVIDER=teste`.

## Financeiro: contas a receber, DRE e fluxo de caixa

Em **Financeiro e fiscal** (ver: `finance.view`; dar baixa e configurar: `finance.manage`).

- **Taxas e prazos** (Contas a receber › Taxas e prazos): % e taxa fixa da maquininha/gateway, em quantos dias
  cai e se exige conferir o extrato. Ao salvar, o que está a receber é recalculado.
- **Contas a receber:** cada pagamento de venda vira um recebível (bruto, taxa, líquido, quando cai). Pix e dinheiro
  caem na hora; cartão no prazo. Sem "conferir extrato", baixa sozinho no dia; com ele, alguém marca "Recebi" (pode
  informar o valor que caiu de fato). Venda cancelada antes de cair: venda e estorno se anulam. Recebimento avulso
  para o que não é venda.
- **DRE** (competência ou caixa, por mês ou período, total ou por canal, com o período anterior):
  receita bruta → deduções (preço de membro, ofertas, cupons, parceiros, descontos, impostos) → receita líquida →
  CMV e perdas → lucro bruto → despesas de venda (taxas, comissões, cashback) → despesas operacionais → resultado.
  Alíquota estimada de impostos em DRE › Configurar. Compras de mercadoria só entram no caixa (na competência o
  custo é o CMV). Nas colunas por canal, perdas e despesas fixas são rateadas pela receita (÷).
- **Fluxo de caixa:** por dia, o que entrou/saiu e o que vai entrar/sair, com saldo acumulado a partir do saldo inicial.
- O Assistente responde sobre isso (`dre`, `contas_a_receber`).

## Gestão financeira completa, funcionários e ponto

- **Plano de contas** (Financeiro › Plano de contas): contas em árvore (5 › 5.1 › 5.1.1), cada uma ligada a um grupo do
  DRE. O plano padrão nasce sozinho e é editável. "Só no caixa" marca compras de mercadoria/insumos e pagamento de
  comissão (na competência o valor já entra pelo CMV e pela comissão calculada).
- **Contas e bancos:** caixa, contas bancárias e carteiras com saldo inicial, extrato, transferência e ajuste.
  Pagar uma conta escolhe de onde saiu; cada forma de pagamento tem a conta onde o dinheiro cai.
- **Contas a pagar:** conta do plano, fornecedor do cadastro, competência, nº do documento e conta de pagamento.
- **DRE em árvore:** grupo → conta → detalhe, com % da receita, % dentro do grupo, período anterior e os lançamentos
  de cada conta. Vendas e CMV abrem por categoria de produto; taxas, por forma de pagamento. Resultado operacional,
  financeiro e impostos sobre o lucro; na visão de caixa, também investimentos, empréstimos e retiradas.
- **Funcionários** (Equipe › Funcionários): cadastro, vínculo, salário, escala, login e PIN do ponto; escalas; regras
  do ponto (foto, cerca por GPS, locais, feriados).
- **Ponto** (portado da Aritana): batida com hora do servidor, número sequencial e hash encadeado (imutável no banco),
  pelo login da pessoa ou por PIN no aparelho da loja; espelho com as regras da CLT, ajustes com motivo, ocorrências
  (atestado, férias, falta), fechamento do mês com confirmação do funcionário e salários lançados em contas a pagar.
  Ainda não tem: arquivos AFD/AEJ da Portaria 671 com assinatura digital e envio para a contabilidade.
- Teste: `scripts/e2e-gestao.mjs`.

## Controle: conciliação, orçamento, comissões, importação, auditoria e disparos
- **Conciliação bancária** (`/conciliacao`): sobe o extrato do banco em OFX, o sistema casa sozinho o que tem o mesmo
  valor e data até 3 dias de distância; o resto resolve linha a linha (casar com um lançamento, dar baixa numa conta
  a pagar em aberto, lançar como despesa/receita numa conta do plano, ajustar o saldo ou ignorar). Mostra também o
  que está no sistema e não apareceu no banco. Subir o mesmo arquivo de novo não duplica.
- **Orçamento** (`/orcamento`): valor esperado por linha do DRE em cada mês, comparado com o realizado (competência).
- **Comissões da equipe** (`/comissoes`): vendas de cada pessoa no caixa × percentual do cadastro de funcionário.
- **Importar planilha** (`/configuracoes/importar`): produtos e clientes por CSV, com conferência antes de gravar.
- **Auditoria** (`/configuracoes/auditoria`): quem fez o quê e quando, com filtros.
- **Disparos e anúncios** (`/disparos`): mensagem de WhatsApp para um grupo (membros, sumidos, aniversariantes, com
  cashback, por categoria comprada), com `{nome}` e `{cashback}`, envio espaçado (`BROADCAST_INTERVAL_MS`, padrão
  4000), limite de 2.000 pessoas, parada automática com 8 falhas seguidas e retomada se o servidor reiniciar.
  Mostra as vendas de quem recebeu nos 7 dias seguintes. A aba de anúncios soma cadastros e pedidos por UTM.
- Teste: `scripts/e2e-controle.mjs`.

## Avisos, ajuda e arquivo do ponto
- **Central de avisos** (sino no topo): contas vencidas e do dia, recebimentos atrasados, linhas do banco sem
  conciliar, estoque mínimo, lotes vencidos ou vencendo, conversas do WhatsApp esperando, notas rejeitadas, pedidos
  parados e ponto do mês passado sem fechar. Cada pessoa vê só o que tem permissão.
- **Ajuda** (`/ajuda`): manual por área, com busca e atalho para cada tela.
- **AFD do ponto** (Ponto › Arquivo AFD): arquivo das marcações no leiaute 004 da Portaria 671 para REP-P (cabeçalho
  com CRC-16/KERMIT, marcações tipo 7 com SHA-256 encadeado, trailer e linha de assinatura). Sai sem assinatura
  digital (.p7s) e sem registro no INPI: `AFD_INPI` e `AFD_DEV_DOC` no `.env` preenchem esses campos quando houver.

## iFood
- A cada 30 s o servidor busca os eventos do iFood (Merchant API): pedido novo é aceito, vira pedido na tela de
  preparo (canal iFood) e venda no canal iFood com a forma de pagamento "iFood" (taxa e prazo em Taxas e prazos).
  Andar o pedido na tela de preparo avisa o iFood (em preparo, pronto, despachado). Cancelado no iFood cancela aqui.
- O produto é reconhecido pelo "código PDV" do item no cardápio do iFood = código ou código de barras do produto.
  Item sem código deixa o pedido "sem cadastro" na tela `/marketplaces`, com "Tentar de novo" depois de corrigir.
- Caixa fechado: o pedido espera e a venda entra sozinha quando o caixa abrir.
- `.env`: `IFOOD_CLIENT_ID`, `IFOOD_CLIENT_SECRET`, `IFOOD_MERCHANT_ID` (e `IFOOD_STORE_ID` com mais de uma loja).
  `IFOOD_PROVIDER=teste` liga o simulador. **Ainda não foi testado contra o iFood de verdade** (não há chaves) e o
  iFood exige homologação do aplicativo antes de liberar em produção.
- Não faz: complementos do iFood como opções de montagem (vão como observação), cancelamento pela loja, cardápio.
- Teste: `scripts/e2e-ifood.mjs`.

## Câmeras: fluxo de pessoas e conversão
- Contagem de quem entra na loja por hora, comparada com as vendas do balcão: conversão, ticket e horário de pico.
- A contagem chega por um endereço com segredo (`TRAFFIC_SECRET`), que a câmera ou o gravador chama a cada pessoa
  (GET ou POST, `?in=N&out=N&store=CODIGO`), ou é digitada na tela. O sistema só recebe números.
- Não há integração própria com um modelo de câmera: vale para qualquer equipamento que consiga chamar um endereço.
  **Ainda não foi testado com uma câmera de verdade.**

## Implantação
- `/configuracoes/implantacao`: as 48 pendências de implantação em 8 grupos (empresa e nota fiscal, produtos,
  clientes, financeiro, equipe, entrega, contas de terceiros, equipamentos). Cada item tem situação (pendente,
  recebido, concluído, não se aplica), observação, quem mexeu e quando, e atalho para a tela onde se configura.
- O sistema mostra ao lado o que já enxerga cadastrado (ex.: "128 produtos cadastrados", "Chave cadastrada no
  servidor"), mas não conclui o item sozinho: quem marca é a pessoa. A lista fica em `packages/contracts/src/setup.ts`.

### O que ainda falta
Assinatura digital do AFD (precisa de certificado ICP-Brasil) e o AEJ; Mercado Livre, Shopee, Amazon e 99Food.
