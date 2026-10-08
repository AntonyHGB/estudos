import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const buildSource = readFileSync(new URL('../build-site.mjs', import.meta.url), 'utf8');
const start = buildSource.indexOf('function escapeHtml(');
const end = buildSource.indexOf('/* ================================ CSS compartilhado', start);
assert.ok(start >= 0 && end > start, 'funções legadas de Markdown devem estar presentes');
const parserSource = buildSource.slice(start, end);

test('parseTopic mantém estudo, TOC e cards com LF e CRLF nas fontes reais', () => {
  const script = `
const vm = require('node:vm');
const fs = require('node:fs');
const context = { result: null };
vm.createContext(context);
vm.runInContext(${JSON.stringify(parserSource)} + '\\nglobalThis.parse = parseTopic;', context);
const paths = [
  'engenharia-de-dados/01-modelagem-de-dados.md',
  'engenharia-de-dados/12-design-de-sistemas-de-dados.md',
  'machine-learning/01-fundamentos.md',
  'machine-learning/12-ml-system-design.md',
];
const result = paths.map((path) => {
  const raw = fs.readFileSync(path, 'utf8');
  const lf = context.parse(raw.replace(/\\r\\n?/g, '\\n'), {});
  const crlf = context.parse(raw.replace(/\\r?\\n/g, '\\r\\n'), {});
  return { path, lf, crlf };
});
process.stdout.write(JSON.stringify(result));
`;
  const run = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 2500,
  });

  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr);
  const parsed = JSON.parse(run.stdout);
  for (const { path, lf, crlf } of parsed) {
    assert.deepEqual(crlf, lf, `${path}: resultado CRLF deve ser idêntico a LF`);
    assert.ok(lf.toc.length > 0, `${path}: TOC não pode estar vazio`);
    assert.ok(lf.studyHtml.length > 0, `${path}: estudo não pode estar vazio`);
    assert.ok(lf.cards.length > 0, `${path}: cards não podem estar vazios`);
  }
});

test('mdToHtml avança ao receber linha de lista com separador Unicode', () => {
  const fnStart = buildSource.indexOf('function mdToHtml(');
  const fnEnd = buildSource.indexOf('\nfunction ', fnStart + 1);
  const functionSource = buildSource.slice(buildSource.indexOf('function normalizeMarkdown('), fnEnd);
  const script = `const inline = (s) => s;\n${functionSource}\nprocess.stdout.write(mdToHtml('- um\\r\\n- dois\\r\\n', {}));`;
  const run = spawnSync(process.execPath, ['-e', script], {
    cwd: root,
    encoding: 'utf8',
    timeout: 1500,
  });
  assert.equal(run.error, undefined, run.error?.message);
  assert.equal(run.status, 0, run.stderr);
  assert.equal((run.stdout.match(/<li>/g) || []).length, 2);
});
