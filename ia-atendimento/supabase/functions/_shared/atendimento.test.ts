// Testes do atendimento no Instagram com banco, Gemini, Instagram e Telegram simulados.
// Rodar: deno test supabase/functions/_shared/  (depois de node preparar-servidor.js)
import { assert, assertEquals } from 'jsr:@std/assert@1';
import { criarAtendimento } from './atendimento.ts';
import { assinaturaValida } from './externos.ts';
import type { Banco, Config, Conversa, Mensagem } from './banco.ts';

// deno-lint-ignore no-explicit-any
type Json = any;

function bancoMemoria(cfg: Partial<Config> = {}) {
  const estado = {
    config: { ativo: true, loja: 'kronos-phone', modelo: 'm', modelo_reserva: null, pausa_horas: 12, followup_ativo: true,
      aprovar_automatico: false, telegram_chat_id: '1', ultima_analise_em: null, ...cfg } as Config,
    conversas: new Map<string, Conversa>(),
    mensagens: [] as Mensagem[],
    aprendizados: [] as Json[],
    agendamentos: [] as Json[],
    relatorios: [] as Json[],
  };
  let seq = 0;
  const banco: Banco = {
    config: async () => ({ ...estado.config }),
    salvarConfig: async (p) => { Object.assign(estado.config, p); },
    segredo: async () => null,
    salvarSegredo: async () => {},
    conversa: async (id) => (estado.conversas.has(id) ? structuredClone(estado.conversas.get(id)!) : null),
    criarConversa: async (c) => { if (!estado.conversas.has(c.id)) estado.conversas.set(c.id, { status: 'bia', historico: [], alertas: [], followups: 0, ...c }); },
    atualizarConversa: async (id, p) => { Object.assign(estado.conversas.get(id)!, structuredClone(p)); },
    travar: async (id, agora, s) => {
      const c = estado.conversas.get(id)!;
      if (c.processando_ate && new Date(c.processando_ate) > agora) return false;
      c.processando_ate = new Date(agora.getTime() + s * 1000).toISOString();
      return true;
    },
    destravar: async (id) => { estado.conversas.get(id)!.processando_ate = null; },
    inserirMensagem: async (m) => {
      if (m.mid && estado.mensagens.some((x) => x.mid === m.mid)) return false;
      estado.mensagens.push({ processada: false, ...m, id: ++seq, criado_em: new Date().toISOString() });
      return true;
    },
    mensagemPorMid: async (mid) => estado.mensagens.find((m) => m.mid === mid) || null,
    pendentes: async (cid) => estado.mensagens.filter((m) => m.conversa_id === cid && m.de === 'cliente' && !m.processada),
    marcarProcessadas: async (ids) => { for (const m of estado.mensagens) if (ids.includes(m.id!)) m.processada = true; },
    mensagens: async (cid) => estado.mensagens.filter((m) => m.conversa_id === cid),
    aprendizadosAtivos: async () => estado.aprendizados.filter((a) => a.ativo).map((a) => a.texto),
    inserirAprendizados: async (l) => { estado.aprendizados.push(...l); },
    inserirAgendamento: async (a) => { estado.agendamentos.push(a); },
    agendamentos: async () => estado.agendamentos,
    conversasDesde: async () => [...estado.conversas.values()].map((c) => structuredClone(c)),
    inserirRelatorio: async (r) => { estado.relatorios.push(r); },
    registrarUso: async () => {},
  };
  return { banco, estado };
}

// Gemini roteirizado: cada chamada devolve as próximas partes da fila.
function geminiFalso(roteiro: Json[][]) {
  const pedidos: Json[] = [];
  return {
    pedidos,
    gemini: {
      gerar: async (_m: string, p: Json) => {
        pedidos.push(structuredClone(p));
        if (p.esquemaJson?.properties?.temperatura) {
          return { partes: [{ text: JSON.stringify({ temperatura: 'quente', estagio: 'proposta', intencao: 80, resumo: 'Quer 17 Pro Max', interesse: '17 Pro Max' }) }] };
        }
        const proximo = roteiro.shift();
        if (!proximo) throw new Error('roteiro acabou');
        return { partes: proximo };
      },
    },
  };
}

