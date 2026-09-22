# Fechamento de Comissão — Design

Data: 2026-09-22

## Objetivo

Substituir o fechamento de comissão manual (gerente lê vendas postadas no grupo de
WhatsApp e anota à mão) por um sistema automático que:

- Lê os pedidos de venda direto do GestãoClick (já integrado no app do dono).
- Calcula comissão por combo, acessório avulso, aparelho vendido acima da tabela,
  agendamento e bônus especiais, respeitando a classificação (A/B/C) de cada
  colaboradora.
- Calcula automaticamente quem bateu meta individual (mensal) e meta de equipe
  (semanal).
- Guarda tudo permanentemente no Supabase, incluindo o status de pagamento
  (Pago / Pendente / Pago parcial + valor faltante), editável por qualquer gerente.
- Aparece como uma aba nova, protegida por senha, em **dois lugares**: o app do
  dono (Replit) e o app das colaboradoras (`contatorriphones-glitch/simulador`,
  publicado via GitHub Pages em `contatorriphones-glitch.github.io/simulador`).

## Arquitetura

```
GestãoClick (/api/vendas/)  ──┐
                                ├──► api-server (Replit, dono) — calcula comissão
Supabase (config + histórico) ──┘         │
                                            ├─► Nova aba no app do dono (React)
                                            └─► Nova aba no index.html das
                                                colaboradoras (fetch pra mesma API)
```

- O cálculo roda **só** no `api-server` do dono, porque só ele tem acesso ao
  GestãoClick hoje. O app das colaboradoras (`index.html`, HTML+JS puro, sem
  backend próprio) chama essa mesma API via `fetch` — não duplica lógica de
  cálculo.
- Config (classificação, metas, tabela de preço de referência, senha) e histórico
  (fechamentos salvos + status de pagamento) ficam no Supabase — lidos e escritos
  pelos dois apps, sempre pela mesma fonte.
- Publicar a mudança no app das colaboradoras significa: editar `index.html`
  neste repositório, e o merge pra branch `main` (GitHub Pages publica a partir
  dela) só acontece com aprovação explícita do usuário — nunca automático.

## Dados de origem (GestãoClick)

Cada pedido de venda (`GET /api/vendas/:id` via o proxy já existente) traz, em
`atributos[]`, os campos usados pra atribuir comissão:

- `VENDEDOR` — nome de quem vendeu de verdade (não o `nome_vendedor` oficial do
  pedido, que pode ser só quem cadastrou no sistema).
- `AGENDAMENTO` — nome de quem agendou o cliente que resultou nessa venda. Só
  existe em pedidos concretizados — não há registro de agendamento que não virou
  venda, então "agendamento feito" = "venda concretizada com esse atributo
  preenchido".
- `ADQ` — quando presente/preenchido ("Sim"), indica cliente vindo de follow up.
  Campo novo no GestãoClick (cadastrado em 22/09/26); pedidos anteriores a essa
  data não têm esse atributo — tratar ausência como "não".

Em `produtos[]`, cada item tem `nome_produto` e `valor_total` (já com desconto
aplicado). O aparelho vendido é o item cujo nome bate com um modelo de iPhone;
os demais itens (case, película, fonte, cabo etc.) são acessórios.

## Regras de comissão

**Classificação por colaboradora** (A/B/C, editável): multiplica os valores fixos
abaixo por 1 (A), 1/2 (B) ou 1/3 (C) — exceto onde indicado "igual pra todos".

| Evento | A | B | C |
|---|---|---|---|
| Combo Protection (acessórios somando R$165) | R$15 | R$7,50 | R$5 |
| Combo Premium (acessórios somando R$465) | R$30 | R$15 | R$10 |
| Acessório avulso (fora de combo) | 5% do valor — **igual pra todos** |
| Agendamento (venda com atributo AGENDAMENTO) | R$8 | R$4 | R$2,67 |
| Bônus ADQ (atributo ADQ = Sim) | R$20 — **igual pra todos**, soma pra quem agendou |
| Aparelho vendido acima da tabela de referência | 10% da diferença — **igual pra todos** |
| Aparelho vendido (só Joana) | R$3 por aparelho — **só ela, soma à parte** |

**Detecção de combo**: soma o valor de todos os itens de acessório (não o
aparelho) dentro do pedido. Se der exatamente R$165 → Protection; se der
R$465 → Premium. Não depende de quais itens específicos apareceram — é pela
soma total, porque a composição real observada nos dados varia (ex: uma venda
Premium real não teve item de "protetor de cabo" separado, mas ainda assim
somou R$465).

**Aparelho acima da tabela**: compara `valor_total` do item do aparelho com o
preço de referência daquele modelo+capacidade na `tabela_precos_referencia`. Se
vendido por mais, comissão de 10% sobre a diferença. Tabela editável/colável
pela gerente.

**Meta individual (mensal, período do mês civil)**:
- Presencial: 50 combos/mês → R$300 (A) ou 30 combos/mês → R$300 (A) — usa a
  faixa mais alta atingida. B recebe metade do valor, C um terço — quantidade
  pra bater é igual pra todos.
