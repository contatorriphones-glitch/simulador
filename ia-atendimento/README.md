# IA de Atendimento: motor de cálculo e tabelas

A IA conversa, mas **todo número sai deste motor**: preço, avaliação de troca, parcelas e horários.
Assim ela nunca inventa um valor.

## Onde editar cada informação

| Arquivo | O que tem |
|---|---|
| `dados/catalogo.json` | Preços de lacrados (por cor quando muda) e seminovos |
| `dados/upgrade.json` | Quanto pagamos no aparelho do cliente em estado perfeito |
| `dados/assistencia.json` | Custo de cada reparo por modelo (o que desconta na avaliação) e defeitos que recusamos |
| `dados/maquininha.json` | Taxas de débito / 1x–18x, fórmula e parcelas mostradas por padrão |
| `dados/custos.json` | Quanto a loja pagou em cada aparelho (só para a margem; o cliente nunca vê) |
| `dados/loja.json` | Endereço, horários, questionário de agendamento, margem mínima, garantia |
| `dados/garantia.md` | Termo de garantia completo (texto revisado) |
| `prompt/bia.md` | Personalidade, fluxo e regras da Bia |

Mudou a tabela, a IA já usa o valor novo. Mais pra frente, isso vira uma tela de administração.

## Como a avaliação é calculada

```
valor = tabela de upgrade (modelo + GB)
      − custo de cada defeito (tabela da assistência)
      − troca de bateria, se a saúde estiver abaixo de 80%
```

- Modelo ou GB fora da tabela de upgrade: **não aceito**, passa para um humano.
- Defeito sem preço na tabela: **consultar**, passa para um humano.
- Display com defeito desconta a tela inteira (não soma o vidro).
- **Não pegamos:** mensagem de peça desconhecida, chip sem funcionar, problema de placa, sem Face ID, iCloud bloqueado, aparelho que não liga ou molhado.

## Como funciona o desconto (só quando o cliente pede)

```
margem = (preço de venda − custo do aparelho)
       + (preço do aparelho da troca como seminovo − valor de upgrade pago)
       − perda com a taxa da maquininha
```

- O desconto máximo é o que mantém a margem em **pelo menos R$ 300** (`loja.json → negociacao`).
- A Bia libera em etapas: primeiro 50% do máximo e depois 100%, arredondando para baixo em múltiplos de R$ 50.
- A ferramenta **nunca informa o máximo** para a Bia, então ela não tem como deixar escapar o limite.
- Sem custo cadastrado em `custos.json`, ela não negocia e chama alguém da equipe.

## Rodar os testes

```
cd ia-atendimento && npm test
```
