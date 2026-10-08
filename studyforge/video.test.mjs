import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {buildVideoLesson, toSrt} from './video/src/model.mjs';
import {createVideoRenderer, renderVideo} from './video/render.mjs';

const ref = (pathValue = 'engenharia-de-dados/01-modelagem-de-dados.md', anchor = '1.7') => ({
  path: pathValue, sha256: 'a'.repeat(64), span: {start: 0, end: 10, startLine: 1, endLine: 1}, anchor,
});
const source = {path: 'machine-learning/01-fundamentos.md', sha256: 'b'.repeat(64)};
const edSource = {path: 'engenharia-de-dados/01-modelagem-de-dados.md', sha256: 'a'.repeat(64)};
const genericLesson = {
  id: 'lesson:ml-01', schemaVersion: 1, domain: 'machine-learning', sourceTopic: 'ml01', difficulty: 'basic',
  title: 'Validação de modelos', source, verificationStatus: 'unverified', sources: [source],
  objectives: [], summary: {markdown: 'Validar dados separados.', plainText: 'Validar dados separados.', sourceRef: ref()},
  concepts: [{id: 'c1', title: 'Separação temporal', markdown: 'A separação temporal preserva a ordem observada.', plainText: 'A separação temporal preserva a ordem observada.', sourceRef: ref(source.path, '1.1')}],
  examples: [], questions: [{id: 'q1', kind: 'recall', question: 'Por que preservar a ordem?', answer: 'Para evitar avaliar com informação futura.', explanation: '', sourceRef: ref(source.path, 'q1')}],
  pitfalls: [], recap: [],
};
const ed01Lesson = {
  ...genericLesson, id: 'lesson:ed01', domain: 'engenharia-de-dados', title: 'Modelagem de dados', sourceTopic: 'ed01', source: edSource, sources: [edSource],
  concepts: [{id: 'scd', title: 'Slowly Changing Dimensions (SCD)', markdown: '### 1.7 Slowly Changing Dimensions (SCD)\n\nTipo 1 — sobrescreve o valor anterior.\n\nTipo 2 — uma mudança gera uma nova linha com nova surrogate key.', plainText: 'Tipo 1 sobrescreve o valor anterior. Tipo 2 cria uma nova linha.', sourceRef: ref()}],
  examples: [{markdown: 'Cenário: o cliente muda de cidade. A venda anterior mantém a cidade da época.', plainText: 'Cenário: o cliente muda de cidade. A venda anterior mantém a cidade da época.', sourceRef: ref()}],
  questions: [
    {id: 'q-scd', kind: 'scenario', question: 'Como manter o contexto histórico?', answer: 'Use a versão vigente na data do evento.', explanation: '', sourceRef: ref()},
    {id: 'q-pitfall', kind: 'find-error', question: 'Qual é a falha?', answer: 'O lookup deve usar a data do evento.', explanation: '', sourceRef: ref()},
  ],
};

test('perfil genérico só deriva conteúdo/ref existente e não injeta SCD em ML nem ED12', () => {
  const ed12Path = 'engenharia-de-dados/12-outro.md';
  const ed12Ref = ref(ed12Path, '12.1');
  const ed12 = {...genericLesson, id: 'lesson:ed12', domain: 'engenharia-de-dados', sourceTopic: 'ed12', source: {path: ed12Path, sha256: 'c'.repeat(64)}, sources: [{path: ed12Path, sha256: 'c'.repeat(64)}], concepts: [{...genericLesson.concepts[0], sourceRef: ed12Ref}], questions: [{...genericLesson.questions[0], sourceRef: ed12Ref}]};
  for (const lesson of [genericLesson, ed12]) {
    const video = buildVideoLesson(lesson);
    const text = JSON.stringify(video);
    assert.doesNotMatch(text, /SCD|São Paulo|Recife|surrogate key|9999-12-31/i);
    assert.ok(video.scenes.every(scene => scene.sourceRef?.path));
    assert.equal(video.scenes.some(scene => ['diagram', 'comparison'].includes(scene.kind)), false);
    assert.equal(video.metadata.verificationStatus, 'unverified');
    assert.equal(video.metadata.profile, 'generic');
  }
});

