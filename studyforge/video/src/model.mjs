import { createHash } from 'node:crypto';
import { clean } from './text.mjs';

const sourceOf = item => item?.sourceRef ?? item?.source ?? null;
const textOf = item => clean(item?.plainText || item?.markdown || item?.question || item?.answer || '');
const words = text => clean(text).split(/\s+/).filter(Boolean).length;
const seconds = (text, wpm) => Math.max(2, words(text) * 60 / wpm);
const sameSource = (a, b) => a?.path === b?.path && a?.sha256 === b?.sha256;

function sourceRefsFor(lesson, selected) {
  const refs = [];
  for (const item of [...selected.map(sourceOf), ...(lesson.sources ?? [])]) {
    if (item?.path && item?.sha256 && !refs.some(ref => sameSource(ref, item)
      && (ref.anchor ?? ref.pointer) === (item.anchor ?? item.pointer))) refs.push(item);
  }
  return refs;
}

const graphemeSegmenter = new Intl.Segmenter('pt-BR', {granularity: 'grapheme'});
const graphemes = value => [...graphemeSegmenter.segment(value)].map(item => item.segment);

function captionGroups(text, maxChars = 42) {
  const tokens = clean(text).split(/\s+/u).filter(Boolean);
  const groups = [];
  let lines = [];
  let line = '';
  const flushLine = () => {
    if (line) lines.push(line);
    line = '';
    if (lines.length >= 2) {
      groups.push(lines);
      lines = [];
    }
  };
  const flushGroup = () => { flushLine(); if (lines.length) groups.push(lines); lines = []; };
  const appendGrapheme = (value) => {
    if (line && graphemes(`${line}${value}`).length > maxChars) flushLine();
    if (lines.length === 2) flushGroup();
    line += value;
  };

  for (const token of tokens) {
    const pieces = graphemes(token);
    if (pieces.length > maxChars) {
      flushLine();
      if (lines.length === 2) flushGroup();
      for (const piece of pieces) appendGrapheme(piece);
      flushLine();
      continue;
    }
    const joiner = line ? ' ' : '';
    if (graphemes(`${line}${joiner}${token}`).length <= maxChars) {
      line += `${joiner}${token}`;
    } else {
      flushLine();
      if (lines.length === 2) flushGroup();
      line = token;
    }
  }
  flushGroup();
  return groups;
}

function makeCues(text, startFrame, requestedDurationInFrames) {
  const groups = captionGroups(text);
  if (!groups.length) return {cues: [], durationInFrames: requestedDurationInFrames};
  const durationInFrames = Math.max(requestedDurationInFrames, groups.length);
  const weights = groups.map(lines => Math.max(1, words(lines.join(' '))));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  const distributable = durationInFrames - groups.length;
  const exact = weights.map(weight => distributable * weight / weightTotal);
  const lengths = exact.map(value => 1 + Math.floor(value));
  let remainder = durationInFrames - lengths.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({index, fraction: value - Math.floor(value)}))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let index = 0; index < remainder; index++) lengths[order[index].index]++;
  let cursor = startFrame;
  const cues = groups.map((lines, index) => {
    const cue = {startFrame: cursor, endFrame: cursor + lengths[index], text: lines.join('\n'), lines};
    cursor = cue.endFrame;
    return cue;
  });
  return {cues, durationInFrames};
}

function isEd01SCD(lesson) {
  if (lesson.domain !== 'engenharia-de-dados' || lesson.source?.path !== 'engenharia-de-dados/01-modelagem-de-dados.md') {
    throw new TypeError('Perfil ed01-scd só aceita a fonte canônica ED-01.');
  }
  const concept = lesson.concepts.find(item => /SCD|slowly changing dimension/i.test(item.title)
    && sameSource(sourceOf(item), lesson.source) && sourceOf(item)?.anchor === '1.7');
  if (!concept) throw new TypeError('Perfil ed01-scd exige conceito SCD ligado à fonte canônica ED-01.');
  return concept;
}

function textChunks(value, limit = 560) {
  const paragraphs = String(value ?? '').split(/\n\s*\n/).map(clean).filter(Boolean);
  const chunks = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= limit) { chunks.push(paragraph); continue; }
    let current = '';
    for (const word of paragraph.split(/\s+/)) {
      if (current && `${current} ${word}`.length > limit) { chunks.push(current); current = word; }
      else current = current ? `${current} ${word}` : word;
    }
    if (current) chunks.push(current);
  }
  return chunks;
}

