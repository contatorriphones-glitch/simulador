// Carrega as tabelas de ./dados e devolve o motor pronto (uso em Node).
import { readFileSync } from 'node:fs';
import { criarMotor } from './motor.js';

const ler = (nome) => JSON.parse(readFileSync(new URL(`./dados/${nome}.json`, import.meta.url), 'utf8'));

export function carregarMotor() {
  return criarMotor({
    catalogo: ler('catalogo'),
    upgrade: ler('upgrade'),
    assistencia: ler('assistencia'),
    maquininha: ler('maquininha'),
    loja: ler('loja'),
  });
}