test('perfil ED01-SCD é opt-in, exige conceito ancorado e marca diagrama ilustrativo', () => {
  assert.throws(() => buildVideoLesson(genericLesson, {profile: 'ed01-scd'}), /fonte canônica ED-01/);
  const video = buildVideoLesson(ed01Lesson, {profile: 'ed01-scd'});
  const diagram = video.scenes.find(scene => scene.kind === 'diagram');
  assert.deepEqual(video.scenes.map(scene => scene.kind), ['title', 'concept', 'diagram', 'comparison', 'question', 'pause', 'answer', 'pitfall', 'recap', 'sources']);
  assert.equal(diagram.props.illustrative, true);
  assert.equal(diagram.derivation, 'authored');
  assert.equal(diagram.sourceRef.anchor, '1.7');
  assert.ok(video.scenes.find(scene => scene.kind === 'comparison').props.rows.every(row => /Tipo [12]/.test(row.label)));
  assert.ok(video.authored.every(item => item.sourceRef.path === edSource.path));
  assert.ok(video.durationSeconds < 120);
  assert.equal(video.metadata.verificationStatus, 'unverified');
});

test('SRT e burn-in: cues monotônicos e cada linha <=42 caracteres, sem truncar texto', () => {
  const tail = 'última resposta: preservação histórica da cidade antiga?';
  const longAnswer = `${'palavra '.repeat(180)}${tail}`;
  const questionText = 'Um cliente muda de cidade em junho. Como garantir que as vendas de janeiro continuem associadas à cidade antiga?';
  const lesson = {...genericLesson, questions: [{...genericLesson.questions[0], question: questionText, answer: longAnswer}]};
  const video = buildVideoLesson(lesson, {wpm: 145});
  const srt = toSrt(video);
  const captionScenes = video.scenes.filter(scene => ['question', 'answer'].includes(scene.kind));
  const answerScene = captionScenes.find(scene => scene.kind === 'answer');
  const answerCues = answerScene.captionCues;
  assert.ok(answerCues.length > 2);
  const countGraphemes = value => [...new Intl.Segmenter('pt-BR', {granularity: 'grapheme'}).segment(value)].length;
  assert.ok(answerCues.every(cue => cue.lines.length <= 2 && cue.lines.every(line => countGraphemes(line) <= 42)));
  const stripWhitespace = value => [...value].filter(char => !/\s/u.test(char)).join('');
  const displayed = captionScenes.flatMap(scene => scene.captionCues.flatMap(cue => cue.lines)).join(' ');
  assert.equal(stripWhitespace(displayed), stripWhitespace(captionScenes.map(scene => scene.captionText).join(' ')));
  assert.ok(stripWhitespace(displayed).includes(stripWhitespace(questionText)));
  assert.ok(stripWhitespace(displayed).endsWith(stripWhitespace(tail)));
  let previous = 0;
  for (const cue of video.scenes.flatMap(scene => scene.captionCues)) {
    assert.ok(cue.startFrame >= previous);
    assert.ok(cue.endFrame > cue.startFrame);
    previous = cue.endFrame;
  }
  assert.match(srt, /Validação de modelos/);
  const srtText = srt.split(/\r?\n/).filter(line => line && !/^\d+$/.test(line) && !line.includes(' --> ')).join(' ');
  assert.equal(stripWhitespace(srtText), stripWhitespace(video.scenes.flatMap(scene => scene.captionCues.flatMap(cue => cue.lines)).join(' ')));
  assert.ok(stripWhitespace(srtText).includes(stripWhitespace('continuem associadas à cidade antiga?')));
  assert.ok(stripWhitespace(srtText).includes(stripWhitespace(tail)));
  const finalAnswerCue = answerCues.at(-1);
  assert.ok(srt.includes(finalAnswerCue.lines.join('\n')));
  const pathological = '\u{1F469}\u{1F3FD}\u200D\u{1F4BB}'.repeat(80) + ' depois curto fim';
  const pathVideo = buildVideoLesson({...genericLesson, questions: [{...genericLesson.questions[0], question: pathological, answer: pathological}]});
  for (const cue of pathVideo.scenes.flatMap(scene => scene.captionCues)) {
    assert.ok(cue.lines.length <= 2);
    assert.ok(cue.lines.every(line => countGraphemes(line) <= 42));
  }
  assert.equal(stripWhitespace(pathVideo.scenes.flatMap(scene => scene.captionCues.flatMap(cue => cue.lines)).join(' ')), stripWhitespace(pathVideo.scenes.map(scene => scene.captionText).join(' ')));
});

