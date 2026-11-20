import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabaseClient";

// ── Caixa: capital parado em aparelhos ────────────────────────────────────────
// Lê o estoque do sistema das vendedoras (tabela aparelhos) e os custos/fornecedores
// gravados no cadastro (tabela aparelhos_custos). Só leitura, exceto quando você
// preenche um custo que ficou faltando.

interface Aparelho {
  id: string; nome: string | null; gb: string | null; cor: string | null; imei: string | null;
  destino: string | null; tipo: string | null; assistencia_nome: string | null;
  data_entrada: string | null; origem: string | null; criado_em: number | null;
}
interface Custo { aparelho_id: string; custo: number | null; fornecedor: string | null; origem_custo: string | null; registrado_por: string | null; atualizado_em: string | null; }
interface Contagem { local: string; usuario: string; finalizada_em: string; esperados: number; faltando: { resposta?: { destino?: string } }[] | null; }
interface Linha extends Aparelho { custo: number | null; fornecedor: string; local: string; dias: number; }

const LOCAIS: Record<string, string> = { loja: "📦 Loja", estoque_r1: "🏬 R1", assistencia: "🔧 Assistência" };

function fmt(n: number) { return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" }); }
function norm(t: string) { return String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim(); }
function dist(a: string, b: string) {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Corrige erro de digitação aproximando de um fornecedor conhecido (LAGACY → LEGACY)
function corrigir(texto: string, conhecidos: string[]) {
  const t = norm(texto); if (!t) return "";
  const exato = conhecidos.find(k => norm(k) === t); if (exato) return exato;
  let melhor = "", dm = 99;
  for (const k of conhecidos) { const d = dist(t, norm(k)); if (d < dm) { dm = d; melhor = k; } }
  const lim = t.length <= 4 ? 1 : t.length <= 8 ? 2 : 3;
  return melhor && dm <= lim ? melhor : t;
}
function valorBR(s: string) {
  const t = String(s || "").replace(/[^\d.,]/g, ""); if (!t) return NaN;
  if (t.includes(",")) return parseFloat(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+\.\d{1,2}$/.test(t)) return parseFloat(t);
  return parseFloat(t.replace(/\./g, ""));
}
function localDe(a: Aparelho) { return a.destino === "estoque_r1" ? "estoque_r1" : a.destino === "assistencia" ? "assistencia" : "loja"; }

const card: CSSProperties = { background: "#fff", border: "1px solid #d0daf5", borderRadius: 16, padding: 16, marginBottom: 14 };
const titulo: CSSProperties = { fontSize: 13, fontWeight: 800, color: "#1a3fa8", textTransform: "uppercase", letterSpacing: ".04em", margin: "0 0 10px" };
const btn: CSSProperties = { border: "none", borderRadius: 12, padding: "10px 14px", fontWeight: 800, fontSize: 14, cursor: "pointer", background: "linear-gradient(135deg,#0d1b3e,#1a3fa8)", color: "#fff" };
const btnGhost: CSSProperties = { ...btn, background: "#fff", color: "#0d1b3e", border: "1px solid #d0daf5" };
const input: CSSProperties = { border: "1px solid #d0daf5", borderRadius: 10, padding: "9px 10px", fontSize: 14, width: "100%", boxSizing: "border-box" };

export default function CaixaEstoque({ onBack }: { onBack?: () => void }) {
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [fornecedores, setFornecedores] = useState<string[]>([]);
  const [contagens, setContagens] = useState<Contagem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [busca, setBusca] = useState("");
  const [filtroLocal, setFiltroLocal] = useState("");
  const [edicao, setEdicao] = useState<Record<string, { valor: string; fornecedor: string }>>({});
  const [salvando, setSalvando] = useState("");
  const [aviso, setAviso] = useState("");

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const [ap, cu, fo, co] = await Promise.all([
        supabase.from("aparelhos").select("id,nome,gb,cor,imei,destino,tipo,assistencia_nome,data_entrada,origem,criado_em"),
        supabase.from("aparelhos_custos").select("aparelho_id,custo,fornecedor,origem_custo,registrado_por,atualizado_em"),
        supabase.from("app_dados").select("valor").eq("chave", "config:fornecedores_aparelhos").maybeSingle(),
        supabase.from("contagens").select("local,usuario,finalizada_em,esperados,faltando").gte("finalizada_em", hoje.toISOString()).order("finalizada_em", { ascending: false }),
      ]);
      if (ap.error) throw ap.error;
      const custos = new Map<string, Custo>(((cu.data || []) as Custo[]).map(c => [c.aparelho_id, c]));
      const agora = Date.now();
      const emEstoque = ((ap.data || []) as Aparelho[]).filter(a => a.tipo !== "cliente" && (!a.destino || a.destino === "estoque_r1" || a.destino === "assistencia"));
      setLinhas(emEstoque.map(a => {
        const c = custos.get(a.id);
        const entrada = a.data_entrada ? new Date(a.data_entrada + "T12:00:00").getTime() : (a.criado_em || agora);
        return { ...a, custo: c && c.custo != null ? Number(c.custo) : null, fornecedor: (c && c.fornecedor) || "", local: localDe(a), dias: Math.max(0, Math.floor((agora - entrada) / 86400000)) };
      }));
      const lista = fo.data && Array.isArray((fo.data as { valor: unknown }).valor) ? ((fo.data as { valor: string[] }).valor) : [];
      setFornecedores(lista);
      setContagens((co.data || []) as Contagem[]);
    } catch (e) {
      setErro("Não consegui carregar o estoque: " + ((e as Error).message || String(e)));
    }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  const resumo = useMemo(() => {
    const comCusto = linhas.filter(l => l.custo != null);
    const total = comCusto.reduce((s, l) => s + (l.custo || 0), 0);
    const porLocal: Record<string, { qtd: number; valor: number; sem: number }> = {};
    const porFornecedor: Record<string, { qtd: number; valor: number }> = {};
    const porModelo: Record<string, { qtd: number; valor: number; sem: number }> = {};
    for (const l of linhas) {
      const pl = (porLocal[l.local] ||= { qtd: 0, valor: 0, sem: 0 }); pl.qtd++;
      const modelo = [l.nome, l.gb].filter(Boolean).join(" ") || "Sem nome";
      const pm = (porModelo[modelo] ||= { qtd: 0, valor: 0, sem: 0 }); pm.qtd++;
      if (l.custo == null) { pl.sem++; pm.sem++; continue; }
      pl.valor += l.custo; pm.valor += l.custo;
      const f = l.fornecedor || "SEM FORNECEDOR";
      const pf = (porFornecedor[f] ||= { qtd: 0, valor: 0 }); pf.qtd++; pf.valor += l.custo;
    }
    const dias = linhas.map(l => l.dias);
    return {
      total, qtd: linhas.length, comCusto: comCusto.length, sem: linhas.length - comCusto.length,
      medio: comCusto.length ? total / comCusto.length : 0,
      diasMedio: dias.length ? Math.round(dias.reduce((s, d) => s + d, 0) / dias.length) : 0,
      porLocal, porFornecedor: Object.entries(porFornecedor).sort((a, b) => b[1].valor - a[1].valor),
      porModelo: Object.entries(porModelo).sort((a, b) => b[1].valor - a[1].valor || b[1].qtd - a[1].qtd),
      parados: [...linhas].sort((a, b) => b.dias - a.dias).slice(0, 10),
    };
  }, [linhas]);

  const visiveis = useMemo(() => {
    const b = norm(busca);
    return linhas.filter(l => (!filtroLocal || l.local === filtroLocal) &&
      (!b || norm([l.nome, l.gb, l.cor, l.imei, l.fornecedor].join(" ")).includes(b)))
      .sort((a, b) => (a.custo == null ? 0 : 1) - (b.custo == null ? 0 : 1) || b.dias - a.dias);
  }, [linhas, busca, filtroLocal]);

  async function salvarCusto(l: Linha) {
    const e = edicao[l.id] || { valor: l.custo != null ? String(l.custo) : "", fornecedor: l.fornecedor };
    const v = valorBR(e.valor);
    if (!(v > 0)) { setAviso("Informe o valor pago (ex.: 2.450,00)."); return; }
    if ((v < 150 || v > 15000) && !confirm(`Valor de ${fmt(v)}? Confirme se está certo.`)) return;
    const forn = corrigir(e.fornecedor, fornecedores);
    if (!forn) { setAviso("Informe o fornecedor."); return; }
    if (!fornecedores.includes(forn) && !confirm(`"${forn}" não está na lista de fornecedores. É um fornecedor novo?`)) return;
    setSalvando(l.id); setAviso("");
    const agora = new Date().toISOString();
    const { error } = await supabase.from("aparelhos_custos").upsert({ aparelho_id: l.id, custo: v, fornecedor: forn, origem_custo: "fornecedor", registrado_por: "Robert", atualizado_em: agora });
    setSalvando("");
    if (error) { setAviso("Erro ao salvar: " + error.message); return; }
    if (!fornecedores.includes(forn)) {
      const nova = [...fornecedores, forn].sort(); setFornecedores(nova);
      await supabase.from("app_dados").upsert({ chave: "config:fornecedores_aparelhos", valor: nova, atualizado_em: agora });
    }
    setLinhas(ls => ls.map(x => x.id === l.id ? { ...x, custo: v, fornecedor: forn } : x));
    setEdicao(ed => { const n = { ...ed }; delete n[l.id]; return n; });
    setAviso(norm(e.fornecedor) !== norm(forn) ? `✓ Salvo. Fornecedor corrigido para ${forn}.` : "✓ Salvo.");
  }

  const statusContagem = (k: string) => {
    const c = contagens.find(x => (x.local || "").split(":")[0] === k || (k === "estoque_r1" && x.local === "r1"));
    if (!c) return { txt: "⏳ Não conferido hoje", cor: "#b45309" };
    const nao = (c.faltando || []).filter(f => f.resposta && f.resposta.destino === "nao_encontrado").length;
    const hora = new Date(c.finalizada_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return nao ? { txt: `🚨 ${nao} não encontrado(s) · ${hora}`, cor: "#dc2626" } : { txt: `✅ Conferido ${hora} · ${c.usuario}`, cor: "#15803d" };
  };

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "16px 14px 80px", fontFamily: "system-ui,-apple-system,Arial", color: "#0d1b3e" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>💰 Caixa · Capital em estoque</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnGhost} onClick={carregar}>🔄</button>
          {onBack && <button style={btnGhost} onClick={onBack}>← Voltar</button>}
        </div>
      </div>
      {erro && <div style={{ ...card, borderColor: "#dc2626", color: "#dc2626" }}>{erro}</div>}
      {carregando ? <div style={card}>Carregando…</div> : <>
        <div style={{ ...card, background: "linear-gradient(135deg,#0d1b3e,#1a3fa8)", color: "#fff", border: "none" }}>
          <div style={{ fontSize: 13, opacity: .8, fontWeight: 700 }}>CAPITAL EM APARELHOS (pelo custo)</div>
          <div style={{ fontSize: 34, fontWeight: 900, margin: "4px 0" }}>{fmt(resumo.total)}</div>
          <div style={{ fontSize: 14, opacity: .9 }}>{resumo.qtd} aparelhos em estoque · custo médio {fmt(resumo.medio)} · {resumo.diasMedio} dias parados em média</div>
          {resumo.sem > 0 && <div style={{ marginTop: 10, background: "rgba(255,255,255,.15)", borderRadius: 10, padding: "8px 10px", fontSize: 14, fontWeight: 700 }}>
            ⚠️ {resumo.sem} aparelho(s) sem custo não entram no total. Preencha na lista abaixo.</div>}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          {Object.entries(LOCAIS).map(([k, nome]) => {
            const p = resumo.porLocal[k] || { qtd: 0, valor: 0, sem: 0 }, st = statusContagem(k);
            return <button key={k} onClick={() => setFiltroLocal(filtroLocal === k ? "" : k)}
              style={{ ...card, flex: "1 1 200px", marginBottom: 0, textAlign: "left", cursor: "pointer", borderWidth: 2, borderColor: filtroLocal === k ? "#1a3fa8" : "#d0daf5" }}>
              <div style={{ fontWeight: 900, fontSize: 16 }}>{nome}</div>
              <div style={{ fontSize: 22, fontWeight: 900, margin: "4px 0" }}>{fmt(p.valor)}</div>
              <div style={{ fontSize: 13, color: "#6b7fa8" }}>{p.qtd} aparelhos{p.sem ? ` · ${p.sem} sem custo` : ""}</div>
              <div style={{ fontSize: 12, fontWeight: 800, color: st.cor, marginTop: 6 }}>{st.txt}</div>
            </button>;
          })}
        </div>

        <div style={card}>
          <p style={titulo}>Por fornecedor</p>
          {resumo.porFornecedor.length === 0 ? <div style={{ color: "#6b7fa8", fontSize: 14 }}>Nenhum custo cadastrado ainda.</div> :
            resumo.porFornecedor.map(([f, v]) => <div key={f} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderTop: "1px solid #eef2ff", fontSize: 14 }}>
              <span><b>{f}</b> <span style={{ color: "#6b7fa8" }}>· {v.qtd} un.</span></span><b>{fmt(v.valor)}</b></div>)}
        </div>

        <div style={card}>
          <p style={titulo}>Por modelo</p>
          {resumo.porModelo.map(([m, v]) => <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderTop: "1px solid #eef2ff", fontSize: 14 }}>
            <span><b>{m}</b> <span style={{ color: "#6b7fa8" }}>· {v.qtd} un.{v.sem ? ` (${v.sem} sem custo)` : ""}</span></span><b>{fmt(v.valor)}</b></div>)}
        </div>

        <div style={card}>
          <p style={titulo}>Parados há mais tempo</p>
          {resumo.parados.map(l => <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderTop: "1px solid #eef2ff", fontSize: 14 }}>
            <span>{[l.nome, l.gb, l.cor].filter(Boolean).join(" · ")} <span style={{ color: "#6b7fa8" }}>· {LOCAIS[l.local]}</span></span>
            <b style={{ color: l.dias > 30 ? "#dc2626" : "#0d1b3e", whiteSpace: "nowrap" }}>{l.dias} dias</b></div>)}
        </div>

        <div style={card}>
          <p style={titulo}>Aparelhos {filtroLocal ? "· " + LOCAIS[filtroLocal] : ""} ({visiveis.length})</p>
          <input style={{ ...input, marginBottom: 10 }} placeholder="Buscar modelo, cor, IMEI ou fornecedor" value={busca} onChange={e => setBusca(e.target.value)} />
          {aviso && <div style={{ fontSize: 14, fontWeight: 700, color: aviso.startsWith("✓") ? "#15803d" : "#dc2626", marginBottom: 8 }}>{aviso}</div>}
          <datalist id="caixa-fornecedores">{fornecedores.map(f => <option key={f} value={f} />)}</datalist>
          {visiveis.map(l => {
            const ed = edicao[l.id], abrir = l.custo == null || !!ed;
            return <div key={l.id} style={{ padding: "10px 0", borderTop: "1px solid #eef2ff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 14 }}><b>{[l.nome, l.gb].filter(Boolean).join(" ")}</b> {l.cor}
                  <div style={{ fontSize: 12, color: "#6b7fa8", fontFamily: "ui-monospace,Menlo,monospace" }}>{l.imei} · {LOCAIS[l.local]}{l.local === "assistencia" && l.assistencia_nome ? " " + l.assistencia_nome : ""} · {l.dias}d</div></div>
                {l.custo != null && !ed && <div style={{ textAlign: "right", cursor: "pointer" }} onClick={() => setEdicao(x => ({ ...x, [l.id]: { valor: String(l.custo).replace(".", ","), fornecedor: l.fornecedor } }))}>
                  <b>{fmt(l.custo)}</b><div style={{ fontSize: 12, color: "#6b7fa8" }}>{l.fornecedor || "—"} ✏️</div></div>}
                {l.custo == null && !ed && <span style={{ fontSize: 12, fontWeight: 800, color: "#b45309", whiteSpace: "nowrap" }}>⚠️ sem custo</span>}
              </div>
              {abrir && <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <input style={{ ...input, flex: "1 1 110px" }} inputMode="decimal" placeholder="Valor pago" value={ed ? ed.valor : ""}
                  onChange={e => setEdicao(x => ({ ...x, [l.id]: { valor: e.target.value, fornecedor: (x[l.id] || { fornecedor: l.fornecedor }).fornecedor } }))} />
                <input style={{ ...input, flex: "1 1 140px" }} list="caixa-fornecedores" placeholder="Fornecedor" value={ed ? ed.fornecedor : l.fornecedor}
                  onChange={e => setEdicao(x => ({ ...x, [l.id]: { valor: (x[l.id] || { valor: "" }).valor, fornecedor: e.target.value } }))} />
                <button style={{ ...btn, flex: "0 0 auto" }} disabled={salvando === l.id} onClick={() => salvarCusto(l)}>{salvando === l.id ? "…" : "Salvar"}</button>
              </div>}
            </div>;
          })}
        </div>
      </>}
    </div>
  );
}
