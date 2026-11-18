# Controle de estoque, contagem diária e capital — com Mercado Phone

Data: 18/11/2026 · Status: definido com o dono, aguardando chave da API para construir

## Princípios

- **"Se não está no Mercado Phone, não existe."** O Mercado Phone (plano Pro Max) é o sistema oficial: cadastro, venda, NF, caixa e OS de clientes.
- O **App de contagem** (dentro do sistema das vendedoras) cuida de: cadastro por bipe (gravando no Mercado Phone), local físico de cada aparelho, contagem diária, pendências do dono e capital em estoque.
- As vendedoras fazem o mínimo possível; o que puder ser descoberto pelo sistema não depende de alguém lembrar.
- As vendedoras usam **iPhone**. Câmera (bipe) funciona no Safari; impressão de etiqueta é a exceção (ver Etiquetas).

## Integração com o Mercado Phone

- API REST `https://platform.mercadophone.tech/api/v1`, header `X-API-Key: mpk_...` (chave de **leitura e escrita**, escopada à loja).
- Usado: `GET/POST /inventory` (estoque, `imei`, `aparelhoId`, `gbId`, `corId`, `valorCusto`, `fornecedorId`, `clienteId`, `saudeBateria`), `GET /sales` (`include_payments=true`), `GET /suppliers`, catálogo (`/catalog/devices`, cores, GB), OS (`/service-orders`).
- A chave fica só no servidor (nunca no navegador das vendedoras).
- O app lê o estoque e as vendas do Mercado Phone a cada poucos minutos; aparelho cadastrado direto no app do Mercado Phone aparece sozinho como "aguardando etiqueta".

## Cadastro (entrada)

1. Vendedora toca **Entrada** e bipa o `*#06#` (seminovo/upgrade) ou o código da caixa (lacrado).
2. Validação do IMEI (15 dígitos + dígito verificador Luhn); IMEI repetido é bloqueado e mostra o histórico.
3. **Modelo automático** pelos 8 primeiros dígitos do IMEI (TAC), aprendido com os cadastros existentes (98% dos TACs apontam um único modelo). Vendedora só confirma.
4. **GB e cor:** lacrado → pelo código de barras da caixa (EAN aprendido na primeira vez); seminovo → 2 toques em botões filtrados pelo modelo. Sem texto livre: usa as listas do catálogo do Mercado Phone.
5. Seminovo: saúde da bateria.
6. **Origem:**
   - **Upgrade:** cliente + valor pago na troca → vira o custo automaticamente.
   - **Fornecedor:** custo e fornecedor podem ficar **pendentes** (motoboy leva direto à loja; vários pedidos/fornecedores por dia). O dono preenche em Pendências.
7. Grava no Mercado Phone e imprime a etiqueta.
- Custo **pode** ficar visível para as vendedoras (decisão do dono).

## Etiquetas

- Impressora **Niimbot B21**, etiquetas 40×30 ou 50×30 mm.
- Conteúdo: **QR com o IMEI** + texto (modelo, GB, cor, final do IMEI). Gerada pelo próprio app (não depende da etiqueta do Mercado Phone).
- iPhone não tem Bluetooth no Safari: imprimir pelo navegador **Bluefy** (Web Bluetooth, 1 toque) ou, como garantia, compartilhar a imagem para o app oficial da Niimbot.
- Aparelho sem etiqueta não entra na contagem e gera alerta.

## Locais e situações

- **Loja** · **R1** (outra pessoa/endereço) · **Fora**: assistência (técnico), garantia, outro lojista · **Vendido** (pela venda no Mercado Phone) · **Não localizado** (faltou e ninguém explicou).
- **Aparelho de cliente** (conserto): só na OS do Mercado Phone; não entra no estoque nem no capital; aparece em seção separada da contagem enquanto estiver na loja.

## Movimentações — descobertas pela contagem

- Mover na hora (bipa + destino) existe, mas é **opcional**.
- Na contagem, todo aparelho esperado e não bipado gera a pergunta **"onde está?"** (Assistência/qual técnico · R1 · Garantia · Outro lojista · Não encontrei). A resposta é a movimentação (com nome e horário). Não fecha a contagem com pergunta sem resposta.
- Automático, sem perguntar: vendido no Mercado Phone sai; faltou na loja e foi bipado no R1 → transferência; reapareceu num bipe → "voltou".
- **R1 é outra pessoa:** loja→R1 fica "em trânsito" até o R1 bipar; sem confirmação em 24h → alerta.
- Prazos com alerta: assistência > 7 dias (ajustável), garantia, outro lojista.

## Contagem diária

- **Completa, todo dia, no fechamento.** Loja pela vendedora do fechamento; R1 pela pessoa do R1.
- Bipe contínuo (vibra/apita), contador "N de M", ao fim mostra só faltas e sobras.
- "Não encontrei" → **Não localizado** → alerta imediato ao dono.
- Resumo diário ao dono: quem contou, horário, faltas, aparelhos fora da loja.

## Pendências do dono (tela obrigatória)

- Ao entrar com o login do dono, abre **Pendências** e **não dá para ir a outra tela** enquanto houver:
  1. **Aparelhos sem custo ou sem fornecedor:** para cada um, valor + fornecedor (lista com busca; o último fornecedor usado fica sugerido). Grava no aparelho e no Mercado Phone (`valorCusto`, `fornecedorId`).
  2. **Alertas abertos** (não localizado, venda com IMEI fora do estoque, prazos estourados, trânsito sem confirmação): cada um exige uma ação ou uma justificativa escrita.
- Custo + fornecedor ficam presos ao IMEI → o **Fechamento Diário** passa a preencher custo e fornecedor de cada venda sozinho.

## Caixa — Capital em estoque (primeira versão)

- Total em capital: soma do custo dos aparelhos em estoque (loja + R1 + fora), quantidade de aparelhos.
- Por local (loja, R1, assistência/garantia/outro lojista) e por modelo.
- Valor de venda pela tabela de preços e lucro potencial.
- Tempo parado (dias em estoque) por aparelho.
- Aviso de quantos aparelhos estão sem custo (não somam no capital).
- Evolução futura: dinheiro em caixa, PIX/cartão a receber, contas a pagar.

## Segurança

- Login por vendedora (Mercado Phone, com níveis de acesso, sem excluir aparelho) e PIN no app.
- Ninguém apaga aparelho: só pede baixa com motivo; o dono aprova.
- Linha do tempo por IMEI (quem cadastrou, moveu, contou, vendeu).
- Alertas: falta na contagem, venda com IMEI fora do estoque ou sem IMEI, fora da loja além do prazo, trânsito sem confirmação, cadastro digitado à mão, movimentação fora do horário.
- Custos e chave da API protegidos no servidor (não acessíveis com a chave pública do site).

## Ordem de construção

1. Ligação com a API do Mercado Phone (leitura de estoque/vendas/fornecedores/catálogo).
2. Cadastro por bipe + modelo automático + etiqueta.
3. Contagem diária com "onde está?" + regras automáticas + R1 em duas pontas.
4. Pendências do dono (custo/fornecedor + alertas, tela obrigatória).
5. Capital em estoque.
6. Fechamento Diário usando custo/fornecedor do IMEI.