test('ED01 real: todo cue e todo SRT preservam captionText em no máximo duas linhas de 42 grafemas', async () => {
  const lessonUrl = new URL('../generated/lessons/engenharia-de-dados/01-modelagem-de-dados.json', import.meta.url);
  const lesson = JSON.parse(await readFile(lessonUrl, 'utf8'));
  const video = buildVideoLesson(lesson, {profile: 'ed01-scd', wpm: 160});
  const srt = toSrt(video);
  const segments = new Intl.Segmenter('pt-BR', {granularity: 'grapheme'});
  const count = value => [...segments.segment(value)].length;
  const compact = value => [...value].filter(char => !/\s/u.test(char)).join('');
  const cues = video.scenes.flatMap(scene => scene.captionCues);
  assert.ok(cues.length > 40);
  for (const cue of cues) {
    assert.ok(cue.lines.length >= 1 && cue.lines.length <= 2, `cue ${cue.startFrame}: ${cue.lines.length} linhas`);
    assert.ok(cue.lines.every(line => count(line) <= 42), `cue ${cue.startFrame} excede 42 grafemas`);
  }
  for (const scene of video.scenes) {
    const shown = scene.captionCues.flatMap(cue => cue.lines).join(' ');
    assert.equal(compact(shown), compact(scene.captionText), `texto exibido incompleto na cena ${scene.kind}`);
  }
  const srtText = srt.split(/\r?\n/).filter(line => line && !/^\d+$/.test(line) && !line.includes(' --> ')).join(' ');
  assert.equal(compact(srtText), compact(video.scenes.flatMap(scene => scene.captionCues.flatMap(cue => cue.lines)).join(' ')));
  assert.ok(srt.includes('continuem associadas à cidade antiga?'));
  const answer = video.scenes.find(scene => scene.kind === 'answer');
  assert.ok(compact(srt).includes(compact(answer.captionText.slice(-70))));
  const sources = video.scenes.filter(scene => scene.kind === 'sources').flatMap(scene => scene.props.sources);
  assert.equal(sources.filter(source => source.kind === 'external').length, 8);
  assert.ok(sources.filter(source => source.kind === 'internal').length >= 2);
});

test('external sources preservam URLs públicas/artigos e páginas com internal refs sem vazar tokens', () => {
  const externalSources = Array.from({length: 8}, (_, index) => ({title: `Fonte ${index + 1}`, url: index === 4
    ? 'https://learn.microsoft.com/sql/t-sql?view=sql-server-ver17&token=do-not-export#section'
    : `https://example.org/ref/${index}?token=do-not-export#section`, checkedAt: '2026-10-07', claimStatuses: ['NEEDS_SOURCE']}));
  const video = buildVideoLesson({...genericLesson, externalSources});
  assert.equal(video.externalSources.length, 8);
  assert.ok(video.externalSources.every(item => !item.url.includes('token=') && !item.url.includes('#') && item.checkedAt === '2026-10-07' && item.claimStatuses[0] === 'NEEDS_SOURCE'));
  assert.match(video.externalSources[4].url, /\?view=sql-server-ver17/);
  assert.equal(video.metadata.verificationStatus, 'unverified');
  const sourceScenes = video.scenes.filter(scene => scene.kind === 'sources');
  assert.ok(sourceScenes.length >= 4);
  assert.equal(sourceScenes.flatMap(scene => scene.props.sources).filter(item => item.kind === 'external').length, 8);
  assert.equal(sourceScenes.flatMap(scene => scene.props.sources).filter(item => item.kind === 'internal').length, 3);
  assert.ok(sourceScenes.every(scene => scene.durationSeconds >= 2 && scene.props.sources.length <= 2));
  assert.doesNotMatch(JSON.stringify(video), /do-not-export/);
});

