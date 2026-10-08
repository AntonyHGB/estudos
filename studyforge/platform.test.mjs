import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTopic, parseQuiz } from './parser.mjs';
import { normalizeQuizQuestion } from './model.mjs';
import { validateQuiz, validateTopic } from './validate.mjs';
import { selectTopics } from './cli.mjs';

const markdown = '# 13 — Test\n\n## Seção\ntexto\n';
const source = 'engenharia-de-dados/13-test.md';
const quizBank = { '13': [{ n: '🟢', q: 'Pergunta?', a: ['A', 'B'], c: 0, e: 'Porque sim.', extra: 'preservado' }] };
function validTopic() {
  const { topic } = parseTopic(markdown, source);
  const parsed = parseQuiz(JSON.stringify(quizBank), 'engenharia-de-dados/quiz.json');
  topic.quizQuestions = parsed.questions.map((q) => normalizeQuizQuestion(q, topic));
  return topic;
}

test('JSON Schema exige as coleções e campos canônicos completos', () => {
  const topic = validTopic();
  assert.equal(validateTopic(topic).valid, true);
  for (const field of ['partitions', 'sections', 'interviewQuestions', 'quizQuestions']) {
    const missing = { ...topic }; delete missing[field];
    assert.equal(validateTopic(missing).valid, false, `${field} ausente`);
  }
  const malformed = validTopic(); delete malformed.quizQuestions[0].alternatives;
  assert.equal(validateTopic(malformed).valid, false);
});

test('valida follow-up/span, hash e particionamento integral', () => {
  const topic = validTopic();
  topic.interviewQuestions.push({ id: 'bad', kind: 'question', difficulty: null, difficultyReason: 'ausente', question: 'Q?', modelAnswer: null, followUps: [{ question: '', answer: null, source: { start: 0, end: 1, startLine: 1, endLine: 1 } }], traps: [], sourceAnchor: 'x', source: { ...topic.source, span: { start: 0, end: 1, startLine: 1, endLine: 1 }, anchor: 'x' } });
  assert.equal(validateTopic(topic).valid, false);
  const broken = validTopic(); broken.partitions[0].source.start++;
  assert.ok(validateTopic(broken).errors.some((e) => e.code === 'PARTITION_LOSS'));
});

test('quiz inválido ou malformado produz erros sem exceção', () => {
  for (const input of ['{', 'null', '[]', '{"13":[null]}', '{"13":[{"n":"🟢","q":"Q?","a":[],"c":0,"e":"E"}]}']) {
    assert.doesNotThrow(() => validateQuiz(input));
    assert.equal(validateQuiz(input).valid, false);
  }
  const parsed = parseQuiz('{"13":[null]}', 'x/quiz.json');
  assert.equal(parsed.valid, false);
});

test('normalização expõe contrato semântico com source rastreável', () => {
  const topic = validTopic(), q = topic.quizQuestions[0];
  assert.deepEqual(Object.keys(q).sort(), ['alternatives','correctIndex','difficulty','explanation','id','index','question','source','sourceTopic','theme'].sort());
  assert.equal(q.sourceTopic, 'engenharia-de-dados/13');
  assert.equal(q.source.pointer, '/13/0');
});

test('selector suporta 13+ e recusa traversal e ambiguidade', () => {
  const topics = [validTopic()];
  assert.equal(selectTopics(topics, 'engenharia-de-dados/13').length, 1);
  for (const selector of ['../13', 'engenharia-de-dados/13/extra', 'engenharia-de-dados/99']) assert.throws(() => selectTopics(topics, selector));
  assert.throws(() => selectTopics([...topics, validTopic()], 'engenharia-de-dados/13'), /exatamente um/);
});
