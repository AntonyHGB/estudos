import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, relative, resolve, isAbsolute } from 'node:path';
import { compileAll, REPO_ROOT, selectTopics } from './cli.mjs';
import { buildLesson, serialiseLesson } from './lesson/index.mjs';
import { renderFlashcards, renderHtml, renderAudioScript } from './renderers/index.mjs';
import { loadAuditForTopic, createAuditReport } from './audit/index.mjs';
import { atomicWrite, hash, hashFile, readJson } from './cache.mjs';

const cacheRoot = root => join(root, 'generated', '.cache', 'studyforge');
const slug = topic => basename(topic.source.path, '.md');
const artifact = (root, folder, topic, ext) => join(root, 'generated', folder, topic.domain, `${slug(topic)}.${ext}`);
const relativeKey = (root, path) => relative(root, path).replaceAll('\\', '/');

async function filesUnder(directory) {
  const files = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  for (const entry of entries) {
    if (['node_modules', 'out', 'generated', 'tests', 'records'].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (/\.(?:mjs|js|jsx|ts|tsx|css|json)$/i.test(entry.name) && !entry.name.endsWith('.test.mjs')) files.push(path);
  }
  return files;
}

async function filesUnderVideo(directory) {
  const files = [];
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (['node_modules', 'generated', 'tests', 'out', '.git'].includes(entry.name) || entry.name.toLowerCase().endsWith('.md')) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnderVideo(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function localFileDigest(value, label, { extension, absolute = false } = {}) {
  if (typeof value !== 'string' || /^(?:https?:|file:|ftp:|\\\\|\/\/)/i.test(value)) {
    throw new TypeError(`${label} deve ser arquivo local; URLs e caminhos UNC não são aceitos.`);
  }
  if (absolute && !isAbsolute(value)) throw new TypeError(`${label} deve ser um caminho absoluto local.`);
  if (extension && extname(value).toLowerCase() !== extension) throw new TypeError(`${label} precisa ter extensão ${extension}.`);
  const path = resolve(value);
  const info = await stat(path);
  if (!info.isFile()) throw new TypeError(`${label} precisa apontar para arquivo regular.`);
  const digest = await hashFile(path);
  return { path, digest, size: info.size, mtimeMs: info.mtimeMs };
}

export async function pipelineFingerprint(root, topic) {
  const paths = [
    ...['studyforge/parser.mjs', 'studyforge/model.mjs', 'studyforge/validate.mjs', 'studyforge/cli.mjs', 'studyforge/pipeline.mjs', 'studyforge/cache.mjs', 'package.json', 'package-lock.json'].map(file => join(root, file)),
    ...await filesUnder(join(root, 'studyforge', 'schemas')),
    ...await filesUnder(join(root, 'studyforge', 'lesson')),
    ...await filesUnder(join(root, 'studyforge', 'renderers')),
    ...await filesUnder(join(root, 'studyforge', 'audit')),
    ...await filesUnder(join(root, 'studyforge', 'print')),
    join(root, 'studyforge', 'print', 'package-lock.json'),
    join(root, 'studyforge', 'video', 'package-lock.json'),
    join(root, topic.domain, 'quiz.json'),
    join(root, 'studyforge', 'audit', 'records', topic.domain, `${slug(topic)}.audit.json`)
  ];
  const pairs = [];
  for (const path of [...new Set(paths)].sort()) pairs.push([relativeKey(root, path), await hashFile(path)]);
  pairs.push(
    ['markdown:sha256', topic.source.sha256],
    ['runtime', process.version],
    ['pipeline-cache-signature', 'studyforge-pipeline-cache-v2'],
    ['render-profile', JSON.stringify({ audioWpmDefault: 145, audioPauseSecondsDefault: 8 })]
  );
  return hash(JSON.stringify(pairs));
}

export async function videoRuntimeFingerprint(directory) {
  const files = await filesUnderVideo(directory);
  const entries = [];
  for (const file of files.sort()) entries.push([relative(directory, file).replaceAll('\\', '/'), await hashFile(file)]);
  return hash(JSON.stringify(entries));
}

export function videoInputFingerprint(config) {
  return hash(JSON.stringify({
    ...config,
    signature: 'renderVideo-v1'
  }));
}

export async function videoOutputsMatch(paths, expected, inputHash) {
  if (!expected || expected.inputHash !== inputHash) return false;
  const current = [];
  for (const path of paths) current.push(await hashFile(path));
  const prior = [expected.outputs?.mp4, expected.outputs?.captions, expected.outputs?.timeline];
  return current.every((digest, index) => digest && digest === prior[index]);
}

export function validateVideoCaptions(video, srtText) {
  const segmenter = new Intl.Segmenter('pt-BR', { granularity: 'grapheme' });
  if (!Number.isFinite(video?.fps) || video.fps <= 0) throw new Error('Timeline de vídeo tem fps inválido.');
  const expected = (video.scenes ?? []).flatMap(scene => scene.captionCues ?? []);
  const blocks = srtText.trim().split(/\r?\n\s*\r?\n/).filter(Boolean);
  if (blocks.length !== expected.length) throw new Error(`SRT contém ${blocks.length} cues; timeline contém ${expected.length}.`);
  let previousEndFrame = 0;
  for (const [index, block] of blocks.entries()) {
    const rows = block.split(/\r?\n/);
    const timestamp = rows[1]?.match(/^(\d{2,}):(\d{2}):(\d{2}),(\d{3}) --> (\d{2,}):(\d{2}):(\d{2}),(\d{3})$/);
    if (rows[0] !== String(index + 1) || !timestamp) {
      throw new Error(`SRT cue ${index + 1} tem sequência ou timestamp inválido.`);
    }
    const cue = expected[index];
    if (!Number.isInteger(cue.startFrame) || !Number.isInteger(cue.endFrame)
      || cue.startFrame < previousEndFrame || cue.endFrame <= cue.startFrame) {
      throw new Error(`Timeline cue ${index + 1} tem frames inválidos ou fora de ordem.`);
    }
    previousEndFrame = cue.endFrame;
    const toMilliseconds = (hours, minutes, seconds, millis) => (((Number(hours) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000) + Number(millis);
    const actualStart = toMilliseconds(...timestamp.slice(1, 5));
    const actualEnd = toMilliseconds(...timestamp.slice(5, 9));
    const expectedStart = Math.round(cue.startFrame / video.fps * 1000);
    const expectedEnd = Math.round(cue.endFrame / video.fps * 1000);
    if (actualEnd <= actualStart || actualStart !== expectedStart || actualEnd !== expectedEnd) {
      throw new Error(`SRT cue ${index + 1} timestamps não correspondem aos frames/fps da timeline.`);
    }
    const actualLines = rows.slice(2);
    const expectedLines = cue.lines;
    if (actualLines.length > 2 || actualLines.some(line => [...segmenter.segment(line)].length > 42)) {
      throw new Error(`SRT cue ${index + 1} excede 2 linhas de 42 grafemas.`);
    }
    if (actualLines.length !== expectedLines?.length || actualLines.some((line, lineIndex) => line !== expectedLines[lineIndex])) {
      throw new Error(`SRT cue ${index + 1} não corresponde integralmente às linhas da timeline.`);
    }
  }
  return { cues: blocks.length, maxLines: 2, maxGraphemes: 42 };
}

export function assertNoCriticalWarnings(warnings) {
  const critical = warnings.filter(warning => ['UNCLOSED_FENCE', 'UNCLASSIFIED_INTERVIEW'].includes(warning.code));
  if (critical.length) {
    throw new Error(`Build abortado por ${critical.length} aviso(s) crítico(s):\n${critical.map(warning => `${warning.source?.path ?? ''}:${warning.source?.span?.startLine ?? '?'} ${warning.code}: ${warning.message}`).join('\n')}`);
  }
  return warnings;
}

export async function writeCached(root, path, content, stage, inputHash) {
  const statePath = join(cacheRoot(root), `${stage}.json`);
  const state = await readJson(statePath) ?? {};
  const key = relativeKey(root, path);
  const expectedHash = hash(content);
  const actualHash = await hashFile(path);
  if (actualHash === expectedHash && state[key]?.contentHash === expectedHash && state[key]?.inputHash === inputHash) {
    console.log(`SKIP ${key}`);
    return 'SKIP';
  }
  await atomicWrite(path, content);
  state[key] = { inputHash, contentHash: expectedHash };
  await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`${actualHash ? 'changed' : 'generated'} ${key}`);
  return actualHash ? 'changed' : 'generated';
}

async function topicContexts(root, selector) {
  const compiled = await compileAll(root, { cache: true });
  console.log(`Cache parse: ${compiled.cacheStats.hits} hit(s), ${compiled.cacheStats.misses} miss(es).`);
  if (compiled.errors.length) {
    throw new Error(`Compilação falhou:\n${compiled.errors.map(error => `${error.source ?? ''} ${error.code}: ${error.message}`).join('\n')}`);
  }
  const topics = selectTopics(compiled.topics, selector);
  const selectedPaths = new Set(topics.map(topic => topic.source.path));
  const selectedWarnings = compiled.warnings.filter(warning => selectedPaths.has(warning.source?.path));
  assertNoCriticalWarnings(selectedWarnings);
  for (const warning of selectedWarnings) {
    console.warn(`⚠ ${warning.source?.path}:${warning.source?.span?.startLine ?? '?'} ${warning.code}: ${warning.message}${warning.excerpt ? ` — ${warning.excerpt}` : ''}`);
  }
  const contexts = [];
  for (const topic of topics) {
    const record = await loadAuditForTopic(root, topic);
    const report = createAuditReport(record, topic);
    const lesson = buildLesson(topic, report.json);
    contexts.push({ topic, record, report, lesson, inputHash: await pipelineFingerprint(root, topic) });
  }
  return contexts;
}

async function canonicalAndLesson(root, context) {
  const { topic, lesson, inputHash } = context;
  await writeCached(root, artifact(root, 'canonical', topic, 'json'), `${JSON.stringify(topic, null, 2)}\n`, 'canonical', inputHash);
  await writeCached(root, artifact(root, 'lessons', topic, 'json'), serialiseLesson(lesson), 'lesson', inputHash);
}

async function writeReport(root, context) {
  const { topic, report, inputHash } = context;
  await writeCached(root, artifact(root, 'reports', topic, 'audit.json'), `${JSON.stringify(report.json, null, 2)}\n`, 'report', inputHash);
  await writeCached(root, artifact(root, 'reports', topic, 'audit.md'), report.markdown, 'report', inputHash);
}

async function writeCards(root, context) {
  const { topic, lesson, inputHash } = context;
  await writeCached(root, artifact(root, 'flashcards', topic, 'json'), `${JSON.stringify(renderFlashcards(lesson), null, 2)}\n`, 'flashcards', inputHash);
}

async function writeHtml(root, context) {
  const { topic, lesson, inputHash } = context;
  const path = artifact(root, 'html', topic, 'html');
  const html = await renderHtml(lesson, { outputPath: path, repositoryRoot: root });
  await writeCached(root, path, html, 'html', inputHash);
}

async function writeAudio(root, context, { wpm = 145, pauseSeconds = 8 } = {}) {
  const { topic, lesson } = context;
  const audio = renderAudioScript(lesson, { wpm, pauseSeconds });
  const inputHash = hash(`${context.inputHash}:${JSON.stringify({ wpm, pauseSeconds })}`);
  const outputs = [
    [join(root, 'generated', 'audio-scripts', topic.domain, `${slug(topic)}.md`), audio.markdown],
    [join(root, 'generated', 'audio-scripts', topic.domain, `${slug(topic)}.cues.json`), `${JSON.stringify({ ...audio.metadata, cues: audio.cues }, null, 2)}\n`],
    [join(root, 'generated', 'captions', topic.domain, `${slug(topic)}.srt`), audio.captions]
  ];
  for (const [path, content] of outputs) await writeCached(root, path, content, 'audio', inputHash);
}

async function writePdf(root, context, options = {}) {
  const { topic, lesson } = context;
  const path = artifact(root, 'pdf', topic, 'pdf');
  const statePath = join(cacheRoot(root), 'pdf.json');
  const state = await readJson(statePath) ?? {};
  const key = relativeKey(root, path);
  const actualHash = await hashFile(path);
  const inputHash = hash(`${context.inputHash}:${JSON.stringify(options.print ?? {})}`);
  if (actualHash && state[key]?.inputHash === inputHash && state[key]?.contentHash === actualHash) {
    console.log(`SKIP ${key}`);
    return;
  }
  const { renderPdf } = await import('./print/index.mjs');
  const result = await renderPdf(lesson, path, { repositoryRoot: root });
  state[key] = { inputHash, contentHash: await hashFile(path), bytes: result.bytes };
  await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`generated ${key} (${result.bytes} bytes)`);
  void options;
}

function isEd01(topic) {
  return topic.domain === 'engenharia-de-dados'
    && topic.order === 1
    && topic.source.path === 'engenharia-de-dados/01-modelagem-de-dados.md';
}

async function videoInputs(root, options) {
  let audio = null;
  let browser = null;
  if (options.audioFile) audio = await localFileDigest(options.audioFile, 'audioFile', { extension: '.wav' });
  if (options.browserExecutable) browser = await localFileDigest(options.browserExecutable, 'browserExecutable', { absolute: true });
  return { audio, browser };
}

export async function writeVideo(root, context, options, renderer) {
  const { topic, lesson } = context;
  const ed01 = isEd01(topic);
  const profile = options.videoProfile ?? (ed01 ? 'ed01-scd' : 'generic');
  const wpm = options.videoWpm ?? (ed01 ? 160 : 145);
  const pauseSeconds = options.pauseSeconds ?? 8;
  if (!['generic', 'ed01-scd'].includes(profile)) throw new TypeError('videoProfile deve ser generic ou ed01-scd.');
  if (profile === 'ed01-scd' && !ed01) throw new TypeError('O perfil ed01-scd só pode ser usado no tópico ED/01.');
  if (!Number.isFinite(wpm) || wpm <= 0 || !Number.isFinite(pauseSeconds) || pauseSeconds < 0) {
    throw new RangeError('wpm deve ser positivo e pauseSeconds não negativo.');
  }

  const paths = {
    outputPath: artifact(root, 'video', topic, 'mp4'),
    captionsPath: join(root, 'generated', 'captions', topic.domain, `${slug(topic)}.video.srt`),
    timelinePath: join(root, 'generated', 'video', topic.domain, `${slug(topic)}.timeline.json`)
  };
  const { audio, browser } = await videoInputs(root, options);
  const videoCodeHash = await videoRuntimeFingerprint(join(root, 'studyforge', 'video'));
  const inputHash = videoInputFingerprint({
    pipeline: context.inputHash,
    videoRuntime: videoCodeHash,
    profile,
    wpm,
    pauseSeconds,
    width: options.width ?? 1920,
    height: options.height ?? 1080,
    fps: options.fps ?? 30,
    audioSha256: audio?.digest ?? null,
    browser: browser ? { path: browser.path, size: browser.size, mtimeMs: browser.mtimeMs } : null
  });

  const statePath = join(cacheRoot(root), 'video.json');
  const state = await readJson(statePath) ?? {};
  const key = relativeKey(root, paths.outputPath);
  const previous = state[key];
  const outputFiles = [paths.outputPath, paths.captionsPath, paths.timelinePath];
  if (await videoOutputsMatch(outputFiles, previous, inputHash)) {
    const currentHashes = [previous.outputs.mp4, previous.outputs.captions, previous.outputs.timeline];
    console.log(`SKIP ${key} (+ SRT/timeline verificados)`);
    return { skipped: true, inputHash, outputHashes: currentHashes };
  }

  let result;
  try {
    result = await renderer(lesson, paths.outputPath, {
      ...paths,
      profile,
      wpm,
      pauseSeconds,
      width: options.width ?? 1920,
      height: options.height ?? 1080,
      fps: options.fps ?? 30,
      audioFile: audio?.path,
      browserExecutable: browser?.path,
      captureFrames: false
    });
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
      throw new Error(`Dependências de vídeo ausentes. Instale no prefixo isolado com: npm run study:setup:video. ${error.message}`, { cause: error });
    }
    throw error;
  }
  if (resolve(result.output) !== resolve(paths.outputPath)
    || resolve(result.captionsPath) !== resolve(paths.captionsPath)
    || resolve(result.timelinePath) !== resolve(paths.timelinePath)) {
    throw new Error('Renderer de vídeo retornou destinos diferentes dos artefatos do pipeline.');
  }
  const captionValidation = validateVideoCaptions(result.video, await readFile(paths.captionsPath, 'utf8'));
  const outputStats = [];
  for (const path of outputFiles) {
    const info = await stat(path);
    if (!info.isFile() || info.size === 0) throw new Error(`Saída de vídeo ausente ou vazia: ${relativeKey(root, path)}`);
    outputStats.push({ sha256: await hashFile(path), bytes: info.size });
  }
  const [mp4, captions, timeline] = outputStats;
  state[key] = {
    inputHash,
    outputs: { mp4: mp4.sha256, captions: captions.sha256, timeline: timeline.sha256 },
    bytes: { mp4: mp4.bytes, captions: captions.bytes, timeline: timeline.bytes },
    profile,
    wpm,
    pauseSeconds,
    composition: { width: result.composition.width, height: result.composition.height, fps: result.composition.fps, durationInFrames: result.composition.durationInFrames },
    sourceHash: result.video.sourceHash,
    renderHash: result.video.renderHash,
    outputHash: result.video.outputHash,
    captions: captionValidation
  };
  await atomicWrite(statePath, `${JSON.stringify(state, null, 2)}\n`);
  console.log(`generated ${key} (${mp4.bytes} bytes; ${profile}, ${result.composition.width}x${result.composition.height}@${result.composition.fps})`);
  console.log(`generated ${relativeKey(root, paths.captionsPath)} (${captions.bytes} bytes; SRT estimado)`);
  console.log(`generated ${relativeKey(root, paths.timelinePath)} (${timeline.bytes} bytes)`);
  return { skipped: false, inputHash, outputHashes: outputStats.map(output => output.sha256), result };
}

export async function runInventory(root = REPO_ROOT, { json = false } = {}) {
  const compiled = await compileAll(root, { cache: true });
  const totals = Object.fromEntries([...new Set(compiled.topics.map(topic => topic.domain))].map(domain => {
    const topics = compiled.topics.filter(topic => topic.domain === domain);
    return [domain, {
      topics: topics.length,
      interviewQuestions: topics.reduce((count, topic) => count + topic.interviewQuestions.length, 0),
      quizQuestions: topics.reduce((count, topic) => count + topic.quizQuestions.length, 0)
    }];
  }));
  const result = {
    topics: compiled.topics.map(topic => ({ domain: topic.domain, order: topic.order, id: topic.id, title: topic.title, interviewQuestions: topic.interviewQuestions.length, quizQuestions: topic.quizQuestions.length })),
    totals,
    warnings: compiled.warnings,
    errors: compiled.errors
  };
  if (json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`StudyForge: ${compiled.topics.length} tópicos; ${compiled.warnings.length} avisos; ${compiled.errors.length} erros.`);
    for (const [domain, total] of Object.entries(totals)) console.log(`${domain}: ${total.topics} tópicos; ${total.interviewQuestions} abertas; ${total.quizQuestions} quiz.`);
    const grand = Object.values(totals).reduce((sum, total) => ({
      topics: sum.topics + total.topics,
      interviewQuestions: sum.interviewQuestions + total.interviewQuestions,
      quizQuestions: sum.quizQuestions + total.quizQuestions
    }), { topics: 0, interviewQuestions: 0, quizQuestions: 0 });
    console.log(`Total: ${grand.topics} tópicos; ${grand.interviewQuestions} abertas; ${grand.quizQuestions} quiz.`);
  }
  return compiled.errors.length ? 1 : 0;
}

export async function runVerify(root = REPO_ROOT, selector = '--all') {
  const contexts = await topicContexts(root, selector);
  let partial = 0;
  for (const context of contexts) {
    const { topic, record, report } = context;
    await writeReport(root, context);
    const bound = report.json.topicBinding.matches && report.json.validation.valid;
    const verified = report.json.claims.filter(claim => claim.status === 'VERIFIED').length;
    if (!record || !bound || !report.json.coverage.completeTopicReview || !verified) partial++;
    console.log(`${topic.source.path}: ${!record ? 'sem auditoria' : !bound ? 'auditoria inválida/stale' : `claims VERIFIED ${verified}; cobertura ${report.json.coverage.completeTopicReview ? 'completa' : 'parcial'}`}`);
  }
  return partial ? 2 : 0;
}

export async function runLesson(root = REPO_ROOT, selector = 'engenharia-de-dados/01') {
  for (const context of await topicContexts(root, selector)) await canonicalAndLesson(root, context);
  return 0;
}

export async function runFlashcards(root = REPO_ROOT, selector = 'engenharia-de-dados/01') {
  for (const context of await topicContexts(root, selector)) {
    await canonicalAndLesson(root, context);
    await writeCards(root, context);
  }
  return 0;
}

export async function runHtml(root = REPO_ROOT, selector = 'engenharia-de-dados/01') {
  for (const context of await topicContexts(root, selector)) {
    await canonicalAndLesson(root, context);
    await writeHtml(root, context);
  }
  return 0;
}

export async function runPdf(root = REPO_ROOT, selector = 'engenharia-de-dados/01', options = {}) {
  for (const context of await topicContexts(root, selector)) {
    await canonicalAndLesson(root, context);
    await writeHtml(root, context);
    await writePdf(root, context, options);
  }
  return 0;
}

export async function runVideo(root = REPO_ROOT, selector = 'engenharia-de-dados/01', options = {}) {
  const contexts = await topicContexts(root, selector);
  let renderer;
  try {
    const videoModule = await import('./video/render.mjs');
    renderer = videoModule.createVideoRenderer();
  } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
      throw new Error(`Dependências de vídeo ausentes. Instale no prefixo isolado com: npm run study:setup:video. ${error.message}`, { cause: error });
    }
    throw error;
  }
  for (const context of contexts) {
    await canonicalAndLesson(root, context);
    await writeVideo(root, context, options, renderer);
  }
  return 0;
}

