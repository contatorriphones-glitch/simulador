# Agendamentos da Bia no Google Agenda

Há dois jeitos. O primeiro já funciona sem configurar nada; o segundo é automático.

## 1. Botão "➕ Adicionar ao Google Agenda" (já funciona)
Cada agendamento registrado pela Bia mostra esse botão. Ao clicar, o Google Agenda abre com o evento já preenchido (cliente, WhatsApp, Instagram, aparelho, proposta, endereço); é só salvar.

## 2. Automático: a Bia cria o evento sozinha (uns 10 minutos para configurar)
Use a conta Google da loja, a mesma onde a equipe vai ver os agendamentos.

1. Acesse **script.google.com** e clique em **Novo projeto**.
2. Apague o que estiver no editor e cole todo o conteúdo do arquivo `agenda.gs`.
3. No começo do código, troque:
   - `NOME_AGENDA`, se quiser outro nome para a agenda;
   - `SEGREDO`: uma senha sua (ex.: `kronos-2026-xyz`).
4. Clique em ⚙️ **Configurações do projeto** e, em **Fuso horário**, escolha **(GMT-03:00) São Paulo**.
5. Volte ao editor, selecione a função **testar** e clique em **Executar**. O Google pede autorização: clique em **Revisar permissões**, escolha a conta da loja e depois **Avançado > Acessar (não seguro) > Permitir**. O aviso aparece porque o script é seu, não de uma empresa verificada. Confira no Google Agenda: deve aparecer o evento "Teste da Bia" hoje às 18h.
6. Clique em **Implantar > Nova implantação**, tipo **App da Web**:
   - Executar como: **Eu**;
   - Quem pode acessar: **Qualquer pessoa**.
   Clique em **Implantar** e copie o **URL do app da Web** (termina em `/exec`).
7. Na página de teste da Bia, abra ⚙️ e cole o URL em **Google Agenda: link do Apps Script** e a senha em **Senha do Apps Script**. Clique em **Salvar e começar**.

Pronto: a cada agendamento, o evento aparece na agenda "Agendamentos Kronos Phone", com lembretes 1 hora e 15 minutos antes. Dá para compartilhar essa agenda com as vendedoras no próprio Google Agenda.

**Se mudar o código depois:** Implantar > Gerenciar implantações > ✏️ > Versão: Nova versão > Implantar. O URL continua o mesmo.

**Segurança:** só quem tem o URL **e** a senha consegue criar eventos. Não compartilhe os dois juntos.
