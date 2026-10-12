// Integrações externas: Gemini, Instagram, Telegram e Google Agenda.
// Cada uma é um objeto simples, para os testes poderem trocar por versões falsas.

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- Gemini
// deno-lint-ignore no-explicit-any
type Json = any;

export interface PedidoGemini {
  sistema: string;
  conteudos: Json[];
  ferramentas?: Json[];          // declarações (sem a função run)
  esquemaJson?: Json;            // resposta estruturada (classificação, análise)
}

export interface Gemini {
  gerar(modelo: string, pedido: PedidoGemini, reserva?: string | null): Promise<{ partes: Json[] }>;
}

const passageiro = (status: number, msg: string) =>
  [500, 502, 503, 504].includes(status) || (status === 429 && !/per ?day|daily|PerDay/i.test(msg)) || /high demand|overloaded|unavailable/i.test(msg);

export function geminiApi(chave: string, registrarUso?: (entrada: number, saida: number) => Promise<void>): Gemini {
  async function chamar(modelo: string, p: PedidoGemini) {
    const corpo: Json = {
      systemInstruction: { parts: [{ text: p.sistema }] },
      contents: p.conteudos,
    };
    if (p.ferramentas?.length) corpo.tools = [{ functionDeclarations: p.ferramentas }];
    if (p.esquemaJson) corpo.generationConfig = { responseMimeType: 'application/json', responseSchema: p.esquemaJson };
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': chave }, body: JSON.stringify(corpo),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }

  return {
    async gerar(modelo, pedido, reserva) {
      const tentativas: [string, number][] = [[modelo, 0], [modelo, 2000], [modelo, 6000]];
      if (reserva && reserva !== modelo) tentativas.push([reserva, 0], [reserva, 4000]);
      let ultimo = '';
      for (const [m, espera] of tentativas) {
        if (espera) await dormir(espera);
        const { ok, status, j } = await chamar(m, pedido);
        if (ok) {
          const u = j.usageMetadata || {};
          registrarUso?.(u.promptTokenCount || 0, (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0)).catch(() => {});
          const partes = j.candidates?.[0]?.content?.parts;
          if (!partes) throw new Error('Gemini: resposta vazia (' + (j.candidates?.[0]?.finishReason || j.promptFeedback?.blockReason || '?') + ')');
          return { partes };
        }
        ultimo = j.error?.message || `HTTP ${status}`;
        if (!passageiro(status, ultimo)) break;
      }
      throw new Error('Gemini: ' + ultimo);
    },
  };
}

// ---------------------------------------------------------------- Instagram
export interface Instagram {
  enviarTexto(para: string, texto: string): Promise<string | null>;   // devolve o mid
  digitando(para: string): Promise<void>;
  perfil(id: string): Promise<{ nome?: string; usuario?: string }>;
  baixarMidia(url: string): Promise<{ mimeType: string; data: string } | null>;
}

export function instagramApi(token: () => Promise<string>, versao = 'v24.0'): Instagram {
  const base = `https://graph.instagram.com/${versao}`;
  async function post(corpo: Json) {
    const r = await fetch(`${base}/me/messages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await token()}` }, body: JSON.stringify(corpo),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Instagram: ${j.error?.message || r.status}`);
    return j;
  }
  return {
    async enviarTexto(para, texto) {
      const j = await post({ recipient: { id: para }, message: { text: texto } });
      return j.message_id || null;
    },
    async digitando(para) {
      await post({ recipient: { id: para }, sender_action: 'typing_on' }).catch(() => {});
    },
    async perfil(id) {
      try {
        const r = await fetch(`${base}/${id}?fields=name,username`, { headers: { Authorization: `Bearer ${await token()}` } });
        const j = await r.json();
        return { nome: j.name, usuario: j.username };
      } catch { return {}; }
    },
    // Áudios e fotos do cliente: o Gemini ouve e enxerga (até 8 MB).
    async baixarMidia(url) {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.length > 8 * 1024 * 1024) return null;
        let bin = '';
        for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        return { mimeType: (r.headers.get('content-type') || 'application/octet-stream').split(';')[0], data: btoa(bin) };
      } catch { return null; }
    },
  };
}

// Renova o token do Instagram (vale 60 dias; renovamos a cada ~30).
export async function renovarTokenInstagram(token: string): Promise<string | null> {
  const r = await fetch(`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`);
  const j = await r.json().catch(() => ({}));
  return j.access_token || null;
}

// ---------------------------------------------------------------- avisos
export interface Avisos {
  telegram(texto: string): Promise<void>;
  agenda(corpo: Json): Promise<{ ok: boolean; erro?: string }>;
}

export function avisosApi(opcoes: { telegramToken?: string; chatId: () => Promise<string | null>; agendaUrl?: string }): Avisos {
  return {
    async telegram(texto) {
      const chat = await opcoes.chatId();
      if (!opcoes.telegramToken || !chat) return;
      await fetch(`https://api.telegram.org/bot${opcoes.telegramToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chat, text: texto, disable_web_page_preview: true }),
      }).catch(() => {});
    },
    async agenda(corpo) {
      if (!opcoes.agendaUrl) return { ok: false, erro: 'Google Agenda não configurado' };
      try {
        const r = await fetch(opcoes.agendaUrl, { method: 'POST', body: JSON.stringify(corpo), redirect: 'follow' });
        const j = await r.json().catch(() => ({}));
        return j.ok ? { ok: true } : { ok: false, erro: j.erro || `HTTP ${r.status}` };
      } catch (e) { return { ok: false, erro: String(e) }; }
    },
  };
}

// ---------------------------------------------------------------- segurança do webhook
// A Meta assina cada aviso com o App Secret; recusamos qualquer coisa sem assinatura válida.
export async function assinaturaValida(corpo: string, cabecalho: string | null, segredo: string): Promise<boolean> {
  if (!cabecalho?.startsWith('sha256=') || !segredo) return false;
  const chave = await crypto.subtle.importKey('raw', new TextEncoder().encode(segredo), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const assinatura = new Uint8Array(await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(corpo)));
  const esperado = Array.from(assinatura).map((b) => b.toString(16).padStart(2, '0')).join('');
  const recebido = cabecalho.slice(7);
  if (recebido.length !== esperado.length) return false;
  let diff = 0;
  for (let i = 0; i < esperado.length; i++) diff |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i);
  return diff === 0;
}
