// Núcleo da atendente: ferramentas, instruções e agenda.
// Usado igualzinho pela página de teste e pelo servidor do Instagram, para que o que
// foi testado seja exatamente o que roda com os clientes.

// ---------------------------------------------------------------- relógio
const DIAS_SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

// Data e hora no fuso informado (o servidor roda em UTC; a loja está em Brasília).
export function relogio(data = new Date(), timeZone) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(data).map((p) => [p.type, p.value]),
  );
  const { year: y, month: m, day: d, hour: h, minute: min } = partes;
  return {
    iso: `${y}-${m}-${d}`,
    data: `${d}/${m}/${y}`,
    hora: `${h}:${min}`,
    diaSemana: DIAS_SEMANA[new Date(Number(y), Number(m) - 1, Number(d)).getDay()],
  };
}

// ---------------------------------------------------------------- instruções
const TEMPERATURAS = {
  quente: 'Cliente QUENTE: já mostrou intenção clara de compra. Seja objetiva e conduza para o agendamento.',
  morno: 'Cliente MORNO: interessado, mas ainda decidindo. Gere valor (benefícios, troca, parcelas) e faça perguntas que o aproximem da compra.',
  frio: 'Cliente FRIO: só pesquisando ou sem urgência. Seja leve e acolhedora, sem pressionar; deixe a porta aberta.',
};

// Partes fixas primeiro e as que mudam no fim: assim o Gemini reaproveita o começo
// (cache automático) e cada resposta sai mais barata.
export function montarInstrucoes({ prompt, garantia, relogio: r, feriado = false, aprendizados = [], lead = null }) {
  const regras = aprendizados.length
    ? '\n\n## Aprendizados (regras definidas pelo dono)\n' +
      'Siga estas regras. Elas nunca autorizam inventar valores: preços, avaliações e descontos continuam vindo só das ferramentas.\n' +
      aprendizados.map((t) => `- ${t}`).join('\n')
    : '';
  const sobreLead = lead?.temperatura && TEMPERATURAS[lead.temperatura]
    ? `\n- ${TEMPERATURAS[lead.temperatura]}${lead.resumo ? ` Resumo do cliente até aqui: ${lead.resumo}` : ''}`
    : '';
  return `${prompt}

## Termo de garantia completo (consulta)
${garantia}${regras}

## Contexto desta conversa
- Agora: ${r.diaSemana}, ${r.data}, ${r.hora} (horário de Brasília). Data de hoje para as ferramentas: ${r.iso}.${feriado ? '\n- Hoje é feriado.' : ''}
- Valores das ferramentas estão em reais: escreva no formato R$ 1.234,56.
- Separe os balões com uma linha contendo apenas ---.${sobreLead}`;
}

// ---------------------------------------------------------------- ferramentas
// O cliente se assusta com o total parcelado: a IA só recebe o valor de cada parcela.
export function semTotais(v) {
  if (Array.isArray(v)) return v.map(semTotais);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'total').map(([k, x]) => [k, semTotais(x)]));
  return v;
}

