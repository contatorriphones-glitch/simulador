# IA de Atendimento: como a Bia melhora com o tempo

A Bia **não aprende sozinha durante a conversa**. O modelo de IA não muda com o uso. O que muda, e é isso que a deixa melhor, são as **instruções** (`prompt/bia.md`) e os **exemplos** que ela recebe. Essas mudanças saem dos dados dos atendimentos, num ciclo controlado:

```
atendimentos -> registro e resultado -> análise semanal -> ajuste no prompt/exemplos -> teste -> publicar
```

## 1. Registrar (desde já, na página de teste)
- Botão ⬇️: baixa a conversa com as avaliações 👍/👎, as correções ("como deveria ter respondido") e os agendamentos.

## 2. Medir (quando estiver no Instagram)
Para cada conversa, registrar:
- se o cliente respondeu;
- se pediu preço, troca ou desconto;
- se agendou, **compareceu** e **comprou**;
- desconto e brinde concedidos;
- se passou para um humano, e por quê.

Os atendentes marcam o comparecimento e a venda numa tela simples, como já fazem no sistema de estoque.

## 3. Analisar (semanal)
- Em quais pontos os clientes param de responder?
- Quais argumentos levam ao agendamento? (brindes, garantia, troca, parcelas…)
- Quais horários e dias têm mais comparecimento?
- Quais perguntas a Bia não soube responder?

## 4. Ajustar com aprovação humana
- As melhores conversas reais viram **exemplos** no prompt ("responda neste estilo").
- Cada correção feita por um atendente vira uma regra ou um exemplo.
- **Teste A/B:** duas versões de abordagem rodando em paralelo (ex.: oferecer os brindes antes ou depois do preço), medindo qual agenda mais.
- **Nenhuma mudança entra sem passar pelos testes** (`npm test` e os casos de conversa) **e sem a aprovação do dono.** Uma IA que muda as próprias regras sem supervisão pode "aprender" que dar desconto fecha mais vendas e acabar com a margem.
