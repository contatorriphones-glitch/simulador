// Atendimento da Bia no Instagram: recebe mensagens, responde, percebe quando a equipe
// assume, classifica o cliente (quente/morno/frio), retoma quem sumiu e analisa os
// resultados todo dia para sugerir melhorias.
import { criarMotor } from './gerado/motor.js';
import * as nucleo from './gerado/nucleo.js';
import { LOJAS } from './gerado/lojas.js';

// O núcleo é JavaScript puro (compartilhado com a página de teste): usamos sem tipos rígidos.
// deno-lint-ignore no-explicit-any
const N: any = nucleo;
import type { Banco, Config, Conversa, Mensagem } from './banco.ts';
import type { Avisos, Gemini, Instagram } from './externos.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

export interface Dependencias {
  banco: Banco;
  gemini: Gemini;
  ig: Instagram;
  avisos: Avisos;
  agendaSegredo?: string;
  agora?: () => Date;
  dormir?: (ms: number) => Promise<void>;
  esperaDigitacaoMs?: number;   // espera o cliente terminar de mandar mensagens seguidas
  esperaEcoMs?: number;         // espera antes de decidir se uma mensagem da loja foi da equipe
  pausaEntreBolhas?: (texto: string) => number;
}

const FUSO = 'America/Sao_Paulo';
const HORA = 3600 * 1000;
const ANEXOS: Record<string, string> = {
  audio: 'um áudio', image: 'uma foto', video: 'um vídeo', file: 'um arquivo',
  share: 'um post compartilhado', story_mention: 'uma menção nos stories', ig_reel: 'um reels', reel: 'um reels',
};

// ---------------------------------------------------------------- classificação do cliente
const SISTEMA_LEAD = `Você analisa conversas de vendas de iPhone pelo Instagram e classifica o cliente.
Temperatura:
- quente: intenção clara de compra agora (pediu valor de modelo específico E falou de pagamento/troca/horário/endereço, preencheu checklist ou questionário, quer comprar hoje, pediu desconto para fechar).
- morno: interessado, mas ainda decidindo (perguntou preço, comparando, "vou pensar", dúvidas sobre garantia/troca).
- frio: só pesquisando, sem urgência, orçamento muito abaixo, sumiu logo após o preço ou disse que não quer.
Estágios: novo, qualificando, proposta, negociando, agendado, perdido.
Seja objetivo. Escreva em português.`;

const ESQUEMA_LEAD = {
  type: 'object',
  properties: {
    temperatura: { type: 'string', enum: ['quente', 'morno', 'frio'] },
    estagio: { type: 'string', enum: ['novo', 'qualificando', 'proposta', 'negociando', 'agendado', 'perdido'] },
    intencao: { type: 'integer', description: 'Chance de compra de 0 a 100' },
    interesse: { type: 'string', description: 'Produto de interesse, ex.: "17 Pro Max 256 lacrado"' },
    sinais: { type: 'array', items: { type: 'string' } },
    objecoes: { type: 'array', items: { type: 'string' } },
    proximo_passo: { type: 'string' },
    resumo: { type: 'string', description: 'Até 2 frases' },
  },
  required: ['temperatura', 'estagio', 'intencao', 'resumo'],
};

// ---------------------------------------------------------------- análise diária
const SISTEMA_ANALISE = `Você é um gerente de vendas experiente analisando os atendimentos de uma atendente virtual (Bia) que vende iPhones pelo Instagram.
Com base nas métricas e nas conversas, identifique o que está funcionando e o que não está, e proponha regras curtas e práticas para a Bia vender mais.
Regras propostas:
- precisam ser específicas e aplicáveis numa conversa ("Quando o cliente disser X, faça Y");
- nunca podem mudar preços, descontos, taxas, brindes ou garantia (isso é decidido pelo dono);
- marque o risco: baixo (tom, ordem das perguntas, forma de explicar), médio (abordagem de venda), alto (qualquer coisa que envolva valores ou promessas).
Baseie-se em evidências das conversas. Português do Brasil.`;

