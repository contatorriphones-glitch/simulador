import { test } from 'node:test';
import assert from 'node:assert/strict';
import { carregarMotor } from './carregar.js';

const m = carregarMotor();

test('entende o jeito que o cliente escreve o modelo', () => {
  assert.equal(m.normalizarModelo('15 pro max'), 'iPhone 15 Pro Max');
  assert.equal(m.normalizarModelo('iphone 17 promax'), 'iPhone 17 Pro Max');
  assert.equal(m.normalizarModelo('17 air'), 'iPhone 17 Air');
  assert.equal(m.normalizarModelo('xr'), 'iPhone XR');
});

test('17 Pro Max lacrado: preço muda por cor', () => {
  const c = m.consultarCatalogo({ modelo: '17 pro max', gb: 256 });
  assert.deepEqual(c.opcoes.map((o) => [o.cor, o.preco]), [['Azul', 7049], ['Laranja', 6849], ['Branco', 7199]]);
  assert.equal(c.a_partir_de, 6849);
});

test('"tem 17 pro de 128gb roxo?" -> não existe, mostra o que existe', () => {
  const c = m.consultarCatalogo({ modelo: '17 pro', gb: 128, cor: 'roxo' });
  assert.equal(c.encontrado, false);
  assert.deepEqual(c.capacidades_disponiveis, [256, 512]);
  assert.deepEqual(c.cores_disponiveis, ['Azul', 'Laranja', 'Branco']);
});

test('troca: 15 Pro Max 256, bateria 79%, vidro trincado', () => {
  const a = m.avaliarAparelho({ modelo: '15 pro max', gb: '256', bateria: 79, defeitos: ['vidro_tela'] });
  assert.equal(a.status, 'ok');
  assert.equal(a.valor_base, 3550);
  // 3550 - vidro 270 - bateria 180
  assert.equal(a.valor, 3100);
});

test('troca: 15 Pro Max 256 perfeito, bateria 90%', () => {
  const a = m.avaliarAparelho({ modelo: '15 pro max', gb: 256, bateria: 90 });
  assert.equal(a.valor, 3550);
  assert.deepEqual(a.descontos, []);
});

test('display com defeito desconta a tela, não soma o vidro', () => {
  const a = m.avaliarAparelho({ modelo: '13', gb: 128, bateria: 85, defeitos: ['tela', 'vidro_tela'] });
  assert.equal(a.valor, 1350 - 340);
});

test('modelo fora da tabela de upgrade não é aceito', () => {
  assert.equal(m.avaliarAparelho({ modelo: '16 plus', gb: 128 }).status, 'nao_aceito');
  assert.equal(m.avaliarAparelho({ modelo: '15 pro max', gb: 1024 }).status, 'nao_aceito');
});

test('defeito sem preço na tabela da assistência -> consultar humano', () => {
  const a = m.avaliarAparelho({ modelo: '17 pro', gb: 256, bateria: 75 });
  assert.equal(a.status, 'consultar');
  assert.deepEqual(a.consultar, ['bateria']);
});

test('aparelhos que não pegamos são recusados', () => {
  for (const d of ['icloud_bloqueado', 'aviso_peca', 'chip', 'placa', 'face_id']) {
    assert.equal(m.avaliarAparelho({ modelo: '14', gb: 128, defeitos: [d] }).status, 'recusado', d);
  }
  assert.deepEqual(m.avaliarAparelho({ modelo: '14', gb: 128, defeitos: ['aviso_peca'] }).motivo,
    ['mensagem de peça desconhecida (bateria, tela ou câmera)']);
});

test('parcelamento do saldo usa a tabela da maquininha', () => {
  const p = m.simularPagamento(2650);
  assert.deepEqual(p.opcoes.map((o) => o.parcelas), [6, 10, 12, 18]);
  const p18 = p.opcoes.find((o) => o.parcelas === 18);
  assert.equal(p18.total, 3161.45); // 2650 x 1,193
  assert.equal(p18.valor_parcela, 175.64);
  assert.equal(p.debito, 2729.5);
});

