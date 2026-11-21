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
interface ItemVendido { chave: string; venda_id: number; produto_id: number; dia: string; cliente: string; vendedor: string; nome: string; imei: string; valor: number; custo: number | null; fornecedor: string; aparelho_id: string | null; origem: string; }
const INICIO_MP = "2026-11-18";
interface Linha extends Aparelho { custo: number | null; fornecedor: string; local: string; dias: number; }

interface Filtros { busca: string; local: string; fornecedor: string; modelo: string; de: string; ate: string; custo: "todos" | "com" | "sem"; mp: "todos" | "no" | "fora"; parados: string; ordem: "parados" | "recentes" | "maior" | "menor" | "modelo"; }
const FILTROS_INICIAIS: Filtros = { busca: "", local: "", fornecedor: "", modelo: "", de: "", ate: "", custo: "todos", mp: "todos", parados: "", ordem: "parados" };
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
  const [filtros, setFiltros] = useState<Filtros>(FILTROS_INICIAIS);
  const [mostrarFiltros, setMostrarFiltros] = useState(false);
  const [verAnalises, setVerAnalises] = useState(false);
  const [verTodasPendencias, setVerTodasPendencias] = useState(false);
  const [limiteLista, setLimiteLista] = useState(50);
  const [edicao, setEdicao] = useState<Record<string, { valor: string; fornecedor: string }>>({});
  const [salvando, setSalvando] = useState("");
  const [aviso, setAviso] = useState("");
  const [mpStatus, setMpStatus] = useState<Record<string, string>>({});
  const [enviandoTodos, setEnviandoTodos] = useState(false);
  const [vendidos, setVendidos] = useState<ItemVendido[]>([]);
  const [taxasVendas, setTaxasVendas] = useState<{ dia: string; valor: number }[]>([]);
  const [acessVendas, setAcessVendas] = useState<{ dia: string; nome: string; qtd: number; valor: number; custo: number | null }[]>([]);
  const [verVendidosOk, setVerVendidosOk] = useState(false);
  const [periodoVendas, setPeriodoVendas] = useState<"hoje" | "7" | "mes" | "tudo">("mes");

  async function carregar() {
    setCarregando(true); setErro("");
    try {
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const [ap, cu, fo, co, ms] = await Promise.all([
        supabase.from("aparelhos").select("id,nome,gb,cor,imei,destino,tipo,assistencia_nome,data_entrada,origem,criado_em"),
        supabase.from("aparelhos_custos").select("aparelho_id,custo,fornecedor,origem_custo,registrado_por,atualizado_em"),
        supabase.from("app_dados").select("valor").eq("chave", "config:fornecedores_aparelhos").maybeSingle(),
        supabase.from("contagens").select("local,usuario,finalizada_em,esperados,faltando").gte("finalizada_em", hoje.toISOString()).order("finalizada_em", { ascending: false }),
        supabase.from("aparelhos_mp").select("aparelho_id,status"),
      ]);
      setMpStatus(Object.fromEntries(((ms.data || []) as { aparelho_id: string; status: string }[]).map(x => [x.aparelho_id, x.status])));
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
      await carregarVendidos(custos);
    } catch (e) {
      setErro("Não consegui carregar o estoque: " + ((e as Error).message || String(e)));
    }
    setCarregando(false);
  }
  useEffect(() => { carregar(); }, []);

  // Aparelhos vendidos pelo Mercado Phone (desde 18/11) e o custo real de cada um.
  // Observação: no MP o campo custo costuma vir igual ao preço de venda; só é confiável quando veio de upgrade (cliente).
  async function carregarVendidos(custos: Map<string, Custo>) {
    const { data: vs } = await supabase.from("vendas_mp").select("id,dia,cliente,vendedor,status,itens,lucro_taxa_calc,lucro_taxa_ajuste").gte("dia", INICIO_MP).order("data_venda", { ascending: false });
    const vendas = ((vs || []) as { id: number; dia: string; cliente: string; vendedor: string; status: string; itens: Record<string, unknown>[]; lucro_taxa_calc: number; lucro_taxa_ajuste: number | null }[]).filter(v => v.status === "concluido");
    const imeis = [...new Set(vendas.flatMap(v => v.itens.filter(i => i.aparelho && i.imei).map(i => String(i.imei))))];
    const [{ data: aps }, { data: vic }] = await Promise.all([
      imeis.length ? supabase.from("aparelhos").select("id,imei,criado_em").in("imei", imeis) : Promise.resolve({ data: [] as { id: string; imei: string; criado_em: number }[] }),
      supabase.from("vendas_itens_custo").select("venda_id,produto_id,custo,fornecedor"),
    ]);
    const porImei = new Map<string, string>();
    for (const a of ((aps || []) as { id: string; imei: string; criado_em: number }[]).sort((x, y) => (x.criado_em || 0) - (y.criado_em || 0))) porImei.set(a.imei, a.id);
    const manuais = new Map(((vic || []) as { venda_id: number; produto_id: number; custo: number; fornecedor: string }[]).map(x => [`${x.venda_id}-${x.produto_id}`, x]));
    const itens: ItemVendido[] = [];
    const taxas: { dia: string; valor: number }[] = [];
    const acess: { dia: string; nome: string; qtd: number; valor: number; custo: number | null }[] = [];
    for (const v of vendas) {
      taxas.push({ dia: v.dia, valor: Number(v.lucro_taxa_ajuste ?? v.lucro_taxa_calc) || 0 });
      for (const i of v.itens) {
        if (i.acessorio) acess.push({ dia: v.dia, nome: String(i.produtoNome || "").split(" - ")[0], qtd: Number(i.quantidade) || 1, valor: Number(i.valorTotal) || 0, custo: i.custo_total == null ? null : Number(i.custo_total) });
        if (!i.aparelho) continue;
        const chave = `${v.id}-${i.produtoId}`, imei = String(i.imei || ""), apId = porImei.get(imei) || null;
        const cSis = apId ? custos.get(apId) : undefined, cMan = manuais.get(chave);
        const cMp = i.fornecedor_mp && Number(i.custo_mp) > 0 && Number(i.custo_mp) !== Number(i.valorUnitario) ? Number(i.custo_mp) : null;
        let custo: number | null = null, fornecedor = "", origem = "";
        if (cSis && cSis.custo != null) { custo = Number(cSis.custo); fornecedor = cSis.fornecedor || ""; origem = "cadastro"; }
        else if (cMan && cMan.custo != null) { custo = Number(cMan.custo); fornecedor = cMan.fornecedor || ""; origem = "preenchido"; }
        else if (cMp != null) { custo = cMp; fornecedor = String(i.fornecedor_mp || ""); origem = "upgrade"; }
        itens.push({ chave, venda_id: v.id, produto_id: Number(i.produtoId), dia: v.dia, cliente: v.cliente, vendedor: v.vendedor, nome: String(i.produtoNome || ""), imei, valor: Number(i.valorTotal) || 0, custo, fornecedor, aparelho_id: apId, origem });
      }
    }
    setVendidos(itens);
    setTaxasVendas(taxas);
    setAcessVendas(acess);
  }
  async function salvarCustoVendido(it: ItemVendido, fornPadrao: string) {
    const e0 = edicao[it.chave] || { valor: "", fornecedor: "" };
    const e = { valor: e0.valor, fornecedor: e0.fornecedor || fornPadrao };
    const v = valorBR(e.valor);
    if (!(v > 0)) { setAviso("Informe o valor pago no aparelho vendido."); return; }
    if (v >= it.valor && !confirm(`O custo (${fmt(v)}) é maior ou igual ao valor da venda (${fmt(it.valor)}). Está certo?`)) return;
    const forn = corrigir(e.fornecedor, fornecedores);
    if (!forn) { setAviso("Informe o fornecedor."); return; }
    if (!fornecedores.includes(forn) && !confirm(`"${forn}" não está na lista de fornecedores. É um fornecedor novo?`)) return;
    setSalvando(it.chave);
    const agora = new Date().toISOString();
    const r1 = await supabase.from("vendas_itens_custo").upsert({ venda_id: it.venda_id, produto_id: it.produto_id, imei: it.imei, custo: v, fornecedor: forn, registrado_por: "Robert", atualizado_em: agora });
    if (!r1.error && it.aparelho_id) await supabase.from("aparelhos_custos").upsert({ aparelho_id: it.aparelho_id, custo: v, fornecedor: forn, origem_custo: "fornecedor", registrado_por: "Robert", atualizado_em: agora });
    setSalvando("");
    if (r1.error) { setAviso("Erro ao salvar: " + r1.error.message); return; }
    if (!fornecedores.includes(forn)) { const nova = [...fornecedores, forn].sort(); setFornecedores(nova); await supabase.from("app_dados").upsert({ chave: "config:fornecedores_aparelhos", valor: nova, atualizado_em: agora }); }
    setVendidos(xs => xs.map(x => x.chave === it.chave ? { ...x, custo: v, fornecedor: forn, origem: "preenchido" } : x));
    setEdicao(ed => { const n = { ...ed }; delete n[it.chave]; return n; });
    setAviso(`✓ Custo salvo · lucro da venda ${fmt(it.valor - v)}`);
  }

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
    const f = filtros, b = norm(f.busca), soDig = f.busca.replace(/\D/g, "");
    const r = linhas.filter(l => {
      if (f.local && l.local !== f.local) return false;
      if (f.fornecedor && l.fornecedor !== f.fornecedor) return false;
      if (f.modelo && [l.nome, l.gb].filter(Boolean).join(" ") !== f.modelo) return false;
      if (f.custo === "com" && l.custo == null) return false;
      if (f.custo === "sem" && l.custo != null) return false;
      if (f.mp === "no" && mpStatus[l.id] !== "ok") return false;
      if (f.mp === "fora" && mpStatus[l.id] === "ok") return false;
      if (f.parados && l.dias <= Number(f.parados)) return false;
      if (f.de && (!l.data_entrada || l.data_entrada < f.de)) return false;
      if (f.ate && (!l.data_entrada || l.data_entrada > f.ate)) return false;
      if (b && !(soDig.length >= 4 && String(l.imei || "").includes(soDig)) && !norm([l.nome, l.gb, l.cor, l.imei, l.fornecedor].join(" ")).includes(b)) return false;
      return true;
    });
    const ord: Record<Filtros["ordem"], (a: Linha, b: Linha) => number> = {
      parados: (a, b) => b.dias - a.dias, recentes: (a, b) => a.dias - b.dias,
      maior: (a, b) => (b.custo ?? -1) - (a.custo ?? -1), menor: (a, b) => (a.custo ?? 1e9) - (b.custo ?? 1e9),
      modelo: (a, b) => String(a.nome).localeCompare(String(b.nome)) || String(a.gb).localeCompare(String(b.gb)),
    };
    return r.sort(ord[f.ordem]);
  }, [linhas, filtros, mpStatus]);

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
    const base = norm(e.fornecedor) !== norm(forn) ? `✓ Salvo. Fornecedor corrigido para ${forn}.` : "✓ Salvo.";
    setAviso(base + " Enviando ao Mercado Phone…");
    setAviso(base + " " + await enviarMP(l.id));
  }
  // O servidor cria/atualiza o aparelho no Mercado Phone com custo e fornecedor (a chave do MP fica só no servidor)
  async function enviarMP(id: string): Promise<string> {
    try {
      const { data, error } = await supabase.functions.invoke("mp-estoque", { body: { aparelho_id: id } });
      if (error) return "⚠️ Não foi para o Mercado Phone (" + error.message + ").";
      const r = data as { status?: string; acao?: string; erro?: string };
      setMpStatus(m => ({ ...m, [id]: r.status || "" }));
      if (r.status === "ok") return r.acao === "criado" ? "✓ Cadastrado no Mercado Phone." : "✓ Atualizado no Mercado Phone.";
      if (r.status === "erro") return "⚠️ Mercado Phone: " + (r.erro || "erro");
      return "";
    } catch (err) { return "⚠️ Não foi para o Mercado Phone (" + String(err) + ")."; }
  }
  async function enviarTodosMP() {
    const ids = linhas.filter(l => l.custo != null && l.fornecedor && mpStatus[l.id] !== "ok").map(l => l.id);
    if (!ids.length) { setAviso("Nenhum aparelho com custo aguardando envio."); return; }
    if (!confirm(`Enviar ${ids.length} aparelho(s) com custo para o Mercado Phone?`)) return;
    setEnviandoTodos(true); let ok = 0, erro = 0;
    for (let i = 0; i < ids.length; i += 20) {
      setAviso(`Enviando ao Mercado Phone… ${i}/${ids.length}`);
      const { data } = await supabase.functions.invoke("mp-estoque", { body: { ids: ids.slice(i, i + 20) } });
      for (const r of ((data || []) as { aparelho_id: string; status: string }[])) { setMpStatus(m => ({ ...m, [r.aparelho_id]: r.status })); if (r.status === "ok") ok++; else if (r.status === "erro") erro++; }
    }
    setEnviandoTodos(false);
    setAviso(`✓ ${ok} enviado(s) ao Mercado Phone` + (erro ? ` · ⚠️ ${erro} com erro (veja na lista)` : ""));
  }

  const statusContagem = (k: string) => {
    const c = contagens.find(x => (x.local || "").split(":")[0] === k || (k === "estoque_r1" && x.local === "r1"));
    if (!c) return { txt: "⏳ Não conferido", cor: "#b45309" };
    const nao = (c.faltando || []).filter(f => f.resposta && f.resposta.destino === "nao_encontrado").length;
    const hora = new Date(c.finalizada_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return nao ? { txt: `🚨 ${nao} sumido(s)`, cor: "#dc2626" } : { txt: `✅ ${hora} · ${c.usuario}`, cor: "#15803d" };
  };

  const f = filtros;
  const setF = (p: Partial<Filtros>) => setFiltros(x => ({ ...x, ...p }));
  const filtrosAtivos = [
    f.local && ["Local: " + LOCAIS[f.local], () => setF({ local: "" })],
    f.fornecedor && ["Fornecedor: " + f.fornecedor, () => setF({ fornecedor: "" })],
    f.modelo && ["Modelo: " + f.modelo, () => setF({ modelo: "" })],
    f.de && ["Desde " + f.de.split("-").reverse().join("/"), () => setF({ de: "" })],
    f.ate && ["Até " + f.ate.split("-").reverse().join("/"), () => setF({ ate: "" })],
    f.custo !== "todos" && [f.custo === "com" ? "Com custo" : "Sem custo", () => setF({ custo: "todos" })],
    f.mp !== "todos" && [f.mp === "no" ? "No Mercado Phone" : "Fora do Mercado Phone", () => setF({ mp: "todos" })],
    f.parados && ["Parados há +" + f.parados + " dias", () => setF({ parados: "" })],
  ].filter(Boolean) as [string, () => void][];
  const totalFiltrado = visiveis.reduce((s, l) => s + (l.custo || 0), 0);
  const hojeIso = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })();
  const desdeVendas = periodoVendas === "hoje" ? hojeIso : periodoVendas === "7" ? (() => { const d = new Date(Date.now() - 6 * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; })() : periodoVendas === "mes" ? hojeIso.slice(0, 8) + "01" : INICIO_MP;
  const vendPeriodo = vendidos.filter(v => v.dia >= desdeVendas);
  const vendComCusto = vendPeriodo.filter(v => v.custo != null);
  const fatAparelhos = vendPeriodo.reduce((t, v) => t + v.valor, 0);
  const lucroAparelhos = vendComCusto.reduce((t, v) => t + v.valor - (v.custo || 0), 0);
  const acessPeriodo = acessVendas.filter(a => a.dia >= desdeVendas);
  const fatAcess = acessPeriodo.reduce((t, a) => t + a.valor, 0);
  const lucroAcess = acessPeriodo.reduce((t, a) => t + a.valor - (a.custo || 0), 0);
  const acessSemCusto = [...new Set(acessPeriodo.filter(a => a.custo == null).map(a => a.nome))];
  const brindes = acessPeriodo.filter(a => a.valor === 0).reduce((t, a) => t + (a.custo || 0), 0);
  const lucroTaxasPeriodo = taxasVendas.filter(t => t.dia >= desdeVendas).reduce((t, x) => t + x.valor, 0);
  const vendidosSemCusto = vendidos.filter(v => v.custo == null).sort((a, b) => a.dia.localeCompare(b.dia));
  const pendentes = linhas.filter(l => l.custo == null && (!f.local || l.local === f.local)).sort((a, b) => b.dias - a.dias);
  const modelos = [...new Set(linhas.map(l => [l.nome, l.gb].filter(Boolean).join(" ")))].sort();
  const fornecedoresUsados = [...new Set(linhas.map(l => l.fornecedor).filter(Boolean))].sort();
  const sel: CSSProperties = { ...input, padding: "8px 10px" };
  const rotulo: CSSProperties = { fontSize: 11, fontWeight: 800, color: "#6b7fa8", textTransform: "uppercase", margin: "8px 0 4px" };

  // Linha de um aparelho; com edição de custo quando está sem custo (ou ao tocar no valor)
  const linhaAparelho = (l: Linha, sempreEditar: boolean) => {
    const ed = edicao[l.id], abrir = sempreEditar || !!ed;
    return <div key={l.id} style={{ padding: "10px 0", borderTop: "1px solid #eef2ff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
        <div style={{ fontSize: 14 }}><b>{[l.nome, l.gb].filter(Boolean).join(" ")}</b> {l.cor}
          <div style={{ fontSize: 12, color: "#6b7fa8", fontFamily: "ui-monospace,Menlo,monospace" }}>{l.imei} · {LOCAIS[l.local]}{l.local === "assistencia" && l.assistencia_nome ? " " + l.assistencia_nome : ""} · entrou {l.data_entrada ? l.data_entrada.split("-").reverse().join("/") : "?"} ({l.dias}d)</div>
          <div style={{ fontSize: 11, fontWeight: 800, marginTop: 2, color: mpStatus[l.id] === "ok" ? "#15803d" : mpStatus[l.id] === "erro" ? "#dc2626" : "#b45309" }}>{mpStatus[l.id] === "ok" ? "✓ No Mercado Phone" : mpStatus[l.id] === "erro" ? "⚠️ Erro ao enviar ao Mercado Phone" : "⏳ Ainda não está no Mercado Phone"}</div></div>
        {l.custo != null && !ed && <div style={{ textAlign: "right", cursor: "pointer", whiteSpace: "nowrap" }} onClick={() => setEdicao(x => ({ ...x, [l.id]: { valor: String(l.custo).replace(".", ","), fornecedor: l.fornecedor } }))}>
          <b>{fmt(l.custo)}</b><div style={{ fontSize: 12, color: "#6b7fa8" }}>{l.fornecedor || "—"} ✏️</div></div>}
        {l.custo == null && !abrir && <span style={{ fontSize: 12, fontWeight: 800, color: "#b45309", whiteSpace: "nowrap", cursor: "pointer" }} onClick={() => setEdicao(x => ({ ...x, [l.id]: { valor: "", fornecedor: "" } }))}>⚠️ sem custo ✏️</span>}
      </div>
      {abrir && <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <input style={{ ...input, flex: "1 1 110px" }} inputMode="decimal" placeholder="Valor pago" value={ed ? ed.valor : ""}
          onChange={e => setEdicao(x => ({ ...x, [l.id]: { valor: e.target.value, fornecedor: (x[l.id] || { fornecedor: l.fornecedor }).fornecedor } }))} />
        <input style={{ ...input, flex: "1 1 140px" }} list="caixa-fornecedores" placeholder="Fornecedor" value={ed ? ed.fornecedor : l.fornecedor}
          onChange={e => setEdicao(x => ({ ...x, [l.id]: { valor: (x[l.id] || { valor: "" }).valor, fornecedor: e.target.value } }))} />
        <button style={{ ...btn, flex: "0 0 auto" }} disabled={salvando === l.id} onClick={() => salvarCusto(l)}>{salvando === l.id ? "…" : "Salvar"}</button>
        {ed && l.custo != null && <button style={{ ...btnGhost, flex: "0 0 auto" }} onClick={() => setEdicao(x => { const n = { ...x }; delete n[l.id]; return n; })}>✕</button>}
      </div>}
    </div>;
  };
  const linhaResumo = (nome: string, v: { qtd: number; valor: number; sem?: number }, onClick: () => void) =>
    <div key={nome} onClick={onClick} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderTop: "1px solid #eef2ff", fontSize: 14, cursor: "pointer" }}>
      <span><b>{nome}</b> <span style={{ color: "#6b7fa8" }}>· {v.qtd} un.{v.sem ? ` (${v.sem} sem custo)` : ""}</span></span><b>{fmt(v.valor)} ›</b></div>;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "16px 14px 100px", fontFamily: "system-ui,-apple-system,Arial", color: "#0d1b3e" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, gap: 8 }}>
        <div style={{ fontSize: 22, fontWeight: 900 }}>🏦 Caixa · Capital em estoque</div>
        <div style={{ display: "flex", gap: 8 }}>
          <button style={btnGhost} onClick={carregar} title="Atualizar">🔄</button>
          {onBack && <button style={btnGhost} onClick={onBack}>← Voltar</button>}
        </div>
      </div>
      {erro && <div style={{ ...card, borderColor: "#dc2626", color: "#dc2626" }}>{erro}</div>}
      <datalist id="caixa-fornecedores">{fornecedores.map(x => <option key={x} value={x} />)}</datalist>
      {carregando ? <div style={card}>Carregando…</div> : <>

        {/* 1. Painel: quanto tenho */}
        <div style={{ ...card, background: "linear-gradient(135deg,#0d1b3e,#1a3fa8)", color: "#fff", border: "none" }}>
          <div style={{ fontSize: 13, opacity: .8, fontWeight: 700 }}>CAPITAL EM APARELHOS (pelo custo)</div>
          <div style={{ fontSize: 34, fontWeight: 900, margin: "4px 0" }}>{fmt(resumo.total)}</div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 13, opacity: .95 }}>
            <span><b>{resumo.qtd}</b> aparelhos</span><span>médio <b>{fmt(resumo.medio)}</b></span><span><b>{resumo.diasMedio}</b> dias parados em média</span>
          </div>
          {resumo.sem > 0 && <div style={{ marginTop: 10, background: "rgba(255,255,255,.15)", borderRadius: 10, padding: "8px 10px", fontSize: 14, fontWeight: 700 }}>
            ⚠️ {resumo.sem} aparelho(s) sem custo não entram no total ({resumo.qtd ? Math.round(resumo.comCusto / resumo.qtd * 100) : 0}% preenchido)</div>}
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {Object.entries(LOCAIS).map(([k, nome]) => {
            const p = resumo.porLocal[k] || { qtd: 0, valor: 0, sem: 0 }, st = statusContagem(k);
            return <button key={k} onClick={() => setF({ local: f.local === k ? "" : k })}
              style={{ ...card, flex: "1 1 100px", minWidth: 0, padding: 10, marginBottom: 0, textAlign: "left", cursor: "pointer", borderWidth: 2, borderColor: f.local === k ? "#1a3fa8" : "#d0daf5", background: f.local === k ? "#eef2ff" : "#fff" }}>
              <div style={{ fontWeight: 900, fontSize: 14 }}>{nome}</div>
              <div style={{ fontSize: 16, fontWeight: 900, margin: "4px 0", whiteSpace: "nowrap" }}>{fmt(p.valor)}</div>
              <div style={{ fontSize: 12, color: "#6b7fa8" }}>{p.qtd} un.{p.sem ? ` · ${p.sem} s/ custo` : ""}</div>
              <div style={{ fontSize: 11, fontWeight: 800, color: st.cor, marginTop: 4 }}>{st.txt}</div>
            </button>;
          })}
        </div>

        {aviso && <div style={{ ...card, padding: 12, fontSize: 14, fontWeight: 700, color: aviso.startsWith("✓") ? "#15803d" : aviso.startsWith("⚠") ? "#dc2626" : "#0d1b3e" }}>{aviso}</div>}

        {/* Vendas: lucro do período */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <p style={{ ...titulo, margin: 0 }}>📈 Lucro das vendas</p>
            <div style={{ display: "flex", gap: 4 }}>
              {([["hoje", "Hoje"], ["7", "7 dias"], ["mes", "Mês"], ["tudo", "Desde 18/11"]] as const).map(([k, n]) =>
                <button key={k} onClick={() => setPeriodoVendas(k)} style={{ border: "1px solid #d0daf5", background: periodoVendas === k ? "#1a3fa8" : "#fff", color: periodoVendas === k ? "#fff" : "#0d1b3e", borderRadius: 999, padding: "4px 9px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>{n}</button>)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 10 }}>
            {[["Faturado (aparelhos + acessórios)", fmt(fatAparelhos + fatAcess)], ["Aparelhos vendidos", String(vendPeriodo.length)],
              ["Lucro nos aparelhos", vendPeriodo.length && vendComCusto.length < vendPeriodo.length ? fmt(lucroAparelhos) + " *" : fmt(lucroAparelhos)], ["Lucro nos acessórios", fmt(lucroAcess)],
              ["Lucro com taxas", fmt(lucroTaxasPeriodo)], ["Brindes (custo)", fmt(brindes)]].map(([k, v]) =>
              <div key={k} style={{ background: "#f8faff", borderRadius: 12, padding: 10 }}><div style={{ fontSize: 11, fontWeight: 800, color: "#6b7fa8", textTransform: "uppercase" }}>{k}</div><div style={{ fontSize: 18, fontWeight: 900 }}>{v}</div></div>)}
          </div>
          <div style={{ background: "#eef2ff", borderRadius: 12, padding: 10, marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <b>Lucro total do período</b><b style={{ fontSize: 20, color: "#15803d" }}>{fmt(lucroAparelhos + lucroAcess + lucroTaxasPeriodo)}</b></div>
          {vendComCusto.length < vendPeriodo.length && <div style={{ fontSize: 12, color: "#b45309", marginTop: 6 }}>* {vendPeriodo.length - vendComCusto.length} aparelho(s) vendido(s) ainda sem custo: o lucro só fica certo depois de preencher abaixo.</div>}
          <div style={{ fontSize: 11, color: "#6b7fa8", marginTop: 6 }}>Lucro = aparelhos (venda − custo) + acessórios (venda − custo do Mercado Phone; brindes entram como custo) + taxas da maquininha.</div>
          {acessSemCusto.length > 0 && <div style={{ fontSize: 12, color: "#b45309", marginTop: 4 }}>⚠️ Acessórios sem custo no Mercado Phone: {acessSemCusto.join(", ")}</div>}
        </div>

        {vendidosSemCusto.length > 0 && <div style={{ ...card, borderColor: "#dc2626", borderWidth: 2 }}>
          <p style={{ ...titulo, color: "#dc2626" }}>🧾 Aparelhos vendidos sem custo ({vendidosSemCusto.length})</p>
          <div style={{ fontSize: 13, color: "#6b7fa8", marginBottom: 4 }}>Vendas do Mercado Phone desde 18/11. Preencha o valor pago e o fornecedor para fechar o lucro de cada dia.</div>
          {vendidosSemCusto.map((it, idx) => {
            const ed = edicao[it.chave] || { valor: "", fornecedor: idx > 0 ? (edicao[vendidosSemCusto[idx - 1].chave]?.fornecedor || "") : "" };
            return <div key={it.chave} style={{ padding: "10px 0", borderTop: "1px solid #eef2ff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 14 }}><b>{it.nome}</b>
                  <div style={{ fontSize: 12, color: "#6b7fa8" }}>{it.dia.split("-").reverse().join("/")} · {it.cliente} · {it.vendedor} · IMEI {it.imei || "—"}</div></div>
                <div style={{ textAlign: "right", whiteSpace: "nowrap", fontSize: 13 }}>vendido<br /><b>{fmt(it.valor)}</b></div>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                <input style={{ ...input, flex: "1 1 110px" }} inputMode="decimal" placeholder="Valor pago" value={edicao[it.chave]?.valor ?? ""}
                  onChange={e => setEdicao(x => ({ ...x, [it.chave]: { valor: e.target.value, fornecedor: (x[it.chave] || ed).fornecedor } }))} />
                <input style={{ ...input, flex: "1 1 140px" }} list="caixa-fornecedores" placeholder="Fornecedor" value={edicao[it.chave]?.fornecedor ?? ed.fornecedor}
                  onChange={e => setEdicao(x => ({ ...x, [it.chave]: { valor: (x[it.chave] || { valor: "" }).valor, fornecedor: e.target.value } }))} />
                <button style={{ ...btn, flex: "0 0 auto" }} disabled={salvando === it.chave} onClick={() => salvarCustoVendido(it, ed.fornecedor)}>{salvando === it.chave ? "…" : "Salvar"}</button>
              </div>
              {edicao[it.chave]?.valor && valorBR(edicao[it.chave].valor) > 0 && <div style={{ fontSize: 12, marginTop: 4, color: it.valor - valorBR(edicao[it.chave].valor) >= 0 ? "#15803d" : "#dc2626" }}>Lucro: {fmt(it.valor - valorBR(edicao[it.chave].valor))}</div>}
            </div>;
          })}
        </div>}

        {vendidos.length > 0 && <div style={card}>
          <button onClick={() => setVerVendidosOk(v => !v)} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", width: "100%", textAlign: "left" }}>
            <span style={{ ...titulo, margin: 0 }}>✅ Vendidos com custo ({vendidos.length - vendidosSemCusto.length}) {verVendidosOk ? "▲" : "▼"}</span></button>
          {verVendidosOk && vendidos.filter(v => v.custo != null).map(it => <div key={it.chave} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "8px 0", borderTop: "1px solid #eef2ff", fontSize: 13 }}>
            <span><b>{it.nome}</b><br /><span style={{ color: "#6b7fa8" }}>{it.dia.split("-").reverse().join("/")} · {it.fornecedor || "—"} · custo {fmt(it.custo || 0)} ({it.origem})</span></span>
            <b style={{ whiteSpace: "nowrap", color: it.valor - (it.custo || 0) >= 0 ? "#15803d" : "#dc2626" }}>{fmt(it.valor - (it.custo || 0))}</b></div>)}
        </div>}

        {/* 2. Pendências: sem custo */}
        {pendentes.length > 0 && <div style={{ ...card, borderColor: "#f5c26b", borderWidth: 2 }}>
          <p style={{ ...titulo, color: "#b45309" }}>⚠️ Precisam de custo e fornecedor ({pendentes.length}){f.local ? " · " + LOCAIS[f.local] : ""}</p>
          <div style={{ fontSize: 13, color: "#6b7fa8", marginBottom: 4 }}>Ao salvar, o aparelho já vai para o Mercado Phone. Os mais antigos aparecem primeiro.</div>
          {(verTodasPendencias ? pendentes : pendentes.slice(0, 8)).map(l => linhaAparelho(l, true))}
          {pendentes.length > 8 && <button style={{ ...btnGhost, width: "100%", marginTop: 8 }} onClick={() => setVerTodasPendencias(v => !v)}>{verTodasPendencias ? "Mostrar menos" : `Ver todos os ${pendentes.length}`}</button>}
        </div>}

        {/* 3. Estoque com filtros */}
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
            <p style={{ ...titulo, margin: 0 }}>Estoque ({visiveis.length}) · {fmt(totalFiltrado)}</p>
            <button style={{ ...btnGhost, padding: "8px 12px" }} onClick={() => setMostrarFiltros(v => !v)}>⚙️ Filtros{filtrosAtivos.length ? ` (${filtrosAtivos.length})` : ""}</button>
          </div>
          <input style={{ ...input, margin: "10px 0 6px" }} placeholder="🔎 Buscar por IMEI, modelo ou cor" value={f.busca} onChange={e => setF({ busca: e.target.value })} />
          {mostrarFiltros && <div style={{ background: "#f8faff", border: "1px solid #eef2ff", borderRadius: 12, padding: 10, margin: "6px 0" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8 }}>
              <div><div style={rotulo}>Local</div><select style={sel} value={f.local} onChange={e => setF({ local: e.target.value })}><option value="">Todos</option>{Object.entries(LOCAIS).map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select></div>
              <div><div style={rotulo}>Fornecedor</div><select style={sel} value={f.fornecedor} onChange={e => setF({ fornecedor: e.target.value })}><option value="">Todos</option>{fornecedoresUsados.map(x => <option key={x}>{x}</option>)}</select></div>
              <div><div style={rotulo}>Modelo</div><select style={sel} value={f.modelo} onChange={e => setF({ modelo: e.target.value })}><option value="">Todos</option>{modelos.map(x => <option key={x}>{x}</option>)}</select></div>
              <div><div style={rotulo}>Custo</div><select style={sel} value={f.custo} onChange={e => setF({ custo: e.target.value as Filtros["custo"] })}><option value="todos">Todos</option><option value="com">Com custo</option><option value="sem">Sem custo</option></select></div>
              <div><div style={rotulo}>Mercado Phone</div><select style={sel} value={f.mp} onChange={e => setF({ mp: e.target.value as Filtros["mp"] })}><option value="todos">Todos</option><option value="no">Já está lá</option><option value="fora">Ainda não está</option></select></div>
              <div><div style={rotulo}>Parados há mais de</div><select style={sel} value={f.parados} onChange={e => setF({ parados: e.target.value })}><option value="">Qualquer tempo</option><option value="15">15 dias</option><option value="30">30 dias</option><option value="60">60 dias</option><option value="90">90 dias</option></select></div>
              <div><div style={rotulo}>Entrada desde</div><input type="date" style={sel} value={f.de} onChange={e => setF({ de: e.target.value })} /></div>
              <div><div style={rotulo}>Entrada até</div><input type="date" style={sel} value={f.ate} onChange={e => setF({ ate: e.target.value })} /></div>
              <div><div style={rotulo}>Ordenar por</div><select style={sel} value={f.ordem} onChange={e => setF({ ordem: e.target.value as Filtros["ordem"] })}><option value="parados">Mais tempo parado</option><option value="recentes">Entrada mais recente</option><option value="maior">Maior custo</option><option value="menor">Menor custo</option><option value="modelo">Modelo</option></select></div>
            </div>
          </div>}
          {filtrosAtivos.length > 0 && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "6px 0" }}>
            {filtrosAtivos.map(([txt, limpar]) => <button key={txt} onClick={limpar} style={{ border: "1px solid #1a3fa8", background: "#eef2ff", color: "#1a3fa8", borderRadius: 999, padding: "5px 10px", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>{txt} ✕</button>)}
            <button onClick={() => setFiltros(FILTROS_INICIAIS)} style={{ border: "none", background: "none", color: "#dc2626", fontSize: 12, fontWeight: 800, cursor: "pointer" }}>Limpar tudo</button>
          </div>}
          <button style={{ ...btnGhost, width: "100%", margin: "6px 0" }} disabled={enviandoTodos} onClick={enviarTodosMP}>{enviandoTodos ? "Enviando…" : "📤 Enviar ao Mercado Phone os que já têm custo"}</button>
          {visiveis.length === 0 && <div style={{ color: "#6b7fa8", fontSize: 14, padding: "10px 0" }}>Nenhum aparelho com esses filtros.</div>}
          {visiveis.slice(0, limiteLista).map(l => linhaAparelho(l, false))}
          {visiveis.length > limiteLista && <button style={{ ...btnGhost, width: "100%", marginTop: 8 }} onClick={() => setLimiteLista(n => n + 50)}>Mostrar mais ({visiveis.length - limiteLista})</button>}
        </div>

        {/* 4. Análises (recolhidas) */}
        <div style={card}>
          <button onClick={() => setVerAnalises(v => !v)} style={{ ...btnGhost, width: "100%", textAlign: "left", border: "none", padding: 0, background: "none" }}>
            <span style={{ ...titulo, margin: 0 }}>📊 Análises {verAnalises ? "▲" : "▼"}</span></button>
          {verAnalises && <>
            <div style={rotulo}>Por fornecedor (toque para filtrar)</div>
            {resumo.porFornecedor.length === 0 ? <div style={{ color: "#6b7fa8", fontSize: 14 }}>Nenhum custo cadastrado ainda.</div> :
              resumo.porFornecedor.map(([n, v]) => linhaResumo(n, v, () => { setF({ fornecedor: n === "SEM FORNECEDOR" ? "" : n }); window.scrollTo({ top: 0, behavior: "smooth" }); }))}
            <div style={rotulo}>Por modelo (toque para filtrar)</div>
            {resumo.porModelo.map(([n, v]) => linhaResumo(n, v, () => setF({ modelo: n })))}
            <div style={rotulo}>Parados há mais tempo</div>
            {resumo.parados.map(l => <div key={l.id} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderTop: "1px solid #eef2ff", fontSize: 14 }}>
              <span>{[l.nome, l.gb, l.cor].filter(Boolean).join(" · ")} <span style={{ color: "#6b7fa8" }}>· {LOCAIS[l.local]}</span></span>
              <b style={{ color: l.dias > 30 ? "#dc2626" : "#0d1b3e", whiteSpace: "nowrap" }}>{l.dias} dias</b></div>)}
          </>}
        </div>
      </>}
    </div>
  );
}
