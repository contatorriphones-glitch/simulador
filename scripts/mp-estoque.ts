// mp-estoque: envia um aparelho cadastrado no sistema das vendedoras para o estoque do Mercado Phone.
// A chave do Mercado Phone fica só aqui no servidor (segredo MERCADOPHONE_KEY).
// Entrada: { aparelho_id, estado? } ou { ids: [...] }. Lê aparelho + custo do banco e cria
// (ou atualiza, se o IMEI já existir) o item no Mercado Phone. Resultado gravado em aparelhos_mp.
import { createClient } from "jsr:@supabase/supabase-js@2";

const MP = "https://platform.mercadophone.tech/api/v1";
const KEY = Deno.env.get("MERCADOPHONE_KEY") ?? "";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const TIPO_CELULAR = 134765, DISPONIVEL = 1, LABORATORIO = 2;

const norm = (t: unknown) => String(t ?? "").toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });

async function mp(path: string, opt: RequestInit = {}): Promise<any> {
  for (let tentativa = 0; tentativa < 5; tentativa++) {
    const r = await fetch(MP + path, { ...opt, headers: { "X-API-Key": KEY, "Content-Type": "application/json", ...(opt.headers || {}) } });
    const t = await r.text();
    let j: any; try { j = JSON.parse(t); } catch { j = t; }
    if (r.status === 429) { await new Promise(ok => setTimeout(ok, 4000 * (tentativa + 1))); continue; }
    if (!r.ok) throw new Error(`Mercado Phone ${r.status} em ${path.split("?")[0]}: ${typeof j === "string" ? j.slice(0, 200) : JSON.stringify(j.detail ?? j).slice(0, 300)}`);
    return j;
  }
  throw new Error("Mercado Phone ocupado (muitas requisições). Tente de novo em 1 minuto.");
}
async function listar(path: string): Promise<any[]> {
  const out: any[] = [];
  for (let page = 1; page < 50; page++) {
    const j = await mp(`${path}${path.includes("?") ? "&" : "?"}limit=300&page=${page}`);
    out.push(...(j.items || []));
    if (!j.items?.length || out.length >= (j.total ?? 0)) break;
  }
  return out;
}
const cache: Record<string, any[]> = {};
let SIMULAR = false; const criaria: string[] = [];
// Procura no catálogo do Mercado Phone; se não existir (ex.: cor nova da Apple), cria com o mesmo padrão em maiúsculas
async function idCatalogo(recurso: string, campo: string, valor: string): Promise<number> {
  const n = norm(valor);
  if (!n) throw new Error(`Sem ${campo} para o catálogo ${recurso}`);
  cache[recurso] ??= await listar(`/catalog/${recurso}`);
  // aceita também nomes cadastrados à mão sem "IPHONE" (ex.: "18 PRO")
  let achou = cache[recurso].find(x => norm(x[campo]) === n) ?? (recurso === "devices" ? cache[recurso].find(x => "IPHONE " + norm(x[campo]) === n) : undefined);
  if (achou) return achou.id;
  const nome = String(valor).toUpperCase().replace(/-/g, " ").replace(/\s+/g, " ").trim();
  if (SIMULAR) { criaria.push(`${recurso}: ${nome}`); return -1; }
  const r = await mp(`/catalog/${recurso}`, { method: "POST", body: JSON.stringify({ [campo]: nome }) });
  cache[recurso].push({ id: r.id, [campo]: nome });
  return r.id;
}
async function idFornecedor(nome: string): Promise<number> {
  const n = norm(nome);
  cache.suppliers ??= await listar("/suppliers");
  const f = cache.suppliers.find(x => norm(x.nome) === n);
  if (f) return f.id;
  if (SIMULAR) { criaria.push(`fornecedor: ${nome.toUpperCase()}`); return -1; }
  const r = await mp("/persons", { method: "POST", body: JSON.stringify({ nome: nome.toUpperCase(), snFornecedor: 1, snCliente: 0, snTecnico: 0 }) });
  cache.suppliers.push({ id: r.id, nome: nome.toUpperCase() });
  return r.id;
}
async function idCliente(nome: string): Promise<number> {
  const n = norm(nome);
  const j = await mp(`/customers?limit=50&nome=${encodeURIComponent(nome)}`);
  const c = (j.items || []).find((x: any) => norm(x.nome) === n);
  if (c) return c.id;
  if (SIMULAR) { criaria.push(`cliente: ${nome.toUpperCase()}`); return -1; }
  const r = await mp("/customers", { method: "POST", body: JSON.stringify({ nome: nome.toUpperCase() }) });
  return r.id;
}

