// mp-vendas: traz as vendas do Mercado Phone para o banco (vendas_mp) e calcula sozinho o lucro da taxa da maquininha.
// Também: marca como vendido no estoque o aparelho que saiu na venda, e grava o custo do aparelho que entrou de upgrade.
// Entrada (opcional): { desde: "aaaa-mm-dd", ate: "aaaa-mm-dd" }. Sem nada: últimos 3 dias. Roda sozinho a cada 15 min.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MP = "https://platform.mercadophone.tech/api/v1";
const KEY = Deno.env.get("MERCADOPHONE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const norm = (t: unknown) => String(t ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const r2 = (n: number) => Math.round(n * 100) / 100;

// Taxas padrão (as mesmas da aba Taxas); as do banco têm prioridade
const MAQ_PADRAO: Record<string, number> = { D: 0.99, "1": 2.99, "2": 4.14, "3": 4.81, "4": 5.47, "5": 6.13, "6": 6.78, "7": 7.63, "8": 8.27, "9": 8.9, "10": 9.53, "11": 10.15, "12": 10.77, "13": 11.95, "14": 12.56, "15": 13.16, "16": 13.75, "17": 14.34, "18": 14.93 };
const CLI_PADRAO: Record<string, number> = { D: 3, "1": 5, "2": 7.5, "3": 8.5, "4": 9.5, "5": 10, "6": 10.5, "7": 11.5, "8": 12.5, "9": 13, "10": 14.5, "11": 15.5, "12": 16, "13": 16, "14": 17, "15": 17.5, "16": 17.5, "17": 18, "18": 19.3 };
const nomeMod = (k: string) => (k === "D" ? "débito" : k === "1" ? "crédito à vista" : `${k}x`);

async function mp(path: string): Promise<any> {
  for (let t = 0; t < 5; t++) {
    const r = await fetch(MP + path, { headers: { "X-API-Key": KEY } });
    if (r.status === 429) { await new Promise(ok => setTimeout(ok, 4000 * (t + 1))); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Mercado Phone ${r.status} em ${path.split("?")[0]}: ${JSON.stringify(j.detail ?? j).slice(0, 200)}`);
    return j;
  }
  throw new Error("Mercado Phone ocupado. Tente de novo em 1 minuto.");
}

const imeiNoTexto = (t: string) => { const m = String(t || "").match(/\b(\d{14,15})\b/); return m ? m[1] : null; };

// Separa o texto anotado no pagamento em pedaços "valor + como foi passado".
// Ex.: "R$4.100,00 em 12x E R$3.789,00 em 12x" → [{4100,"12"},{3789,"12"}]; ignora pedaços de PIX/dinheiro.
function segmentos(det: string): { valor: number; mod: string | null }[] {
  const re = /\d{1,3}(?:\.\d{3})+,\d{2}|\d+,\d{2}|\d+\.\d{2}(?!\d)/g;
  const achados = [...String(det || "").matchAll(re)];
  const out: { valor: number; mod: string | null; ignorar: boolean }[] = [];
  achados.forEach((m, i) => {
    const fim = i + 1 < achados.length ? achados[i + 1].index! : det.length;
    const depois = norm(det.slice(m.index! + m[0].length, fim));
    const s = m[0], valor = s.includes(",") ? parseFloat(s.replace(/\./g, "").replace(",", ".")) : parseFloat(s);
    const x = depois.match(/(\d{1,2})\s*X/);
    const mod = x ? x[1] : /DEBITO/.test(depois) ? "D" : /A ?VISTA/.test(depois) ? "1" : null;
    out.push({ valor, mod, ignorar: /PIX|DINHEIRO|ESPECIE|UPGRADE|SINAL|ENTRADA/.test(depois) && !x });
  });
  const validos = out.filter(o => !o.ignorar);
  // pedaço sem parcelas herda as do próximo pedaço que tiver ("R$1.965 E R$3.435 EM 10x")
  for (let i = validos.length - 1; i >= 0; i--) if (!validos[i].mod && i + 1 < validos.length) validos[i].mod = validos[i + 1].mod;
  return validos.map(({ valor, mod }) => ({ valor, mod }));
}

function calcularTaxa(venda: any, maq: Record<string, number>, cli: Record<string, number>) {
  let base = 0, bruto = 0, taxa = 0, estimada = false;
  const alertas: string[] = [];
  for (const p of venda.pagamentos || []) {
    const forma = norm(p.formaPagamentoDescricao);
    if (!/CART|CREDITO|DEBITO/.test(forma)) continue;
    const valor = Number(p.valor) || 0;
    if (!(valor > 0)) continue;
    const det = String(p.detalhes || "");
    const modPadrao = /DEBIT/.test(forma) ? "D" : String(Math.min(18, Math.max(1, parseInt(p.parcela) || 1)));
    let segs = segmentos(det).map(s => ({ valor: s.valor, mod: s.mod || modPadrao }));
    const soma = segs.reduce((t, s) => t + s.valor, 0);
    const comParcelas = segs.length > 0 && segmentos(det).every(s => s.mod);
    const semTaxaAnotado = segs.reduce((t, s) => t + s.valor / (1 + (cli[s.mod] ?? 0) / 100), 0);
    if (comParcelas && (soma < valor || soma > valor * 1.3) && soma > 0) {
      // O pagamento foi lançado com outro valor, mas o que passou na máquina está anotado certinho:
      // o lucro vem do que passou na máquina (valor sem a taxa do cliente = base real do cartão)
      alertas.push(`No Mercado Phone o cartão está como R$ ${valor.toFixed(2)}, mas o que passou na máquina (R$ ${soma.toFixed(2)}, ${segs.map(s => nomeMod(s.mod)).join(" + ")}) corresponde a R$ ${semTaxaAnotado.toFixed(2)}. Calculei pelo que passou na máquina.`);
      base += r2(semTaxaAnotado);
      for (const s of segs) { bruto += s.valor; taxa += s.valor * (maq[s.mod] ?? 0) / 100; }
      continue;
    }
    // aceita o que foi anotado só se for coerente: entre o valor do pagamento e o valor + 30%
    if (!segs.length || soma < valor || soma > valor * 1.3) {
      if (segs.length) alertas.push(`O valor anotado (${det.slice(0, 50)}) não bate com o pagamento de R$ ${valor.toFixed(2)}; usei a tabela.`);
      else alertas.push(`Não anotaram o valor passado na máquina; considerei ${nomeMod(modPadrao)} pela tabela.`);
      segs = [{ valor: r2(valor * (1 + (cli[modPadrao] ?? 0) / 100)), mod: modPadrao }];
      estimada = true;
    } else {
      const semTaxa = semTaxaAnotado;
      if (Math.abs(semTaxa - valor) > Math.max(5, valor * 0.015)) alertas.push(`Passado na máquina R$ ${soma.toFixed(2)} (${segs.map(s => nomeMod(s.mod)).join(" + ")}); pela tabela corresponde a R$ ${semTaxa.toFixed(2)} e o pagamento é R$ ${valor.toFixed(2)}. Confira as parcelas.`);
    }
    base += valor;
    for (const s of segs) { bruto += s.valor; taxa += s.valor * (maq[s.mod] ?? 0) / 100; }
  }
  const lucro = base > 0 ? r2(bruto - taxa - base) : 0;
  if (base > 0 && lucro < 0) alertas.push("Lucro da taxa negativo: confira as parcelas e os valores.");
  return { base_cartao: r2(base), bruto_cartao: r2(bruto), taxa_maquininha: r2(taxa), lucro_taxa_calc: lucro, taxa_estimada: estimada, taxa_alertas: alertas };
}

// Produtos do estoque do MP (celulares e acessórios, com estoque e já vendidos), carregados uma vez por execução
let produtos: Map<number, any> | null = null;
let acessoriosPorNome: Map<string, any> | null = null;
async function carregarProdutos() {
  produtos = new Map(); acessoriosPorNome = new Map();
  for (const tipo of ["134765", "134764"]) {
    for (const extra of ["", "&zero_or_negative_stock=true"]) {
      for (let page = 1; page < 30; page++) {
        const j = await mp(`/inventory?tipoProdutoId=${tipo}&limit=300&page=${page}${extra}`);
        for (const x of j.items || []) {
          produtos.set(Number(x.id), x);
          const nome = norm(x.aparelhoDescricao || x.nome || "");
          if (tipo === "134764" && nome && Number(x.valorCusto) && !acessoriosPorNome.has(nome)) acessoriosPorNome.set(nome, x);
        }
        if (!j.items?.length || page * 300 >= (j.total ?? 0)) break;
      }
    }
  }
}
async function produto(id: number) {
  if (!produtos) await carregarProdutos();
  return produtos!.get(Number(id)) ?? null;
}
// Tabela antiga de custos de acessórios (do sistema anterior), usada só quando o MP não tem um custo confiável
let tabelaAntiga: { nome: string; custo: number }[] = [];
// Custo do acessório: o do cadastro "oficial" de mesmo nome no MP (o que tem estoque); senão o do produto vendido.
// Custo igual ou maior que o preço = cadastrado errado (repetiram o preço) → tenta a tabela antiga.
async function custoAcessorio(id: number, nome: string, preco: number): Promise<{ custo: number | null; suspeito: boolean }> {
  const p = await produto(id);
  const base = norm(nome).split(" - ")[0].trim();
  const q = acessoriosPorNome!.get(base);
  let c = q ? Math.abs(Number(q.valorCusto)) : p && Number(p.valorCusto) ? Math.abs(Number(p.valorCusto)) : null;
  if (c != null && preco > 0 && c >= preco) {
    const t = tabelaAntiga.find(x => norm(x.nome) === base) || tabelaAntiga.find(x => norm(x.nome).includes(base) || base.includes(norm(x.nome)));
    if (t) return { custo: t.custo, suspeito: false };
    return { custo: c, suspeito: true };
  }
  return { custo: c, suspeito: false };
}
const ehAparelho = (nome: string) => /IPHONE|^\s*1\d\s*PRO|^\s*\d{2}\s/.test(norm(nome));

async function sincronizar(desde: string, ate: string) {
  produtos = null; acessoriosPorNome = null;
  const { data: tab } = await sb.from("app_dados").select("valor").eq("chave", "arquivo:tabela_custos.json").maybeSingle();
  tabelaAntiga = Array.isArray(tab?.valor) ? (tab!.valor as any[]).map(x => ({ nome: String(x.nome || ""), custo: Number(String(x.custo).replace(",", ".")) })).filter(x => x.custo > 0) : [];
  const { data: cfg } = await sb.from("config_taxas").select("id,taxas").in("id", [1, 2]);
  const cli = { ...CLI_PADRAO, ...((cfg || []).find((x: any) => x.id === 1)?.taxas || {}) };
  const maq = { ...MAQ_PADRAO, ...((cfg || []).find((x: any) => x.id === 2)?.taxas || {}) };

  const vendas: any[] = [];
  for (let page = 1; page < 30; page++) {
    const j = await mp(`/sales?include_payments=true&limit=300&page=${page}&dataVendaInicial=${desde}&dataVendaFinal=${ate}`);
    vendas.push(...(j.items || []));
    if (!j.items?.length || vendas.length >= (j.total ?? 0)) break;
  }

  const resumo = { vendas: vendas.length, vendidos_baixados: 0, upgrades_com_custo: 0, vendas_canceladas_devolvidas: 0, erros: [] as string[] };
  for (const v of vendas) {
    try {
      // IMEI de cada aparelho vendido (o item da venda só traz o id do produto no estoque do MP)
      const itens = [];
      for (const it of v.itens || []) {
        const x: any = { ...it };
        if (ehAparelho(it.produtoNome) && it.produtoId) {
          const p = await produto(it.produtoId);
          if (p) { x.imei = p.imei || null; x.custo_mp = p.valorCusto != null ? Math.abs(Number(p.valorCusto)) : null; x.fornecedor_mp = p.fornecedorNome || p.clienteNome || null; x.aparelho = true; }
        } else if (it.produtoId) {
          // acessório (película, case, fonte, brinde…): custo cadastrado no Mercado Phone × quantidade
          const r = await custoAcessorio(it.produtoId, it.produtoNome, Number(it.valorUnitario) || 0);
          x.acessorio = true; x.custo_unit = r.custo; x.custo_suspeito = r.suspeito; x.custo_total = r.custo != null ? r2(r.custo * (Number(it.quantidade) || 1)) : null;
        }
        itens.push(x);
      }
      const t = calcularTaxa(v, maq, cli);
      const { error } = await sb.from("vendas_mp").upsert({
        id: v.id, data_venda: v.dataVenda, dia: String(v.dataVenda).slice(0, 10), status: v.status, total: v.totalVenda,
        cliente: v.clienteNome, vendedor: v.vendedorNome, tipo_venda: v.tipoVendaDescricao, observacao: v.observacao,
        itens, pagamentos: v.pagamentos, ...t, sincronizado_em: new Date().toISOString(),
      });
      if (error) throw error;
      if (v.status !== "concluido") {
        // venda cancelada/estornada: aparelho que demos baixa por esta venda volta para o estoque
        const { data: hs } = await sb.from("aparelhos_historico").select("aparelho_id").eq("evento", "vendido").like("usuario", `Mercado Phone (venda ${v.id} %`);
        for (const h of hs || []) {
          const { data: ap } = await sb.from("aparelhos").select("*").eq("id", h.aparelho_id).maybeSingle();
          if (ap && ap.destino === "vendido") {
            const agora = new Date().toISOString();
            await sb.from("aparelhos").update({ destino: null, data_saida: null, atualizado_em: agora, atualizado_por: "Mercado Phone" }).eq("id", ap.id);
            await sb.from("aparelhos_historico").insert({ aparelho_id: ap.id, imei: ap.imei, nome: ap.nome, gb: ap.gb, cor: ap.cor, evento: "aguardando", usuario: `Mercado Phone (venda ${v.id} cancelada)`, criado_em: agora });
            resumo.vendas_canceladas_devolvidas++;
          }
        }
        continue;
      }

      // Aparelho vendido ainda aparece no estoque das vendedoras → dá baixa como vendido
      for (const x of itens.filter((i: any) => i.imei)) {
        const { data: ap } = await sb.from("aparelhos").select("*").eq("imei", x.imei).order("criado_em", { ascending: false }).limit(1).maybeSingle();
        if (ap && ap.tipo !== "cliente" && (!ap.destino || ["estoque_r1", "assistencia"].includes(ap.destino)) && String(ap.data_entrada || "") <= String(v.dataVenda).slice(0, 10)) { // não dá baixa em aparelho que voltou para a loja depois desta venda
          const agora = new Date().toISOString();
          await sb.from("aparelhos").update({ destino: "vendido", data_saida: String(v.dataVenda).slice(0, 10), atualizado_em: agora, atualizado_por: "Mercado Phone" }).eq("id", ap.id);
          await sb.from("aparelhos_historico").insert({ aparelho_id: ap.id, imei: ap.imei, nome: ap.nome, gb: ap.gb, cor: ap.cor, evento: "vendido", usuario: `Mercado Phone (venda ${v.id} · ${v.vendedorNome || ""})`, criado_em: agora });
          resumo.vendidos_baixados++;
        }
      }
      // Aparelho recebido de upgrade: o valor pago na troca é o custo dele
      for (const p of (v.pagamentos || []).filter((p: any) => /UPGRADE|APARELHO/.test(norm(p.formaPagamentoDescricao)))) {
        const imei = imeiNoTexto(p.detalhes);
        if (!imei || !(Number(p.valor) > 0)) continue;
        const { data: ap } = await sb.from("aparelhos").select("id").eq("imei", imei).order("criado_em", { ascending: false }).limit(1).maybeSingle();
        if (!ap) continue;
        const { data: c } = await sb.from("aparelhos_custos").select("aparelho_id").eq("aparelho_id", ap.id).maybeSingle();
        if (c) continue;
        await sb.from("aparelhos_custos").insert({ aparelho_id: ap.id, custo: Number(p.valor), origem_custo: "upgrade", fornecedor: v.clienteNome, registrado_por: `Mercado Phone (venda ${v.id})`, atualizado_em: new Date().toISOString() });
        resumo.upgrades_com_custo++;
      }
    } catch (e) {
      resumo.erros.push(`venda ${v.id}: ${String((e as Error).message || e)}`);
    }
  }
  return resumo;
}

// ── Estoque do Mercado Phone → app das vendedoras ─────────────────────────────
const titulo = (t: string) => String(t || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/(^|[\s-])(\p{L})/gu, (_m, a, b) => a + b.toUpperCase());
function nomeApp(desc: string) {
  let n = norm(desc).replace(/^IPHONE\s*/, "").trim();
  return "iPhone " + titulo(n).replace(/\bXr\b/, "XR").replace(/\bSe\b/, "SE");
}
const CONCLUIDO = ["vendido", "garantia", "troca", "outro_lojista"];
// custo do MP só vale se for de verdade: de upgrade (cliente) sempre vale; de fornecedor não pode ser o preço de venda repetido
const custoReal = (p: any) => {
  const c = Math.abs(Number(p.valorCusto) || 0);
  if (!(c > 0)) return null;
  if (Number(p.flagTipoFornecedor) === 2) return c;
  return c !== Math.abs(Number(p.valorVenda) || 0) ? c : null;
};
const fornecedorDe = (p: any) => String(p.fornecedorNome || p.clienteNome || "").trim().toUpperCase();
const novoId = () => Date.now() + "-" + Math.random().toString(36).slice(2, 7);

async function sincronizarEstoque() {
  if (!produtos) await carregarProdutos();
  const r = { criados_no_app: 0, nova_passagem: 0, custos_vindos_do_mp: 0, custos_atualizados: 0, fornecedores_novos: 0, conflitos: [] as string[] };
  const celulares = [...produtos!.values()].filter(p => String(p.tipoProdutoId) === "134765" && Number(p.quantidade) > 0 && !p.excluido && String(p.imei || "").replace(/\D/g, "").length >= 14);
  const imeis = celulares.map(p => String(p.imei).replace(/\D/g, ""));
  const { data: aps } = await sb.from("aparelhos").select("*").in("imei", imeis);
  const ultimo = new Map<string, any>();
  for (const a of (aps || []).sort((x: any, y: any) => (x.criado_em || 0) - (y.criado_em || 0))) ultimo.set(a.imei, a);
  const ids = (aps || []).map((a: any) => a.id);
  const { data: cs } = ids.length ? await sb.from("aparelhos_custos").select("*").in("aparelho_id", ids) : { data: [] };
  const custos = new Map((cs || []).map((c: any) => [c.aparelho_id, c]));
  const agora = new Date().toISOString();

  for (const p of celulares) {
    const imei = String(p.imei).replace(/\D/g, "");
    const a = ultimo.get(imei);
    const cReal = custoReal(p), forn = fornecedorDe(p), upgrade = Number(p.flagTipoFornecedor) === 2;
    let alvo = a;
    if (a && CONCLUIDO.includes(a.destino || "") && String(p.dataEntrada || "") <= String(a.data_saida || a.data_entrada || "")) {
      r.conflitos.push(`${p.aparelhoDescricao} IMEI ${imei}: no app saiu como "${a.destino}" em ${a.data_saida || "?"}, mas está em estoque no Mercado Phone (entrada ${p.dataEntrada || "?"})`);
      continue;
    }
    if (!a || CONCLUIDO.includes(a.destino || "")) {
      // não existe no app (cadastrado direto no MP) ou já tinha saído e voltou → nova passagem
      const novo = {
        id: novoId(), nome: nomeApp(p.aparelhoDescricao || ""), gb: p.gbDescricao || null, cor: p.corDescricao ? titulo(p.corDescricao) : null, imei,
        origem: upgrade ? "UPGRADE" : "FORNECEDOR", cadastrador: "Mercado Phone", data_entrada: p.dataEntrada || agora.slice(0, 10),
        destino: Number(p.produtoDisponibilidadeId) === 2 ? "assistencia" : null, assistencia_nome: null, data_saida: null,
        obs: upgrade && p.clienteNome ? `Upgrade de ${p.clienteNome}` : null, criado_em: Date.now(), tipo: "loja", atualizado_em: agora, atualizado_por: "Mercado Phone",
        bateria: p.saudeBateria != null ? String(p.saudeBateria) : null, aviso_peca: null, garantia_apple: false,
      };
      const { error } = await sb.from("aparelhos").insert(novo);
      if (error) continue;
      await sb.from("aparelhos_historico").insert({ aparelho_id: novo.id, imei, nome: novo.nome, gb: novo.gb, cor: novo.cor, evento: "entrada", usuario: "Mercado Phone (cadastrado lá)", criado_em: agora });
      await sb.from("aparelhos_mp").upsert({ aparelho_id: novo.id, mp_id: p.id, status: cReal ? "ok" : "sem_custo", acao: "veio do Mercado Phone", erro: null, enviado_em: agora });
      if (a) r.nova_passagem++; else r.criados_no_app++;
      alvo = novo;
    } else {
      await sb.from("aparelhos_mp").upsert({ aparelho_id: a.id, mp_id: p.id, status: cReal ? "ok" : "sem_custo", acao: "ligado ao Mercado Phone", erro: null, enviado_em: agora });
    }
    // custo e fornecedor: o que foi mudado por último vale (app ou Mercado Phone)
    if (cReal && forn) {
      const c: any = custos.get(alvo.id);
      const mudouNoMp = p.dataModificacao ? new Date(String(p.dataModificacao).replace(" ", "T") + "-03:00").toISOString() : agora;
      if (!c) {
        await sb.from("aparelhos_custos").insert({ aparelho_id: alvo.id, custo: cReal, fornecedor: forn, origem_custo: upgrade ? "upgrade" : "fornecedor", registrado_por: "Mercado Phone", atualizado_em: mudouNoMp });
        r.custos_vindos_do_mp++;
      } else if ((Number(c.custo) !== cReal || norm(c.fornecedor) !== norm(forn)) && mudouNoMp > String(c.atualizado_em || "")) {
        await sb.from("aparelhos_custos").update({ custo: cReal, fornecedor: forn, registrado_por: "Mercado Phone", atualizado_em: mudouNoMp }).eq("aparelho_id", alvo.id);
        r.custos_atualizados++;
      }
    }
  }
  // fornecedores criados no MP entram na lista do app
  const sup = await mp("/suppliers?limit=300");
  const { data: cfg } = await sb.from("app_dados").select("valor").eq("chave", "config:fornecedores_aparelhos").maybeSingle();
  const lista: string[] = Array.isArray(cfg?.valor) ? cfg!.valor as string[] : [];
  const novos = (sup.items || []).map((x: any) => String(x.nome || "").trim().toUpperCase()).filter((n: string) => n && !lista.some(l => norm(l) === norm(n)));
  if (novos.length) {
    await sb.from("app_dados").upsert({ chave: "config:fornecedores_aparelhos", valor: [...lista, ...new Set(novos)].sort(), atualizado_em: agora });
    r.fornecedores_novos = novos.length;
  }
  return r;
}

// Custos de aparelhos vendidos preenchidos no Caixa: se o Mercado Phone ainda está com outro custo/fornecedor,
// reenvia (pela função mp-estoque). Garante a atualização mesmo se o envio feito pelo navegador falhou.
async function enviarCustosPendentes() {
  const { data } = await sb.from("vendas_itens_custo").select("venda_id,produto_id,custo,fornecedor").order("atualizado_em", { ascending: false }).limit(300);
  const enviados: unknown[] = [];
  for (const r of data || []) {
    if (enviados.length >= 15) break;
    const p = await produto(Number(r.produto_id));
    if (!p) continue;
    const igual = Math.abs(Math.abs(Number(p.valorCusto)) - Number(r.custo)) < 0.01 && (!r.fornecedor || norm(p.fornecedorNome || p.clienteNome).trim() === norm(r.fornecedor).trim());
    if (igual) continue;
    const resp = await fetch(Deno.env.get("SUPABASE_URL") + "/functions/v1/mp-estoque", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") },
      body: JSON.stringify({ produto_id: Number(r.produto_id), custo: Number(r.custo), fornecedor: r.fornecedor || "" }),
    }).then(x => x.json()).catch(e => ({ status: "erro", erro: String(e) }));
    enviados.push({ produto_id: r.produto_id, de: p.valorCusto, para: r.custo, ...resp });
  }
  return enviados;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!KEY) return json({ erro: "Chave do Mercado Phone não configurada" }, 500);
  try {
    const b = await req.json().catch(() => ({}));
    const hoje = new Date(Date.now() - 3 * 3600 * 1000); // horário de Brasília
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    // sem datas: desde o início do Mercado Phone (18/11), no máximo os últimos 30 dias, para pegar custos corrigidos em vendas antigas
    const trintaDias = fmt(new Date(hoje.getTime() - 30 * 86400000));
    const desde = /^\d{4}-\d{2}-\d{2}$/.test(b.desde || "") ? b.desde : (trintaDias > "2026-11-18" ? trintaDias : "2026-11-18");
    const ate = /^\d{4}-\d{2}-\d{2}$/.test(b.ate || "") ? b.ate : fmt(hoje);
    const vendasRes = await sincronizar(desde, ate);
    let estoque: unknown = null;
    try { estoque = await sincronizarEstoque(); } catch (e) { estoque = { erro: String((e as Error).message || e) }; }
    let custosEnviados: unknown = null;
    try { custosEnviados = await enviarCustosPendentes(); } catch (e) { custosEnviados = { erro: String((e as Error).message || e) }; }
    return json({ desde, ate, ...vendasRes, estoque, custosEnviados });
  } catch (e) {
    return json({ erro: String((e as Error).message || e) }, 500);
  }
});
