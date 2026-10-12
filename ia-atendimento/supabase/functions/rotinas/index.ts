// Rotinas: chamadas a cada hora pelo agendador do banco (pg_cron) e pelos botões do painel.
//   agendadas         -> retomada de clientes, análise diária (1x/dia, depois das 22h) e renovação do token
//   analisar_agora    -> análise imediata (painel)
//   telegram_conectar -> descobre o grupo do Telegram onde o bot foi adicionado (painel)
//   telegram_testar   -> manda uma mensagem de teste (painel)
import { criarServico } from '../_shared/servico.ts';

const servico = criarServico();
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const resposta = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// Ações do painel exigem alguém logado no Supabase Auth.
async function usuarioLogado(req: Request) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const r = await fetch(`${servico.env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { Authorization: auth, apikey: servico.env('SUPABASE_ANON_KEY') },
  });
  return r.ok;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const { acao } = await req.json().catch(() => ({ acao: 'agendadas' }));
  const { atendimento, renovarToken, banco, avisos, env } = servico;

  try {
    // Seguro de chamar a qualquer momento: cada parte só age quando é a hora.
    if (acao === 'agendadas') {
      const [retomadas, analise, token] = await Promise.allSettled([atendimento.retomarConversas(), atendimento.analisar(), renovarToken()]);
      return resposta({ retomadas: retomadas.status === 'fulfilled' ? retomadas.value : String(retomadas.reason),
        analise: analise.status === 'fulfilled' ? !!analise.value : String(analise.reason),
        token: token.status === 'fulfilled' ? token.value : String(token.reason) });
    }

    if (!(await usuarioLogado(req))) return resposta({ erro: 'faça login no painel' }, 401);

    if (acao === 'analisar_agora') return resposta(await atendimento.analisar({ forcar: true }) || { aviso: 'sem conversas nos últimos 7 dias' });

    if (acao === 'telegram_conectar') {
      const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/getUpdates`);
      const j = await r.json();
      const chats = (j.result || []).map((u: { message?: { chat: { id: number; title?: string; type: string } } }) => u.message?.chat).filter(Boolean);
      const grupo = chats.reverse().find((c: { type: string }) => c.type !== 'private') || chats[0];
      if (!grupo) return resposta({ erro: 'Adicione o bot ao grupo e mande qualquer mensagem no grupo; depois tente de novo.' }, 400);
      await banco.salvarConfig({ telegram_chat_id: String(grupo.id) });
      await avisos.telegram('✅ Bia conectada! Os alertas da equipe vão chegar aqui.');
      return resposta({ ok: true, grupo: grupo.title || grupo.id });
    }

    if (acao === 'telegram_testar') {
      await avisos.telegram('🔔 Teste de alerta da Bia: está tudo funcionando.');
      return resposta({ ok: true });
    }

    return resposta({ erro: 'ação desconhecida' }, 400);
  } catch (e) {
    console.error(acao, e);
    return resposta({ erro: String((e as Error).message || e) }, 500);
  }
});
