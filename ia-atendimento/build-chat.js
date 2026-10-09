// Gera uma página de teste por loja: chat-teste-<loja>.html, um arquivo único (abre direto
// no navegador) com o motor, as tabelas e o prompt da atendente embutidos.
// Uso: node build-chat.js            -> todas as lojas
//      node build-chat.js kronos-phone -> só uma
// Rode de novo sempre que mudar algo em dados/, lojas/ ou prompt/.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const ler = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const existe = (p) => existsSync(new URL(p, import.meta.url));
const json = (v) => JSON.stringify(v).replace(/<\/script/gi, '<\\/script');

const DIAS = [['segunda', 'segunda'], ['terca', 'terça'], ['quarta', 'quarta'], ['quinta', 'quinta'], ['sexta', 'sexta'], ['sabado', 'sábado'], ['domingo', 'domingo']];
const hora = (h) => h.replace(/^0/, '').replace(':00', 'h').replace(':', 'h');

// { segunda: ['09:00','20:30'], ... } -> "segunda a sexta, das 9h às 20h30; sábado, das 9h às 17h; ..."
export function horariosTexto(h) {
  const grupos = [];
  for (const [chave, nome] of DIAS) {
    const faixa = h[chave] ? h[chave].join('-') : null;
    const ultimo = grupos.at(-1);
    if (ultimo && ultimo.faixa === faixa) ultimo.fim = nome;
    else grupos.push({ inicio: nome, fim: nome, faixa, valor: h[chave] });
  }
  const abertos = grupos.filter((g) => g.valor).map((g) =>
    `${g.inicio === g.fim ? g.inicio : `${g.inicio} a ${g.fim}`}, das ${hora(g.valor[0])} às ${hora(g.valor[1])}`);
  if (h.feriado) abertos.push(`feriados, das ${hora(h.feriado[0])} às ${hora(h.feriado[1])}`);
  const fechados = grupos.filter((g) => !g.valor).map((g) => (g.inicio === g.fim ? g.inicio : `${g.inicio} a ${g.fim}`));
  return abertos.join('; ') + '.' + (fechados.length ? ` **${fechados.join(' e ').replace(/^./, (c) => c.toUpperCase())}: fechado.**` : '');
}

function preencher(texto, loja) {
  const naoCadastrado = 'ainda não cadastrado. Se o cliente perguntar, diga que vai confirmar e chame `transferir_humano`.';
  return texto
    .replaceAll('{{LOJA}}', loja.nome)
    .replaceAll('{{ATENDENTE}}', loja.atendente)
    .replaceAll('{{EMOJI}}', loja.emoji || '')
    .replaceAll('{{BAIRRO}}', loja.bairro ? ` no ${loja.bairro}` : '')
    .replaceAll('{{ENDERECO}}', loja.endereco || naoCadastrado)
    .replaceAll('{{HORARIOS}}', horariosTexto(loja.horarios));
}

function gerar(slug) {
  const pasta = `./lojas/${slug}`;
  const loja = JSON.parse(ler(`${pasta}/loja.json`));
  // Cada loja pode ter as próprias tabelas em lojas/<loja>/; sem elas, usa as de dados/.
  const tabela = (n) => JSON.parse(ler(existe(`${pasta}/${n}.json`) ? `${pasta}/${n}.json` : `./dados/${n}.json`));
  const dados = { ...Object.fromEntries(['catalogo', 'upgrade', 'assistencia', 'maquininha'].map((n) => [n, tabela(n)])), loja };
  const motor = ler('./motor.js').replace('export function criarMotor', 'function criarMotor');
  const garantia = preencher(ler(`${pasta}/garantia.md`).replace(/^<!--[\s\S]*?-->\n/, ''), loja);

  const html = ler('./teste/chat.template.html')
    .replace('/*__DADOS__*/', () => json(dados))
    .replace('/*__PROMPT__*/', () => json(preencher(ler('./prompt/bia.md'), loja)))
    .replace('/*__GARANTIA__*/', () => json(garantia))
    .replace('/*__NUVEM__*/', () => json(JSON.parse(ler('./dados/nuvem.json'))))
    .replace('/*__MOTOR__*/', () => motor);

  const saida = `chat-teste-${slug}.html`;
  writeFileSync(new URL(`./${saida}`, import.meta.url), html);
  console.log(`${saida} gerado${loja._pendente ? `  (pendente: ${loja._pendente})` : ''}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pedidas = process.argv.slice(2);
  const todas = readdirSync(new URL('./lojas', import.meta.url));
  for (const slug of pedidas.length ? pedidas : todas) gerar(slug);
}
