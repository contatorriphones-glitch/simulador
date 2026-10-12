# Ligar a Bia no Instagram da Kronos Phone

## Como funciona
```
Cliente no Direct ─► Meta (API oficial) ─► Servidor da Bia (Supabase) ─► Gemini
                                                  │
                     ┌────────────────────────────┼─────────────────────────────┐
                     ▼                            ▼                             ▼
          Responde no Direct           Alertas no Telegram            Google Agenda
          (em balões, "digitando…")    (🔥 cliente quente, 🔔 ajuda,   (título no modelo
                                        📅 agendamento, 📊 resumo)      das vendedoras)
                                                  │
                                          Painel da equipe (painel.html)
```

- **Equipe respondeu pelo Instagram:** a Bia percebe sozinha e sai da conversa por 12h (configurável).
- **Cliente quente, morno ou frio:** a Bia reclassifica a cada mensagem e adapta o jeito de vender. Cliente quente gera alerta no Telegram.
- **Retomada:** cliente quente ou morno que sumiu há 2h ou mais recebe **uma** mensagem, sempre dentro das 24h que o Instagram permite e entre 9h e 21h.
- **Aprendizado diário (22h):** a Bia analisa os atendimentos da semana (quem agendou, quem sumiu, quem comprou) e sugere regras novas. Você aprova no painel com um clique, ou liga a aprovação automática para as de baixo risco. Regras que falam de preço, desconto, brinde ou garantia **nunca** entram sozinhas.
- **Áudio e foto:** a Bia ouve os áudios e vê as fotos que o cliente manda.
- **Chave geral:** um botão no painel liga e desliga a Bia na hora.

## Custos
| Item | Custo | Observação |
|---|---|---|
| API do Instagram (Meta) | Grátis | — |
| Servidor e banco (Supabase) | Grátis | O plano gratuito aguenta o começo. O Pro (US$ 25/mês) só faz falta se crescer muito ou se quiser backup automático diário. |
| Alertas (Telegram) | Grátis | — |
| Google Agenda (Apps Script) | Grátis | — |
| Publicação automática (GitHub) | Grátis | — |
| **Gemini (a "cabeça" da Bia)** | **Pago, obrigatório** | Ver abaixo. |

**Por que o Gemini precisa ser pago:**
1. No plano grátis o Google pode usar as conversas, com nome e WhatsApp dos clientes, para treinar os modelos dele. No pago, não usa. Isso é obrigatório pela LGPD.
2. O grátis tem limite diário e fica "lotado" nos horários de pico. Com cliente real esperando, a Bia não pode parar.

Custo estimado: centavos por conversa. O painel mostra o gasto real por dia e por conversa (⚙️ > Uso do Gemini). Configure um **alerta de orçamento** no Google Cloud (Faturamento > Orçamentos e alertas), por exemplo R$ 100/mês, para não ter surpresa.

## Passo a passo

### Parte 1: contas e chaves (você faz, com a minha ajuda)
1. **Instagram da Kronos**
   - [ ] A conta precisa ser **profissional** (Comercial).
   - [ ] No app do Instagram: Configurações > Mensagens e respostas aos stories > Controles de mensagens > ative **Permitir acesso às mensagens** (ferramentas conectadas).
2. **Gemini pago**
   - [ ] Em aistudio.google.com > Get API key: ative o faturamento (cadastrar cartão) no projeto da chave.
   - [ ] Crie o alerta de orçamento no Google Cloud.
   - Guarde a chave: ela vira `GEMINI_API_KEY`.
3. **Telegram**
   - [ ] No Telegram, fale com **@BotFather** > `/newbot` > dê um nome (ex.: "Bia Kronos"). Ele devolve um token: `TELEGRAM_BOT_TOKEN`.
   - [ ] Crie um grupo "Equipe Kronos", adicione o bot e as vendedoras, e mande `/start` no grupo.
