# Decisões da Mercearia Saudável

Leia antes de mexer. Cada linha é uma decisão já tomada; mudar exige combinar com o Wil.

## Sistema
- Sistema **novo e separado**: repositório próprio (willopes2025/merceariasaudavel), banco próprio.
- Base copiada do VISIO (que veio do Soul ERP): NestJS + Prisma + PostgreSQL, React, Docker + Caddy. **Sem Supabase.**
- Roda na VPS Hostinger dos outros sistemas, em mercearia.wideic.com.
- Uma loja, equipe pequena. A estrutura aceita outra loja no futuro.

## Clube e preço de membro
- Ser membro é **grátis**: cadastro com celular no caixa ou pelo app (`/app`).
- Todo membro tem um **código de cartão** de 6 caracteres (sem 0/O/1/I/L), único na loja; o caixa busca por ele.

## App do cliente (Fase 2a)
- Login do cliente = **celular + PIN de 6 números** (PIN fácil é recusado). Sem SMS/WhatsApp por enquanto:
  quando o WhatsApp entrar, vira código por WhatsApp para recuperar o PIN.
- Celular que a loja já conhece só vira conta no app com o **mesmo CPF da ficha**, ou se a ficha está vazia
  (sem compras e sem cashback). Fora isso, **código provisório do balcão** (gerado na ficha, mostrado uma vez).
- 5 PINs errados travam o login por 15 min. Trocar o PIN ou gerar código novo **derruba todos os logins**
  (versão do acesso no token).
- Token do cliente (`kind: cliente`, 90 dias) não abre rota da equipe, e o da equipe não abre o app.
- Rotas do app são `/v1/shop/:slug/...`; filtram sempre pela organização do slug ou do token.
- App das lojas (Play Store / App Store): embrulho (Capacitor/TWA) desta mesma página `/app`, numa etapa seguinte.
- Membro paga o **preço de membro** dos produtos que têm esse preço; os outros pagam o preço normal.
- Preço de membro nunca é maior que o preço normal.
- Cashback: % sobre o que foi **pago** (sem contar o cashback usado), só para membro.
  Validade e limite de uso por compra são configuráveis (Configurações › Clube).
- O saldo de cashback só muda pelo extrato (`moveCashback`); extrato não se altera nem se apaga.
- Venda cancelada: devolve o cashback usado e tira o ganho (só o que sobrou, se ela já gastou).

## Pedidos e preparo (Fase 2b)
- Pedido do app/totem **paga no caixa** (sem gateway por enquanto). O caixa recalcula na hora de cobrar;
  o valor do pedido é só estimativa. Cobrar trava o pedido (`FOR UPDATE`): ninguém cobra duas vezes.
- Pedido pago entra na fila; andar só para a frente (`na_fila → preparando → pronto → entregue`), e só
  se ninguém mexeu antes (duas telas abertas).
- Venda no balcão com preparado abre pedido já pago (configurável). Cancelar a venda cancela o pedido.
- Número do pedido volta a 1 todo dia (`tenant_sequence` com nome `order:AAAA-MM-DD`).
- Adicional da montagem custa igual para membro e não membro; insumo da opção baixa como `consumo`.
- Opção removida da montagem some; venda feita guarda nome e preço das escolhas (`sale_item.options`).
- Totem identifica membro por celular ou código do cartão, sem PIN (só dá o preço de membro, que é grátis).
- Painel de retirada é público: só número e primeiro nome.

## Campanhas e recompra (Fase 3a)
- Ordem da conta: preço (membro ou normal) → oferta (só se for menor) → desconto manual → cupom → cashback usado.
  `sale.discount` = manual + cupom (a NFC-e rateia); `coupon_discount` guarda a parte do cupom.
- Economia de membro e economia de oferta ficam separadas (`member_savings` × `promo_savings`).
- Cupom inválido não quebra o orçamento (mostra o motivo); na venda, recusa (`COUPON_INVALID`).
  A linha do cupom é travada na venda para o limite de usos não estourar. Venda cancelada devolve o uso.
- Cupom de aniversariante: vale no mês do aniversário, 1 vez por ano (a menos que diga outro limite).
- Cashback turbinado só para membro, soma ao do clube; com duas campanhas na mesma linha vale a maior.
- Campanha não se apaga (vendas apontam para ela): liga/desliga.
- Recompra: intervalo = mediana entre as compras da cliente (com 2+ compras, ignorando compras a menos de 3 dias);
  sem histórico, a duração do produto. Lista quem vence em até N dias ou atrasou até 45 dias (depois disso é "sumida").
- WhatsApp por link (wa.me) com a mensagem pronta; o disparo automático entra quando o WhatsApp for integrado.

