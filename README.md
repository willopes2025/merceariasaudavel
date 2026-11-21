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
npm run e2e                                  # ponta a ponta contra um Postgres local
```

Sem acesso ao servidor de binários do Prisma, use `PRISMA_JS_ENGINE=1`.

## Publicar

Ver [DEPLOY.md](DEPLOY.md). Decisões já tomadas: [DECISOES.md](DECISOES.md).