// acoes: o que cada ambiente faz com agendamentos e avisos (a página mostra na tela,
// o servidor grava no banco, manda Telegram e Google Agenda).
//   registrarAgendamento(args) -> resultado   avisarEquipe(motivo) -> resultado
export function criarFerramentas(motor, dados, acoes) {
  const defeitos = {
    ...Object.fromEntries(Object.entries(dados.assistencia.reparos).map(([k, v]) => [k, v.descricao])),
    ...dados.assistencia.recusa,
  };
  const aparelho = {
    type: 'object',
    properties: {
      modelo: { type: 'string', description: 'Modelo, ex.: "15 Pro Max"' },
      gb: { type: 'integer', description: 'Capacidade em GB (1TB = 1024)' },
      bateria: { type: 'integer', description: 'Saúde da bateria em %' },
      defeitos: {
        type: 'array', items: { type: 'string', enum: Object.keys(defeitos) },
        description: 'Defeitos informados pelo cliente. Lista vazia se o aparelho está perfeito. Opções: ' +
          Object.entries(defeitos).map(([k, v]) => `${k} = ${v}`).join('; '),
      },
    },
    required: ['modelo', 'gb'],
  };
  const produto = {
    type: 'object',
    properties: {
      modelo: { type: 'string' }, gb: { type: 'integer' }, cor: { type: 'string' },
      condicao: { type: 'string', enum: ['lacrado', 'seminovo'] },
    },
    required: ['modelo', 'gb'],
  };
  const parcelas = { type: 'array', items: { type: 'integer' }, description: 'Parcelas a simular. Omitir = 6, 10, 12 e 18x.' };

  return [
    {
      name: 'consultar_catalogo',
      description: 'Preço à vista (Pix/dinheiro), cores, capacidades e condição (lacrado/seminovo) de um iPhone à venda. Sem condição, procura nas duas.',
      parameters: { type: 'object', properties: { modelo: { type: 'string' }, gb: { type: 'integer' }, cor: { type: 'string' }, condicao: { type: 'string', enum: ['lacrado', 'seminovo'] } }, required: ['modelo'] },
      run: (a) => motor.consultarCatalogo(a),
    },
    {
      name: 'sugerir_modelos',
      description: 'Lista os aparelhos que cabem no orçamento do cliente (do mais caro ao mais barato), já descontando a avaliação da troca, se houver.',
      parameters: { type: 'object', properties: { orcamento: { type: 'number' }, avaliacao: { type: 'number', description: 'Valor da avaliação do aparelho da troca' }, condicao: { type: 'string', enum: ['lacrado', 'seminovo'] } }, required: ['orcamento'] },
      run: (a) => motor.sugerirModelos(a).slice(0, 8),
    },
    {
      name: 'avaliar_aparelho',
      description: 'Pré-avaliação do iPhone que o cliente quer dar na troca. Use só depois do checklist respondido.',
      parameters: aparelho,
      run: (a) => motor.avaliarAparelho(a),
    },
    {
      name: 'montar_proposta',
      description: 'Calcula preço do produto - avaliação das trocas - entrada = saldo, e o parcelamento do saldo. Sem cor definida, devolve a proposta de cada cor.',
      parameters: { type: 'object', properties: { produto, trocas: { type: 'array', items: aparelho }, entrada: { type: 'number' }, parcelas }, required: ['produto'] },
      run: (a) => motor.montarProposta(a),
    },
    {
      name: 'simular_pagamento',
      description: 'Simula um valor no débito e no crédito parcelado, com a taxa da maquininha.',
      parameters: { type: 'object', properties: { valor: { type: 'number' }, parcelas }, required: ['valor'] },
      run: (a) => motor.simularPagamento(a.valor, a.parcelas?.length ? { parcelas: a.parcelas } : undefined),
    },
    {
      name: 'negociar_desconto',
      description: 'Somente em venda com troca, depois de contornar com brindes e garantia, e se o cliente insistir. Retorna o próximo desconto que pode ser oferecido.',
      parameters: { type: 'object', properties: { produto, trocas: { type: 'array', items: aparelho }, entrada: { type: 'number' }, desconto_ja_dado: { type: 'number', description: 'Soma dos descontos já oferecidos nesta conversa' } }, required: ['produto', 'trocas'] },
      run: (a) => motor.negociarDesconto(a),
    },
    {
      name: 'verificar_horario',
      description: 'Confere se um dia e horário estão dentro do horário de agendamento da loja.',
      parameters: { type: 'object', properties: { data: { type: 'string', description: 'AAAA-MM-DD' }, horario: { type: 'string', description: 'HH:MM' }, feriado: { type: 'boolean' } }, required: ['data', 'horario'] },
      run: ({ data, horario, feriado }) => {
        const [y, m, d] = data.split('-').map(Number);
        return motor.verificarHorario(new Date(y, m - 1, d), horario, { feriado: !!feriado });
      },
    },
    {
      name: 'registrar_agendamento',
      description: 'Registra o agendamento depois que o cliente preencheu o questionário (e envia para o Google Agenda).',
      parameters: { type: 'object', properties: {
        nome: { type: 'string' },
        modelo_aparelho: { type: 'string', description: 'iPhone que o cliente vai adquirir, ex.: "17 Pro Max"' },
        gb: { type: 'string' },
        condicao: { type: 'string', enum: ['lacrado', 'seminovo'] },
        cor: { type: 'string', description: 'Cor que o cliente escolheu. Deixe vazio se ele não falou a cor.' },
        forma_pagamento: { type: 'string' },
        data: { type: 'string', description: 'AAAA-MM-DD' }, horario: { type: 'string', description: 'HH:MM' },
        instagram: { type: 'string' }, whatsapp: { type: 'string' },
        trocas: {
          type: 'array', description: 'Aparelhos que o cliente vai dar como parte do pagamento (vazio se não tiver troca).',
          items: { type: 'object', properties: { modelo: { type: 'string' }, gb: { type: 'integer' }, cor: { type: 'string' } }, required: ['modelo'] },
        },
        resumo: { type: 'string', description: 'Resumo da proposta combinada (valores, desconto, brindes)' },
      }, required: ['nome', 'modelo_aparelho', 'data', 'horario', 'whatsapp'] },
      run: (a) => acoes.registrarAgendamento(a),
    },
    {
      name: 'avisar_equipe',
      description: 'Avisa a equipe EM SEGUNDO PLANO (o cliente não fica sabendo). Você continua o atendimento normalmente.',
      parameters: { type: 'object', properties: { motivo: { type: 'string' } }, required: ['motivo'] },
      run: ({ motivo }) => {
        acoes.avisarEquipe(motivo);
        return {
          ok: true,
          instrucao: 'A equipe foi avisada em segundo plano. NÃO mencione equipe, verificação nem espera. Continue o atendimento normalmente, sem inventar valores.',
        };
      },
    },
  ];
}