function ambiente({ roteiro = [] as Json[][], cfg = {} as Partial<Config>, agora = new Date('2026-10-12T17:00:00Z') } = {}) {
  const { banco, estado } = bancoMemoria(cfg);
  const g = geminiFalso(roteiro);
  const enviados: Json[] = [];
  const telegram: string[] = [];
  const agenda: Json[] = [];
  let mid = 0;
  const relogio = { agora };
  const atendimento = criarAtendimento({
    banco, gemini: g.gemini,
    ig: {
      enviarTexto: async (para, texto) => { enviados.push({ para, texto }); return `bia-${++mid}`; },
      digitando: async () => {},
      perfil: async () => ({ nome: 'Robert', usuario: 'robert.r' }),
      baixarMidia: async () => ({ mimeType: 'audio/mp4', data: 'QUJD' }),
    },
    avisos: { telegram: async (t) => { telegram.push(t); }, agenda: async (c) => { agenda.push(c); return { ok: true }; } },
    agendaSegredo: 's', agora: () => relogio.agora, dormir: async () => {}, esperaDigitacaoMs: 0, esperaEcoMs: 0, pausaEntreBolhas: () => 0,
  });
  return { atendimento, estado, enviados, telegram, agenda, pedidos: g.pedidos, relogio };
}

const webhook = (eventos: Json[]) => ({ object: 'instagram', entry: [{ id: 'loja', messaging: eventos }] });
const doCliente = (id: string, mid: string, text: string, extra: Json = {}) => ({ sender: { id }, recipient: { id: 'loja' }, message: { mid, text, ...extra } });
const eco = (cliente: string, mid: string, text: string) => ({ sender: { id: 'loja' }, recipient: { id: cliente }, message: { mid, text, is_echo: true } });
const rodar = (a: Json, eventos: Json[]) => Promise.all(a.receberWebhook(webhook(eventos)));

Deno.test('responde em balões e registra tudo', async () => {
  const t = ambiente({ roteiro: [[{ text: 'Olaaaaa 😊 Sou a Bia!\n---\nQual modelo você procura?' }]] });
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'oi')]);
  assertEquals(t.enviados.map((e) => e.texto), ['Olaaaaa 😊 Sou a Bia!', 'Qual modelo você procura?']);
  assert(t.estado.mensagens.filter((m) => m.de === 'cliente').every((m) => m.processada));
  assertEquals(t.estado.conversas.get('c1')!.nome, 'Robert');
  assertEquals(t.estado.conversas.get('c1')!.lead.temperatura, 'quente');
  assert(t.telegram.some((x) => x.startsWith('🔥 Cliente quente')));
});

Deno.test('mensagem repetida pelo Instagram não gera resposta dupla', async () => {
  const t = ambiente({ roteiro: [[{ text: 'Oi!' }]] });
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'oi')]);
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'oi')]);
  assertEquals(t.enviados.length, 1);
});

Deno.test('consulta as tabelas, esconde o total parcelado e agenda no Google com o título das vendedoras', async () => {
  const t = ambiente({ roteiro: [
    [{ functionCall: { name: 'avaliar_aparelho', args: { modelo: '15 Pro Max', gb: 256, bateria: 79, defeitos: ['vidro_tela'] } } }],
    [{ functionCall: { name: 'simular_pagamento', args: { valor: 1000, parcelas: [18] } } }],
    [{ functionCall: { name: 'registrar_agendamento', args: { nome: 'Robert', modelo_aparelho: '17 Pro Max', gb: '256', condicao: 'lacrado', cor: 'Azul', data: '2026-10-13', horario: '15:00', instagram: 'robert.r', whatsapp: '11999990000', trocas: [{ modelo: '15 Pro Max', gb: 256, cor: 'Natural' }] } } }],
    [{ text: 'Agendado! Traga um documento com foto 😊' }],
  ] });
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'Nome: Robert ...')]);
  const respostaSimulacao = t.pedidos[2].conteudos.at(-1).parts[0].functionResponse.response.resultado;
  assertEquals(respostaSimulacao.opcoes[0], { parcelas: 18, valor_parcela: 66.28 });
  assertEquals(t.estado.agendamentos[0].titulo,
    'ROBERT - IPHONE 17 PRO MAX 256GB LACRADO AZUL 💙 - @ROBERT.R - 11999990000 - (UPGRADE IPHONE 15 PRO MAX 256GB NATURAL 🩶, AVALIADO EM 3.100,00)');
  assertEquals(t.agenda[0].data, '2026-10-13');
  assertEquals(t.agenda[0].lembrete_min, 30);
  assert(t.telegram.some((x) => x.startsWith('📅 Novo agendamento')));
});