test('proposta completa: 17 Pro Max Branco com 15 Pro Max na troca', () => {
  const r = m.montarProposta({
    produto: { modelo: '17 pro max', gb: 256, cor: 'branco' },
    trocas: [{ modelo: '15 pro max', gb: 256, bateria: 79, defeitos: ['vidro_tela'] }],
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.saldo, 7199 - 3100);
});

test('proposta sem cor escolhida pede para o cliente escolher', () => {
  const r = m.montarProposta({ produto: { modelo: '17 pro max', gb: 256 } });
  assert.equal(r.status, 'precisa_escolher');
});

test('orçamento de 5.000 sem troca sugere o melhor que cabe', () => {
  const s = m.sugerirModelos({ orcamento: 5000, condicao: 'lacrado' });
  assert.equal(s[0].modelo, 'iPhone 16');
});

test('horários: agenda até 20h30 na semana e até 17h no sábado; domingo fechado', () => {
  const quinta = new Date(2026, 9, 8);
  assert.equal(m.verificarHorario(quinta, '20:30').aberto, true);
  const r = m.verificarHorario(quinta, '20:45');
  assert.equal(r.aberto, false);
  assert.equal(r.ultimo_agendamento, '20:30');
  const sabado = new Date(2026, 9, 10);
  assert.equal(m.verificarHorario(sabado, '17:00').aberto, true);
  assert.equal(m.verificarHorario(sabado, '17:30').aberto, false);
  assert.equal(m.verificarHorario(new Date(2026, 9, 11), '12:00').aberto, false);
  assert.equal(m.verificarHorario(quinta, '16:00', { feriado: true }).aberto, false);
});

// ---------------------------------------------------------------- negociação
const vendaComTroca = {
  produto: { modelo: '17 pro max', gb: 256, cor: 'branco' },
  trocas: [{ modelo: '17 pro', gb: 256, bateria: 92 }],
};

test('simulação simples: R$ 1.000 em 18x = 18x de R$ 66,28', () => {
  const p = m.simularPagamento(1000, { parcelas: [18] });
  assert.equal(p.opcoes[0].valor_parcela, 66.28);
});

test('desconto com troca: margem da troca nunca fica abaixo de R$ 300', () => {
  // 17 Pro 256: revenda 6399 - upgrade 5850 = 549 -> até 249 de desconto
  const d1 = m.negociarDesconto(vendaComTroca);
  assert.equal(d1.status, 'ok');
  assert.equal(d1.desconto, 100); // 50% de 249, de 50 em 50
  assert.equal(d1.ultima_oferta, false);
  assert.equal(d1.novo_saldo, 7199 - 5850 - 100);
  assert.equal('maximo' in d1, false); // nunca expõe o limite

  const d2 = m.negociarDesconto({ ...vendaComTroca, desconto_ja_dado: 100 });
  assert.equal(d2.desconto, 200);
  assert.equal(d2.ultima_oferta, true);

  assert.equal(m.negociarDesconto({ ...vendaComTroca, desconto_ja_dado: 200 }).status, 'limite');
});

test('desconto não mexe na taxa: parcelas recalculadas sobre o novo saldo', () => {
  const d = m.negociarDesconto(vendaComTroca);
  const semDesconto = m.simularPagamento(d.novo_saldo);
  assert.deepEqual(d.pagamento, semDesconto);
});

test('defeitos descontados não reduzem a margem da troca', () => {
  const comDefeito = m.negociarDesconto({ ...vendaComTroca, trocas: [{ modelo: '17 pro', gb: 256, bateria: 92, defeitos: ['lentes'] }] });
  // lentes do 17 Pro não têm preço na tabela -> avaliação pendente
  assert.equal(comDefeito.status, 'avaliacao_pendente');
  const r = m.negociarDesconto({
    produto: { modelo: '17 pro max', gb: 256, cor: 'branco' },
    trocas: [{ modelo: '15 pro max', gb: 256, bateria: 79, defeitos: ['vidro_tela'] }],
  });
  // 3949 - 3550 = 399 -> até 99 -> etapas 0 e 50
  assert.equal(r.desconto, 50);
  assert.equal(r.ultima_oferta, true);
});

test('sem troca a IA não dá desconto: chama humano', () => {
  const r = m.negociarDesconto({ produto: { modelo: '17 pro max', gb: 256, cor: 'branco' } });
  assert.equal(r.status, 'humano');
});

test('aparelho da troca sem preço de revenda: chama humano', () => {
  const r = m.negociarDesconto({ produto: { modelo: '17', gb: 256 }, trocas: [{ modelo: '11', gb: 128, bateria: 85 }] });
  assert.equal(r.status, 'humano');
});
