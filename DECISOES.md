# Decisões da Mercearia Saudável

Leia antes de mexer. Cada linha é uma decisão já tomada; mudar exige combinar com o Wil.

## Sistema
- Sistema **novo e separado**: repositório próprio (willopes2025/merceariasaudavel), banco próprio.
- Base copiada do VISIO (que veio do Soul ERP): NestJS + Prisma + PostgreSQL, React, Docker + Caddy. **Sem Supabase.**
- Roda na VPS Hostinger dos outros sistemas, em mercearia.wideic.com.
- Uma loja, equipe pequena. A estrutura aceita outra loja no futuro.

## Clube e preço de membro
- Ser membro é **grátis**: basta o cadastro com celular (no caixa hoje; instalando o app na Fase 2).
- Membro paga o **preço de membro** dos produtos que têm esse preço; os outros pagam o preço normal.
- Preço de membro nunca é maior que o preço normal.
- Cashback: % sobre o que foi **pago** (sem contar o cashback usado), só para membro.
  Validade e limite de uso por compra são configuráveis (Configurações › Clube).
- O saldo de cashback só muda pelo extrato (`moveCashback`); extrato não se altera nem se apaga.
- Venda cancelada: devolve o cashback usado e tira o ganho (só o que sobrou, se ela já gastou).

## Produtos e estoque
- Tipos: **revenda**, **insumo** e **preparado** (shake, sorvete). Preparado não tem estoque:
  a venda baixa os insumos da ficha técnica.
- Quantidade com 3 casas (granel em kg). Produto em UN, CX ou PCT só vende inteiro.
- Produto com lote sai pelo **FEFO** (vence primeiro, sai primeiro). O que passar dos lotes
  sai "sem lote" e o saldo pode ficar negativo: venda sem estoque **avisa, não bloqueia**.
- O saldo só muda por movimentação (`applyStock`/`takeStock`/`putStock`); movimentação não se altera nem se apaga.
- Perda tem motivo (vencido, avaria, erro no preparo, degustação, consumo da equipe, furto, outro).
- A equipe do preparo lança perda e faz a contagem, mas não dá entrada nem acerta estoque.
- Contagem do fim do dia: a diferença vira movimentação "contagem" e entra nas perdas.

## Caixa e venda
- Um caixa aberto por loja. Sem caixa aberto não vende.
- O caixa manda só produto e quantidade: preço, desconto, cashback e total são do servidor.
- Só dinheiro passa do total (troco). O troco sai do pagamento em dinheiro.
- Desconto manual só com a permissão `sale.discount` (gerente e dona).
- Cancelar venda: estornos no caixa aberto agora; se houver NFC-e autorizada, ela é
  cancelada antes — se a SEFAZ recusar, a venda **não** é cancelada.

## Fiscal
- NFC-e pela Focus NFe, por loja. Nasce desligada; com "emitir sozinha" ligado, sai ao finalizar a venda.
- Desconto do caixa e cashback usado vão na nota como desconto, repartido entre os itens.
- Falha da nota nunca desfaz a venda: fica a mensagem e o botão de emitir na tela da venda.

## Metas, painel e TV
- Faturamento = total pago + cashback usado (o que a mercadoria valeu), sem as canceladas.
- Status da meta: verde no ritmo, amarelo um pouco atrás, vermelho longe. Perda de insumos é meta de máximo.
- TV abre por link com token, **sem login**, e nunca mostra dado de cliente; só o primeiro nome da equipe.
  Trocar o link derruba o antigo.

## Regras de código
- Datas "de hoje" com `todayBR()` (horário de Brasília). O servidor roda em UTC.
- Dinheiro somado em centavos. Total sempre calculado no servidor.
- Toda tabela nova: `tenant_id` + política de RLS na migração.
- Dentro de `$transaction(async (tx) => ...)` usar só `tx`.
- Toda entrega: `npm run e2e` passando antes de subir.