- Online: 70 agendamentos/mês → R$300 (A) ou 40 agendamentos/mês → R$200 (A) —
  mesma lógica de fração por classificação, quantidade igual pra todos.

**Meta de equipe (semanal, quantidade editável, hoje 55 aparelhos/semana)**: se
o total de aparelhos vendidos na semana bater a meta, todas as colaboradoras
ativas recebem R$250 cada (valor também editável), sem variar por classificação.

## Modelo de dados (Supabase)

```sql
create table colaboradoras (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  classificacao text not null check (classificacao in ('A','B','C')),
  ativo boolean not null default true
);

create table metas_config (
  id int primary key default 1,
  meta_equipe_semanal_qtd int not null default 55,
  meta_equipe_semanal_valor numeric not null default 250,
  meta_presencial_baixa_qtd int not null default 30,
  meta_presencial_baixa_valor numeric not null default 200,
  meta_presencial_alta_qtd int not null default 50,
  meta_presencial_alta_valor numeric not null default 300,
  meta_online_baixa_qtd int not null default 40,
  meta_online_baixa_valor numeric not null default 200,
  meta_online_alta_qtd int not null default 70,
  meta_online_alta_valor numeric not null default 300,
  atualizado_em timestamptz not null default now()
);

create table tabela_precos_referencia (
  modelo text not null,
  gb text not null,
  preco_referencia numeric not null,
  primary key (modelo, gb)
);

create table config_acesso_comissao (
  id int primary key default 1,
  senha text not null
);

create table fechamento_comissao_semanal (
  id uuid primary key default gen_random_uuid(),
  semana_inicio date not null,
  semana_fim date not null,
  colaboradora_id uuid references colaboradoras(id),
  detalhamento jsonb not null default '[]'::jsonb,
  valor_total numeric not null default 0,
  meta_equipe_batida boolean not null default false,
  status_pagamento text not null default 'pendente'
    check (status_pagamento in ('pendente','pago','parcial')),
  valor_faltante numeric,
  observacao_pagamento text,
  pago_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (semana_inicio, colaboradora_id)
);

create table fechamento_metas_mensal (
  id uuid primary key default gen_random_uuid(),
  mes text not null, -- 'YYYY-MM'
  colaboradora_id uuid references colaboradoras(id),
  combos_presencial_qtd int not null default 0,
  agendamentos_online_qtd int not null default 0,
  valor_presencial numeric not null default 0,
  valor_online numeric not null default 0,
  valor_total numeric not null default 0,
  status_pagamento text not null default 'pendente'
    check (status_pagamento in ('pendente','pago','parcial')),
  valor_faltante numeric,
  observacao_pagamento text,
  pago_em timestamptz,
  criado_em timestamptz not null default now(),
  unique (mes, colaboradora_id)
);
```

Todas as tabelas com RLS habilitado e policy permissiva pra `anon`, mesmo padrão
já usado em `precos_aparelhos`/`fechamento_diario`.

## UI

Nova aba **"💼 Comissão"**, protegida por senha única (comparada contra
`config_acesso_comissao`, guardada em `localStorage`/sessão depois de digitada
uma vez).

Seletor de período no topo (semana pra Comissões/Meta Equipe, mês pra Metas
Individuais) + botão "Gerar fechamento" que dispara o cálculo.

Três módulos, cada um com seu total:
1. **💰 Comissões (semanal)** — uma linha expansível por colaboradora com o
   detalhamento item a item, total individual, seletor de status de pagamento
   (Pendente/Pago/Parcial, com campo de valor faltante + observação quando
   parcial), e total geral no fim.
2. **🎯 Meta em Equipe (semanal)** — cartão único, verde "BATIDA" com valor
   total a distribuir, ou vermelho com quanto faltou.
3. **🏆 Metas Individuais (mensal)** — uma linha por colaboradora com dois
   indicadores (presencial/online), verde com valor quando bate, vermelho com
   "não bateu a meta" quando não bate.

Seção **⚙️ Config** (mesma aba): editar classificação A/B/C por colaboradora,
editar quantidades/valores de todas as metas, colar/editar tabela de preço de
referência, trocar a senha de acesso.

## Fora de escopo (YAGNI)

- Login individual por gerente (senha única aprovada).
- Contagem de agendamentos que não viraram venda (não há como capturar isso
  hoje no GestãoClick).
- Qualquer cálculo envolvendo os atributos "APARELHO DE UPGRADE"/"VALOR PAGO
  UPGRADE" vistos nos dados — não fazem parte das regras de comissão descritas.

## Riscos / pontos de atenção

- `ADQ` e `AGENDAMENTO` só existem em pedidos a partir de 21-22/09/2026 — o
  cálculo precisa tratar pedidos mais antigos sem esses atributos como
  ausentes (sem bônus), não como erro.
- Combo detectado por soma exata (165/465) pode falhar se um desconto pontual
  mudar o total por poucos centavos — vale considerar tolerância pequena
  (ex: ±R$1) se aparecerem casos assim na prática.
