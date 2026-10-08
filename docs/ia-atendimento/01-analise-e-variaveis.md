# IA de Atendimento RR Prime Cell: análise dos concorrentes e variáveis

Status: rascunho. Aguardando as tabelas (maquininha, avaliação de upgrade, descontos de assistência).

## 1. O que os concorrentes fazem (prints de 08/10/2026)

### Phone Millenium ("Mia")
- Se apresenta com nome e emoji e manda respostas curtas, em 2 a 4 balões.
- Passa o preço dos dois modelos que o cliente pediu e diz se tem pronta entrega. O 512GB fica "sob consulta".
- Já na 1ª resposta pergunta se o cliente tem iPhone para dar na troca.
- Quando o cliente fala em orçamento, pergunta se aquele valor é o **total** ou a **entrada**.
- Simula o saldo em **4 opções** (6x, 10x, 12x, 18x), sem mostrar a tabela inteira.
- Confirma as cores disponíveis e a cor escolhida em estoque.
- Empurra o agendamento: informa o horário de funcionamento e o último horário que dá para agendar (30 min antes de fechar).
- Pede os dados num formulário (Nome, RG, Instagram, E-mail).
- Objeção "achei loja que fecha mais tarde": oferece fechar pelo WhatsApp e retirar no dia seguinte.
- Pontos fracos: repete argumentos, pede RG por DM (dado sensível) e no final mandou áudio e telefone, ou seja, um humano assumiu sem transição.
- 18x deles: saldo × **1,25**.

### Urban Phone ("Duda")
- A conversa aparece como "Conversa comercial", sinal de que eles usam a **API oficial da Meta**.
- Fala o preço "a partir de" e explica que muda conforme a cor e o GB.
- **Corrige o cliente**: não existe 17 Pro de 128GB, nem roxo. Ou seja, conhece o catálogo.
- Com orçamento de R$ 5.000, oferece um modelo que cabe no valor (iPhone 16 128GB por R$ 4.790) **e** usa a troca como gancho para subir para o 17 Pro.
- **Pré-avaliação em formulário**: modelo, GB, saúde da bateria, tela da frente, traseira, câmera, Face ID, áudio/microfone e aviso de troca de peça.
  - Pergunta de acompanhamento: o trincado é só no vidro ou o display também tem defeito?
  - Pergunta a cor do aparelho do cliente.
- Resultado mostrado como "**volta**" (diferença) à vista e em 18x, comparando os dois modelos e a diferença entre eles.
  - 15 Pro Max 256, bateria 79%, vidro trincado: **R$ 2.900**
  - 15 Pro Max 256, bateria 90%, perfeito: **R$ 3.250**
- Informa endereço, horário e último horário agendável. Não cobra sinal. Pede só o nome completo.
- Pontos fracos: no 2º aparelho avaliou sem refazer o checklist completo, e não deixa claro que o valor é uma **pré-avaliação** sujeita a conferência na loja.
- 18x deles: saldo × **1,2238**.

### Comparação com a nossa taxa
No simulador (`simulador_1.html`) a fórmula é `valor × (1 + taxa/100)`. Para 18x a taxa é 21,5%, ou seja, **× 1,215**. Hoje sairíamos mais baratos no 18x que os dois concorrentes.
➡ Confirmar se a IA usa essa mesma fórmula e tabela.

## 2. Fluxo da nossa IA

1. **Abertura**: saudação e resposta direta ao que o cliente perguntou (preço e disponibilidade).
2. **Qualificação**: modelo de interesse, GB, cor, orçamento (total ou entrada) e se tem aparelho para a troca.
3. **Pré-avaliação** (quando tem troca): formulário, perguntas de acompanhamento e valor calculado **pela tabela**, nunca "de cabeça".
4. **Proposta**: preço, menos avaliação, menos entrada, dá o saldo. O saldo sai à vista ou em 3 ou 4 opções de parcela. Sempre com a ressalva de que é pré-avaliação.
5. **Fechamento**: agendamento dentro do horário, coleta de dados mínimos e aviso ao vendedor.
6. **Objeções**: horário, preço, concorrente, "vou pensar".
7. **Passagem para humano**: veja a seção 5.

## 3. Variáveis que precisamos definir

### 3.1 Identidade e tom
- [ ] Nome da atendente virtual
- [ ] Emoji assinatura / uso de emojis (muito, pouco, nenhum)
- [ ] Tratamento: "você" e informal?
- [ ] Palavras e expressões típicas da loja (pegar das conversas reais dos seus atendentes)

