// Gera chat-teste.html: um arquivo único (abre direto no navegador) com o motor,
// as tabelas e o prompt da Bia embutidos. Rode de novo sempre que mudar algo em dados/ ou prompt/.
import { readFileSync, writeFileSync } from 'node:fs';

const ler = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const json = (v) => JSON.stringify(v).replace(/<\/script/gi, '<\\/script');

const dados = Object.fromEntries(
  ['catalogo', 'upgrade', 'assistencia', 'maquininha', 'loja'].map((n) => [n, JSON.parse(ler(`./dados/${n}.json`))]),
);
const motor = ler('./motor.js').replace('export function criarMotor', 'function criarMotor');

const html = ler('./teste/chat.template.html')
  .replace('/*__DADOS__*/', () => json(dados))
  .replace('/*__PROMPT__*/', () => json(ler('./prompt/bia.md')))
  .replace('/*__GARANTIA__*/', () => json(ler('./dados/garantia.md')))
  .replace('/*__MOTOR__*/', () => motor);

writeFileSync(new URL('./chat-teste.html', import.meta.url), html);
console.log('chat-teste.html gerado');