Deno.test('avisar equipe: alerta no Telegram e a Bia continua respondendo', async () => {
  const t = ambiente({ roteiro: [
    [{ functionCall: { name: 'avisar_equipe', args: { motivo: 'pediu preço de MacBook' } } }],
    [{ text: 'Temos sim! Qual modelo de MacBook?' }],
    [{ text: 'Ainda aqui 😊' }],
  ] });
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'tem macbook?')]);
  await rodar(t.atendimento, [doCliente('c1', 'm2', 'oi?')]);
  assert(t.telegram.some((x) => x.includes('pediu preço de MacBook')));
  assertEquals(t.enviados.map((e) => e.texto), ['Temos sim! Qual modelo de MacBook?', 'Ainda aqui 😊']);
  assertEquals(t.estado.conversas.get('c1')!.status, 'bia');
});

Deno.test('eco da própria Bia é ignorado; resposta da equipe pausa a Bia e ela volta depois da pausa', async () => {
  const t = ambiente({ roteiro: [[{ text: 'Oi!' }], [{ text: 'Voltei 😊' }]] });
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'oi')]);
  await rodar(t.atendimento, [eco('c1', 'bia-1', 'Oi!')]);
  assertEquals(t.estado.conversas.get('c1')!.status, 'bia');

  await rodar(t.atendimento, [eco('c1', 'equipe-1', 'Aqui é a Ana da loja, posso ajudar?')]);
  assertEquals(t.estado.conversas.get('c1')!.status, 'equipe');
  await rodar(t.atendimento, [doCliente('c1', 'm2', 'pode sim')]);
  assertEquals(t.enviados.length, 1); // Bia ficou quieta

  t.relogio.agora = new Date(t.relogio.agora.getTime() + 13 * 3600 * 1000);
  await rodar(t.atendimento, [doCliente('c1', 'm3', 'oi de novo')]);
  assertEquals(t.enviados.at(-1).texto, 'Voltei 😊');
  // a fala da equipe ficou no histórico para a Bia saber o que foi dito
  assert(JSON.stringify(t.estado.conversas.get('c1')!.historico).includes('Aqui é a Ana da loja'));
});

Deno.test('chave geral desligada: ninguém recebe resposta da Bia', async () => {
  const t = ambiente({ cfg: { ativo: false }, roteiro: [[{ text: 'Oi!' }]] });
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'oi')]);
  assertEquals(t.enviados.length, 0);
  assertEquals(t.estado.mensagens.length, 1); // mas a mensagem fica registrada
});

Deno.test('áudio do cliente vai para o Gemini, mas não fica pesado no histórico', async () => {
  const t = ambiente({ roteiro: [[{ text: 'Entendi seu áudio!' }]] });
  await rodar(t.atendimento, [doCliente('c1', 'm1', undefined as unknown as string, { attachments: [{ type: 'audio', payload: { url: 'https://cdn/a.mp4' } }] })]);
  const partes = t.pedidos[0].conteudos.at(-1).parts;
  assert(partes.some((p: Json) => p.inlineData?.mimeType === 'audio/mp4'));
  assert(!JSON.stringify(t.estado.conversas.get('c1')!.historico).includes('inlineData'));
  assertEquals(t.enviados[0].texto, 'Entendi seu áudio!');
});