function extractCode(concepts) {
  for (const concept of concepts) {
    const match = String(concept.markdown ?? '').match(/```([\w+-]*)\s*\r?\n([\s\S]*?)\r?\n```/);
    if (match && match[2].trim()) return {language: match[1] || 'text', code: match[2].trim(), sourceRef: sourceOf(concept)};
  }
  return null;
}

export function buildVideoLesson(lesson, {
  profile = 'generic', wpm = 145, pauseSeconds = 8, width = 1920, height = 1080, fps = 30,
} = {}) {
  if (!lesson || lesson.schemaVersion !== 1 || !lesson.source?.path || !lesson.source?.sha256
    || !Array.isArray(lesson.concepts) || !Array.isArray(lesson.questions)) {
    throw new TypeError('Esperado StudyLesson v1 com source, concepts e questions.');
  }
  if (!Number.isFinite(wpm) || wpm <= 0 || !Number.isFinite(pauseSeconds) || pauseSeconds < 1
    || !Number.isInteger(width) || width < 640 || !Number.isInteger(height) || height < 360
    || !Number.isInteger(fps) || fps < 1) throw new RangeError('wpm, pausa, resolução ou fps inválidos.');
  if (!['generic', 'ed01-scd'].includes(profile)) throw new TypeError(`Perfil de vídeo desconhecido: ${profile}`);

  const profileConcept = profile === 'ed01-scd' ? isEd01SCD(lesson) : null;
  const concepts = profileConcept ? [] : lesson.concepts.slice(0, 2);
  const sourceConcepts = profileConcept ? [profileConcept] : concepts;
  const profileExample = profileConcept && (lesson.examples ?? []).find(item => /SCD\s*Tipo\s*2/i.test(item.markdown ?? '')
    && sameSource(sourceOf(item), sourceOf(profileConcept)));
  const example = profileExample ?? (lesson.examples ?? []).find(item => item?.markdown || item?.plainText);
  const question = profileConcept
    ? lesson.questions.find(item => item?.question && (item.kind === 'scenario' || item.kind === 'application')
      && sameSource(sourceOf(item), sourceOf(profileConcept))
      && (sourceOf(item)?.anchor ?? sourceOf(item)?.pointer) === (sourceOf(profileConcept)?.anchor ?? sourceOf(profileConcept)?.pointer))
      ?? lesson.questions.find(item => item?.question && (item.kind === 'scenario' || item.kind === 'application') && /SCD|hist.r|cidade/i.test(item.question))
      ?? lesson.questions.find(item => item?.question)
    : lesson.questions.find(item => item?.question);
  const pitfall = profileConcept
    ? lesson.questions.find(item => item.kind === 'find-error') ?? (lesson.pitfalls ?? []).find(item => item?.markdown || item?.plainText)
    : (lesson.pitfalls ?? []).find(item => item?.markdown || item?.plainText);
  const selected = [...sourceConcepts, ...(example ? [example] : []), ...(question ? [question] : []), ...(pitfall ? [pitfall] : [])];
  const refs = sourceRefsFor(lesson, selected);
  const scenes = [];
  /** @type {(kind: string, props: object, ref: any, captionText: string, options?: {seconds?: number, derivation?: string}) => void} */
  const add = (kind, props, ref, captionText, {seconds: hold, derivation = 'extract'} = {}) => {
    if (!captionText) return;
    if (!ref?.path || !/^[a-f0-9]{64}$/i.test(ref.sha256 ?? '')) {
      throw new TypeError(`Cena ${kind} sem referência StudyLesson path/hash válida.`);
    }
    scenes.push({kind, props: {...props, domainLabel: `${lesson.domain ?? 'StudyForge'} · verificação ${lesson.verificationStatus ?? 'unverified'}`}, sourceRef: ref, derivation, captionText: clean(captionText), durationSeconds: hold ?? seconds(captionText, wpm)});
  };

  add('title', {title: lesson.title}, lesson.source, lesson.title, {seconds: 4});
  for (const concept of concepts) {
    const chunks = textChunks(textOf(concept));
    chunks.forEach((text, index) => add('concept', {title: chunks.length > 1 ? `${clean(concept.title)} · ${index + 1}/${chunks.length}` : clean(concept.title), text}, sourceOf(concept), text));
  }
  if (example) for (const text of textChunks(textOf(example))) add('concept', {title: 'Exemplo derivado da aula', text}, sourceOf(example), text);
  if (question) {
    const ref = sourceOf(question);
    const prompt = clean(question.question);
    for (const [index, text] of textChunks(prompt).entries()) add('question', {question: text, part: index + 1}, ref, text);
    add('pause', {seconds: pauseSeconds}, ref, 'Pausa para pensar.', {seconds: pauseSeconds, derivation: 'authored'});
    const response = clean(question.answer ?? question.explanation);
    for (const [index, text] of textChunks(response).entries()) add('answer', {answer: text, part: index + 1}, ref, text);
  }
  if (pitfall) {
    const pitfallText = clean(pitfall.kind === 'find-error' ? pitfall.answer ?? pitfall.explanation : textOf(pitfall));
    for (const text of textChunks(pitfallText)) add('pitfall', {text}, sourceOf(pitfall), text);
  }
  const recaps = profileConcept ? [] : (lesson.recap ?? []).slice(0, 2);
  for (const recap of recaps) for (const text of textChunks(textOf(recap))) add('recap', {items: [text]}, sourceOf(recap), text);
  if (profileConcept && question?.answer) {
    const recapText = clean(question.answer);
    add('recap', {items: [recapText], derivedFromAnswer: true}, sourceOf(question), recapText);
  }

  const code = extractCode(sourceConcepts);
  if (code) add('code', {title: `Trecho de código${code.language === 'text' ? '' : ` · ${code.language}`}`, code: code.code, language: code.language, highlightLine: 0, reveal: true}, code.sourceRef, code.code);

  const authored = [];
  if (profile === 'ed01-scd') {
    const ref = sourceOf(profileConcept);
    const labels = ['Antes', 'Mudança', 'Depois'];
    add('diagram', {title: 'Representação ilustrativa de versões', nodes: labels.map((label, index) => ({label, detail: ['atributo anterior', 'atributo alterado', 'atributo atual'][index]})), edges: [{from: 0, to: 1}, {from: 1, to: 2}], illustrative: true}, ref, 'Representação ilustrativa: versões e mudança.', {seconds: 7, derivation: 'authored'});
    authored.push({kind: 'diagram', sourceRef: ref, rationale: 'Diagrama estrutural ilustrativo; rótulos genéricos, sem instâncias de dados.'});
    const sourceParagraphs = String(profileConcept.markdown ?? '').split(/\r?\n\s*\r?\n/).map(clean);
    const rows = ['Tipo 1', 'Tipo 2'].map(label => {
      const paragraph = sourceParagraphs.find(value => new RegExp(`\\b${label}\\b`, 'i').test(value));
      if (!paragraph) return null;
      const sentences = paragraph.split(/(?<=[.!?])\s+/);
      const start = sentences.findIndex(sentence => new RegExp(`\\b${label}\\b`, 'i').test(sentence));
      return start < 0 ? null : {label, text: sentences.slice(start, start + 2).join(' ')};
    }).filter(Boolean);
    if (rows.length === 2) {
      const body = rows.map(row => `${row.label}: ${row.text}`).join(' ');
      add('comparison', {title: 'Trechos comparativos extraídos da seção', rows, excerpted: true}, ref, body, {derivation: 'extract'});
    }
  }

  const externalSources = Array.isArray(lesson.externalSources) ? lesson.externalSources : [];
  const safeExternalSources = externalSources.map(safeExternalRecord);
  const sourceEntries = [
    ...safeExternalSources.map(source => ({kind: 'external', ...source, host: hostOf(source.url)})),
    ...refs.map(ref => ({kind: 'internal', path: ref.path, sha256: ref.sha256, anchor: ref.anchor, pointer: ref.pointer, span: ref.span})),
  ];
  const sourcePages = [];
  for (let index = 0; index < sourceEntries.length; index += 2) sourcePages.push(sourceEntries.slice(index, index + 2));
  for (const [index, page] of sourcePages.entries()) {
    const sourceCaption = page.map(source => source.kind === 'external'
      ? `${source.title}, ${source.url ?? ''}, ${source.checkedAt ?? 'data não informada'}, ${(source.claimStatuses ?? []).join(', ')}${source.redactedQuery ? ', outros parâmetros removidos' : ''}`
      : `${source.path}, ${source.anchor ?? source.pointer ?? ''}, ${source.sha256.slice(0, 12)}`).join('. ');
    const readHold = Math.max(seconds(sourceCaption, wpm), sourceCaption.length / 18);
    add('sources', {sources: page, page: index + 1, pageCount: sourcePages.length}, lesson.source, sourceCaption, {seconds: readHold, derivation: 'extract'});
  }

  const sceneOrder = profile === 'ed01-scd'
    ? ['title', 'concept', 'code', 'diagram', 'comparison', 'question', 'pause', 'answer', 'pitfall', 'recap', 'sources']
    : ['title', 'concept', 'code', 'question', 'pause', 'answer', 'pitfall', 'recap', 'diagram', 'comparison', 'sources'];
  scenes.sort((a, b) => sceneOrder.indexOf(a.kind) - sceneOrder.indexOf(b.kind));

  let cursor = 0;
  for (const scene of scenes) {
    scene.startFrame = cursor;
    const timed = makeCues(scene.captionText, scene.startFrame, Math.max(1, Math.ceil(scene.durationSeconds * fps)));
    scene.durationInFrames = timed.durationInFrames;
    scene.endFrame = cursor + scene.durationInFrames;
    scene.captionCues = timed.cues;
    cursor = scene.endFrame;
  }
  const sourceHash = createHash('sha256').update(JSON.stringify({source: lesson.source, refs, externalSources: safeExternalSources})).digest('hex');
  const renderHash = createHash('sha256').update(JSON.stringify({sourceHash, profile, width, height, fps, wpm, pauseSeconds,
    scenes: scenes.map(({kind, props, sourceRef, derivation}) => ({kind, props, sourceRef, derivation}))})).digest('hex');
  return {
    id: `video:${lesson.id}`, title: lesson.title, domain: lesson.domain, width, height, fps,
    durationInFrames: cursor, durationSeconds: cursor / fps, scenes, sourceRefs: refs,
    externalSources: safeExternalSources, authored, sourceHash, renderHash,
    metadata: {profile, demoScope: profile === 'generic' ? 'selection of existing lesson content' : 'explicit ED01 SCD teaching profile',
      truncated: selected.length < (lesson.concepts.length + (lesson.examples?.length ?? 0) + lesson.questions.length + (lesson.pitfalls?.length ?? 0) + (lesson.recap?.length ?? 0)),
      verificationStatus: lesson.verificationStatus ?? 'unverified', wpm, pauseSeconds,
      captionTiming: 'estimated-proportional-to-cue-word-count-within-scene', audio: {included: false, durationSeconds: null, assetSha256: null}, domain: lesson.domain ?? null},
  };
}

