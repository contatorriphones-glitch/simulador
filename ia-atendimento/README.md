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
| `dados/loja.json` | Endereço, horários, questionário de agendamento, pagamento, brindes, margem mínima, garantia |
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

## Como funciona o desconto

A Bia **não dá desconto logo de cara**. Primeiro contorna (brindes: fone Bluetooth + cabo; 6 meses de garantia no seminovo). Se o cliente insistir, pode trocar os brindes por capinha e película. Só depois disso:

- **Venda com troca:** o desconto sai da margem do aparelho recebido, que nunca fica abaixo de **R$ 300**:
  ```
  margem da troca = preço de revenda como seminovo − valor de upgrade
  ```
  Ela libera em etapas (50% e depois 100% do possível), arredondando para baixo em múltiplos de R$ 50. A ferramenta nunca informa o máximo para a Bia.
- **Venda sem troca, ou aparelho sem preço de revenda:** a Bia não dá desconto; se o cliente insistir muito, chama um atendente.
- **A taxa da maquininha nunca muda.** O desconto reduz o saldo e as parcelas são recalculadas com a taxa normal (ex.: R$ 1.000 em 18x = 18x de R$ 66,28).

## Rodar os testes

```
cd ia-atendimento && npm test
```

## Lojas

Cada loja tem uma pasta em `lojas/` com `loja.json` (nome, endereço, horários, regras) e `garantia.md`.
Tabelas próprias (ex.: `catalogo.json`) podem ser colocadas na pasta da loja; sem elas, valem as de `dados/`.

| Loja | Pasta | Página de teste |
|---|---|---|
| Kronos Phone (testes primeiro) | `lojas/kronos-phone` | `chat-teste-kronos-phone.html` |
| RR Prime Cell | `lojas/rr-prime-cell` | `chat-teste-rr-prime-cell.html` |

## Página de teste

Arquivo único: abra no navegador, cole a chave do Gemini em ⚙️ e converse como se fosse um cliente.

- 📚 **Conversas**: tudo é salvo sozinho (mensagens, 👍/👎, correções, observações 📝, agendamentos). Dá para abrir e continuar qualquer conversa, baixar e restaurar backups.
- 🧠 **Aprendizados**: regras que a atendente segue em todas as conversas. Uma correção feita no 👎 pode virar regra na hora.
- ➕ nova conversa · 🔎 mostra as consultas às tabelas · ⚙️ chave, modelo, data/hora simulada, nuvem.

### Onde fica salvo
- **No navegador**, sempre.
- **Na nuvem (Supabase)**, no mesmo projeto do sistema de estoque, depois de criar as tabelas uma única vez: Supabase → SQL Editor → New query → colar `supabase/bia.sql` → Run.

Mudou alguma tabela, o prompt ou uma loja? Gere as páginas de novo:

```
cd ia-atendimento && npm run build
```
