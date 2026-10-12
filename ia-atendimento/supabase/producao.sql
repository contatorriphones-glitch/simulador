-- Bia no Instagram: tabelas de produção.
-- Rode uma vez no Supabase: SQL Editor -> New query -> colar -> Run. Pode rodar de novo sem perder nada.
-- (Precisa ter rodado antes o bia.sql, que cria bia_aprendizados.)

-- ---------------------------------------------------------------- configuração
create table if not exists public.bia_config (
  id                 int primary key default 1 check (id = 1),
  ativo              boolean not null default false,    -- chave geral: Bia responde no Instagram?
  loja               text not null default 'kronos-phone',
  modelo             text not null default 'gemini-3.8-flash',
  modelo_reserva     text,                               -- usado quando o principal está lotado
  pausa_horas        int  not null default 12,           -- quanto tempo a Bia fica parada depois que alguém da equipe responde
  followup_ativo     boolean not null default true,      -- 1 mensagem de retomada para cliente quente/morno que sumiu (dentro das 24h)
  aprovar_automatico boolean not null default false,     -- aprendizados sugeridos de baixo risco entram sozinhos
  telegram_chat_id   text,
  ultima_analise_em  timestamptz,
  atualizado_em      timestamptz not null default now()
);
insert into public.bia_config (id) values (1) on conflict (id) do nothing;

-- Segredos que só o servidor lê (sem nenhuma política de acesso = painel não enxerga).
create table if not exists public.bia_segredos (
  nome          text primary key,                        -- ex.: 'ig_token'
  valor         text not null,
  atualizado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------- conversas do Instagram
create table if not exists public.ig_conversas (
  id                 text primary key,                   -- id do cliente no Instagram (IGSID)
  loja               text not null,
  nome               text,
  usuario            text,                               -- @ do cliente
  status             text not null default 'bia' check (status in ('bia', 'equipe')),
  pausada_ate        timestamptz,
  processando_ate    timestamptz,                        -- trava para não responder duas vezes ao mesmo tempo
  historico          jsonb not null default '[]',        -- conversa no formato do Gemini (com as consultas às tabelas)
  lead               jsonb,                              -- temperatura, estágio, intenção, sinais, objeções, resumo
  alertas            jsonb not null default '[]',
  resultado          text check (resultado in ('compareceu', 'comprou', 'nao_veio', 'perdido')),
  followups          int  not null default 0,
  ultima_msg_cliente_em timestamptz,
  ultima_msg_em      timestamptz,
  ultima_fala        text,                               -- quem falou por último: cliente, bia ou equipe
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
alter table public.ig_conversas add column if not exists ultima_fala text;
create index if not exists ig_conversas_atualizado on public.ig_conversas (atualizado_em desc);

create table if not exists public.ig_mensagens (
  id           bigserial primary key,
  conversa_id  text not null references public.ig_conversas (id) on delete cascade,
  de           text not null check (de in ('cliente', 'bia', 'equipe')),
  texto        text,
  mid          text unique,                              -- id da mensagem no Instagram
  processada   boolean not null default false,           -- mensagem do cliente já respondida?
  midia        jsonb,                                    -- anexos (áudio, foto)
  criado_em    timestamptz not null default now()
);
create index if not exists ig_mensagens_conversa on public.ig_mensagens (conversa_id, criado_em);

create table if not exists public.ig_agendamentos (
  id            bigserial primary key,
  conversa_id   text references public.ig_conversas (id) on delete set null,
  loja          text not null,
  dados         jsonb not null,                          -- tudo o que a Bia registrou
  titulo        text,
  data          date,
  horario       text,
  resultado     text check (resultado in ('compareceu', 'comprou', 'nao_veio', 'remarcou')),
  criado_em     timestamptz not null default now()
);
create index if not exists ig_agendamentos_data on public.ig_agendamentos (data);

-- ---------------------------------------------------------------- aprendizado
alter table public.bia_aprendizados add column if not exists status    text not null default 'ativo';  -- ativo | sugerido | rejeitado
alter table public.bia_aprendizados add column if not exists evidencia text;
alter table public.bia_aprendizados add column if not exists risco     text;

create table if not exists public.bia_relatorios (
  id         bigserial primary key,
  loja       text not null,
  periodo    text,
  metricas   jsonb,
  analise    jsonb,
  criado_em  timestamptz not null default now()
);

-- Custo: tokens usados por dia (para acompanhar o gasto com o Gemini).
create table if not exists public.bia_uso (
  dia      date primary key,
  chamadas int    not null default 0,
  entrada  bigint not null default 0,
  saida    bigint not null default 0
);
create or replace function public.bia_registrar_uso(p_entrada bigint, p_saida bigint)
returns void language sql security definer set search_path = public as $$
  insert into public.bia_uso (dia, chamadas, entrada, saida)
  values ((now() at time zone 'America/Sao_Paulo')::date, 1, p_entrada, p_saida)
  on conflict (dia) do update set chamadas = bia_uso.chamadas + 1,
    entrada = bia_uso.entrada + excluded.entrada, saida = bia_uso.saida + excluded.saida;
$$;
revoke all on function public.bia_registrar_uso(bigint, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- segurança
-- Dados de clientes reais: só o servidor (chave de serviço) e quem faz login no painel acessam.
alter table public.bia_config      enable row level security;
alter table public.ig_conversas    enable row level security;
alter table public.ig_mensagens    enable row level security;
alter table public.ig_agendamentos enable row level security;
alter table public.bia_relatorios  enable row level security;
alter table public.bia_uso         enable row level security;
alter table public.bia_segredos    enable row level security;

do $$
declare t text;
begin
  foreach t in array array['bia_config', 'ig_conversas', 'ig_mensagens', 'ig_agendamentos', 'bia_relatorios', 'bia_uso'] loop
    execute format('drop policy if exists "painel_%1$s" on public.%1$I', t);
    execute format('create policy "painel_%1$s" on public.%1$I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- rotinas automáticas
-- A cada hora: retomada de clientes que sumiram, análise diária (uma vez por dia) e renovação do token.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule('bia-rotinas') where exists (select 1 from cron.job where jobname = 'bia-rotinas');
select cron.schedule('bia-rotinas', '7 * * * *', $$
  select net.http_post(
    url := 'https://gcawgwnthuqijgamkvhv.supabase.co/functions/v1/rotinas',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{"acao": "agendadas"}'::jsonb
  );
$$);