// Nome do modelo no padrão do Mercado Phone ("13 pro" → "IPHONE 13 PRO"); null se não for iPhone
function modeloMP(nome: string): string | null {
  let n = norm(nome).replace(/\b(APPLE|SEMINOVO|LACRADO|NOVO|VITRINE|USADO)\b/g, " ").replace(/\s+/g, " ").trim();
  n = n.replace(/PROMAX/g, "PRO MAX");
  if (/^IPHONE\b/.test(n)) n = n.replace(/^IPHONE\s*/, "");
  else if (!/^(\d{1,2}|XR|XS|X|SE|AIR)\b/.test(n)) return null;
  return n === "XR" ? "IPHONE XR" : "IPHONE " + n;
}
// Cor no padrão do Mercado Phone (sinônimos e cores titânio dos Pro)
const SINONIMOS: Record<string, string> = { GOLD: "DOURADO", OURO: "DOURADO", PRATA: "PRATEADO", SILVER: "PRATEADO", LILAS: "ROXO", PURPLE: "ROXO", RED: "VERMELHO", "PRODUCT RED": "VERMELHO", MIDNIGHT: "MEIA NOITE", STARLIGHT: "ESTELAR", CINZA: "CINZA ESPACIAL", BLACK: "PRETO", WHITE: "BRANCO", BLUE: "AZUL", GREEN: "VERDE", PINK: "ROSA", YELLOW: "AMARELO", DESERT: "DESERTO", "TITANIO DESERT": "TITANIO DESERTO" };
function corMP(modelo: string, cor: string): string {
  let c = norm(cor).replace(/TITANIUM/g, "TITANIO");
  c = SINONIMOS[c] ?? c;
  if (/IPHONE 1[56] PRO/.test(modelo) && ["NATURAL", "PRETO", "BRANCO", "AZUL", "DESERTO"].includes(c)) c = "TITANIO " + c;
  return c;
}

async function registrar(aparelho_id: string, dados: Record<string, unknown>) {
  if (SIMULAR) return;
  await sb.from("aparelhos_mp").upsert({ aparelho_id, enviado_em: new Date().toISOString(), ...dados });
}

// Preço de venda para cadastro novo no Mercado Phone (campo obrigatório lá):
// usa a tabela de preços do simulador (bia_tabelas → catalogo: seminovos/lacrados).
let catalogo: any = null;
async function precoVenda(a: any, estado: string, custo: number): Promise<{ valor: number; provisorio: boolean }> {
  catalogo ??= (await sb.from("bia_tabelas").select("valor").eq("chave", "catalogo").maybeSingle()).data?.valor || {};
  const lista: any[] = (estado === "lacrado" ? catalogo.lacrados : catalogo.seminovos) || [];
  const n = String(a.gb || "").replace(/\D/g, ""), tb = /tb/i.test(String(a.gb || ""));
  const gbs = tb ? [Number(n) * 1024, Number(n) * 1000, Number(n)] : [Number(n)];
  const item = lista.find(x => norm(x.modelo) === norm(a.nome) && gbs.includes(Number(x.gb)));
  let valor = 0;
  if (item?.preco) valor = Number(item.preco);
  else if (item?.cores) {
    const cor = Object.entries(item.cores).find(([k]) => norm(k) === norm(a.cor));
    valor = Number(cor ? cor[1] : Math.max(...Object.values(item.cores).map(Number)));
  }
  if (valor > custo) return { valor, provisorio: false };
  // sem preço na tabela (ou preço abaixo do custo): provisório de custo + 15%, terminado em 9
  return { valor: Math.ceil((custo * 1.15) / 50) * 50 - 1, provisorio: true };
}

