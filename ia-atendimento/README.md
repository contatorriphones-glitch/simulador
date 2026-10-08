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
| `dados/loja.json` | Horários, regra de agendamento, bateria mínima, garantia |

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

## Rodar os testes

```
cd ia-atendimento && npm test
```