### 3.2 Loja
- [ ] Endereço e ponto de referência
- [ ] Horários por dia da semana e feriados
- [ ] Último horário agendável (ex.: 30 min antes de fechar)
- [ ] Agendamento obrigatório ou recomendado?
- [ ] Precisa de sinal? Quanto e como?
- [ ] Faz entrega ou envio? Para onde, quanto custa e em quanto tempo?
- [ ] Dados coletados para agendar (sugestão: nome completo e WhatsApp; **evitar RG por DM**)

### 3.3 Catálogo e preços (tabela)
Por item: modelo, GB, cor, condição (lacrado / seminovo), preço à vista, em estoque (sim / não / sob consulta).
- [ ] Usar o estoque já cadastrado no `index.html` (Supabase) ou uma tabela separada?
- [ ] O preço muda por cor?
- [ ] Seminovos: como descrever (bateria, garantia)?

### 3.4 Pagamento (tabela da maquininha)
- [ ] Taxas de débito e de 1x a 18x (já estão no simulador)
- [ ] Fórmula: `× (1 + taxa)` (atual) ou `÷ (1 − taxa)`?
- [ ] Quais parcelas mostrar por padrão (sugestão: 6x, 10x, 12x, 18x)
- [ ] Pix / dinheiro: tem desconto?
- [ ] Aceita mais de um cartão? Financiamento / boleto?

### 3.5 Avaliação do aparelho do cliente (troca / upgrade)
- [ ] **Tabela base**: valor pago por modelo + GB em estado perfeito
- [ ] Faixas de bateria e quanto desconta em cada uma (ex.: ≥ 90%, 85–89%, 80–84%, < 80%)
- [ ] **Tabela de assistência**: desconto por defeito e por modelo:
  - vidro da tela trincado (display ok)
  - display com defeito (manchas, linhas, touch)
  - traseira trincada
  - câmera com defeito
  - Face ID com defeito
  - áudio / microfone
  - aviso de peça não original (bateria, tela, câmera)
  - outros (botões, carcaça, conector)
- [ ] A cor muda a avaliação?
- [ ] Aceita com caixa / sem caixa? Garantia Apple ativa vale mais?
- [ ] Defeitos que **recusam** a troca (iCloud bloqueado, Face ID + tela, placa, etc.)
- [ ] Aceita 2 aparelhos na troca?
- [ ] Texto da ressalva: "valor de pré-avaliação, confirmado na loja após teste"

### 3.6 Regras comerciais
- [ ] Garantia: lacrado e seminovo (prazo)
- [ ] Brindes (película, capa)?
- [ ] Margem de negociação: a IA **nunca** dá desconto fora da tabela; quando o cliente pede, passa para um humano?
- [ ] Sugerir um modelo mais barato quando o orçamento não cobre?

## 4. Ferramentas (funções) da IA

Todos os números vêm de funções. A IA nunca calcula valores sozinha.

| Função | O que faz |
|---|---|
| `consultar_catalogo(modelo, gb?, cor?)` | preço, cores e disponibilidade |
| `avaliar_aparelho(modelo, gb, bateria, defeitos[])` | valor da pré-avaliação, conforme as tabelas |
| `simular_pagamento(valor, entrada?, parcelas[])` | à vista e parcelas, conforme a tabela da maquininha |
| `sugerir_modelos(orcamento, avaliacao?)` | modelos que cabem no orçamento |
| `horarios_disponiveis(data)` | horários agendáveis |
| `registrar_agendamento(nome, whatsapp, resumo)` | salva e avisa o vendedor |
| `transferir_humano(motivo)` | pausa a IA nessa conversa e avisa a equipe |

## 5. Quando passar para um humano
- Pedido de desconto ou negociação fora da tabela
- Defeito não previsto na tabela ou que a regra manda recusar
- Reclamação, pós-venda, garantia
- Cliente irritado ou que pede para falar com uma pessoa
- A IA sem confiança na resposta

## 6. Casos de teste iniciais (tirados dos prints)
1. "Qual valor do 17 pro e 17 pro max?": responde os dois preços e pergunta sobre troca.
2. "Tem roxo de 128gb?": corrige que não existe e lista o que existe.
3. Orçamento de R$ 5.000: pergunta se é total ou entrada e sugere modelo que caiba.
4. R$ 5.000 de entrada no 17 Pro Max: saldo correto nas parcelas.
5. Troca: 15 Pro Max 256, bateria 79%, vidro trincado: valor bate com a tabela.
6. Segundo aparelho perfeito: refaz o checklist completo antes de avaliar.
7. "Consigo às 20h": recusa educadamente e oferece o último horário ou o dia seguinte.
8. "Achei uma loja que fica até mais tarde": tenta reter sem insistir demais.
9. "Precisa de sinal?": responde conforme a regra da loja.
10. "Você é robô?": não nega e oferece falar com alguém da equipe.