async function sincronizar(id: string, estadoPedido?: string) {
  const { data: a } = await sb.from("aparelhos").select("*").eq("id", id).maybeSingle();
  if (!a) return { aparelho_id: id, status: "erro", erro: "Aparelho não encontrado" };
  const { data: anterior } = await sb.from("aparelhos_mp").select("estado").eq("aparelho_id", id).maybeSingle();
  const estado = estadoPedido || anterior?.estado || "seminovo";
  if (a.tipo === "cliente") { await registrar(id, { status: "ignorado", acao: "aparelho de cliente", erro: null, estado }); return { aparelho_id: id, status: "ignorado" }; }
  const { data: c } = await sb.from("aparelhos_custos").select("*").eq("aparelho_id", id).maybeSingle();
  const imei = String(a.imei || "").replace(/\D/g, "");
  const modelo = modeloMP(a.nome || "");
  if (!modelo) { await registrar(id, { status: "ignorado", acao: "não é iPhone: " + (a.nome || ""), erro: null, estado }); return { aparelho_id: id, status: "ignorado", acao: "não é iPhone" }; }
  try {
    const existentes = imei ? (await mp(`/inventory?imei=${imei}&limit=10`)).items || [] : [];
    const existente = existentes.find((x: any) => String(x.imei) === imei && !x.excluido);

    const obs: string[] = [];
    if (a.destino === "estoque_r1") obs.push("Local: R1");
    if (a.destino === "assistencia") obs.push("Na assistência: " + (a.assistencia_nome || ""));
    if (a.aviso_peca) obs.push(a.aviso_peca);
    if (a.garantia_apple) obs.push("Garantia Apple");
    obs.push("Enviado pelo sistema de estoque (" + (a.cadastrador || "") + ")");

    const corpo: Record<string, unknown> = {
      aparelhoId: await idCatalogo("devices", "name", modelo),
      gbId: await idCatalogo("storage-sizes", "size", String(a.gb || "").replace(/\s/g, "").toUpperCase()),
      corId: await idCatalogo("colors", "name", corMP(modelo, a.cor || "")),
      imei,
      tipoProdutoId: TIPO_CELULAR,
      estadoProdutoId: await idCatalogo("product-conditions", "name", estado === "lacrado" ? "NOVO" : "SEMINOVO"),
      produtoDisponibilidadeId: a.destino === "assistencia" ? LABORATORIO : DISPONIVEL,
      observacao: obs.join(" · "),
    };
    if (a.bateria && /^\d+$/.test(String(a.bateria))) corpo.saudeBateria = Math.min(100, parseInt(a.bateria));
    if (a.data_entrada) corpo.dataEntrada = a.data_entrada;
    const temCusto = c && c.custo != null && Number(c.custo) > 0 && c.fornecedor;
    if (temCusto) {
      corpo.valorCusto = Number(c.custo);
      if (c.origem_custo === "upgrade") { corpo.flagTipoFornecedor = 2; corpo.clienteId = await idCliente(c.fornecedor); }
      else { corpo.flagTipoFornecedor = 1; corpo.fornecedorId = await idFornecedor(c.fornecedor); }
    }

    if (SIMULAR) { const cr = [...criaria]; criaria.length = 0; return { aparelho_id: id, simulacao: true, criaria: cr, acao: existente ? "atualizaria " + existente.id : temCusto ? "criaria" : "aguardaria custo", preco: temCusto && !existente ? await precoVenda(a, estado, Number(c.custo)) : null, corpo }; }
    if (existente) {
      corpo.id = existente.id;
      if (!(Number(existente.quantidade) > 0)) corpo.quantidade = 1; // voltou para a loja
      await mp("/inventory", { method: "POST", body: JSON.stringify(corpo) });
      await registrar(id, { mp_id: existente.id, status: temCusto ? "ok" : "sem_custo", acao: "atualizado", erro: null, estado });
      return { aparelho_id: id, status: temCusto ? "ok" : "sem_custo", acao: "atualizado", mp_id: existente.id };
    }
    if (!temCusto) {
      await registrar(id, { status: "sem_custo", acao: "aguardando custo e fornecedor", erro: null, estado });
      return { aparelho_id: id, status: "sem_custo" };
    }
    if (Number(c.custo) < 100) {
      await registrar(id, { status: "erro", acao: null, erro: `Custo suspeito (R$ ${c.custo}): provável erro de digitação. Corrija o custo no Caixa.`, estado });
      return { aparelho_id: id, status: "erro", erro: "custo suspeito" };
    }
    corpo.quantidade = 1;
    const pv =await precoVenda(a, estado, Number(c.custo));
    corpo.valorVenda = pv.valor;
    if (pv.provisorio) corpo.observacao = "PREÇO DE VENDA PROVISÓRIO, CONFERIR · " + corpo.observacao;
    const r = await mp("/inventory", { method: "POST", body: JSON.stringify(corpo) });
    await registrar(id, { mp_id: r.id, status: "ok", acao: pv.provisorio ? "criado (preço provisório " + pv.valor + ")" : "criado", erro: null, estado });
    return { aparelho_id: id, status: "ok", acao: "criado", mp_id: r.id };
  } catch (e) {
    const erro = String((e as Error).message || e);
    await registrar(id, { status: "erro", erro, estado });
    return { aparelho_id: id, status: "erro", erro };
  }
}

