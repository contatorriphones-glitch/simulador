// Webhook do Instagram: a Meta avisa aqui cada mensagem recebida (e cada eco das enviadas).
import { assinaturaValida } from '../_shared/externos.ts';
import { criarServico } from '../_shared/servico.ts';

const servico = criarServico();

// deno-lint-ignore no-explicit-any
declare const EdgeRuntime: { waitUntil(p: Promise<any>): void };

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // Verificação feita pela Meta ao cadastrar o webhook.
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === servico.env('IG_VERIFY_TOKEN');
    return ok ? new Response(url.searchParams.get('hub.challenge') || '') : new Response('proibido', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('método não permitido', { status: 405 });

  const corpo = await req.text();
  if (!(await assinaturaValida(corpo, req.headers.get('x-hub-signature-256'), servico.env('IG_APP_SECRET')))) {
    return new Response('assinatura inválida', { status: 401 });
  }
  let payload;
  try { payload = JSON.parse(corpo); } catch { return new Response('json inválido', { status: 400 }); }

  // Responde na hora para a Meta e atende em segundo plano.
  const tarefas = servico.atendimento.receberWebhook(payload);
  EdgeRuntime.waitUntil(Promise.allSettled(tarefas).then((r) => {
    for (const x of r) if (x.status === 'rejected') console.error('atendimento:', x.reason);
  }));
  return new Response('EVENT_RECEIVED');
});
