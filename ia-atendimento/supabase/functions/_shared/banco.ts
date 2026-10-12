// Acesso ao banco (Supabase/PostgREST) com a chave de serviço: só o servidor usa.
// O atendimento depende desta interface, e os testes usam uma versão em memória.

export interface Config {
  ativo: boolean;
  loja: string;
  modelo: string;
  modelo_reserva: string | null;
  pausa_horas: number;
  followup_ativo: boolean;
  aprovar_automatico: boolean;
  telegram_chat_id: string | null;
  ultima_analise_em: string | null;
}

export interface Mensagem {
  id?: number;
  conversa_id: string;
  de: 'cliente' | 'bia' | 'equipe';
  texto: string | null;
  mid?: string | null;
  processada?: boolean;
  midia?: unknown;
  criado_em?: string;
}

// deno-lint-ignore no-explicit-any
export type Conversa = Record<string, any> & { id: string };

export interface Banco {
  config(): Promise<Config>;
  salvarConfig(parcial: Partial<Config> & Record<string, unknown>): Promise<void>;
  segredo(nome: string): Promise<{ valor: string; atualizado_em: string } | null>;
  salvarSegredo(nome: string, valor: string): Promise<void>;
  conversa(id: string): Promise<Conversa | null>;
  criarConversa(c: Conversa): Promise<void>;
  atualizarConversa(id: string, parcial: Record<string, unknown>): Promise<void>;
  travar(id: string, agora: Date, segundos: number): Promise<boolean>;
  destravar(id: string): Promise<void>;
  inserirMensagem(m: Mensagem): Promise<boolean>;
  mensagemPorMid(mid: string): Promise<Mensagem | null>;
  pendentes(conversaId: string): Promise<Mensagem[]>;
  marcarProcessadas(ids: number[]): Promise<void>;
  mensagens(conversaId: string, limite?: number): Promise<Mensagem[]>;
  aprendizadosAtivos(): Promise<string[]>;
  inserirAprendizados(lista: Record<string, unknown>[]): Promise<void>;
  inserirAgendamento(a: Record<string, unknown>): Promise<void>;
  agendamentos(desdeIso: string): Promise<Record<string, unknown>[]>;
  conversasDesde(desdeIso: string, limite?: number): Promise<Conversa[]>;
  inserirRelatorio(r: Record<string, unknown>): Promise<void>;
  registrarUso(entrada: number, saida: number): Promise<void>;
}

export function bancoSupabase(url: string, chave: string): Banco {
  const base = `${url}/rest/v1`;
  const cabecalhos = (extra: Record<string, string> = {}) => ({
    apikey: chave, Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json', ...extra,
  });
  // deno-lint-ignore no-explicit-any
  async function req(metodo: string, caminho: string, corpo?: unknown, prefer = 'return=minimal'): Promise<any> {
    const r = await fetch(`${base}/${caminho}`, {
      method: metodo, headers: cabecalhos({ Prefer: prefer }), body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    if (!r.ok) throw new Error(`banco ${metodo} ${caminho.split('?')[0]}: ${r.status} ${(await r.text()).slice(0, 200)}`);
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const enc = encodeURIComponent;

  return {
    async config() {
      const [c] = await req('GET', 'bia_config?id=eq.1&select=*');
      return c;
    },
    async salvarConfig(parcial) {
      await req('PATCH', 'bia_config?id=eq.1', { ...parcial, atualizado_em: new Date().toISOString() });
    },
    async segredo(nome) {
      const [s] = await req('GET', `bia_segredos?nome=eq.${enc(nome)}&select=valor,atualizado_em`);
      return s || null;
    },
    async salvarSegredo(nome, valor) {
      await req('POST', 'bia_segredos?on_conflict=nome', { nome, valor, atualizado_em: new Date().toISOString() }, 'resolution=merge-duplicates,return=minimal');
    },
    async conversa(id) {
      const [c] = await req('GET', `ig_conversas?id=eq.${enc(id)}&select=*`);
      return c || null;
    },
    async criarConversa(c) {
      await req('POST', 'ig_conversas?on_conflict=id', c, 'resolution=ignore-duplicates,return=minimal');
    },
    async atualizarConversa(id, parcial) {
      await req('PATCH', `ig_conversas?id=eq.${enc(id)}`, { ...parcial, atualizado_em: new Date().toISOString() });
    },
    // Só um atendimento por conversa de cada vez: a trava vale até "segundos" depois de agora.
    async travar(id, agora, segundos) {
      const ate = new Date(agora.getTime() + segundos * 1000).toISOString();
      const linhas = await req('PATCH',
        `ig_conversas?id=eq.${enc(id)}&or=(processando_ate.is.null,processando_ate.lt.${enc(agora.toISOString())})`,
        { processando_ate: ate }, 'return=representation');
      return linhas.length > 0;
    },
    async destravar(id) {
      await req('PATCH', `ig_conversas?id=eq.${enc(id)}`, { processando_ate: null });
    },
    async inserirMensagem(m) {
      const linhas = await req('POST', 'ig_mensagens?on_conflict=mid', m, 'resolution=ignore-duplicates,return=representation');
      return linhas.length > 0;
    },
    async mensagemPorMid(mid) {
      const [m] = await req('GET', `ig_mensagens?mid=eq.${enc(mid)}&select=*`);
      return m || null;
    },
    async pendentes(conversaId) {
      return await req('GET', `ig_mensagens?conversa_id=eq.${enc(conversaId)}&de=eq.cliente&processada=eq.false&order=id.asc&select=*`);
    },
    async marcarProcessadas(ids) {
      if (ids.length) await req('PATCH', `ig_mensagens?id=in.(${ids.join(',')})`, { processada: true });
    },
    async mensagens(conversaId, limite = 200) {
      return await req('GET', `ig_mensagens?conversa_id=eq.${enc(conversaId)}&order=id.asc&limit=${limite}&select=de,texto,criado_em`);
    },
    async aprendizadosAtivos() {
      const linhas = await req('GET', 'bia_aprendizados?ativo=is.true&order=criado_em.asc&select=texto');
      return linhas.map((l: { texto: string }) => l.texto);
    },
    async inserirAprendizados(lista) {
      if (lista.length) await req('POST', 'bia_aprendizados', lista);
    },
    async inserirAgendamento(a) {
      await req('POST', 'ig_agendamentos', a);
    },
    async agendamentos(desdeIso) {
      return await req('GET', `ig_agendamentos?criado_em=gte.${enc(desdeIso)}&select=*`);
    },
    async conversasDesde(desdeIso, limite = 80) {
      return await req('GET', `ig_conversas?atualizado_em=gte.${enc(desdeIso)}&order=atualizado_em.desc&limit=${limite}&select=*`);
    },
    async inserirRelatorio(r) {
      await req('POST', 'bia_relatorios', r);
    },
    async registrarUso(entrada, saida) {
      await req('POST', 'rpc/bia_registrar_uso', { p_entrada: entrada, p_saida: saida });
    },
  };
}