## Inteligência de estoque (Fase 3b)
- Saída = venda + consumo do preparo − cancelamentos, no período; por dia = saída ÷ dias.
- Ponto de pedido = saída/dia × (prazo do fornecedor + 3 dias) + mínimo. Abaixo dele, sugere comprar até
  saída/dia × (prazo + folga) + mínimo, menos estoque e menos o já pedido (pedidos "enviado"), no múltiplo de compra.
- Sem fornecedor: prazo padrão 7 dias. Preparado não entra (compra-se o insumo).
- Curva ABC pelo valor movimentado: faturamento (revenda) ou custo consumido (insumo); A até 80%, B até 95%.
- Risco de vencer: lotes por validade; o que o ritmo atual não vende até a data conta como risco (lotes até 180 dias).
- Pedido recebido pode dar entrada no estoque (lote `PC<nº>` quando o produto controla lote) e atualiza o custo.

## Entrega (Fase 2c)
- Bairro é escolhido da lista (sem geolocalização): taxa, mínimo, grátis acima de e prazo por bairro.
- Pedido de entrega é pago na entrega: o caixa registra a venda com a forma que a cliente escolheu
  (o entregador recebe) e o pedido vai ao preparo. A taxa vem do pedido, não do que se digita no caixa.
- Taxa de entrega soma no total pago, não gera cashback, não pode ser paga com cashback e fica fora da
  NFC-e (a nota cobre as mercadorias; os pagamentos da nota são limitados ao total dos itens).
- Entrega só fecha depois do despacho (`saiu_entrega`); não aparece na TV de retirada.
- Entregador abre pelo link com token (32 hex); "link novo" troca o token. Ele só vê e fecha as entregas dele.

## Parceiros e kits (Fase 3c)
- Código do parceiro e código de cupom não podem coincidir (um digitado no caixa vale um só).
- Desconto do parceiro: para a cliente ligada a ele ou para quem digita o código. Não acumula com cupom de campanha; a comissão continua.
- Comissão = % sobre o pago em produtos (total − taxa de entrega), arredondada para baixo no centavo, gravada na venda (`partner_commission`).
- Código digitado liga a cliente ao parceiro só se ela ainda não tiver parceiro. Venda sem cliente com código gera comissão, mas não liga ninguém.
- Fechamento do mês (horário de Brasília) só para mês encerrado. Grava `partner_payout` (não se altera) e cria a conta a pagar. Depois de fechado, a lista mostra os números do fechamento.
- Portal do parceiro por link com token, sem login. Mostra só o primeiro nome das clientes. "Link novo" derruba o antigo.
- Kit só com produtos vendáveis (sem insumo). No app aparece só se todos os produtos estiverem no catálogo. O botão do carrinho some quando algum item exige escolher adicionais.

## Pagamento online (Fase 2d)
- Provedor: Mercado Pago. A chave fica só no `.env` do servidor, nunca no banco. Sem a chave, tudo desligado.
- O aviso (webhook) só traz o id do pagamento. O status sempre vem de uma consulta à API do Mercado Pago com a nossa chave. Assinatura `x-signature` conferida quando `MP_WEBHOOK_SECRET` está no `.env`.
- Sem aviso, a tela do pedido pergunta a cada 4 s e uma rotina confere a cada minuto. Nada depende só do webhook.
- Valor = mesma conta do caixa (`SalesService.estimate`), sem usar cashback. Pago com valor diferente (centavo a mais ou a menos) fica "divergente" e não vira venda.
- Venda automática exige caixa aberto: é registrada em nome de quem abriu o caixa. Sem caixa aberto não gera Pix.
- Um pedido com pagamento online aprovado não pode ser cobrado de novo no caixa (`ORDER_PAID_ONLINE`). Cobrado no caixa com Pix aberto: o Pix é cancelado. Se cair mesmo assim, é devolvido.
- Devolução antes de cancelar: se o Mercado Pago recusar a devolução, a venda (ou o pedido) não é cancelada.
- "Pix online" e "Cartão online" são formas de pagamento criadas sozinhas e não aparecem para escolher no caixa.
- Um pagamento do provedor vale para um registro só (índice único em provider + provider_payment_id).

## Loja online (Fase 2e)
- A vitrine é a mesma aplicação web (`/loja`). Os metadados de SEO são postos pelo servidor no index.html (o Google e o WhatsApp não rodam o app). Produto inexistente devolve o app normal.
- O fechamento do pedido acontece no app da cliente: um só checkout, igual para app e loja online (preço de membro, entrega, cupom, Pix/cartão).
- Origem = último clique com UTM/gclid/fbclid, válida por 30 dias. Sem parâmetro, vale o site que mandou a visita (se não houver origem guardada). Fica no cadastro (só a primeira) e em cada pedido.
- Pixel e GA4 só carregam com o "Aceitar" dos cookies. São ids públicos (não são segredo), guardados no banco.
- `robots.txt`: Google só na loja (`/loja`); o sistema da equipe e o app ficam de fora.

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