export async function runAudio(root = REPO_ROOT, selector = 'engenharia-de-dados/01', options = {}) {
  for (const context of await topicContexts(root, selector)) {
    await canonicalAndLesson(root, context);
    await writeAudio(root, context, options);
  }
  return 0;
}

export async function runBuild(root = REPO_ROOT, selector = 'engenharia-de-dados/01', options = {}) {
  const contexts = await topicContexts(root, selector);
  let videoRenderer;
  if (options.video) {
    try {
      const videoModule = await import('./video/render.mjs');
      videoRenderer = videoModule.createVideoRenderer();
    } catch (error) {
      if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
        throw new Error(`Dependências de vídeo ausentes. Instale no prefixo isolado com: npm run study:setup:video. ${error.message}`, { cause: error });
      }
      throw error;
    }
  }
  for (const context of contexts) {
    await canonicalAndLesson(root, context);
    await writeReport(root, context);
    await writeCards(root, context);
    await writeHtml(root, context);
    await writeAudio(root, context, options);
    if (options.pdf) await writePdf(root, context, options);
    else console.log(`SKIP PDF ${context.topic.source.path}: opcional; use --pdf para habilitar.`);
    if (options.video) await writeVideo(root, context, options, videoRenderer);
    else console.log(`SKIP vídeo ${context.topic.source.path}: use --video para habilitar.`);
  }
  return 0;
}
