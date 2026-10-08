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

test('iCloud bloqueado é recusado', () => {
  assert.equal(m.avaliarAparelho({ modelo: '14', gb: 128, defeitos: ['icloud_bloqueado'] }).status, 'recusado');
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

test('horários: 20h numa quinta pode, 20h30 não; domingo fechado', () => {
  const quinta = new Date(2026, 9, 8);
  assert.equal(m.verificarHorario(quinta, '20:00').aberto, true);
  const r = m.verificarHorario(quinta, '20:30');
  assert.equal(r.aberto, false);
  assert.equal(r.ultimo_agendamento, '20:00');
  assert.equal(m.verificarHorario(new Date(2026, 9, 11), '12:00').aberto, false);
  assert.equal(m.verificarHorario(quinta, '16:00', { feriado: true }).aberto, false);
});
