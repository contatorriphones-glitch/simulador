import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabaseClient";

// ── Relatórios: GestaoClick (até 17/11/2026) + Mercado Phone (desde 18/11/2026) ──
// Até 17/11: faturamento = vendas do GestaoClick; custo = pedidos de compra do fechamento antigo; taxas = histórico da aba Taxas.
// Desde 18/11: vendas do Mercado Phone; custo dos aparelhos pelo IMEI (Caixa/cadastro), acessórios pelo custo do MP, taxas automáticas.

const INICIO_MP = "2026-11-18";
const ehIphone = (nome: string) => /iphone|\d+\s*(gb|tb)\b/i.test(nome) || /^\s*1\d\s*pro/i.test(nome);
const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmt0 = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const br = (s: string) => s.split("-").reverse().join("/");
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const nomeMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`;

interface Dia {
  dia: string; origem: "GestaoClick" | "Mercado Phone"; pedidos: number; aparelhos: number;
  faturamento: number; fatAparelhos: number; fatAcessorios: number; custo: number;
  lucroAparelhos: number | null; lucroAcessorios: number | null; lucroVendas: number; lucroTaxas: number; semCusto: number;
}
interface ItemModelo { nome: string; qtd: number; valor: number; vendedor: string; dia: string; }

async function buscarTodos<T>(tabela: string, colunas: string, de: string, ate: string, campoData: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < 50; i++) {
    const { data, error } = await supabase.from(tabela).select(colunas).gte(campoData, de).lte(campoData, ate).order(campoData).range(i * 1000, i * 1000 + 999);
    if (error) throw new Error(`${tabela}: ${error.message}`);
    out.push(...((data || []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}
const novoDia = (dia: string, origem: Dia["origem"]): Dia => ({ dia, origem, pedidos: 0, aparelhos: 0, faturamento: 0, fatAparelhos: 0, fatAcessorios: 0, custo: 0, lucroAparelhos: null, lucroAcessorios: null, lucroVendas: 0, lucroTaxas: 0, semCusto: 0 });

async function carregar(de: string, ate: string): Promise<{ dias: Dia[]; itens: ItemModelo[]; vendedoras: Record<string, { pedidos: number; valor: number }> }> {
  const dias = new Map<string, Dia>();
  const itens: ItemModelo[] = [];
  const vendedoras: Record<string, { pedidos: number; valor: number }> = {};
  const addVend = (nome: string, valor: number) => { const k = (nome || "—").trim().toUpperCase(); (vendedoras[k] ||= { pedidos: 0, valor: 0 }); vendedoras[k].pedidos++; vendedoras[k].valor += valor; };

  // ── GestaoClick (até 17/11)
  if (de < INICIO_MP) {
    const ateGc = ate < INICIO_MP ? ate : "2026-11-17";
    type VG = { data: string; situacao: string | null; valor_total: number; vendedor: string | null; produtos: { nome: string; qtd: number; valor_total: number }[] | null };
    type CG = { data: string; situacao: string | null; valor_total: number };
    const [vgs, cgs, { data: txs }] = await Promise.all([
      buscarTodos<VG>("vendas_gc", "data,situacao,valor_total,vendedor,produtos", de, ateGc, "data"),
      buscarTodos<CG>("compras_gc", "data,situacao,valor_total", de, ateGc, "data"),
      supabase.from("historico_taxas").select("data,registro").gte("data", de).lte("data", ateGc),
    ]);
    for (const v of vgs) {
      if (!v.data || /cancel/i.test(v.situacao || "")) continue;
      const d = dias.get(v.data) || novoDia(v.data, "GestaoClick"); dias.set(v.data, d);
      const total = Number(v.valor_total) || 0;
      d.pedidos++; d.faturamento += total; addVend(v.vendedor || "", total);
      for (const p of v.produtos || []) {
        const val = Number(p.valor_total) || 0, q = Number(p.qtd) || 1;
        if (ehIphone(p.nome)) { d.aparelhos += q; d.fatAparelhos += val; itens.push({ nome: p.nome, qtd: q, valor: val, vendedor: v.vendedor || "", dia: v.data }); }
        else d.fatAcessorios += val;
      }
    }
    for (const c of cgs) {
      if (!c.data || /cancel/i.test(c.situacao || "")) continue;
      const d = dias.get(c.data) || novoDia(c.data, "GestaoClick"); dias.set(c.data, d);
      d.custo += Number(c.valor_total) || 0;
    }
    for (const t of (txs || []) as { data: string; registro: { lucro?: number } }[]) {
      const d = dias.get(t.data) || novoDia(t.data, "GestaoClick"); dias.set(t.data, d);
      d.lucroTaxas += Number(t.registro?.lucro) || 0;
    }
    for (const d of dias.values()) if (d.origem === "GestaoClick") d.lucroVendas = d.faturamento - d.custo;
  }

  // ── Mercado Phone (desde 18/11)
  if (ate >= INICIO_MP) {
    const deMp = de > INICIO_MP ? de : INICIO_MP;
    type VM = { id: number; dia: string; status: string; total: number; vendedor: string | null; itens: Record<string, unknown>[]; lucro_taxa_calc: number; lucro_taxa_ajuste: number | null };
    const vms = (await buscarTodos<VM>("vendas_mp", "id,dia,status,total,vendedor,itens,lucro_taxa_calc,lucro_taxa_ajuste", deMp, ate, "dia")).filter(v => v.status === "concluido");
    const imeis = [...new Set(vms.flatMap(v => v.itens.filter(i => i.aparelho && i.imei).map(i => String(i.imei))))];
    const [{ data: aps }, { data: vic }] = await Promise.all([
      imeis.length ? supabase.from("aparelhos").select("id,imei,criado_em").in("imei", imeis) : Promise.resolve({ data: [] as { id: string; imei: string; criado_em: number }[] }),
      supabase.from("vendas_itens_custo").select("venda_id,produto_id,custo"),
    ]);
    const apPorImei = new Map<string, string>();
    for (const a of ((aps || []) as { id: string; imei: string; criado_em: number }[]).sort((x, y) => (x.criado_em || 0) - (y.criado_em || 0))) apPorImei.set(a.imei, a.id);
    const apIds = [...new Set(apPorImei.values())];
    const { data: cs } = apIds.length ? await supabase.from("aparelhos_custos").select("aparelho_id,custo").in("aparelho_id", apIds) : { data: [] };
    const custoAp = new Map(((cs || []) as { aparelho_id: string; custo: number }[]).map(c => [c.aparelho_id, Number(c.custo)]));
    const manual = new Map(((vic || []) as { venda_id: number; produto_id: number; custo: number }[]).map(x => [`${x.venda_id}-${x.produto_id}`, Number(x.custo)]));
    for (const v of vms) {
      const d = dias.get(v.dia) || novoDia(v.dia, "Mercado Phone"); dias.set(v.dia, d);
      d.origem = "Mercado Phone";
      const total = Number(v.total) || 0;
      d.pedidos++; d.faturamento += total; addVend(v.vendedor || "", total);
      d.lucroTaxas += Number(v.lucro_taxa_ajuste ?? v.lucro_taxa_calc) || 0;
      for (const i of v.itens) {
        const val = Number(i.valorTotal) || 0, q = Number(i.quantidade) || 1;
        if (i.aparelho) {
          d.aparelhos += q; d.fatAparelhos += val; itens.push({ nome: String(i.produtoNome || ""), qtd: q, valor: val, vendedor: v.vendedor || "", dia: v.dia });
          const apId = apPorImei.get(String(i.imei || ""));
          const cMp = i.fornecedor_mp && Number(i.custo_mp) > 0 && Number(i.custo_mp) !== Number(i.valorUnitario) ? Number(i.custo_mp) : null;
          const c = (apId && custoAp.has(apId) ? custoAp.get(apId)! : null) ?? manual.get(`${v.id}-${i.produtoId}`) ?? cMp;
          if (c == null) d.semCusto++;
          else { d.custo += c; d.lucroAparelhos = (d.lucroAparelhos || 0) + val - c; }
        } else {
          d.fatAcessorios += val;
          const c = i.custo_total == null ? 0 : Number(i.custo_total);
          d.custo += c; d.lucroAcessorios = (d.lucroAcessorios || 0) + val - c;
        }
      }
    }
    for (const d of dias.values()) if (d.origem === "Mercado Phone") d.lucroVendas = (d.lucroAparelhos || 0) + (d.lucroAcessorios || 0);
  }
  return { dias: [...dias.values()].sort((a, b) => a.dia.localeCompare(b.dia)), itens, vendedoras };
}

// semana começando na segunda-feira
function chaveGrupo(dia: string, por: "dia" | "semana" | "mes") {
  if (por === "dia") return dia;
  if (por === "mes") return dia.slice(0, 7);
  const d = new Date(dia + "T12:00:00"); const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); return iso(d);
}
function rotuloGrupo(k: string, por: "dia" | "semana" | "mes") {
  if (por === "mes") return nomeMes(k);
  if (por === "semana") { const f = new Date(k + "T12:00:00"); f.setDate(f.getDate() + 6); return `${br(k).slice(0, 5)} a ${br(iso(f)).slice(0, 5)}`; }
  const d = new Date(k + "T12:00:00"); return `${br(k).slice(0, 5)} ${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()]}`;
}
function somar(ds: Dia[]) {
  const s = { pedidos: 0, aparelhos: 0, faturamento: 0, fatAparelhos: 0, fatAcessorios: 0, custo: 0, lucroVendas: 0, lucroTaxas: 0, semCusto: 0, lucroAparelhos: 0, lucroAcessorios: 0, temDetalhe: false };
  for (const d of ds) {
    s.pedidos += d.pedidos; s.aparelhos += d.aparelhos; s.faturamento += d.faturamento; s.fatAparelhos += d.fatAparelhos; s.fatAcessorios += d.fatAcessorios;
    s.custo += d.custo; s.lucroVendas += d.lucroVendas; s.lucroTaxas += d.lucroTaxas; s.semCusto += d.semCusto;
    if (d.lucroAparelhos != null || d.lucroAcessorios != null) { s.temDetalhe = true; s.lucroAparelhos += d.lucroAparelhos || 0; s.lucroAcessorios += d.lucroAcessorios || 0; }
  }
  return s;
}

const card: CSSProperties = { background: "#fff", border: "1px solid #e8eeff", borderRadius: 16, padding: "14px 16px", marginBottom: 12 };
const titulo: CSSProperties = { fontSize: 12, fontWeight: 800, color: "#1a3fa8", textTransform: "uppercase", letterSpacing: ".05em", margin: "0 0 10px" };
const chip = (ativo: boolean): CSSProperties => ({ background: ativo ? "#fff" : "rgba(255,255,255,.15)", color: ativo ? "#1a3fa8" : "#fff", border: "1px solid rgba(255,255,255,.3)", borderRadius: 999, padding: "6px 11px", fontSize: 12, fontWeight: 800, cursor: "pointer" });
const inputData: CSSProperties = { width: "100%", boxSizing: "border-box", background: "rgba(255,255,255,.15)", border: "1px solid rgba(255,255,255,.3)", borderRadius: 10, padding: "9px 10px", fontSize: 13, color: "#fff", outline: "none" };

export default function RelatorioVendas({ onBack }: { onBack?: () => void }) {
  const hoje = iso(new Date());
  const [de, setDe] = useState(hoje.slice(0, 8) + "01");
  const [ate, setAte] = useState(hoje);
  const [por, setPor] = useState<"dia" | "semana" | "mes">("dia");
  const [dados, setDados] = useState<{ dias: Dia[]; itens: ItemModelo[]; vendedoras: Record<string, { pedidos: number; valor: number }> } | null>(null);
  const [meses, setMeses] = useState<{ mes: string; fat: number; lucro: number; aparelhos: number; incompleto: boolean }[]>([]);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");
  const [copiado, setCopiado] = useState("");

  async function buscar() {
    setCarregando(true); setErro("");
    try { setDados(await carregar(de, ate)); } catch (e) { setErro((e as Error).message); }
    setCarregando(false);
  }
  useEffect(() => { buscar(); }, [de, ate]);
  // comparativo de meses (desde maio/2026)
  useEffect(() => {
    carregar("2026-05-01", hoje).then(r => {
      const m = new Map<string, Dia[]>();
      for (const d of r.dias) { const k = d.dia.slice(0, 7); m.set(k, [...(m.get(k) || []), d]); }
      setMeses([...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, ds]) => { const s = somar(ds); return { mes, fat: s.faturamento, lucro: s.lucroVendas + s.lucroTaxas, aparelhos: s.aparelhos, incompleto: s.semCusto > 0 }; }));
    }).catch(() => {});
  }, []);

  const tot = useMemo(() => somar(dados?.dias || []), [dados]);
  const lucroTotal = tot.lucroVendas + tot.lucroTaxas;
  const grupos = useMemo(() => {
    const m = new Map<string, Dia[]>();
    for (const d of dados?.dias || []) { const k = chaveGrupo(d.dia, por); m.set(k, [...(m.get(k) || []), d]); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, ds]) => ({ k, ...somar(ds), origem: [...new Set(ds.map(d => d.origem))].join(" + ") }));
  }, [dados, por]);
  const ranking = useMemo(() => {
    const m = new Map<string, { qtd: number; valor: number }>();
    for (const i of dados?.itens || []) {
      const nome = i.nome.toUpperCase().replace(/\s+-\s+/g, " ").replace(/\s+/g, " ").replace(/^(\d)/, "IPHONE $1").match(/^(.*?\d+\s*(GB|TB))/)?.[1] || i.nome.toUpperCase();
      const x = m.get(nome) || { qtd: 0, valor: 0 }; x.qtd += i.qtd; x.valor += i.valor; m.set(nome, x);
    }
    return [...m.entries()].sort((a, b) => b[1].qtd - a[1].qtd).slice(0, 15);
  }, [dados]);
  const vendedoras = Object.entries(dados?.vendedoras || {}).sort((a, b) => b[1].valor - a[1].valor);
  const maxMes = Math.max(1, ...meses.map(m => m.fat));

  function atalho(n: string) {
    const d = new Date();
    if (n === "hoje") { setDe(hoje); setAte(hoje); }
    if (n === "ontem") { const o = iso(new Date(Date.now() - 86400000)); setDe(o); setAte(o); }
    if (n === "7d") { setDe(iso(new Date(Date.now() - 6 * 86400000))); setAte(hoje); }
    if (n === "mes") { setDe(hoje.slice(0, 8) + "01"); setAte(hoje); }
    if (n === "mespassado") { const a = new Date(d.getFullYear(), d.getMonth() - 1, 1), b = new Date(d.getFullYear(), d.getMonth(), 0); setDe(iso(a)); setAte(iso(b)); }
    if (n === "tudo") { setDe("2026-05-01"); setAte(hoje); }
  }
  function textoWhats() {
    const periodo = de === ate ? br(de) : `${br(de)} a ${br(ate)}`;
    return [`📊 *Resultado — RR Prime Cell*`, `📅 ${periodo}`, "",
      `🛍️ Pedidos: ${tot.pedidos}`, `📱 Aparelhos: ${tot.aparelhos}`, `💰 Faturamento: ${fmt(tot.faturamento)}`,
      `💵 Lucro nas vendas: ${fmt(tot.lucroVendas)}`, `💳 Lucro com taxas: ${fmt(tot.lucroTaxas)}`, `✅ *Lucro total: ${fmt(lucroTotal)}*`,
      ...(tot.semCusto ? ["", `⚠️ ${tot.semCusto} aparelho(s) ainda sem custo (lucro incompleto)`] : [])].join("\n");
  }
  async function copiar(t: string, k: string) { try { await navigator.clipboard.writeText(t); setCopiado(k); setTimeout(() => setCopiado(""), 2000); } catch { prompt("Copie:", t); } }
  function exportarCSV() {
    const l = ["Período;Origem;Pedidos;Aparelhos;Faturamento;Custo;Lucro vendas;Lucro taxas;Lucro total;Aparelhos sem custo"];
    for (const g of grupos) l.push([rotuloGrupo(g.k, por), g.origem, g.pedidos, g.aparelhos, g.faturamento.toFixed(2), g.custo.toFixed(2), g.lucroVendas.toFixed(2), g.lucroTaxas.toFixed(2), (g.lucroVendas + g.lucroTaxas).toFixed(2), g.semCusto].join(";"));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + l.join("\n")], { type: "text/csv;charset=utf-8" })); a.download = `relatorio_${de}_${ate}.csv`; a.click();
  }

  return (
    <div style={{ background: "#f0f4ff", minHeight: "100vh", fontFamily: "'Plus Jakarta Sans',system-ui,sans-serif", paddingBottom: 100, color: "#0d1b3e" }}>
      <div style={{ background: "linear-gradient(135deg,#1a3fa8 0%,#2d5be3 100%)", padding: "18px 16px 22px", borderRadius: "0 0 26px 26px", marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div><div style={{ color: "rgba(255,255,255,.7)", fontSize: 10, fontWeight: 800, letterSpacing: ".14em" }}>RELATÓRIO</div>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 900 }}>Resultado da loja</div></div>
          {onBack && <button onClick={onBack} style={{ ...chip(false) }}>← Voltar</button>}
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "12px 0 10px" }}>
          {[["hoje", "Hoje"], ["ontem", "Ontem"], ["7d", "7 dias"], ["mes", "Este mês"], ["mespassado", "Mês passado"], ["tudo", "Desde maio"]].map(([k, n]) => <button key={k} style={chip(false)} onClick={() => atalho(k)}>{n}</button>)}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="date" style={inputData} value={de} onChange={e => setDe(e.target.value)} />
          <span style={{ color: "#fff", fontSize: 13 }}>até</span>
          <input type="date" style={inputData} value={ate} onChange={e => setAte(e.target.value)} />
        </div>
      </div>

      <div style={{ padding: "0 14px", maxWidth: 820, margin: "0 auto" }}>
        {erro && <div style={{ ...card, color: "#dc2626" }}>Erro: {erro}</div>}
        {carregando && <div style={card}>Carregando…</div>}
        {dados && !carregando && <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
            {[["Faturamento", fmt(tot.faturamento), "#059669"], ["Aparelhos vendidos", String(tot.aparelhos), "#1a3fa8"],
              ["Lucro nas vendas", fmt(tot.lucroVendas) + (tot.semCusto ? " *" : ""), "#7c3aed"], ["Lucro com taxas", fmt(tot.lucroTaxas), "#0d9488"]].map(([k, v, c]) =>
              <div key={k} style={{ ...card, marginBottom: 0 }}><div style={{ fontSize: 10, fontWeight: 800, color: c, letterSpacing: ".08em" }}>{k.toUpperCase()}</div><div style={{ fontSize: 19, fontWeight: 900, color: c }}>{v}</div></div>)}
          </div>
          <div style={{ ...card, background: "linear-gradient(135deg,#0d1b3e,#1a3fa8)", color: "#fff", border: "none" }}>
            <div style={{ fontSize: 12, opacity: .8, fontWeight: 800 }}>LUCRO TOTAL {de === ate ? br(de) : `${br(de)} a ${br(ate)}`}</div>
            <div style={{ fontSize: 32, fontWeight: 900 }}>{fmt(lucroTotal)}</div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, opacity: .9 }}>
              <span>{tot.pedidos} pedidos</span><span>margem {tot.faturamento ? ((lucroTotal / tot.faturamento) * 100).toFixed(1) : "0"}%</span>
              <span>ticket médio {fmt0(tot.pedidos ? tot.faturamento / tot.pedidos : 0)}</span><span>custo {fmt0(tot.custo)}</span>
            </div>
            {tot.temDetalhe && <div style={{ fontSize: 12, opacity: .85, marginTop: 6 }}>Mercado Phone: aparelhos {fmt(tot.lucroAparelhos)} · acessórios {fmt(tot.lucroAcessorios)}</div>}
            {tot.semCusto > 0 && <div style={{ marginTop: 8, background: "rgba(255,255,255,.15)", borderRadius: 10, padding: "7px 10px", fontSize: 13, fontWeight: 700 }}>* {tot.semCusto} aparelho(s) vendido(s) sem custo: preencha no Caixa para o lucro ficar completo.</div>}
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button onClick={() => copiar(textoWhats(), "w")} style={{ flex: 1, background: "linear-gradient(135deg,#1a3fa8,#2d5be3)", color: "#fff", border: "none", borderRadius: 12, padding: 12, fontWeight: 800, cursor: "pointer" }}>{copiado === "w" ? "✓ Copiado" : "📋 Copiar para WhatsApp"}</button>
            <button onClick={exportarCSV} style={{ background: "#fff", color: "#1a3fa8", border: "1px solid #d0daf5", borderRadius: 12, padding: "12px 14px", fontWeight: 800, cursor: "pointer" }}>⬇ Excel</button>
          </div>

          <div style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <p style={{ ...titulo, margin: 0 }}>Por {por === "dia" ? "dia" : por === "semana" ? "semana" : "mês"}</p>
              <div style={{ display: "flex", gap: 4 }}>{(["dia", "semana", "mes"] as const).map(p =>
                <button key={p} onClick={() => setPor(p)} style={{ border: "1px solid #d0daf5", background: por === p ? "#1a3fa8" : "#fff", color: por === p ? "#fff" : "#0d1b3e", borderRadius: 999, padding: "4px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>{p === "mes" ? "Mês" : p === "dia" ? "Dia" : "Semana"}</button>)}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 6, fontSize: 11, fontWeight: 800, color: "#6b7fa8", padding: "4px 0" }}><span>PERÍODO</span><span style={{ textAlign: "right" }}>FATURAMENTO</span><span style={{ textAlign: "right" }}>LUCRO</span></div>
            {grupos.length === 0 && <div style={{ color: "#6b7fa8", fontSize: 14 }}>Nenhuma venda no período.</div>}
            {grupos.map(g => <div key={g.k} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 6, padding: "8px 0", borderTop: "1px solid #eef2ff", fontSize: 13, alignItems: "center" }}>
              <span><b>{rotuloGrupo(g.k, por)}</b><br /><span style={{ fontSize: 11, color: "#6b7fa8" }}>{g.pedidos} ped. · {g.aparelhos} apar. · {g.origem === "GestaoClick" ? "GC" : g.origem === "Mercado Phone" ? "MP" : "GC+MP"}</span></span>
              <span style={{ textAlign: "right" }}>{fmt0(g.faturamento)}</span>
              <span style={{ textAlign: "right", fontWeight: 800, color: g.lucroVendas + g.lucroTaxas >= 0 ? "#15803d" : "#dc2626" }}>{fmt0(g.lucroVendas + g.lucroTaxas)}{g.semCusto ? <span title="aparelho sem custo" style={{ color: "#b45309" }}> *</span> : ""}<br /><span style={{ fontSize: 11, color: "#6b7fa8", fontWeight: 600 }}>taxas {fmt0(g.lucroTaxas)}</span></span>
            </div>)}
          </div>

          {meses.length > 1 && <div style={card}>
            <p style={titulo}>Comparativo de meses</p>
            {meses.map((m, i) => { const ant = meses[i - 1]; const var_ = ant && ant.lucro ? ((m.lucro - ant.lucro) / Math.abs(ant.lucro)) * 100 : null; return (
              <div key={m.mes} style={{ padding: "7px 0", borderTop: i ? "1px solid #eef2ff" : "none", fontSize: 13 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}><b>{nomeMes(m.mes)}{m.incompleto ? " *" : ""}</b>
                  <span>{fmt0(m.fat)} · lucro <b style={{ color: "#15803d" }}>{fmt0(m.lucro)}</b>{var_ != null && <span style={{ color: var_ >= 0 ? "#15803d" : "#dc2626", fontWeight: 800 }}> {var_ >= 0 ? "▲" : "▼"}{Math.abs(var_).toFixed(0)}%</span>}</span></div>
                <div style={{ background: "#eef2ff", borderRadius: 4, height: 6, marginTop: 4 }}><div style={{ background: "#1a3fa8", height: "100%", width: `${(m.fat / maxMes) * 100}%`, borderRadius: 4 }} /></div>
              </div>); })}
            <div style={{ fontSize: 11, color: "#6b7fa8", marginTop: 6 }}>Até 17/11 pelo GestaoClick (custo = compras do fechamento), desde 18/11 pelo Mercado Phone. * mês com aparelho sem custo.</div>
          </div>}

          {ranking.length > 0 && <div style={card}>
            <p style={titulo}>Aparelhos mais vendidos</p>
            {ranking.map(([n, v], i) => <div key={n} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i ? "1px solid #eef2ff" : "none", fontSize: 13 }}>
              <span>{i < 3 ? ["🥇", "🥈", "🥉"][i] : `${i + 1}.`} {n}</span><b>{v.qtd} un. · {fmt0(v.valor)}</b></div>)}
            <button onClick={() => copiar(`📱 *Mais vendidos* · ${br(de)} a ${br(ate)}\n` + ranking.map(([n, v], i) => `${i + 1}. ${n} — ${v.qtd} un.`).join("\n"), "r")} style={{ marginTop: 8, width: "100%", background: "#fff", color: "#1a3fa8", border: "1px solid #d0daf5", borderRadius: 10, padding: 9, fontWeight: 800, cursor: "pointer" }}>{copiado === "r" ? "✓ Copiado" : "📋 Copiar ranking"}</button>
          </div>}

          {vendedoras.length > 0 && <div style={card}>
            <p style={titulo}>Por vendedora</p>
            {vendedoras.map(([n, v], i) => <div key={n} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: i ? "1px solid #eef2ff" : "none", fontSize: 13 }}>
              <span><b>{n}</b> · {v.pedidos} pedidos</span><b>{fmt0(v.valor)}</b></div>)}
          </div>}
        </>}
      </div>
    </div>
  );
}