4. **App na Meta** (developers.facebook.com)
   - [ ] Meus apps > Criar app > caso de uso **"Gerenciar mensagens e conteúdo no Instagram"** (API do Instagram com login do Instagram).
   - [ ] Em "Configuração da API com login do Instagram": **adicione a conta da Kronos** e gere o token de acesso: `IG_TOKEN`.
   - [ ] Copie a **Chave secreta do app do Instagram**: `IG_APP_SECRET`.
   - [ ] Invente uma senha qualquer para o webhook (ex.: `kronos-webhook-2026`): `IG_VERIFY_TOKEN`.
   - [ ] Em Funções do app, adicione as contas de Instagram que vão testar (a sua e a das vendedoras).
5. **Supabase** (o mesmo projeto do estoque)
   - [ ] SQL Editor: rode `ia-atendimento/supabase/bia.sql` (se ainda não rodou) e depois `ia-atendimento/supabase/producao.sql`.
   - [ ] Authentication > Users > **Add user**: crie o login de quem vai usar o painel (e-mail e senha, marque "Auto Confirm").
   - [ ] Em supabase.com/dashboard/account/tokens: **Generate new token**: `SUPABASE_ACCESS_TOKEN`.

### Parte 2: publicar (automático)
1. No GitHub do projeto: **Settings > Secrets and variables > Actions > New repository secret**. Cadastre um por um:
   `SUPABASE_ACCESS_TOKEN`, `GEMINI_API_KEY`, `IG_TOKEN`, `IG_APP_SECRET`, `IG_VERIFY_TOKEN`, `TELEGRAM_BOT_TOKEN` e, se já configurou o Google Agenda, `AGENDA_URL` e `AGENDA_SEGREDO`.
   As chaves ficam só no GitHub e no Supabase, nunca no código nem no chat.
2. Aba **Actions > Publicar a Bia >** abra a última execução **> Re-run all jobs**. Ela testa tudo e publica o servidor.
3. De volta na Meta, em Webhooks:
   - URL de retorno: `https://gcawgwnthuqijgamkvhv.supabase.co/functions/v1/instagram`
   - Token de verificação: o mesmo `IG_VERIFY_TOKEN`
   - Assine o campo **messages**.
4. Abra o `painel.html`, entre com o login criado, vá em ⚙️ > **Conectar grupo** (Telegram) e depois **Mandar teste**.

### Parte 3: testar com clientes de mentira (no mesmo dia)
1. No painel, **ligue a Bia** (botão no topo).
2. Com as contas cadastradas como testadoras, mande mensagens para a Kronos pelo Instagram. Enquanto o app está em modo de desenvolvimento, **só essas contas recebem resposta**. Clientes reais não são afetados.
3. Teste: preço, troca com checklist, áudio, desconto, agendamento (confira o Google Agenda e o Telegram) e a vendedora respondendo no meio (a Bia tem que sair).

### Parte 4: liberar para todos os clientes
1. **Verificação da empresa** no Meta Business (CNPJ e documentos). Comece logo, porque pode levar alguns dias.
2. No app da Meta: **Análise do app** > peça acesso avançado a `instagram_business_basic` e `instagram_business_manage_messages`. A Meta pede:
   - URL da política de privacidade: use o texto de `05-politica-de-privacidade.md`, publicado num Google Docs público ou no site da loja;
   - um vídeo curto mostrando um cliente mandando mensagem e a Bia respondendo (eu te passo o roteiro).
3. Aprovado: mude o app para o modo **Ao vivo**. A Bia passa a atender todo mundo.

## Segurança e Instagram
- Só a API oficial da Meta, nada de automação com login e senha.
- Só responde quem escreveu primeiro, dentro de 24h. A única retomada é dentro dessa janela.
- O webhook só aceita avisos assinados pela Meta.
- O painel exige login. Os dados dos clientes não ficam abertos como os da página de teste.
- O token do Instagram é renovado sozinho antes de vencer (60 dias).
- Botão de desligar no painel, para qualquer imprevisto.