test('duração varia com texto e options inválidas são rejeitadas', () => {
  const short = buildVideoLesson(genericLesson, {wpm: 220});
  const long = buildVideoLesson({...genericLesson, concepts: [{...genericLesson.concepts[0], plainText: 'texto '.repeat(220)}]}, {wpm: 120});
  assert.ok(long.durationInFrames > short.durationInFrames);
  assert.throws(() => buildVideoLesson(genericLesson, {wpm: 0}), /inválidos/);
  assert.throws(() => buildVideoLesson(genericLesson, {width: 640.5}), /inválidos/);
});

function wavFixture(seconds = 0.25) {
  const sampleRate = 8000, channels = 1, bits = 16, dataSize = Math.floor(sampleRate * seconds) * channels * bits / 8;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + dataSize, 4); wav.write('WAVE', 8);
  wav.write('fmt ', 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22); wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * bits / 8, 28); wav.writeUInt16LE(channels * bits / 8, 32);
  wav.writeUInt16LE(bits, 34); wav.write('data', 36); wav.writeUInt32LE(dataSize, 40);
  return wav;
}

test('smoke real MP4: WAV local vira trilha de áudio via staticFile e caminho remoto/UNC é barrado', {timeout: 240_000}, async () => {
  const tempRoot = process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'Temp', 'opencode') : os.tmpdir();
  const directory = await mkdtemp(path.join(tempRoot, 'studyforge-video-test-'));
  try {
    const audioFile = path.join(directory, 'fixture.wav');
    await writeFile(audioFile, wavFixture());
    const output = path.join(directory, 'smoke.mp4');
    const tinyLesson = {...genericLesson, concepts: [{...genericLesson.concepts[0], plainText: 'Fonte de áudio local.'}], questions: []};
    const result = await renderVideo(tinyLesson, output, {audioFile, width: 640, height: 360, fps: 10, wpm: 10_000});
    const mp4 = await readFile(output);
    assert.ok(result.bytes > 0);
    assert.ok(mp4.includes(Buffer.from('soun')), 'contêiner deve conter handler de áudio');
    assert.ok(result.video.durationSeconds >= 4);
    const timeline = await readFile(result.timelinePath, 'utf8');
    assert.doesNotMatch(timeline, new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    await assert.rejects(renderVideo(tinyLesson, path.join(directory, 'bad.mp4'), {audioFile: 'https://example.org/audio.wav'}), /URLs e caminhos UNC/);
    await assert.rejects(renderVideo(tinyLesson, path.join(directory, 'bad-unc.mp4'), {audioFile: '\\\\server\\share\\audio.wav'}), /URLs e caminhos UNC/);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});

test('instância reaproveita bundle entre aulas diferentes e falha não mascara props', {timeout: 240_000}, async () => {
  const tempRoot = process.platform === 'win32' ? path.join(os.homedir(), 'AppData', 'Local', 'Temp', 'opencode') : os.tmpdir();
  const directory = await mkdtemp(path.join(tempRoot, 'studyforge-video-cache-test-'));
  const bundleCache = new Map();
  try {
    const renderer = createVideoRenderer({bundleCache});
    const common = {width: 640, height: 360, fps: 10, wpm: 10_000};
    const first = await renderer({...genericLesson, title: 'Aula A'}, path.join(directory, 'a.mp4'), common);
    const second = await renderer({...genericLesson, title: 'Aula B'}, path.join(directory, 'b.mp4'), common);
    assert.equal(bundleCache.size, 1);
    assert.notEqual(first.video.title, second.video.title);
    assert.equal(first.serveUrl, second.serveUrl);
  } finally {
    await rm(directory, {recursive: true, force: true});
  }
});
