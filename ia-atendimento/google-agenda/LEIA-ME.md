# Agendamentos da Bia no Google Agenda

Há dois jeitos. O primeiro já funciona sem configurar nada; o segundo é automático.

O título do evento segue o modelo das vendedoras:

```
Robert - iPhone 17 Pro Max Lacrado Azul 💙 - @robert.robert - 11 98765-4321 - (Upgrade iPhone 15 Pro Max 256GB Titânio Natural 🩶, avaliado em 3.100,00)
```

- O coração tem a cor que o cliente escolheu; sem cor escolhida, fica só o modelo.
- O valor do upgrade é o da pré-avaliação calculada pelas tabelas na conversa.
- Lembrete 30 minutos antes. Pode haver vários clientes no mesmo horário.

## 1. Botão "➕ Adicionar ao Google Agenda" (já funciona)
Cada agendamento registrado pela Bia mostra esse botão. Ao clicar, o Google Agenda abre com o evento já preenchido; é só salvar. Nesse modo, o lembrete é o padrão da sua agenda.

## 2. Automático: a Bia cria o evento sozinha (uns 10 minutos para configurar)
Use a conta Google da loja, a mesma onde a equipe vai ver os agendamentos.

1. Acesse **script.google.com** e clique em **Novo projeto**.
2. Apague o que estiver no editor e cole todo o conteúdo do arquivo `agenda.gs`.
3. No começo do código, troque:
   - `NOME_AGENDA`: o nome da agenda que as vendedoras já usam. Deixe `''` para usar a agenda principal da conta;
   - `SEGREDO`: uma senha sua (ex.: `kronos-2026-xyz`).
4. Clique em ⚙️ **Configurações do projeto** e, em **Fuso horário**, escolha **(GMT-03:00) São Paulo**.
5. Volte ao editor, selecione a função **testar** e clique em **Executar**. O Google pede autorização: clique em **Revisar permissões**, escolha a conta da loja e depois **Avançado > Acessar (não seguro) > Permitir**. O aviso aparece porque o script é seu, não de uma empresa verificada. Confira no Google Agenda: deve aparecer o evento "Teste da Bia" hoje às 18h.
6. Clique em **Implantar > Nova implantação**, tipo **App da Web**:
   - Executar como: **Eu**;
   - Quem pode acessar: **Qualquer pessoa**.
   Clique em **Implantar** e copie o **URL do app da Web** (termina em `/exec`).
7. Na página de teste da Bia, abra ⚙️ e cole o URL em **Google Agenda: link do Apps Script** e a senha em **Senha do Apps Script**. Clique em **Salvar e começar**.

Pronto: a cada agendamento, o evento aparece na agenda, com lembrete 30 minutos antes.

**Se mudar o código depois:** Implantar > Gerenciar implantações > ✏️ > Versão: Nova versão > Implantar. O URL continua o mesmo.

**Segurança:** só quem tem o URL **e** a senha consegue criar eventos. Não compartilhe os dois juntos.