const ESQUEMA_ANALISE = {
  type: 'object',
  properties: {
    resumo: { type: 'string' },
    funciona: { type: 'array', items: { type: 'string' } },
    nao_funciona: { type: 'array', items: { type: 'string' } },
    sugestoes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          regra: { type: 'string' },
          motivo: { type: 'string' },
          evidencia: { type: 'string' },
          risco: { type: 'string', enum: ['baixo', 'medio', 'alto'] },
        },
        required: ['regra', 'motivo', 'risco'],
      },
    },
  },
  required: ['resumo', 'funciona', 'nao_funciona', 'sugestoes'],
};

// Regras que mexem em dinheiro ou promessa nunca entram sozinhas, mesmo marcadas como risco baixo.
const SENSIVEL = /desconto|pre[çc]o|valor|r\$|%|parcel|taxa|brinde|garantia|grátis|gratis|promo/i;

export function criarAtendimento(d: Dependencias) {
  const { banco, gemini, ig, avisos } = d;
  const agora = d.agora || (() => new Date());
  const dormir = d.dormir || ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const esperaDigitacao = d.esperaDigitacaoMs ?? 4000;
  const esperaEco = d.esperaEcoMs ?? 5000;
  const pausaEntreBolhas = d.pausaEntreBolhas || ((t: string) => Math.min(800 + t.length * 20, 3000));
  const iso = () => agora().toISOString();

  function loja(slug: string) {
    // deno-lint-ignore no-explicit-any
    const lojas: Record<string, any> = LOJAS;
    const L = lojas[slug] || lojas['kronos-phone'];
    return { L, motor: criarMotor(L.dados) };
  }
  const nomeCliente = (c: Conversa) => c.nome || (c.usuario ? '@' + c.usuario : 'Cliente');

  // ---------------------------------------------------------------- webhook
  // Devolve as tarefas para rodar em segundo plano (o Instagram precisa de resposta rápida).
  function receberWebhook(payload: Json): Promise<unknown>[] {
    const tarefas: Promise<unknown>[] = [];
    for (const entrada of payload?.entry || []) {
      for (const ev of entrada.messaging || []) {
        const msg = ev.message;
        if (!msg || msg.is_deleted || msg.is_unsupported) continue;
        if (msg.is_echo) tarefas.push(tratarEco(ev.recipient.id, msg));
        else tarefas.push(tratarMensagemCliente(ev.sender.id, msg));
      }
    }
    return tarefas;
  }

  async function tratarMensagemCliente(id: string, msg: Json) {
    const cfg = await banco.config();
    if (!(await banco.conversa(id))) {
      const p = await ig.perfil(id);
      await banco.criarConversa({ id, loja: cfg.loja, nome: p.nome || null, usuario: p.usuario || null });
    }
    const midia = (msg.attachments || []).map((a: Json) => ({ tipo: a.type, url: a.payload?.url })).filter((a: Json) => a.tipo);
    const nova = await banco.inserirMensagem({
      conversa_id: id, de: 'cliente', texto: msg.text || null, mid: msg.mid, midia: midia.length ? midia : null,
    });
    if (!nova) return; // o Instagram reenviou um aviso que já tínhamos recebido
    await banco.atualizarConversa(id, { ultima_msg_cliente_em: iso(), ultima_msg_em: iso(), ultima_fala: 'cliente', followups: 0 });

    // Espera o cliente terminar ("oi", "tem 15 pro?", "quanto fica"): quem responde é a última mensagem.
    await dormir(esperaDigitacao);
    const pendentes = await banco.pendentes(id);
    if (pendentes.at(-1)?.mid !== msg.mid) return;
    await processar(id);
  }

  // Toda mensagem enviada pela conta da loja volta como "eco". Se não foi a Bia, foi alguém
  // da equipe respondendo pelo Instagram: a Bia sai da conversa sozinha.
  async function tratarEco(clienteId: string, msg: Json) {
    await dormir(esperaEco);
    if (await banco.mensagemPorMid(msg.mid)) return;
    const conv = await banco.conversa(clienteId);
    if (!conv) return;
    const cfg = await banco.config();
    const texto = msg.text || '[anexo enviado pela equipe]';
    await banco.inserirMensagem({ conversa_id: clienteId, de: 'equipe', texto, mid: msg.mid, processada: true });
    const pendentes = await banco.pendentes(clienteId);
    await banco.marcarProcessadas(pendentes.map((p) => p.id!).filter(Boolean));
    const historico = [...(conv.historico || [])];
    const doCliente = pendentes.filter((p) => p.texto).map((p) => ({ text: p.texto }));
    if (doCliente.length) historico.push({ role: 'user', parts: doCliente });
    historico.push({ role: 'model', parts: [{ text: texto }] });
    await banco.atualizarConversa(clienteId, {
      status: 'equipe', pausada_ate: new Date(agora().getTime() + cfg.pausa_horas * HORA).toISOString(),
      historico: aparar(historico), ultima_msg_em: iso(), ultima_fala: 'equipe',
    });
  }

  // ---------------------------------------------------------------- responder
  async function processar(id: string) {
    const cfg = await banco.config();
    if (!cfg.ativo) return;
    let conv = await banco.conversa(id);
    if (!conv) return;
    if (conv.status === 'equipe') {
      if (conv.pausada_ate && new Date(conv.pausada_ate) > agora()) return;
      await banco.atualizarConversa(id, { status: 'bia', pausada_ate: null });
    }
    if (!(await banco.travar(id, agora(), 150))) return; // já tem um atendimento em andamento
    try {
      for (let volta = 0; volta < 3; volta++) {
        const pendentes = await banco.pendentes(id);
        if (!pendentes.length) break;
        conv = (await banco.conversa(id))!;
        try {
          await responder(conv, pendentes, cfg);
          await banco.marcarProcessadas(pendentes.map((p) => p.id!).filter(Boolean));
        } catch (e) {
          await avisos.telegram(`⚠️ A Bia não conseguiu responder ${nomeCliente(conv)}: ${String((e as Error).message || e).slice(0, 200)}\nResponda pelo Instagram.`);
          break;
        }
      }
    } finally {
      await banco.destravar(id);
    }
    await classificarLead(id, cfg).catch(() => {});
  }

  async function partesDoCliente(pendentes: Mensagem[]) {
    const paraIA: Json[] = [];
    const paraSalvar: Json[] = [];
    for (const m of pendentes) {
      if (m.texto) { paraIA.push({ text: m.texto }); paraSalvar.push({ text: m.texto }); }
      for (const a of (m.midia as Json[]) || []) {
        const aviso = { text: `[o cliente enviou ${ANEXOS[a.tipo] || 'um anexo'}]` };
        paraIA.push(aviso);
        paraSalvar.push(aviso);
        if ((a.tipo === 'audio' || a.tipo === 'image') && a.url) {
          const arquivo = await ig.baixarMidia(a.url);
          if (arquivo) paraIA.push({ inlineData: arquivo });
        }
      }
    }
    if (!paraIA.length) { paraIA.push({ text: '[mensagem sem texto]' }); paraSalvar.push({ text: '[mensagem sem texto]' }); }
    return { paraIA, paraSalvar };
  }

  async function responder(conv: Conversa, pendentes: Mensagem[], cfg: Config) {
    const { L, motor } = loja(conv.loja);
    const historico: Json[] = [...(conv.historico || [])];
    const { paraIA, paraSalvar } = await partesDoCliente(pendentes);
    const indiceCliente = historico.length;
    historico.push({ role: 'user', parts: paraIA });

    const tarefas: Promise<unknown>[] = [];
    const alertas: Json[] = [];
    const ferramentas = N.criarFerramentas(motor, L.dados, {
      registrarAgendamento: async (a: Json) => {
        const trocas = (a.trocas || []).map((t: Json) => ({ ...t, valor: N.avaliacaoFeita(historico, motor, t) }));
        const ag = { ...a, trocas, registrado_em: iso() };
        const ev = N.eventoAgenda(ag, motor, L.dados.loja);
        await banco.inserirAgendamento({
          conversa_id: conv.id, loja: conv.loja, dados: ag, titulo: ev?.titulo || null, data: ev?.data || null, horario: ev?.horario || null,
        });
        if (ev) {
          tarefas.push(avisos.agenda(N.corpoAppsScript(ev, d.agendaSegredo, 30)).then((r) => {
            if (!r.ok) return avisos.telegram(`⚠️ Não consegui pôr no Google Agenda (${r.erro}). Adicione manualmente:\n${ev.titulo}\n${ev.data} ${ev.horario}`);
          }));
        }
        tarefas.push(avisos.telegram(`📅 Novo agendamento (${L.dados.loja.nome})\n${ev?.titulo || a.nome}\n${a.data} às ${a.horario}`));
        return { ok: true };
      },
      avisarEquipe: (motivo: string) => {
        alertas.push({ motivo, em: iso() });
        tarefas.push(avisos.telegram(`🔔 ${L.dados.loja.nome}: ${nomeCliente(conv)} precisa de atenção\nMotivo: ${motivo}\nA Bia continua atendendo. Para assumir, é só responder pelo Instagram.`));
      },
    });
    const declaracoes = ferramentas.map(({ run: _run, ...f }: Json) => f);
    const sistema = N.montarInstrucoes({
      prompt: L.prompt, garantia: L.garantia, relogio: N.relogio(agora(), FUSO),
      aprendizados: await banco.aprendizadosAtivos(), lead: conv.lead,
    });

    await ig.digitando(conv.id);
    for (let rodada = 0; rodada < 6; rodada++) {
      const { partes } = await gemini.gerar(cfg.modelo, { sistema, conteudos: historico, ferramentas: declaracoes }, cfg.modelo_reserva);
      historico.push({ role: 'model', parts: partes });
      const texto = partes.filter((p: Json) => p.text && !p.thought).map((p: Json) => p.text).join('\n').trim();
      if (texto) await enviarBolhas(conv.id, texto);
      const chamadas = partes.filter((p: Json) => p.functionCall);
      if (!chamadas.length) break;
      const respostas = [];
      for (const { functionCall: fc } of chamadas) {
        respostas.push({ functionResponse: { name: fc.name, response: { resultado: await N.executarFerramenta(ferramentas, fc) } } });
      }
      historico.push({ role: 'user', parts: respostas });
      await ig.digitando(conv.id);
    }

    historico[indiceCliente] = { role: 'user', parts: paraSalvar }; // sem guardar áudio/foto no histórico
    await Promise.allSettled(tarefas);
    await banco.atualizarConversa(conv.id, {
      historico: aparar(historico), ultima_msg_em: iso(), ultima_fala: 'bia', alertas: [...(conv.alertas || []), ...alertas],
    });
  }

  async function enviarBolhas(para: string, texto: string) {
    const bolhas = N.dividirBolhas(texto).flatMap((b: string) => (b.length > 950 ? b.match(/[\s\S]{1,950}/g) : [b]));
    for (const [i, b] of bolhas.entries()) {
      if (i > 0) { await ig.digitando(para); await dormir(pausaEntreBolhas(b)); }
      const mid = await ig.enviarTexto(para, b);
      await banco.inserirMensagem({ conversa_id: para, de: 'bia', texto: b, mid, processada: true });
    }
  }

  // Mantém o histórico enxuto (custa menos): últimas ~80 partes, começando numa fala do cliente.
  function aparar(h: Json[]) {
    if (h.length <= 80) return h;
    let i = h.length - 80;
    while (i < h.length && !(h[i].role === 'user' && h[i].parts?.some((p: Json) => p.text))) i++;
    return h.slice(i);
  }

  // ---------------------------------------------------------------- temperatura do cliente
  async function classificarLead(id: string, cfg?: Config) {
    cfg = cfg || await banco.config();
    const conv = await banco.conversa(id);
    if (!conv) return null;
    const msgs = await banco.mensagens(id, 80);
    const transcricao = msgs.filter((m) => m.texto)
      .map((m) => `${m.de === 'cliente' ? 'Cliente' : m.de === 'bia' ? 'Bia' : 'Equipe'}: ${m.texto}`).join('\n').slice(-8000);
    if (!transcricao) return null;
    const { partes } = await gemini.gerar(cfg.modelo, {
      sistema: SISTEMA_LEAD, conteudos: [{ role: 'user', parts: [{ text: transcricao }] }], esquemaJson: ESQUEMA_LEAD,
    }, cfg.modelo_reserva);
    const lead = { ...JSON.parse(partes.map((p: Json) => p.text || '').join('')), atualizado_em: iso() };
    await banco.atualizarConversa(id, { lead });
    if (lead.temperatura === 'quente' && conv.lead?.temperatura !== 'quente' && lead.estagio !== 'agendado') {
      await avisos.telegram(`🔥 Cliente quente: ${nomeCliente(conv)}\n${lead.interesse ? `Quer: ${lead.interesse}\n` : ''}${lead.resumo}\nPróximo passo: ${lead.proximo_passo || '-'}`);
    }
    return lead;
  }

  // ---------------------------------------------------------------- retomada (follow-up)
  // Uma única mensagem para cliente quente/morno que parou de responder há 2h+, sempre dentro
  // das 24h que o Instagram permite e em horário comercial.
  async function retomarConversas() {
    const cfg = await banco.config();
    if (!cfg.ativo || !cfg.followup_ativo) return 0;
    const hora = Number(N.relogio(agora(), FUSO).hora.slice(0, 2));
    if (hora < 9 || hora >= 21) return 0;
    const t = agora().getTime();
    let enviados = 0;
    for (const conv of await banco.conversasDesde(new Date(t - 24 * HORA).toISOString(), 200)) {
      const ultimaCliente = conv.ultima_msg_cliente_em ? new Date(conv.ultima_msg_cliente_em).getTime() : 0;
      const elegivel = conv.status === 'bia' && !conv.resultado && (conv.followups || 0) === 0 &&
        ['quente', 'morno'].includes(conv.lead?.temperatura) && !['agendado', 'perdido'].includes(conv.lead?.estagio) &&
        conv.ultima_fala === 'bia' && ultimaCliente && t - ultimaCliente >= 2 * HORA && t - ultimaCliente <= 22 * HORA;
      if (!elegivel || !(await banco.travar(conv.id, agora(), 90))) continue;
      try {
        const { L } = loja(conv.loja);
        const sistema = N.montarInstrucoes({
          prompt: L.prompt, garantia: L.garantia, relogio: N.relogio(agora(), FUSO),
          aprendizados: await banco.aprendizadosAtivos(), lead: conv.lead,
        }) + `\n\n## Tarefa agora\nO cliente parou de responder há algumas horas. Escreva UMA retomada curta (1 ou 2 balões), natural e leve, lembrando onde vocês pararam e convidando para o próximo passo. Não invente valores novos e não pressione.`;
        const aviso = { role: 'user', parts: [{ text: '[o cliente ficou algumas horas sem responder]' }] };
        const historico = [...(conv.historico || []), aviso];
        const { partes } = await gemini.gerar(cfg.modelo, { sistema, conteudos: historico }, cfg.modelo_reserva);
        const texto = partes.filter((p: Json) => p.text && !p.thought).map((p: Json) => p.text).join('\n').trim();
        if (!texto) continue;
        await enviarBolhas(conv.id, texto);
        historico.push({ role: 'model', parts: [{ text: texto }] });
        await banco.atualizarConversa(conv.id, { historico: aparar(historico), followups: 1, ultima_msg_em: iso(), ultima_fala: 'bia' });
        enviados++;
      } finally {
        await banco.destravar(conv.id);
      }
    }
    return enviados;
  }

  // ---------------------------------------------------------------- análise diária
  async function analisar({ forcar = false } = {}) {
    const cfg = await banco.config();
    const t = agora().getTime();
    if (!forcar) {
      const hora = Number(N.relogio(agora(), FUSO).hora.slice(0, 2));
      if (hora < 22) return null;
      if (cfg.ultima_analise_em && t - new Date(cfg.ultima_analise_em).getTime() < 20 * HORA) return null;
    }
    const desde = new Date(t - 7 * 24 * HORA).toISOString();
    const conversas = await banco.conversasDesde(desde, 80);
    if (!conversas.length) return null;
    const agendamentos = await banco.agendamentos(desde);
    const agendou = new Set(agendamentos.map((a) => a.conversa_id));
    const conta = (f: (c: Conversa) => boolean) => conversas.filter(f).length;
    const metricas = {
      conversas: conversas.length,
      quentes: conta((c) => c.lead?.temperatura === 'quente'),
      mornos: conta((c) => c.lead?.temperatura === 'morno'),
      frios: conta((c) => c.lead?.temperatura === 'frio'),
      agendaram: agendou.size,
      taxa_agendamento: Math.round((agendou.size / conversas.length) * 100),
      compareceram: agendamentos.filter((a) => ['compareceu', 'comprou'].includes(a.resultado as string)).length,
      compraram: agendamentos.filter((a) => a.resultado === 'comprou').length + conta((c) => c.resultado === 'comprou'),
      nao_vieram: agendamentos.filter((a) => a.resultado === 'nao_veio').length,
      equipe_assumiu: conta((c) => c.status === 'equipe'),
      retomadas: conta((c) => (c.followups || 0) > 0),
    };

    // Amostra equilibrada: as que agendaram e as que não agendaram (onde há mais a aprender).
    const ordenadas = [...conversas.filter((c) => agendou.has(c.id)).slice(0, 10), ...conversas.filter((c) => !agendou.has(c.id)).slice(0, 15)];
    const amostras: string[] = [];
    for (const c of ordenadas) {
      const msgs = (await banco.mensagens(c.id, 60)).filter((m) => m.texto);
      const texto = msgs.map((m) => `${m.de === 'cliente' ? 'C' : m.de === 'bia' ? 'Bia' : 'Equipe'}: ${m.texto}`).join('\n');
      amostras.push(`### Conversa (${agendou.has(c.id) ? 'AGENDOU' : 'não agendou'}${c.resultado ? `, resultado: ${c.resultado}` : ''}; temperatura: ${c.lead?.temperatura || '?'})\n${texto.slice(-2500)}`);
    }
    const aprendizadosAtuais = await banco.aprendizadosAtivos();
    const pedido = `## Métricas dos últimos 7 dias\n${JSON.stringify(metricas)}\n\n## Regras que a Bia já segue\n${aprendizadosAtuais.map((a) => '- ' + a).join('\n') || '(nenhuma)'}\n\n## Conversas\n${amostras.join('\n\n')}`;
    const { partes } = await gemini.gerar(cfg.modelo, {
      sistema: SISTEMA_ANALISE, conteudos: [{ role: 'user', parts: [{ text: pedido }] }], esquemaJson: ESQUEMA_ANALISE,
    }, cfg.modelo_reserva);
    const analise = JSON.parse(partes.map((p: Json) => p.text || '').join(''));

    const dia = N.relogio(agora(), FUSO).data;
    const novas = (analise.sugestoes || []).slice(0, 5).map((s: Json) => {
      const automatica = cfg.aprovar_automatico && s.risco === 'baixo' && !SENSIVEL.test(s.regra);
      return {
        id: crypto.randomUUID(), texto: s.regra, ativo: automatica, status: automatica ? 'ativo' : 'sugerido',
        origem: `análise automática de ${dia}${automatica ? ' (aprovada automaticamente)' : ''}`,
        evidencia: [s.motivo, s.evidencia].filter(Boolean).join(' | '), risco: s.risco, criado_em: iso(), atualizado_em: iso(),
      };
    });
    await banco.inserirAprendizados(novas);
    await banco.inserirRelatorio({ loja: cfg.loja, periodo: 'últimos 7 dias', metricas, analise });
    await banco.salvarConfig({ ultima_analise_em: iso() });
    const pendentesAprovacao = novas.filter((n: Json) => !n.ativo).length;
    await avisos.telegram(
      `📊 Resumo da Bia (7 dias)\n${metricas.conversas} conversas · ${metricas.agendaram} agendamentos (${metricas.taxa_agendamento}%) · ` +
      `${metricas.quentes} quentes\n\n${analise.resumo}` +
      (pendentesAprovacao ? `\n\n💡 ${pendentesAprovacao} sugestão(ões) de melhoria esperando sua aprovação no painel.` : ''),
    );
    return { metricas, analise, sugestoes: novas };
  }

  return { receberWebhook, processar, classificarLead, retomarConversas, analisar, tratarMensagemCliente, tratarEco };
}