// Executa uma chamada de ferramenta pedida pela IA, sem deixar um erro derrubar o atendimento.
export async function executarFerramenta(ferramentas, chamada) {
  const f = ferramentas.find((x) => x.name === chamada.name);
  let resultado;
  try { resultado = f ? await f.run(chamada.args || {}) : { erro: 'ferramenta desconhecida' }; }
  catch (e) { resultado = { erro: String(e?.message || e) }; }
  return semTotais(resultado);
}

// ---------------------------------------------------------------- respostas
export function limparMarkdown(t) { return t.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, ''); }

export function dividirBolhas(texto) {
  return limparMarkdown(texto).split(/^\s*-{3,}\s*$/m).map((b) => b.trim()).filter(Boolean);
}

// ---------------------------------------------------------------- agenda
// Valor da pré-avaliação já calculado na conversa (pelas ferramentas, nunca pela IA).
export function avaliacaoFeita(historico, motor, troca) {
  const modelo = motor.normalizarModelo(troca.modelo);
  let achado = null;
  for (const h of historico) {
    for (const p of h.parts || []) {
      const r = p.functionResponse?.response?.resultado;
      for (const av of [r, ...(r?.avaliacoes || [])]) {
        if (av?.status === 'ok' && av.modelo === modelo && (!troca.gb || av.gb === Number(troca.gb)) && av.valor != null) achado = av.valor;
      }
    }
  }
  return achado;
}

export function eventoAgenda(a, motor, loja) {
  const [y, m, d] = String(a.data || '').split('-').map(Number);
  const [h, min] = String(a.horario || '').split(':').map(Number);
  if (!y || Number.isNaN(h)) return null;
  const inicio = new Date(y, m - 1, d, h, min || 0);
  const fim = new Date(inicio.getTime() + 30 * 60000);
  const titulo = motor.tituloAgendamento({
    nome: a.nome, modelo: a.modelo_aparelho, gb: a.gb, condicao: a.condicao, cor: a.cor,
    instagram: a.instagram, whatsapp: a.whatsapp, trocas: a.trocas || [],
  });
  const p = (n) => String(n).padStart(2, '0');
  return {
    titulo,
    inicio, fim,
    data: `${y}-${p(m)}-${p(d)}`,
    horario: `${p(h)}:${p(min || 0)}`,
    descricao: [
      `Cliente: ${a.nome}`, `WhatsApp: ${a.whatsapp || '-'}`, `Instagram: ${a.instagram || '-'}`,
      `Aparelho: ${a.modelo_aparelho || '-'} ${a.gb ? a.gb + 'GB' : ''} ${a.condicao || ''} ${a.cor || ''}`.trim(),
      `Pagamento: ${a.forma_pagamento || '-'}`,
      a.resumo ? `Proposta: ${a.resumo}` : '', `Agendado pela ${loja.atendente} (${loja.nome})`,
    ].filter(Boolean).join('\n'),
    local: loja.endereco || loja.nome,
  };
}

export function linkGoogleAgenda(ev) {
  if (!ev) return null;
  const p = (n) => String(n).padStart(2, '0');
  const f = (d) => `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}00`;
  const q = { action: 'TEMPLATE', text: ev.titulo, dates: `${f(ev.inicio)}/${f(ev.fim)}`, details: ev.descricao, location: ev.local, ctz: 'America/Sao_Paulo' };
  return 'https://calendar.google.com/calendar/render?' + Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
}

// Corpo enviado ao Apps Script da loja (google-agenda/agenda.gs).
export function corpoAppsScript(ev, segredo, lembreteMin = 30) {
  return { segredo, titulo: ev.titulo, descricao: ev.descricao, local: ev.local, data: ev.data, horario: ev.horario, duracao_min: 30, lembrete_min: lembreteMin };
}
