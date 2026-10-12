// Monta o atendimento com as chaves configuradas no Supabase (Edge Functions > Secrets).
import { bancoSupabase } from './banco.ts';
import { avisosApi, geminiApi, instagramApi, renovarTokenInstagram } from './externos.ts';
import { criarAtendimento } from './atendimento.ts';

const env = (k: string) => Deno.env.get(k) || '';

export function criarServico() {
  const banco = bancoSupabase(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  // O token do Instagram fica no banco (renovado sozinho); o do Secret é só o primeiro.
  let tokenEmMemoria = '';
  async function token() {
    if (tokenEmMemoria) return tokenEmMemoria;
    const salvo = await banco.segredo('ig_token');
    if (salvo?.valor) return (tokenEmMemoria = salvo.valor);
    tokenEmMemoria = env('IG_TOKEN');
    if (tokenEmMemoria) await banco.salvarSegredo('ig_token', tokenEmMemoria);
    return tokenEmMemoria;
  }

  async function renovarToken() {
    const salvo = await banco.segredo('ig_token');
    if (!salvo) return 'sem token salvo';
    if (Date.now() - new Date(salvo.atualizado_em).getTime() < 30 * 24 * 3600 * 1000) return 'ainda válido';
    const novo = await renovarTokenInstagram(salvo.valor);
    if (!novo) return 'falhou';
    await banco.salvarSegredo('ig_token', novo);
    tokenEmMemoria = novo;
    return 'renovado';
  }

  const avisos = avisosApi({
    telegramToken: env('TELEGRAM_BOT_TOKEN'),
    chatId: async () => (await banco.config()).telegram_chat_id,
    agendaUrl: env('AGENDA_URL'),
  });
  const atendimento = criarAtendimento({
    banco,
    gemini: geminiApi(env('GEMINI_API_KEY'), (e, s) => banco.registrarUso(e, s)),
    ig: instagramApi(token, env('IG_GRAPH_VERSION') || 'v24.0'),
    avisos,
    agendaSegredo: env('AGENDA_SEGREDO'),
  });
  return { banco, avisos, atendimento, renovarToken, env };
}
