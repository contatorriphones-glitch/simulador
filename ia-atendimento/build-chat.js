// Gera uma página de teste por loja: chat-teste-<loja>.html, um arquivo único (abre direto
// no navegador) com o motor, as tabelas e o prompt da atendente embutidos.
// Uso: node build-chat.js            -> todas as lojas
//      node build-chat.js kronos-phone -> só uma
// Rode de novo sempre que mudar algo em dados/, lojas/ ou prompt/.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { criarMotor } from './motor.js';

const ler = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const existe = (p) => existsSync(new URL(p, import.meta.url));
const json = (v) => JSON.stringify(v).replace(/<\/script/gi, '<\\/script');

// Embute um módulo ES num <script> comum, como objeto (ex.: NUCLEO.relogio), sem conflito de nomes.
function comoObjeto(nome, codigo) {
  const exportados = [...codigo.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  return `const ${nome} = (() => {\n${codigo.replace(/^export /gm, '')}\nreturn { ${exportados.join(', ')} };\n})();`;
}

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

// Lista do que a loja vende, gerada das tabelas: a IA nunca erra as linhas disponíveis.
function catalogoTexto(r) {
  const curto = (l) => l.map((m) => m.replace('iPhone ', '')).join(', ');
  return [
    `- **Linha mais atual da Apple:** ${r.linha_mais_atual.join(' e ')}.`,
    `- **iPhones lacrados:** ${curto(r.lacrados)}.`,
    `- **iPhones seminovos:** ${curto(r.seminovos)}.`,
    `- **Aceitos na troca:** do ${r.troca_aceita[0]} ao ${r.troca_aceita.at(-1)} (modelos fora da tabela de troca: ${'`avisar_equipe`'}).`,
  ].join('\n');
}

export function preencher(texto, loja, resumo) {
  const naoCadastrado = 'ainda não cadastrado. Se o cliente perguntar, diga que vai confirmar e chame `transferir_humano`.';
  return texto
    .replaceAll('{{LOJA}}', loja.nome)
    .replaceAll('{{ATENDENTE}}', loja.atendente)
    .replaceAll('{{EMOJI}}', loja.emoji || '')
    .replaceAll('{{BAIRRO}}', loja.bairro ? ` no ${loja.bairro}` : '')
    .replaceAll('{{ENDERECO}}', loja.endereco || naoCadastrado)
    .replaceAll('{{HORARIOS}}', horariosTexto(loja.horarios))
    .replaceAll('{{TOLERANCIA}}', String(loja.tolerancia_atraso_min || 0))
    .replaceAll('{{DOCUMENTO}}', loja.documento_portaria || '')
    .replaceAll('{{OUTROS_PRODUTOS}}', loja.outros_produtos || '')
    .replaceAll('{{CATALOGO}}', resumo ? catalogoTexto(resumo) : '');
}

// Dados, prompt e garantia de uma loja, prontos para usar (página de teste e servidor).
export function dadosDaLoja(slug) {
  const pasta = `./lojas/${slug}`;
  const loja = JSON.parse(ler(`${pasta}/loja.json`));
  const tabela = (n) => JSON.parse(ler(existe(`${pasta}/${n}.json`) ? `${pasta}/${n}.json` : `./dados/${n}.json`));
  const dados = { ...Object.fromEntries(['catalogo', 'upgrade', 'assistencia', 'maquininha'].map((n) => [n, tabela(n)])), loja };
  const resumo = criarMotor(dados).resumoCatalogo();
  return {
    dados,
    prompt: preencher(ler('./prompt/bia.md'), loja, resumo),
    garantia: preencher(ler(`${pasta}/garantia.md`).replace(/^<!--[\s\S]*?-->\n/, ''), loja),
  };
}

export const lojasDisponiveis = () => readdirSync(new URL('./lojas', import.meta.url));

function gerar(slug) {
  const { dados, prompt, garantia } = dadosDaLoja(slug);
  const motor = ler('./motor.js').replace('export function criarMotor', 'function criarMotor');

  const html = ler('./teste/chat.template.html')
    .replace('/*__DADOS__*/', () => json(dados))
    .replace('/*__PROMPT__*/', () => json(prompt))
    .replace('/*__GARANTIA__*/', () => json(garantia))
    .replace('/*__NUVEM__*/', () => json(JSON.parse(ler('./dados/nuvem.json'))))
    .replace('/*__MOTOR__*/', () => motor)
    .replace('/*__NUCLEO__*/', () => comoObjeto('NUCLEO', ler('./nucleo.js')));

  const saida = `chat-teste-${slug}.html`;
  writeFileSync(new URL(`./${saida}`, import.meta.url), html);
  console.log(`${saida} gerado${dados.loja._pendente ? `  (pendente: ${dados.loja._pendente})` : ''}`);
}

// Painel da equipe (um só arquivo, abre no navegador).
function gerarPainel() {
  const html = ler('./painel/painel.template.html').replace('/*__NUVEM__*/', () => json(JSON.parse(ler('./dados/nuvem.json'))));
  writeFileSync(new URL('./painel.html', import.meta.url), html);
  console.log('painel.html gerado');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const pedidas = process.argv.slice(2);
  for (const slug of pedidas.length ? pedidas : lojasDisponiveis()) gerar(slug);
  gerarPainel();
}
