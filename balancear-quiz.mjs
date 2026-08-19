// balancear-quiz.mjs — redistribui a POSIÇÃO da alternativa correta nos quiz.json.
//
// Uso: node balancear-quiz.mjs engenharia-de-dados machine-learning
//
// Por que existe: escrevendo as questões é natural deixar a correta sempre na
// mesma posição, e aí dá para gabaritar o quiz marcando sempre a mesma letra.
// Este script troca a correta de lugar com a alternativa que ocupa uma posição
// alvo, seguindo um padrão fixo por índice dentro do tema. Como o padrão usa
// cada posição duas vezes a cada oito questões, o resultado é 25% por letra.
//
// É troca de pares: nenhum texto de enunciado, alternativa ou explicação muda.
//
// ATENÇÃO: o script aborta se alguma explicação citar alternativa por letra
// ("a opção B..."), porque embaralhar deixaria o texto mentindo. Nesse caso,
// reescreva a explicação para citar o CONTEÚDO da alternativa.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

// Duas ocorrências de cada posição a cada 8 questões = 25% por letra.
const PADRAO = [0, 2, 3, 1, 2, 0, 1, 3];

// Pega "opção B", "alternativa C", "letra A", "a opção D)" e afins.
const CITA_LETRA =
  /\b(?:op(?:ç|c)(?:ã|a)o|op(?:ç|c)(?:õ|o)es|alternativas?|letras?|itens?|item)\s+["“(]?[A-E]\b/gi;

const areas = process.argv.slice(2);
if (!areas.length) {
  console.error('Uso: node balancear-quiz.mjs <area> [area...]');
  process.exit(1);
}

let houveErro = false;
const resumo = [];

for (const area of areas) {
  const caminho = join(ROOT, area, 'quiz.json');
  if (!existsSync(caminho)) {
    console.error(`✖ ${area}: quiz.json não encontrado`);
    houveErro = true;
    continue;
  }

  const banco = JSON.parse(readFileSync(caminho, 'utf8'));

  // 1. Trava de segurança: explicação que cita letra quebraria com o embaralhamento.
  const citacoes = [];
  for (const [tema, questoes] of Object.entries(banco)) {
    questoes.forEach((q, i) => {
      const achados = q.e.match(CITA_LETRA);
      if (achados) citacoes.push(`${area} tema ${tema} questão ${i + 1}: "${achados.join('", "')}"`);
    });
  }
  if (citacoes.length) {
    console.error(`\n✖ ABORTADO — ${citacoes.length} explicação(ões) citam alternativa por letra:\n`);
    citacoes.forEach((c) => console.error(`   ${c}`));
    console.error(
      '\n   Embaralhar as posições faria esse texto apontar para a alternativa errada.'
    );
    console.error('   Reescreva citando o conteúdo da alternativa, não a letra dela.\n');
    houveErro = true;
    continue;
  }

  // 2. Troca em pares: a correta vai para a posição alvo, e quem estava lá assume a antiga.
  let trocas = 0;
  for (const questoes of Object.values(banco)) {
    questoes.forEach((q, i) => {
      const alvo = PADRAO[i % PADRAO.length];
      if (alvo >= q.a.length) return; // questão com menos alternativas que o padrão exige
      if (q.c === alvo) return;
      const tmp = q.a[alvo];
      q.a[alvo] = q.a[q.c];
      q.a[q.c] = tmp;
      q.c = alvo;
      trocas++;
    });
  }

  // Mantém uma alternativa por linha, para o diff do git ficar legível.
  const json = JSON.stringify(banco, null, 2).replace(/\n {6}/g, ' ').replace(/\n {4}\]/g, ']');
  writeFileSync(caminho, json + '\n', 'utf8');

  // 3. Confere a distribuição resultante.
  const letras = [0, 0, 0, 0, 0];
  let total = 0;
  for (const questoes of Object.values(banco)) {
    questoes.forEach((q) => {
      letras[q.c]++;
      total++;
    });
  }
  const dist = letras
    .slice(0, 4)
    .map((n, k) => `${'ABCD'[k]}=${((100 * n) / total).toFixed(0)}%`)
    .join('  ');
  resumo.push(`✔ ${area}: ${trocas} trocas em ${total} questões — ${dist}`);
}

resumo.forEach((r) => console.log(r));
if (houveErro) process.exit(1);
console.log('\nPosições balanceadas. Rode "node build-site.mjs" para regerar o site.');
