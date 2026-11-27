// mp-custos-vendas: deixa o custo de cada item das vendas do Mercado Phone igual ao custo do nosso sistema,
// para o lucro do Mercado Phone bater com o Relatório (o Mercado Phone guarda o custo dentro da venda).
// { chave, desde, ate, aplicar?: boolean, ids?: number[], limite?: number, vendedorSubstituto?: number }
// Sem `aplicar` só mostra o que mudaria. A anotação do cartão (que a edição apaga lá) vai para a observação da venda
// e fica guardada no nosso banco (vendas_mp_pagamentos_anotados).
import { createClient } from "jsr:@supabase/supabase-js@2";

const MP = "https://platform.mercadophone.tech/api/v1";
const KEY = Deno.env.get("MERCADOPHONE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CHAVE = "c8e41b07a95d3f62e1b4";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } });
const r2 = (n: number) => Math.round(n * 100) / 100;

async function mp(path: string, corpo?: unknown): Promise<any> {
  for (let t = 0; t < 8; t++) {
    const r = await fetch(MP + path, { method: corpo ? "POST" : "GET", headers: { "X-API-Key": KEY, "Content-Type": "application/json" }, body: corpo ? JSON.stringify(corpo) : undefined });
    if (r.status === 429) { await new Promise(ok => setTimeout(ok, 5000 * (t + 1))); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Mercado Phone ${r.status}: ${JSON.stringify(j.detail ?? j).slice(0, 200)}`);
    return j;
  }
  throw new Error("Mercado Phone ocupado");
}

Deno.serve(async (req: Request) => {
  const b = await req.json().catch(() => ({}));
  if (b.chave !== CHAVE) return json({ erro: "não autorizado" }, 403);
  const desde = b.desde || "2026-11-18", ate = b.ate || "2099-12-31", limite = Math.min(Number(b.limite) || 10, 30);
  let q = sb.from("vendas_mp").select("id,dia,itens,pagamentos").eq("status", "concluido").gte("dia", desde).lte("dia", ate).order("data_venda");
  if (Array.isArray(b.ids) && b.ids.length) q = q.in("id", b.ids);
  const { data: vendas, error } = await q;
  if (error) return json({ erro: error.message }, 500);

  // nosso custo de cada aparelho (mesma regra do Relatório) e de cada acessório
  const imeis = [...new Set((vendas || []).flatMap((v: any) => (v.itens || []).filter((i: any) => i.aparelho && i.imei).map((i: any) => String(i.imei))))];
  const { data: aps } = imeis.length ? await sb.from("aparelhos").select("id,imei,criado_em").in("imei", imeis) : { data: [] };
  const apPorImei = new Map<string, string>();
  for (const a of ((aps || []) as any[]).sort((x, y) => (x.criado_em || 0) - (y.criado_em || 0))) apPorImei.set(a.imei, a.id);
  const ids = [...new Set(apPorImei.values())];
  const { data: cs } = ids.length ? await sb.from("aparelhos_custos").select("aparelho_id,custo").in("aparelho_id", ids) : { data: [] };
  const custoAp = new Map(((cs || []) as any[]).filter(c => c.custo != null).map(c => [c.aparelho_id, Number(c.custo)]));
  const { data: vic } = await sb.from("vendas_itens_custo").select("venda_id,produto_id,imei,custo");
  const manual = new Map(((vic || []) as any[]).map(x => [`${x.venda_id}-${x.produto_id}`, Number(x.custo)]));
  const manualImei = new Map(((vic || []) as any[]).filter(x => x.imei).map(x => [String(x.imei), Number(x.custo)]));
  const nossoCusto = (v: any, i: any): number | null => {
    if (i.aparelho) {
      const apId = apPorImei.get(String(i.imei || ""));
      const cMp = i.fornecedor_mp && Number(i.custo_mp) > 0 && Number(i.custo_mp) !== Number(i.valorUnitario) ? Number(i.custo_mp) : null;
      const c = (apId && custoAp.has(apId) ? custoAp.get(apId)! : null) ?? manual.get(`${v.id}-${i.produtoId}`) ?? manualImei.get(String(i.imei || "")) ?? cMp;
      return c != null && c > 0 && c <= 20000 ? c : null;
    }
    if (i.acessorio && i.custo_unit != null && !i.custo_suspeito) return Number(i.custo_unit);
    return null;
  };

  // cópia original das anotações dos pagamentos (nunca é sobrescrita por uma versão já apagada)
  const backup = new Map<number, any[]>();
  for (let i = 0; i < (vendas || []).length; i += 200) {
    const { data: bk } = await sb.from("vendas_mp_pagamentos_anotados").select("venda_id,pagamentos").in("venda_id", (vendas || []).slice(i, i + 200).map((v: any) => v.id));
    for (const x of bk || []) backup.set(Number(x.venda_id), (x.pagamentos as any[]) || []);
  }
  const textoAnot = (pags: any[]) => pags.filter((p: any) => p.detalhes).map((p: any) => `${p.formaPagamentoDescricao}: ${p.detalhes}`).join(" | ");

  const res: any[] = [];
  let feitas = 0;
  for (const v of vendas || []) {
    if (feitas >= limite) break;
    const nossos = new Map<number, number>();
    for (const i of v.itens || []) { const c = nossoCusto(v, i); if (c != null) nossos.set(Number(i.produtoId), c); }
    if (!nossos.size) continue;
    let s: any;
    try { s = await mp(`/sales/${v.id}`); } catch (e) { res.push({ venda: v.id, erro: String((e as Error).message) }); feitas++; continue; }
    const mudancas = (s.itens || []).filter((i: any) => nossos.has(Number(i.produtoId)) && Math.abs(Number(i.valorCusto) - nossos.get(Number(i.produtoId))!) > 0.009)
      .map((i: any) => ({ item: i.produtoNome, de: Number(i.valorCusto), para: nossos.get(Number(i.produtoId)) }));
    const originais = backup.get(Number(v.id)) || [];
    const anot = textoAnot(originais.some((p: any) => p.detalhes) ? originais : (s.pagamentos || []));
    const faltaObs = !!anot && !String(s.observacao || "").includes(anot);
    if (!mudancas.length && !(b.aplicar && faltaObs)) continue;
    feitas++;
    const linha: any = { venda: v.id, dia: v.dia, mudancas, diferenca: r2(mudancas.reduce((t: number, m: any) => t + (m.de - m.para), 0)) };
    if (!b.aplicar) { res.push(linha); continue; }
    // anotações dos pagamentos: a edição apaga o campo lá → ficam na observação da venda e na cópia do nosso banco
    if (!backup.has(Number(v.id)) && (s.pagamentos || []).some((p: any) => p.detalhes)) await sb.from("vendas_mp_pagamentos_anotados").insert({ venda_id: v.id, pagamentos: s.pagamentos, guardado_em: new Date().toISOString() });
    const obsAtual = String(s.observacao || "");
    const corpo: any = {
      id: s.id, dataVenda: s.dataVenda, totalVenda: s.totalVenda, clienteId: s.clienteId, vendedorId: s.vendedorId, tipoVendaId: s.tipoVendaId,
      caixaId: s.caixaId, canalVendaId: s.canalVendaId, naturezaOperacaoId: s.naturezaOperacaoId, tipoEntregaId: s.tipoEntregaId,
      paramEmpresaId: s.paramEmpresaId, clienteIndicadorId: s.clienteIndicadorId, status: "concluido",
      observacao: anot && !obsAtual.includes(anot) ? [obsAtual, `Anotações dos pagamentos: ${anot}`].filter(Boolean).join(" · ") : (s.observacao ?? null),
      itens: (s.itens || []).map((i: any) => ({ id: i.id, produtoId: i.produtoId, quantidade: i.quantidade, valorUnitario: i.valorUnitario, valorCliente: i.valorCliente, desconto: i.desconto, valorTotal: i.valorTotal, observacao: i.observacao, valorCusto: nossos.get(Number(i.produtoId)) ?? i.valorCusto })),
      pagamentos: (s.pagamentos || []).map((p: any) => ({ id: p.id, formaPagamentoId: p.formaPagamentoId, valor: p.valor, parcela: p.parcela, produtoId: p.produtoId, detalhes: p.detalhes, diaVencimento: p.diaVencimento, caixaId: p.caixaId })),
    };
    try {
      try { await mp("/sales", corpo); }
      catch (e) {
        // vendedor que não existe mais no Mercado Phone (ex.: "RR PRIME CELL LTDA"): usa a vendedora indicada e anota o original
        if (!b.vendedorSubstituto || !/Vendedor/i.test(String((e as Error).message))) throw e;
        const nota = `Vendedor original: ${s.vendedorNome || s.vendedorId} (cadastro excluído no Mercado Phone)`;
        corpo.vendedorId = Number(b.vendedorSubstituto);
        if (!String(corpo.observacao || "").includes(nota)) corpo.observacao = [corpo.observacao, nota].filter(Boolean).join(" · ");
        await mp("/sales", corpo);
        linha.vendedor_trocado = `${s.vendedorNome} → ${b.vendedorSubstituto}`;
      }
      const d = await mp(`/sales/${v.id}`);
      const ok = (d.itens || []).length === (s.itens || []).length && Math.abs(Number(d.totalVenda) - Number(s.totalVenda)) < 0.01
        && (d.pagamentos || []).length === (s.pagamentos || []).length
        && Math.abs((d.pagamentos || []).reduce((t: number, p: any) => t + Number(p.valor), 0) - (s.pagamentos || []).reduce((t: number, p: any) => t + Number(p.valor), 0)) < 0.01;
      linha.status = ok ? "ok" : "CONFERIR";
      if (!ok) linha.antes = { itens: s.itens?.length, pag: s.pagamentos?.length, total: s.totalVenda };
    } catch (e) { linha.status = "erro"; linha.erro = String((e as Error).message); }
    res.push(linha);
  }
  return json({ vendas: res.length, diferenca_total: r2(res.reduce((t, x) => t + (x.diferenca || 0), 0)), res });
});
