import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateLesson } from '../lesson/index.mjs';
import { escapeHtml, lessonCss, lessonDocument, plainMarkdown } from './markdown.mjs';

const PRIORITY = ['application', 'scenario', 'comparison', 'find-error', 'conceptual', 'recall'];
const normalise = text => plainMarkdown(text).toLocaleLowerCase('pt-BR').replace(/\s+/g, ' ').trim();
function assertLesson(lesson) {
  const result = validateLesson(lesson);
  if (!result.valid) throw new TypeError(`StudyLesson inválida: ${JSON.stringify(result.errors)}`);
}
function sourceLabel(ref) {
  if (ref.pointer) return `JSON Pointer ${ref.pointer}`;
  const anchor = ref.anchor && /^\d+(?:\.\d+)+$/.test(ref.anchor) ? `Seção ${ref.anchor}` : ref.anchor ? `Referência ${ref.anchor}` : '';
  return `${anchor ? `${anchor} · ` : ''}linhas ${ref.span.startLine}–${ref.span.endLine}`;
}
const questionEvidence = q => ({ ...q.sourceRef, label: sourceLabel(q.sourceRef) });
const topicEvidence = lesson => ({ ...lesson.source, label: 'Fonte principal' });
function externalEvidence(lesson) {
  return (lesson.externalSources ?? []).map(source => ({
    type: source.type, url: source.url, title: source.title, checkedAt: source.checkedAt,
    locator: source.locator, version: source.version, sourceHash: source.sourceHash,
    logicalSnapshotHash: source.logicalSnapshotHash,
    logicalSnapshotHashMatches: source.logicalSnapshotHashMatches,
    claimIds: [...source.claimIds], verifiedClaimIds: [...source.verifiedClaimIds],
    claimStatuses: [...source.claimStatuses]
  }));
}
function uniqueText(parts) {
  const seen = new Set();
  return parts.filter(Boolean).filter(text => {
    const key = normalise(text);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function lessonReferences(lesson) {
  const refs = [lesson.source, lesson.summary.sourceRef, ...lesson.objectives, ...lesson.concepts, ...lesson.examples, ...lesson.pitfalls, ...lesson.recap].map(item => item.sourceRef ?? item);
  for (const question of lesson.questions) refs.push(question.sourceRef, ...question.followUps.map(followUp => followUp.sourceRef));
  const seen = new Set();
  return refs.filter(ref => {
    const key = `${ref.path}|${ref.sha256}|${ref.pointer ?? `${ref.span?.start ?? ''}:${ref.span?.end ?? ''}`}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Renders every question; higher-value applications/scenarios appear first by default. */
export function renderFlashcards(lesson, { includeKinds } = {}) {
  assertLesson(lesson);
  const order = includeKinds ?? PRIORITY;
  return [...lesson.questions]
    .filter(question => order.includes(question.kind))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))
    .map(question => ({
      id: question.id,
      front: plainMarkdown(question.question),
      back: uniqueText([question.answer, question.explanation]).map(plainMarkdown).join('\n\n'),
      topic: lesson.title,
      difficulty: question.difficulty,
      tags: [lesson.domain, lesson.sourceTopic, question.kind, ...(question.difficulty ? [question.difficulty] : [])],
      source: questionEvidence(question),
      topicSource: topicEvidence(lesson),
      externalSources: externalEvidence(lesson),
      audit: lesson.audit ? structuredClone(lesson.audit) : { bindingStatus: 'missing' }
    }));
}

/**
 * Renderiza uma lesson. Para hrefs locais file://, passe outputPath (HTML de destino)
 * e repositoryRoot (raiz da cópia local do repositório); sem ambos, cita as fontes
 * como texto. Referências externas só geram links HTTPS.
 */
export async function renderHtml(lesson, options = {}) {
  assertLesson(lesson);
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(lesson.title)}</title><style>${lessonCss}</style></head><body>${await lessonDocument(lesson, options)}</body></html>`;
}

function audioSource(source) {
  if (source?.pointer) return { path: source.path, sha256: source.sha256, pointer: source.pointer };
  if (source?.span) return { path: source.path, sha256: source.sha256, span: { ...source.span }, anchor: source.anchor };
  return { path: source?.path, sha256: source?.sha256 };
}
function wrapCaption(text, limit = 42) {
  const lines = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if (line && `${line} ${word}`.length > limit) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  const chunks = [];
  for (let i = 0; i < lines.length; i += 2) chunks.push(lines.slice(i, i + 2).join('\n'));
  return chunks.length ? chunks : [''];
}

/** Durations/captions are estimates; no TTS or speech alignment is performed. */
export function renderAudioScript(lesson, { wpm = 145, pauseSeconds = 8 } = {}) {
  assertLesson(lesson);
  if (!Number.isFinite(wpm) || wpm <= 0) throw new RangeError('wpm precisa ser positivo');
  if (!Number.isFinite(pauseSeconds) || pauseSeconds < 0) throw new RangeError('pauseSeconds precisa ser não negativo');
  const cues = [];
  const add = (kind, text, source, { spoken = true, durationSeconds } = {}) => {
    const clean = plainMarkdown(text);
    if (!clean) return;
    const startSeconds = cues.length ? cues.at(-1).endSeconds : 0;
    const estimatedSeconds = durationSeconds ?? Math.max(1, Math.ceil(clean.split(/\s+/).length * 60 / wpm));
    cues.push({ index: cues.length + 1, kind, text: clean, spoken, source: audioSource(source), startSeconds, endSeconds: startSeconds + estimatedSeconds, estimatedSeconds });
  };
  add('intro', lesson.title, lesson.source);
  add('summary', lesson.summary.markdown, lesson.summary.sourceRef);
  for (const concept of lesson.concepts) add('concept', `${concept.title}. ${concept.markdown}`, concept.sourceRef);
  for (const example of lesson.examples) add('example', example.markdown, example.sourceRef);
  for (const question of lesson.questions) {
    add('prompt', question.question, question.sourceRef);
    add('pause', '[pausa para pensar]', question.sourceRef, { spoken: false, durationSeconds: pauseSeconds });
    for (const answerPart of uniqueText([question.answer, question.explanation])) add(answerPart === normalise(question.answer) ? 'answer' : 'commentary', answerPart, question.sourceRef);
    for (const followUp of question.followUps) {
      add('prompt', followUp.question, followUp.sourceRef);
      add('pause', '[pausa para pensar]', followUp.sourceRef, { spoken: false, durationSeconds: pauseSeconds });
      if (followUp.answer) add('answer', followUp.answer, followUp.sourceRef);
    }
  }
  for (const pitfall of lesson.pitfalls) add('pitfall', pitfall.markdown, pitfall.sourceRef);
  for (const recap of lesson.recap) add('recap', recap.markdown, recap.sourceRef);

  const captionRows = [];
  const toMs = seconds => Math.round(seconds * 1000);
  const format = milliseconds => {
    const ms = milliseconds % 1000;
    const totalSeconds = Math.floor(milliseconds / 1000);
    return `${String(Math.floor(totalSeconds / 3600)).padStart(2, '0')}:${String(Math.floor(totalSeconds % 3600 / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
  };
  for (const cue of cues) {
    const chunks = wrapCaption(cue.text);
    const startMs = toMs(cue.startSeconds);
    const endMs = toMs(cue.endSeconds);
    const durationMs = endMs - startMs;
    chunks.forEach((text, index) => {
      const start = startMs + Math.floor(durationMs * index / chunks.length);
      const end = startMs + Math.floor(durationMs * (index + 1) / chunks.length);
      if (end > start) captionRows.push(`${captionRows.length + 1}\n${format(start)} --> ${format(end)}\n${text}`);
    });
  }
  const captions = `${captionRows.join('\n\n')}\n`;
  const durationSeconds = cues.reduce((total, cue) => total + cue.estimatedSeconds, 0);
  const metadata = {
    estimated: true,
    timingNote: 'Estimativas por texto/WPM; não representam sincronização com voz ou TTS.',
    wpm, pauseSeconds, durationSeconds,
    source: topicEvidence(lesson),
    audit: lesson.audit ? structuredClone(lesson.audit) : { bindingStatus: 'missing' },
    externalSources: externalEvidence(lesson)
  };
  const referenceLines = [
    ...lessonReferences(lesson).map(ref => `- ${ref.path} (SHA-256 ${ref.sha256}${ref.span ? `; linhas ${ref.span.startLine}–${ref.span.endLine}${ref.anchor ? `; referência ${ref.anchor}` : ''}` : ref.pointer ? `; JSON Pointer ${ref.pointer}` : ''})`),
    ...metadata.externalSources.map(source => `- ${source.title}; ${source.url}; consultada em ${source.checkedAt}; ${source.locator}; sourceHash ${source.sourceHash}; claims: ${source.claimIds.join(', ') || 'nenhuma'}; claims verificadas: ${source.verifiedClaimIds.join(', ') || 'nenhuma'}; status: ${source.claimStatuses.join(', ') || 'não informado'}`),
    `Auditoria: ${metadata.audit.bindingStatus}; cobertura parcial${metadata.audit.coverage ? ` (${JSON.stringify(metadata.audit.coverage)})` : ''}${metadata.audit.warning ? ` — ${metadata.audit.warning}` : ''}`
  ];
  const markdown = `# Roteiro de áudio — ${lesson.title}\n\n> Duração e legendas estimadas a ${wpm} palavras/minuto; pausas silenciosas de ${pauseSeconds}s; não são timestamps de TTS.\n\n${cues.map(cue => `## ${cue.kind}\n\n${cue.text}\n\n_Fonte: ${cue.source.path}${cue.source.span ? `, linhas ${cue.source.span.startLine}–${cue.source.span.endLine}` : cue.source.pointer ? `, JSON Pointer ${cue.source.pointer}` : ''}; estimativa: ${cue.estimatedSeconds}s._`).join('\n\n')}\n\n## Fontes e auditoria\n\n${referenceLines.join('\n')}`;
  return { markdown, cues, captions, estimatedDurationSeconds: durationSeconds, durationSeconds, wpm, pauseSeconds, metadata };
}

export async function writeAudioArtifacts(lesson, directory, options = {}) {
  const audio = renderAudioScript(lesson, options);
  await mkdir(directory, { recursive: true });
  await Promise.all([
    writeFile(path.join(directory, 'audio-script.md'), audio.markdown, 'utf8'),
    writeFile(path.join(directory, 'audio-cues.json'), `${JSON.stringify({ ...audio.metadata, cues: audio.cues }, null, 2)}\n`, 'utf8'),
    writeFile(path.join(directory, 'audio-captions.srt'), audio.captions, 'utf8')
  ]);
  return audio;
}
