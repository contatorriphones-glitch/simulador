# IA de Atendimento: tabelas e decisões

## Decisões do dono (08/10/2026)
| Tema | Decisão |
|---|---|
| Taxas | Usar a tabela da maquininha enviada (débito 3%, 18x 19,3%) |
| Desconto por defeito | Valores exatos da tabela de reparos (LegacyPhone) |
| Negociação | A IA pode dar desconto quando o cliente pede, desde que a margem da venda continue ≥ R$ 300 |
| Não pegamos na troca | Mensagem de peça desconhecida, chip sem funcionar, problema de placa, sem Face ID, iCloud bloqueado, não liga, molhado |
| Reparo sem preço na tabela | Chama humano |
| Preço por cor | Correto: os preços variam de acordo com a cor |
| Garantia do seminovo | 180 dias |
| Nome da IA | Bia |
| Endereço | Rua Catiguá, 159 – Tatuapé, Condomínio You Metropolitan, Prédio Comercial, 8º andar, sala 820 (2 min do Metrô Tatuapé) |
| Agendamento | Seg–sex até 20h30, sábado até 17h, feriado 10h–15h, domingo fechado |
| Atraso / não vai conseguir chegar | Chama humano |
| Questionário | Nome, modelo do aparelho, GB, forma de pagamento, dia e horário, Instagram, WhatsApp |

## Comparação com os concorrentes (mesmos cenários dos prints)
| Cenário | Concorrente | RR Prime Cell |
|---|---|---|
| 15 Pro Max 256, bateria 79%, vidro trincado | R$ 2.900 (Urban) | **R$ 3.100** |
| 15 Pro Max 256 perfeito | R$ 3.250 (Urban) | **R$ 3.550** |
| Saldo de R$ 2.650 em 18x | R$ 184,03 (Millenium) | **R$ 175,64** |

## Pendências
1. **Custo de cada aparelho** (`ia-atendimento/dados/custos.json`): sem ele, a Bia não consegue calcular a margem e passa o pedido de desconto para a equipe.
2. **Fórmula da taxa**: hoje é `valor × (1 + taxa)`, igual ao simulador. Assim a loja perde um pouco (em 18x, cerca de 3,7% do saldo), e isso já entra na conta da margem. Quer trocar para `valor ÷ (1 − taxa)`, em que a loja recebe o valor cheio?
3. **Sinal para agendar**: precisa ou não?
4. **Garantia adicional**: o termo diz "+3 meses além da garantia legal". Com a garantia de 180 dias, o adicional passa a ser 180 dias + 3 meses? Ela é paga? Quanto custa?
5. **Pix / dinheiro**: o preço "à vista" é o do Pix? Tem desconto extra?
6. **Margem do aparelho da troca**: a conta considera que ele será revendido pelo preço da tabela de seminovos. Para modelos que não estão nessa tabela (ex.: iPhone 11), não há desconto automático e a equipe é chamada.