// Custo de um aparelho JÁ VENDIDO: corrige o custo e o fornecedor no produto do Mercado Phone (id do item da venda)
async function custoVendido(produtoId: number, custo: number, fornecedor: string, upgrade: boolean) {
  const corpo: Record<string, unknown> = { id: produtoId, valorCusto: custo };
  if (fornecedor) {
    if (upgrade) { corpo.flagTipoFornecedor = 2; corpo.clienteId = await idCliente(fornecedor); }
    else { corpo.flagTipoFornecedor = 1; corpo.fornecedorId = await idFornecedor(fornecedor); }
  }
  await mp("/inventory", { method: "POST", body: JSON.stringify(corpo) });
  return { produto_id: produtoId, status: "ok", acao: "custo atualizado" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!KEY) return json({ status: "erro", erro: "Chave do Mercado Phone não configurada no servidor" }, 500);
  try {
    const b = await req.json();
    SIMULAR = !!b.simular;
    if (b.produto_id) {
      const custo = Number(b.custo);
      if (!(custo > 0)) return json({ status: "erro", erro: "Informe o custo" }, 400);
      try { return json(await custoVendido(Number(b.produto_id), custo, String(b.fornecedor || ""), !!b.upgrade)); }
      catch (e) { return json({ produto_id: b.produto_id, status: "erro", erro: String((e as Error).message || e) }); }
    }
    if (Array.isArray(b.ids)) {
      const res = [];
      for (const id of b.ids.slice(0, 40)) res.push(await sincronizar(String(id), b.estado));
      return json(res);
    }
    if (!b.aparelho_id) return json({ status: "erro", erro: "Informe aparelho_id" }, 400);
    return json(await sincronizar(String(b.aparelho_id), b.estado));
  } catch (e) {
    return json({ status: "erro", erro: String((e as Error).message || e) }, 500);
  }
});
