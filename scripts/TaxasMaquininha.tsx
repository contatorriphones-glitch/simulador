import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { supabase } from "../lib/supabaseClient";

// ── Taxas da maquininha (automático) ──────────────────────────────────────────
// A partir de 18/11/2026 as vendas vêm sozinhas do Mercado Phone (tabela vendas_mp, a cada 15 min).
// O lucro de cada venda no cartão é calculado no servidor: passado na máquina − taxa da PagBank − valor do cartão.
// Aqui você só confere e, se precisar, corrige com o botão ✏️ (a correção nunca é apagada pela sincronização).
// Dias anteriores a 18/11 continuam no histórico antigo (mesmo lugar de sempre).

const INICIO_AUTOMATICO = "2026-11-18";
const MODALIDADES = ["D", ...Array.from({ length: 18 }, (_, i) => String(i + 1))];
const MAQ_PADRAO: Record<string, number> = { D: 0.99, "1": 2.99, "2": 4.14, "3": 4.81, "4": 5.47, "5": 6.13, "6": 6.78, "7": 7.63, "8": 8.27, "9": 8.9, "10": 9.53, "11": 10.15, "12": 10.77, "13": 11.95, "14": 12.56, "15": 13.16, "16": 13.75, "17": 14.34, "18": 14.93 };
const CLI_PADRAO: Record<string, number> = { D: 3, "1": 5, "2": 7.5, "3": 8.5, "4": 9.5, "5": 10, "6": 10.5, "7": 11.5, "8": 12.5, "9": 13, "10": 14.5, "11": 15.5, "12": 16, "13": 16, "14": 17, "15": 17.5, "16": 17.5, "17": 18, "18": 19.3 };
const nomeMod = (k: string) => (k === "D" ? "Débito" : k === "1" ? "Crédito à vista" : `${k}x`);

interface Pagamento { formaPagamentoDescricao: string; valor: number; parcela: string | null; detalhes: string | null; }
interface Venda {
  id: number; data_venda: string; dia: string; total: number; cliente: string | null; vendedor: string | null; status: string;
  pagamentos: Pagamento[] | null; base_cartao: number; bruto_cartao: number; taxa_maquininha: number; lucro_taxa_calc: number;
  taxa_estimada: boolean; taxa_alertas: string[] | null; lucro_taxa_ajuste: number | null; ajuste_obs: string | null;
}
interface RegistroTaxa { data: string; lucro: number; totalBruto: number; taxaPagBank: number; pedidos: number; }
type Taxas = Record<string, number>;

const fmt = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const r2 = (n: number) => Math.round(n * 100) / 100;
const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dataBR = (iso: string) => iso.split("-").reverse().join("/");
const lucroDe = (v: Venda) => (v.lucro_taxa_ajuste != null ? Number(v.lucro_taxa_ajuste) : Number(v.lucro_taxa_calc));
function valorBR(s: string) {
  const t = String(s || "").replace(/[^\d.,-]/g, ""); if (!t) return NaN;
  if (t.includes(",")) return parseFloat(t.replace(/\./g, "").replace(",", "."));
  return parseFloat(t);
}