function hostOf(url) { try { return url ? new URL(url).host : null; } catch { return null; } }

function safeExternalRecord(source) {
  const safe = safeExternalURL(source.url);
  return {title: source.title ?? source.name ?? null, ...safe,
    checkedAt: source.checkedAt ?? source.date ?? null,
    claimStatuses: source.claimStatuses ?? [source.claimStatus ?? source.status ?? 'pending']};
}

export function toSrt(video) {
  const timestamp = frame => {
    const millis = Math.round(frame / video.fps * 1000);
    const hours = Math.floor(millis / 3600000), minutes = Math.floor(millis % 3600000 / 60000);
    const seconds = Math.floor(millis % 60000 / 1000), fraction = millis % 1000;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(fraction).padStart(3, '0')}`;
  };
  const cues = video.scenes.flatMap(scene => scene.captionCues);
  return `${cues.map((cue, index) => `${index + 1}\n${timestamp(cue.startFrame)} --> ${timestamp(cue.endFrame)}\n${cue.lines.join('\n')}`).join('\n\n')}\n`;
}

export function retimeVideo(video, extraAudioSeconds = 0) {
  if (!Number.isFinite(extraAudioSeconds) || extraAudioSeconds < 0) throw new RangeError('Duração extra de áudio inválida.');
  let cursor = 0;
  const lastSourcesScene = video.scenes.findLast(scene => scene.kind === 'sources');
  for (const scene of video.scenes) {
    if (scene === lastSourcesScene) scene.durationSeconds += extraAudioSeconds;
    scene.startFrame = cursor;
    const timed = makeCues(scene.captionText, scene.startFrame, Math.max(1, Math.ceil(scene.durationSeconds * video.fps)));
    scene.durationInFrames = timed.durationInFrames;
    scene.endFrame = cursor + scene.durationInFrames;
    scene.captionCues = timed.cues;
    cursor = scene.endFrame;
  }
  video.durationInFrames = cursor;
  video.durationSeconds = cursor / video.fps;
  return video;
}

function safeExternalURL(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return {url: null, redactedQuery: false};
    const allowedKeys = new Set(['view', 'version', 'lang']);
    const kept = [];
    let redactedQuery = false;
    for (const [key, entry] of url.searchParams) {
      if (allowedKeys.has(key.toLowerCase()) && /^[a-z0-9_.-]+$/i.test(entry)) kept.push([key, entry]);
      else redactedQuery = true;
    }
    url.username = '';
    url.password = '';
    url.hash = '';
    url.search = '';
    for (const [key, entry] of kept) url.searchParams.append(key, entry);
    return {url: url.href, redactedQuery};
  } catch { return {url: null, redactedQuery: false}; }
}
