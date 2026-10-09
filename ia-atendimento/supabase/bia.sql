-- Tabelas da Bia (IA de atendimento). Rode uma vez no Supabase: SQL Editor -> New query -> colar -> Run.
-- Pode rodar de novo sem problema: não apaga nada que já exista.

create table if not exists public.bia_conversas (
  id            text primary key,
  titulo        text,
  dados         jsonb not null,          -- conversa completa: mensagens, avaliações, observações, agendamentos
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.bia_aprendizados (
  id            text primary key,
  texto         text not null,           -- regra que a Bia passa a seguir
  ativo         boolean not null default true,
  origem        text,                    -- de onde veio (ex.: correção de uma resposta)
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- Mesmo padrão de acesso do sistema de estoque (página usa a chave publicável).
alter table public.bia_conversas    enable row level security;
alter table public.bia_aprendizados enable row level security;

drop policy if exists "bia_conversas_acesso" on public.bia_conversas;
create policy "bia_conversas_acesso" on public.bia_conversas
  for all to anon, authenticated using (true) with check (true);

drop policy if exists "bia_aprendizados_acesso" on public.bia_aprendizados;
create policy "bia_aprendizados_acesso" on public.bia_aprendizados
  for all to anon, authenticated using (true) with check (true);
