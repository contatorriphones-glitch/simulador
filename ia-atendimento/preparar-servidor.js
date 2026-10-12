// Prepara o código do servidor (Supabase Edge Functions): copia o motor e o núcleo
// e gera as tabelas + roteiro de cada loja em supabase/functions/_shared/gerado/.
// Rode antes de publicar ou testar o servidor: node preparar-servidor.js
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { dadosDaLoja, lojasDisponiveis } from './build-chat.js';

const destino = new URL('./supabase/functions/_shared/gerado/', import.meta.url);
mkdirSync(destino, { recursive: true });
copyFileSync(new URL('./motor.js', import.meta.url), new URL('motor.js', destino));
copyFileSync(new URL('./nucleo.js', import.meta.url), new URL('nucleo.js', destino));

const lojas = Object.fromEntries(lojasDisponiveis().map((slug) => [slug, dadosDaLoja(slug)]));
writeFileSync(new URL('lojas.js', destino),
  '// Gerado por preparar-servidor.js. Não edite: mude dados/, lojas/ ou prompt/ e rode de novo.\n' +
  `export const LOJAS = ${JSON.stringify(lojas)};\n`);
console.log(`servidor preparado: ${Object.keys(lojas).join(', ')}`);
