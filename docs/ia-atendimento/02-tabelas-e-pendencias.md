# IA de Atendimento: tabelas recebidas e pendências

## Recebido em 08/10/2026 (convertido em `ia-atendimento/dados/`)
- Preços de seminovos (36 itens) e lacrados (iPhone 15 ao 18 Pro Max, por cor)
- Valores de upgrade (iPhone 11 ao 17 Pro Max)
- Taxas da maquininha (débito, 1x–18x)
- Tabela de reparos LegacyPhone (tela, vidro, bateria, traseira, carcaça, câmeras, alto-falantes, Face ID, conector, botão, NFC, lentes, placa)
- Termo de garantia
- Regra: descontar bateria abaixo de 80%
- Horários: seg–sex 09h–20h30 · sáb 09h–17h · feriado 10h–15h · domingo fechado

## Comparação com os concorrentes (mesmos cenários dos prints)
| Cenário | Urban / Millenium | RR Prime Cell (tabelas atuais) |
|---|---|---|
| 15 Pro Max 256, bateria 79%, vidro trincado | R$ 2.900 (Urban) | **R$ 3.100** (3.550 − 270 vidro − 180 bateria) |
| 15 Pro Max 256 perfeito | R$ 3.250 (Urban) | **R$ 3.550** |
| Saldo de R$ 2.650 em 18x | R$ 184,03 (Millenium) | **R$ 175,64** |

## Pendências (decisões do dono)
1. **Taxa repassada ao cliente**: o simulador atual usa outra tabela (18x = 21,5%). A IA deve usar a da maquininha (18x = 19,3%) ou a do simulador? E qual fórmula: `× (1 + taxa)` ou `÷ (1 − taxa)`?
2. **O desconto do defeito é o custo exato do reparo** ou tem margem (ex.: +20%)?
3. **Aviso de peça não original** (bateria, tela, câmera): quanto desconta, ou recusa?
4. **Reparos que faltam na tabela**:
   - linha 17: bateria, traseira, câmeras, Face ID, conector etc.;
   - 14 Plus: bateria, traseira, câmeras, Face ID etc.;
   - microfone em todos os modelos.
   Hoje esses casos caem em "consultar humano".
5. **Recusa automática**: hoje está iCloud bloqueado, não liga e molhado. Confirmar e acrescentar outros, se houver.
6. **17 Pro Max 256 Laranja (R$ 6.849) mais barato que o Azul (R$ 7.049)**: é isso mesmo?
7. **Garantia do seminovo**: o termo cita 90 dias (lei), mais 3 meses adicionais, e também "180 dias". Qual prazo a IA deve informar? A garantia adicional é paga?
8. **Pix / dinheiro**: o "à vista" é o preço no Pix? Tem desconto extra?
9. **Seminovos**: qual a saúde mínima de bateria e a condição que a IA pode prometer?
10. **Loja**: endereço, nome da atendente virtual, se o agendamento é obrigatório, se tem sinal e quais dados coletar (sugestão: nome + WhatsApp).
11. **Aceita 2 aparelhos na mesma troca?** O motor já suporta.
