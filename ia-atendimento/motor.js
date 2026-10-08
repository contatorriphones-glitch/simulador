// Motor de cálculo da IA de atendimento.
// A IA nunca calcula valores sozinha: todo preço, avaliação e parcela sai daqui,
// a partir das tabelas em ./dados (editáveis sem mexer no código).

export function criarMotor({ catalogo, upgrade, assistencia, maquininha, loja }) {
  const reais = (v) => Math.round(v * 100) / 100;

  // ---------------------------------------------------------------- modelos
  // "15 pro max", "iphone 15 PM", "15promax" -> "iPhone 15 Pro Max"
  function normalizarModelo(texto) {
    let t = String(texto).toLowerCase().replace(/iphone/g, ' ').replace(/\s+/g, ' ').trim();
    t = t.replace(/promax/g, 'pro max').replace(/\bpm\b/g, 'pro max');
    const m = t.match(/^(xr|\d{2})\s*(pro max|pro|plus|air)?/);
    if (!m) return null;
    const base = m[1] === 'xr' ? 'XR' : m[1];
    const sufixo = { 'pro max': ' Pro Max', pro: ' Pro', plus: ' Plus', air: ' Air' }[m[2]] || '';
    return `iPhone ${base}${sufixo}`;
  }

  // "256", "256gb", "1tb", 512 -> número em GB
  function normalizarGb(gb) {
    if (gb == null) return null;
    const s = String(gb).toLowerCase();
    const n = parseFloat(s);
    if (Number.isNaN(n)) return null;
    return /tb/.test(s) ? n * 1024 : n;
  }

  // ---------------------------------------------------------------- catálogo
  function itensCatalogo(condicao) {
    return condicao === 'seminovo' ? catalogo.seminovos : catalogo.lacrados;
  }

  // Lista as opções de um modelo (todas as capacidades/cores), para a IA responder
  // "quanto tá o 17 pro max?" e também corrigir o cliente ("não tem 128GB").
  function consultarCatalogo({ modelo, gb, cor, condicao = 'lacrado' }) {
    const nome = normalizarModelo(modelo);
    const g = normalizarGb(gb);
    const itens = itensCatalogo(condicao).filter((i) => i.modelo === nome);
    if (!itens.length) return { encontrado: false, modelo: nome, condicao };
    const opcoes = [];
    for (const i of itens) {
      if (g && i.gb !== g) continue;
      if (i.cores) {
        for (const [c, preco] of Object.entries(i.cores)) {
          if (cor && c.toLowerCase() !== String(cor).toLowerCase()) continue;
          opcoes.push({ modelo: i.modelo, gb: i.gb, cor: c, preco });
        }
      } else {
        opcoes.push({ modelo: i.modelo, gb: i.gb, cor: null, preco: i.preco });
      }
    }
    return {
      encontrado: opcoes.length > 0,
      modelo: nome,
      condicao,
      opcoes,
      capacidades_disponiveis: [...new Set(itens.map((i) => i.gb))],
      cores_disponiveis: [...new Set(itens.flatMap((i) => (i.cores ? Object.keys(i.cores) : [])))],
      a_partir_de: Math.min(...itens.flatMap((i) => (i.cores ? Object.values(i.cores) : [i.preco]))),
    };
  }

  // ---------------------------------------------------------------- avaliação
  // defeitos: chaves de assistencia.reparos (ex.: 'vidro_tela', 'face_id').
  // Bateria abaixo do mínimo entra automaticamente como desconto de 'bateria'.
  function avaliarAparelho({ modelo, gb, bateria, defeitos = [] }) {
    const nome = normalizarModelo(modelo);
    const g = normalizarGb(gb);
    const tabela = upgrade.valores[nome];
    if (!tabela) return { status: 'nao_aceito', modelo: nome, motivo: 'modelo fora da tabela de upgrade' };
    const base = tabela[String(g)];
    if (base == null) {
      return { status: 'nao_aceito', modelo: nome, gb: g, motivo: 'capacidade fora da tabela de upgrade' };
    }

    const recusados = defeitos.filter((d) => assistencia.recusa.includes(d));
    if (recusados.length) return { status: 'recusado', modelo: nome, gb: g, motivo: recusados };

    let lista = [...new Set(defeitos)];
    const minimo = loja.avaliacao.bateria_minima_sem_desconto;
    if (bateria != null && Number(bateria) < minimo && !lista.includes('bateria')) lista.push('bateria');
    // Display com defeito já inclui o vidro: não desconta os dois.
    if (lista.includes('tela')) lista = lista.filter((d) => d !== 'vidro_tela');

    const descontos = [];
    const consultar = [];
    for (const d of lista) {
      const reparo = assistencia.reparos[d];
      const valor = reparo && reparo.valores[nome];
      if (valor == null) consultar.push(d);
      else descontos.push({ defeito: d, descricao: reparo.descricao, valor });
    }

    const totalDescontos = descontos.reduce((s, x) => s + x.valor, 0);
    return {
      status: consultar.length ? 'consultar' : 'ok',
      modelo: nome,
      gb: g,
      valor_base: base,
      descontos,
      consultar,
      valor: Math.max(0, base - totalDescontos),
      ressalva: loja.avaliacao.ressalva,
    };
  }

  // ---------------------------------------------------------------- pagamento
  function totalComTaxa(valor, taxaPct) {
    const t = taxaPct / 100;
    return maquininha.formula === 'divide' ? valor / (1 - t) : valor * (1 + t);
  }

  function simularPagamento(valor, { parcelas = maquininha.parcelas_padrao } = {}) {
    const opcoes = parcelas
      .filter((n) => n >= 1 && n <= maquininha.max_parcelas)
      .map((n) => {
        const total = reais(totalComTaxa(valor, maquininha.taxas[String(n)]));
        return { parcelas: n, valor_parcela: reais(total / n), total };
      });
    return {
      a_vista: reais(valor),
      debito: reais(totalComTaxa(valor, maquininha.taxas.debito)),
      opcoes,
    };
  }

  // Monta a proposta completa: produto - avaliação(ões) - entrada = saldo, e parcela o saldo.
  function montarProposta({ produto, trocas = [], entrada = 0, parcelas }) {
    const consulta = consultarCatalogo(produto);
    if (!consulta.encontrado) return { status: 'produto_nao_encontrado', consulta };
    if (consulta.opcoes.length > 1) return { status: 'precisa_escolher', consulta };
    const item = consulta.opcoes[0];

    const avaliacoes = trocas.map(avaliarAparelho);
    const pendente = avaliacoes.find((a) => a.status !== 'ok');
    if (pendente) return { status: 'avaliacao_pendente', item, avaliacoes };

    const totalTrocas = avaliacoes.reduce((s, a) => s + a.valor, 0);
    const saldo = Math.max(0, item.preco - totalTrocas - entrada);
    return {
      status: 'ok',
      item,
      avaliacoes,
      entrada,
      saldo,
      pagamento: saldo > 0 ? simularPagamento(saldo, { parcelas }) : null,
    };
  }

  // Modelos que cabem no orçamento (já descontando a avaliação do aparelho, se houver).
  function sugerirModelos({ orcamento, avaliacao = 0, condicao }) {
    const condicoes = condicao ? [condicao] : ['lacrado', 'seminovo'];
    const out = [];
    for (const c of condicoes) {
      for (const i of itensCatalogo(c)) {
        const preco = i.cores ? Math.min(...Object.values(i.cores)) : i.preco;
        const diferenca = preco - avaliacao;
        if (diferenca <= orcamento) out.push({ condicao: c, modelo: i.modelo, gb: i.gb, preco, diferenca });
      }
    }
    // Mais caros primeiro: o cliente vê o melhor aparelho que cabe no bolso.
    return out.sort((a, b) => b.preco - a.preco);
  }

  // ---------------------------------------------------------------- horários
  const DIAS = ['domingo', 'segunda', 'terca', 'quarta', 'quinta', 'sexta', 'sabado'];
  const minutos = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

  // data: Date; horario: "HH:MM" pedido pelo cliente; feriado: true se for feriado.
  function verificarHorario(data, horario, { feriado = false } = {}) {
    const dia = feriado ? 'feriado' : DIAS[data.getDay()];
    const faixa = loja.horarios[dia];
    if (!faixa) return { aberto: false, dia, motivo: 'loja fechada neste dia' };
    const abre = minutos(faixa[0]);
    const ultimo = minutos(faixa[1]) - loja.ultimo_agendamento_min_antes_fechar;
    const pedido = minutos(horario);
    return {
      aberto: pedido >= abre && pedido <= ultimo,
      dia,
      abre: faixa[0],
      fecha: faixa[1],
      ultimo_agendamento: hhmm(ultimo),
    };
  }

  return {
    normalizarModelo,
    consultarCatalogo,
    avaliarAparelho,
    simularPagamento,
    montarProposta,
    sugerirModelos,
    verificarHorario,
  };
}
