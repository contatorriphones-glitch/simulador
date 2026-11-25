// Despesas da loja (aluguel, salários, empréstimos…) entre o sistema e o financeiro do Mercado Phone.
// {}                      → traz as despesas lançadas no Mercado Phone desde 01/12 para a tabela despesas (roda sozinho a cada 30 min)
// { enviar: true, ids? }  → lança no Mercado Phone as despesas importadas do GestaoClick (só as que contam como despesa e ainda não foram)
// A chave do Mercado Phone fica só aqui no servidor.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MP = "https://platform.mercadophone.tech/api/v1";
const KEY = Deno.env.get("MERCADOPHONE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const norm = (t: unknown) => String(t ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const INICIO_MP = "2026-12-01"; // novembro/2026 inteiro fica no GestaoClick
const CAT_DESPESAS = 154622, CAT_COMPRA = 154623, CAT_OUTRAS = 154624;
const PAG_DINHEIRO = 63068, PAG_PIX = 63069;
const CHAVE_ENVIO = "5f3d31d129e207f7f7d75594"; // só eu (Claude) disparo o envio em lote, para não lançar em duplicidade

async function mp(path: string, metodo = "GET", corpo?: unknown): Promise<any> {
  for (let t = 0; t < 5; t++) {
    const r = await fetch(MP + path, { method: metodo, headers: { "X-API-Key": KEY, "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
    if (r.status === 429) { await new Promise(ok => setTimeout(ok, 3000 * (t + 1))); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Mercado Phone ${r.status} em ${path.split("?")[0]}: ${JSON.stringify(j.detail ?? j).slice(0, 250)}`);
    return j;
  }
  throw new Error("Mercado Phone ocupado. Tente de novo em 1 minuto.");
}

async function categorias(): Promise<{ id: number; nome: string; flagTipo: unknown; financeiroCategoriaPaiId: number | null }[]> {
  return (await mp("/finance/categories?limit=300")).items || [];
}

async function sincronizar() {
  const cats = new Map((await categorias()).map(c => [c.id, c.nome]));
  const itens: any[] = [];
  for (let p = 1; p < 30; p++) {
    const j = await mp(`/finance?limit=300&page=${p}&dataVencimentoInicial=${INICIO_MP}`);
    itens.push(...(j.items || []));
    if ((j.items || []).length < 300) break;
  }
  const despesasMp = itens.filter(x => String(x.flagTipoMovimentacao) === "2");
  // não duplica as que foram enviadas daqui (despesas do GestaoClick)
  const { data: enviadas } = await sb.from("despesas").select("mp_id").eq("origem", "gc").not("mp_id", "is", null);
  const jaEnviadas = new Set((enviadas || []).map(x => Number(x.mp_id)));
  const { data: existentes } = await sb.from("despesas").select("id").eq("origem", "mp");
  const existe = new Set((existentes || []).map(x => x.id));
  let novas = 0, atualizadas = 0;
  for (const x of despesasMp) {
    if (jaEnviadas.has(Number(x.id))) continue;
    const id = "mp:" + x.id;
    const base = {
      data: String(x.dataUltimoPagamento || x.dataVencimento || "").slice(0, 10) || null, descricao: x.titulo || null,
      categoria: cats.get(Number(x.categoriaId))?.replace(/^\d+(\.\d+)*\s*/, "") || null, valor: Number(x.valorTotal ?? x.valor) || 0,
      situacao: x.dataUltimoPagamento ? "pago" : "aberto", mp_id: Number(x.id), raw: x, atualizado_em: new Date().toISOString(),
    };
    if (existe.has(id)) { await sb.from("despesas").update(base).eq("id", id); atualizadas++; }
    else { await sb.from("despesas").insert({ id, origem: "mp", ...base, tipo: Number(x.categoriaId) === CAT_COMPRA ? "compra_aparelho" : "operacional" }); novas++; }
  }
  // lançamento apagado no Mercado Phone → deixa de contar
  const vivos = new Set(despesasMp.map(x => "mp:" + x.id));
  const sumiram = [...existe].filter(id => !vivos.has(id));
  if (sumiram.length) await sb.from("despesas").update({ tipo: "ignorar", situacao: "excluido no Mercado Phone" }).in("id", sumiram);
  return { lidas: despesasMp.length, novas, atualizadas, excluidas: sumiram.length };
}

async function enviar(ids?: string[]) {
  let q = sb.from("despesas").select("*").eq("origem", "gc").is("mp_id", null);
  if (ids?.length) q = q.in("id", ids);
  const { data: lista, error } = await q;
  if (error) throw error;
  const cats = await categorias();
  const catPorNome = new Map(cats.filter(c => c.financeiroCategoriaPaiId === CAT_DESPESAS).map(c => [norm(c.nome.replace(/^\d+(\.\d+)*\s*/, "")), c.id]));
  const res: { id: string; status: string; erro?: string }[] = [];
  for (const d of lista || []) {
    if (d.tipo === "ignorar" || !(Number(d.valor) > 0)) { res.push({ id: d.id, status: "pulado" }); continue; }
    try {
      let categoriaId = d.tipo === "compra_aparelho" ? CAT_COMPRA : CAT_OUTRAS;
      const nomeCat = String(d.categoria || "").trim();
      if (d.tipo !== "compra_aparelho" && nomeCat) {
        const k = norm(nomeCat);
        if (!catPorNome.has(k)) {
          const c = await mp("/finance/categories", "POST", { nome: nomeCat, flagTipo: 2, financeiroCategoriaPaiId: CAT_DESPESAS });
          if (c?.id) catPorNome.set(k, Number(c.id));
        }
        categoriaId = catPorNome.get(k) ?? CAT_OUTRAS;
      }
      const forma = norm(d.raw?.nome_forma_pagamento || "");
      const corpo: Record<string, unknown> = {
        titulo: String(d.descricao || nomeCat || "Despesa").slice(0, 120), flagTipoMovimentacao: 2, valor: Number(d.valor), dataVencimento: d.data,
        categoriaId, observacoes: `Importado do GestaoClick (pagamento ${String(d.id).replace("gc:", "")})${d.fornecedor ? " · " + d.fornecedor : ""}`,
      };
      if (d.situacao === "pago") corpo.pagamentos = [{ formaPagamentoId: /DINHEIRO|ESPECIE/.test(forma) ? PAG_DINHEIRO : PAG_PIX, valorPagamento: Number(d.valor), dataPagamento: d.data }];
      const r = await mp("/finance", "POST", corpo);
      if (!r?.id) throw new Error("Mercado Phone não devolveu o número do lançamento");
      await sb.from("despesas").update({ mp_id: Number(r.id), atualizado_em: new Date().toISOString() }).eq("id", d.id);
      res.push({ id: d.id, status: "ok" });
    } catch (e) { res.push({ id: d.id, status: "erro", erro: (e as Error).message }); }
  }
  return { enviadas: res.filter(r => r.status === "ok").length, erros: res.filter(r => r.status === "erro"), puladas: res.filter(r => r.status === "pulado").length };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!KEY) return json({ erro: "Chave do Mercado Phone não configurada no servidor." }, 500);
  const b = await req.json().catch(() => ({}));
  try {
    if (b.enviar && b.chave !== CHAVE_ENVIO) return json({ erro: "não autorizado" }, 403);
    return json(b.enviar ? await enviar(Array.isArray(b.ids) ? b.ids : undefined) : await sincronizar());
  } catch (e) { return json({ erro: (e as Error).message }, 500); }
});