async function historicoAntigo(): Promise<RegistroTaxa[]> {
  try { const r = await fetch("/api/config/historico-taxas"); const j = await r.json(); return (j.data || []) as RegistroTaxa[]; } catch { return []; }
}
// Grava os dias automáticos no histórico de sempre (para os outros relatórios continuarem somando)
async function gravarHistorico(dias: RegistroTaxa[]) {
  const hist = await historicoAntigo();
  if (!hist.length && !dias.length) return;
  const mapa = new Map(hist.map(h => [h.data, h]));
  let mudou = false;
  for (const d of dias) {
    const a = mapa.get(d.data);
    if (!a || a.lucro !== d.lucro || a.pedidos !== d.pedidos || a.totalBruto !== d.totalBruto) { mapa.set(d.data, d); mudou = true; }
  }
  if (!mudou) return;
  const data = [...mapa.values()].sort((a, b) => b.data.localeCompare(a.data));
  await fetch("/api/config/historico-taxas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data }) }).catch(() => {});
}

const FONTE = "'Plus Jakarta Sans',system-ui,sans-serif";
const card: CSSProperties = { background: "#fff", borderRadius: 16, padding: "14px 16px", marginBottom: 12, border: "1px solid #e8eeff" };
const botao = (cor: string, fundo: string, borda = fundo): CSSProperties => ({ background: fundo, color: cor, border: `1px solid ${borda}`, borderRadius: 12, padding: "9px 13px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: FONTE });
const input: CSSProperties = { border: "1px solid #d0daf5", borderRadius: 10, padding: "9px 10px", fontSize: 14, width: "100%", boxSizing: "border-box", fontFamily: FONTE };
const titulo: CSSProperties = { fontSize: 12, fontWeight: 800, color: "#1a3fa8", textTransform: "uppercase", letterSpacing: ".04em", margin: "0 0 8px" };

export default function TaxasMaquininha({ onBack }: { onBack?: () => void }) {
  const hoje = isoLocal(new Date());
  const [de, setDe] = useState(hoje);
  const [ate, setAte] = useState(hoje);
  const [vendas, setVendas] = useState<Venda[]>([]);
  const [todasAuto, setTodasAuto] = useState<{ dia: string; lucro: number; bruto: number; taxa: number; n: number }[]>([]);
  const [antigo, setAntigo] = useState<RegistroTaxa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [sincronizando, setSincronizando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [editando, setEditando] = useState<Record<number, { valor: string; obs: string }>>({});
  const [verTabela, setVerTabela] = useState(false);
  const [verHistorico, setVerHistorico] = useState(false);
  const [maq, setMaq] = useState<Taxas>(MAQ_PADRAO);
  const [cli, setCli] = useState<Taxas>(CLI_PADRAO);
  const [maqEdicao, setMaqEdicao] = useState<Record<string, string>>({});
  const [ultimaSync, setUltimaSync] = useState("");

  async function carregar() {
    setCarregando(true);
    const [{ data: vs, error }, { data: tudo }, { data: cfg }, hist] = await Promise.all([
      supabase.from("vendas_mp").select("*").gte("dia", de).lte("dia", ate).order("data_venda", { ascending: false }),
      supabase.from("vendas_mp").select("dia,base_cartao,bruto_cartao,taxa_maquininha,lucro_taxa_calc,lucro_taxa_ajuste,sincronizado_em,status").gte("dia", INICIO_AUTOMATICO),
      supabase.from("config_taxas").select("id,taxas").in("id", [1, 2]),
      historicoAntigo(),
    ]);
    if (error) setAviso("Não consegui carregar as vendas: " + error.message);
    setVendas(((vs || []) as Venda[]).filter(v => v.status === "concluido"));
    const porDia = new Map<string, { dia: string; lucro: number; bruto: number; taxa: number; n: number }>();
    let sync = "";
    for (const v of (tudo || []) as (Venda & { sincronizado_em: string })[]) {
      if (v.sincronizado_em > sync) sync = v.sincronizado_em;
      if (v.status !== "concluido" || !(Number(v.base_cartao) > 0)) continue;
      const d = porDia.get(v.dia) || { dia: v.dia, lucro: 0, bruto: 0, taxa: 0, n: 0 };
      d.lucro += lucroDe(v); d.bruto += Number(v.bruto_cartao); d.taxa += Number(v.taxa_maquininha); d.n++;
      porDia.set(v.dia, d);
    }
    const auto = [...porDia.values()].map(d => ({ ...d, lucro: r2(d.lucro), bruto: r2(d.bruto), taxa: r2(d.taxa) })).sort((a, b) => b.dia.localeCompare(a.dia));
    setTodasAuto(auto);
    setUltimaSync(sync);
    setAntigo(hist.filter(h => h.data < INICIO_AUTOMATICO));
    const c = (cfg || []) as { id: number; taxas: Taxas }[];
    setCli({ ...CLI_PADRAO, ...(c.find(x => x.id === 1)?.taxas || {}) });
    setMaq({ ...MAQ_PADRAO, ...(c.find(x => x.id === 2)?.taxas || {}) });
    setCarregando(false);
    // mantém o histórico de sempre atualizado com os dias automáticos
    gravarHistorico(auto.map(d => ({ data: d.dia, lucro: d.lucro, totalBruto: d.bruto, taxaPagBank: d.taxa, pedidos: d.n })));
  }
  useEffect(() => { carregar(); }, [de, ate]);

  async function sincronizarAgora(desde = de) {
    setSincronizando(true); setAviso("Buscando as vendas no Mercado Phone…");
    const { data, error } = await supabase.functions.invoke("mp-vendas", { body: { desde: desde < INICIO_AUTOMATICO ? INICIO_AUTOMATICO : desde, ate: hoje } });
    setSincronizando(false);
    const r = (data || {}) as { vendas?: number; erro?: string; erros?: string[] };
    if (error || r.erro) { setAviso("⚠️ " + (r.erro || error?.message)); return; }
    setAviso(`✓ ${r.vendas ?? 0} venda(s) atualizada(s) do Mercado Phone.` + (r.erros?.length ? ` ⚠️ ${r.erros.length} com erro.` : ""));
    carregar();
  }

  async function salvarAjuste(v: Venda) {
    const e = editando[v.id]; const n = valorBR(e?.valor || "");
    if (isNaN(n)) { setAviso("Digite o lucro correto (ex.: 71,64)."); return; }
    const { error } = await supabase.from("vendas_mp").update({ lucro_taxa_ajuste: r2(n), ajuste_obs: e.obs || null, ajustado_em: new Date().toISOString() }).eq("id", v.id);
    if (error) { setAviso("Erro ao salvar: " + error.message); return; }
    setEditando(x => { const c = { ...x }; delete c[v.id]; return c; });
    setAviso("✓ Lucro corrigido e salvo no histórico.");
    carregar();
  }
  async function voltarAoCalculado(v: Venda) {
    await supabase.from("vendas_mp").update({ lucro_taxa_ajuste: null, ajuste_obs: null, ajustado_em: null }).eq("id", v.id);
    setEditando(x => { const c = { ...x }; delete c[v.id]; return c; });
    carregar();
  }
  async function salvarTabelaMaquininha() {
    const novas: Taxas = { ...maq };
    for (const [k, v] of Object.entries(maqEdicao)) { const n = valorBR(v); if (!isNaN(n)) novas[k] = n; }
    const { error } = await supabase.from("config_taxas").upsert({ id: 2, taxas: novas, atualizado_em: new Date().toISOString() });
    if (error) { setAviso("Erro ao salvar a tabela: " + error.message); return; }
    setMaq(novas); setMaqEdicao({});
    if (confirm("Tabela da maquininha salva. Recalcular as vendas desde 18/11 com a tabela nova? (as correções manuais continuam)")) sincronizarAgora(INICIO_AUTOMATICO);
  }

  const comCartao = vendas.filter(v => Number(v.base_cartao) > 0);
  const totais = useMemo(() => ({
    lucro: r2(comCartao.reduce((s, v) => s + lucroDe(v), 0)),
    bruto: r2(comCartao.reduce((s, v) => s + Number(v.bruto_cartao), 0)),
    taxa: r2(comCartao.reduce((s, v) => s + Number(v.taxa_maquininha), 0)),
    alertas: comCartao.filter(v => (v.taxa_alertas || []).length && v.lucro_taxa_ajuste == null).length,
  }), [vendas]);
  const mesAtual = hoje.slice(0, 7);
  const historico = useMemo(() => {
    const linhas: RegistroTaxa[] = [...todasAuto.map(d => ({ data: d.dia, lucro: d.lucro, totalBruto: d.bruto, taxaPagBank: d.taxa, pedidos: d.n })), ...antigo];
    return linhas.sort((a, b) => b.data.localeCompare(a.data));
  }, [todasAuto, antigo]);
  const acumuladoMes = r2(historico.filter(h => h.data.startsWith(mesAtual)).reduce((s, h) => s + h.lucro, 0));
  const porMes = useMemo(() => {
    const m = new Map<string, number>();
    historico.forEach(h => m.set(h.data.slice(0, 7), (m.get(h.data.slice(0, 7)) || 0) + h.lucro));
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [historico]);
  const atalho = (d1: string, d2: string) => { setDe(d1); setAte(d2); };
  const ontem = isoLocal(new Date(Date.now() - 86400000));
  const seteDias = isoLocal(new Date(Date.now() - 6 * 86400000));

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "16px 14px 100px", fontFamily: FONTE, color: "#0d1b3e" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <div style={{ fontSize: 21, fontWeight: 900 }}>💳 Lucro de Taxas</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={botao("#0d1b3e", "#fff", "#d0daf5")} onClick={() => setVerTabela(v => !v)}>📊 Tabela</button>
          {onBack && <button style={botao("#0d1b3e", "#fff", "#d0daf5")} onClick={onBack}>← Voltar</button>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
        {[["Hoje", hoje, hoje], ["Ontem", ontem, ontem], ["7 dias", seteDias, hoje], ["Este mês", mesAtual + "-01", hoje]].map(([n, a, b]) =>
          <button key={n} onClick={() => atalho(a, b)} style={botao(de === a && ate === b ? "#fff" : "#1a3fa8", de === a && ate === b ? "#1a3fa8" : "#eef2ff")}>{n}</button>)}
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center" }}>
        <input type="date" style={input} value={de} onChange={e => setDe(e.target.value)} />
        <span>até</span>
        <input type="date" style={input} value={ate} onChange={e => setAte(e.target.value)} />
      </div>

      {de < INICIO_AUTOMATICO && <div style={{ ...card, background: "#fff7e6", borderColor: "#f5c26b", fontSize: 13 }}>Antes de {dataBR(INICIO_AUTOMATICO)} as vendas eram do GestaoClick: esses dias aparecem só no histórico abaixo.</div>}

      <div style={{ ...card, background: "linear-gradient(135deg,#0d1b3e,#1a3fa8)", color: "#fff", border: "none" }}>
        <div style={{ fontSize: 12, opacity: .85, fontWeight: 700 }}>LUCRO COM TAXAS {de === ate ? `· ${dataBR(de)}` : `· ${dataBR(de)} a ${dataBR(ate)}`}</div>
        <div style={{ fontSize: 32, fontWeight: 900, margin: "4px 0" }}>{fmt(totais.lucro)}</div>
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, opacity: .95 }}>
          <span><b>{comCartao.length}</b> venda(s) no cartão</span><span>passado <b>{fmt(totais.bruto)}</b></span><span>PagBank <b>{fmt(totais.taxa)}</b></span>
        </div>
        <div style={{ marginTop: 8, fontSize: 13, opacity: .9 }}>No mês: <b>{fmt(acumuladoMes)}</b></div>
        {totais.alertas > 0 && <div style={{ marginTop: 10, background: "rgba(255,255,255,.15)", borderRadius: 10, padding: "8px 10px", fontSize: 13, fontWeight: 700 }}>⚠️ {totais.alertas} venda(s) para conferir (marcadas abaixo)</div>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 12, color: "#6b7fa8" }}>{ultimaSync ? `Atualiza sozinho a cada 15 min · última: ${new Date(ultimaSync).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}` : "Atualiza sozinho a cada 15 min"}</span>
        <button style={botao("#fff", "#1a3fa8")} disabled={sincronizando} onClick={() => sincronizarAgora()}>{sincronizando ? "Buscando…" : "🔄 Atualizar agora"}</button>
      </div>
      {aviso && <div style={{ ...card, padding: 10, fontSize: 13, fontWeight: 700, color: aviso.startsWith("✓") ? "#15803d" : aviso.startsWith("⚠") ? "#dc2626" : "#0d1b3e" }}>{aviso}</div>}

      {verTabela && <div style={card}>
        <p style={titulo}>Tabela de taxas</p>
        <div style={{ fontSize: 12, color: "#6b7fa8", marginBottom: 8 }}>Taxa do cliente: vem do simulador. Taxa da maquininha (PagBank): edite aqui se mudar.</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6, fontSize: 13, alignItems: "center" }}>
          <b>Forma</b><b>Cliente</b><b>PagBank</b>
          {MODALIDADES.map(k => [
            <span key={k + "n"}>{nomeMod(k)}</span>,
            <span key={k + "c"}>{(cli[k] ?? 0).toFixed(2)}%</span>,
            <input key={k + "m"} style={{ ...input, padding: "5px 8px" }} inputMode="decimal" value={maqEdicao[k] ?? String(maq[k] ?? 0).replace(".", ",")} onChange={e => setMaqEdicao(x => ({ ...x, [k]: e.target.value }))} />,
          ])}
        </div>
        <button style={{ ...botao("#fff", "#1a3fa8"), width: "100%", marginTop: 10 }} disabled={!Object.keys(maqEdicao).length} onClick={salvarTabelaMaquininha}>Salvar tabela da maquininha</button>
      </div>}

      <div style={card}>
        <p style={titulo}>Vendas no cartão ({comCartao.length})</p>
        {carregando ? <div style={{ color: "#6b7fa8" }}>Carregando…</div> : comCartao.length === 0 ? <div style={{ color: "#6b7fa8", fontSize: 14 }}>Nenhuma venda no cartão neste período.</div> :
          comCartao.map(v => {
            const ed = editando[v.id], alertas = v.taxa_alertas || [];
            const cartoes = (v.pagamentos || []).filter(p => /CART|CREDITO|DEBITO/i.test(p.formaPagamentoDescricao.normalize("NFD").replace(/[̀-ͯ]/g, "")));
            const outros = (v.pagamentos || []).filter(p => !cartoes.includes(p));
            return <div key={v.id} style={{ padding: "12px 0", borderTop: "1px solid #eef2ff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 14, minWidth: 0 }}>
                  <b>{v.cliente || "Cliente"}</b>
                  <div style={{ fontSize: 12, color: "#6b7fa8" }}>{new Date(v.data_venda.replace(" ", "T")).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · {v.vendedor || ""} · venda {fmt(Number(v.total))}</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>
                    💳 {fmt(Number(v.base_cartao))} → passado <b>{fmt(Number(v.bruto_cartao))}</b>{cartoes.map(c => c.detalhes && /\d/.test(c.detalhes) ? ` (${c.detalhes.slice(0, 40)})` : ` (${nomeMod(String(c.parcela || 1))})`).join("")}
                    {v.taxa_estimada && <span style={{ marginLeft: 6, background: "#fff7e6", color: "#b45309", borderRadius: 6, padding: "1px 6px", fontWeight: 800 }}>estimado</span>}
                  </div>
                  {outros.length > 0 && <div style={{ fontSize: 12, color: "#6b7fa8" }}>{outros.map(o => `${o.formaPagamentoDescricao} ${fmt(Number(o.valor))}`).join(" · ")}</div>}
                  <div style={{ fontSize: 12, color: "#6b7fa8" }}>PagBank: {fmt(Number(v.taxa_maquininha))}</div>
                </div>
                {!ed && <div style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: lucroDe(v) < 0 ? "#dc2626" : "#15803d" }}>{fmt(lucroDe(v))}</div>
                  {v.lucro_taxa_ajuste != null && <div style={{ fontSize: 11, color: "#6b7fa8", textDecoration: "line-through" }}>{fmt(Number(v.lucro_taxa_calc))}</div>}
                  <button style={{ ...botao("#1a3fa8", "#eef2ff"), padding: "5px 10px", marginTop: 4 }} onClick={() => setEditando(x => ({ ...x, [v.id]: { valor: String(lucroDe(v)).replace(".", ","), obs: v.ajuste_obs || "" } }))}>✏️ Editar</button>
                </div>}
              </div>
              {v.lucro_taxa_ajuste != null && !ed && <div style={{ fontSize: 12, color: "#1a3fa8", marginTop: 4 }}>✏️ Corrigido{v.ajuste_obs ? `: ${v.ajuste_obs}` : ""}</div>}
              {alertas.length > 0 && v.lucro_taxa_ajuste == null && <div style={{ fontSize: 12, background: "#fff7e6", color: "#92400e", borderRadius: 8, padding: "6px 8px", marginTop: 6 }}>{alertas.map((a, i) => <div key={i}>⚠️ {a}</div>)}</div>}
              {ed && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                <input style={{ ...input, flex: "1 1 100px" }} inputMode="decimal" placeholder="Lucro correto" value={ed.valor} onChange={e => setEditando(x => ({ ...x, [v.id]: { ...ed, valor: e.target.value } }))} />
                <input style={{ ...input, flex: "2 1 160px" }} placeholder="Motivo (opcional)" value={ed.obs} onChange={e => setEditando(x => ({ ...x, [v.id]: { ...ed, obs: e.target.value } }))} />
                <button style={botao("#fff", "#1a3fa8")} onClick={() => salvarAjuste(v)}>Salvar</button>
                {v.lucro_taxa_ajuste != null && <button style={botao("#0d1b3e", "#fff", "#d0daf5")} onClick={() => voltarAoCalculado(v)}>Usar calculado</button>}
                <button style={botao("#0d1b3e", "#fff", "#d0daf5")} onClick={() => setEditando(x => { const c = { ...x }; delete c[v.id]; return c; })}>✕</button>
              </div>}
            </div>;
          })}
      </div>

      <div style={card}>
        <button onClick={() => setVerHistorico(v => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}>
          <span style={titulo}>📅 Histórico {verHistorico ? "▲" : "▼"}</span></button>
        {verHistorico && <>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7fa8", margin: "6px 0" }}>POR MÊS</div>
          {porMes.map(([m, v]) => <div key={m} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #eef2ff", fontSize: 14 }}><span>{m.split("-").reverse().join("/")}</span><b>{fmt(r2(v))}</b></div>)}
          <div style={{ fontSize: 12, fontWeight: 800, color: "#6b7fa8", margin: "12px 0 6px" }}>POR DIA</div>
          {historico.slice(0, 60).map(h => <div key={h.data} onClick={() => h.data >= INICIO_AUTOMATICO && atalho(h.data, h.data)} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderTop: "1px solid #eef2ff", fontSize: 14, cursor: h.data >= INICIO_AUTOMATICO ? "pointer" : "default" }}>
            <span>{dataBR(h.data)} <span style={{ color: "#6b7fa8", fontSize: 12 }}>· {h.pedidos} venda(s){h.data < INICIO_AUTOMATICO ? " · GestaoClick" : ""}</span></span><b>{fmt(h.lucro)}</b></div>)}
        </>}
      </div>
    </div>
  );
}