Deno.test('Gemini fora do ar: equipe é avisada e a mensagem fica para responder depois', async () => {
  const t = ambiente({ roteiro: [] });
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'oi')]);
  assert(t.telegram.some((x) => x.startsWith('⚠️ A Bia não conseguiu responder')));
  assertEquals(t.estado.mensagens.find((m) => m.mid === 'm1')!.processada, false);
});

Deno.test('retomada: só cliente quente/morno, 2h+ sem responder, uma vez, em horário comercial', async () => {
  const t = ambiente({ roteiro: [[{ text: 'Oi!' }], [{ text: 'Conseguiu ver as opções? 😊' }]] });
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'quanto ta o 17 pro max')]);
  assertEquals(await t.atendimento.retomarConversas(), 0); // ainda não passou 2h
  t.relogio.agora = new Date(t.relogio.agora.getTime() + 3 * 3600 * 1000); // 17h -> 20h UTC = 17h em Brasília
  assertEquals(await t.atendimento.retomarConversas(), 1);
  assertEquals(t.enviados.at(-1).texto, 'Conseguiu ver as opções? 😊');
  assertEquals(await t.atendimento.retomarConversas(), 0); // não repete
});

Deno.test('retomada não acontece de madrugada', async () => {
  const t = ambiente({ roteiro: [[{ text: 'Oi!' }], [{ text: 'retomada' }]], agora: new Date('2026-10-12T01:00:00Z') }); // 22h em Brasília
  await rodar(t.atendimento, [doCliente('c1', 'm1', 'quanto ta o 17 pro max')]);
  t.relogio.agora = new Date('2026-10-12T05:00:00Z'); // 2h da manhã em Brasília
  assertEquals(await t.atendimento.retomarConversas(), 0);
});

Deno.test('análise diária: sugestões esperam aprovação; com aprovação automática, só as de baixo risco e sem dinheiro entram', async () => {
  const analise = { resumo: 'Clientes somem depois do preço.', funciona: ['checklist'], nao_funciona: ['preço seco'], sugestoes: [
    { regra: 'Depois de apresentar o modelo, pergunte qual cor o cliente prefere.', motivo: 'engaja', risco: 'baixo' },
    { regra: 'Ofereça desconto de R$ 100 no Pix.', motivo: 'fecha', risco: 'baixo' },
    { regra: 'Mude a abordagem de troca.', motivo: 'x', risco: 'medio' },
  ] };
  for (const auto of [false, true]) {
    const t = ambiente({ cfg: { aprovar_automatico: auto }, roteiro: [[{ text: 'Oi!' }], [{ text: JSON.stringify(analise) }]], agora: new Date('2026-10-13T01:30:00Z') }); // 22h30 Brasília
    await rodar(t.atendimento, [doCliente('c1', 'm1', 'oi')]);
    const r = await t.atendimento.analisar();
    assert(r);
    const ativos = t.estado.aprendizados.filter((a) => a.ativo).map((a) => a.texto);
    assertEquals(ativos, auto ? ['Depois de apresentar o modelo, pergunte qual cor o cliente prefere.'] : []);
    assertEquals(t.estado.aprendizados.length, 3);
    assert(t.telegram.some((x) => x.startsWith('📊 Resumo da Bia')));
    assertEquals(await t.atendimento.analisar(), null); // não roda duas vezes no mesmo dia
  }
});

Deno.test('webhook: só aceita avisos assinados pela Meta', async () => {
  const corpo = '{"object":"instagram"}';
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode('segredo'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = Array.from(new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo)))).map((b) => b.toString(16).padStart(2, '0')).join('');
  assert(await assinaturaValida(corpo, `sha256=${sig}`, 'segredo'));
  assert(!(await assinaturaValida(corpo, `sha256=${sig}`, 'outro')));
  assert(!(await assinaturaValida(corpo + ' ', `sha256=${sig}`, 'segredo')));
  assert(!(await assinaturaValida(corpo, null, 'segredo')));
});
