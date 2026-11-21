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
