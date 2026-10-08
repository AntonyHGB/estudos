import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

export const AUDIT_STATUSES = Object.freeze(['VERIFIED', 'NEEDS_SOURCE', 'NEEDS_REVIEW', 'OUTDATED', 'CONFLICTING']);
export const SOURCE_TYPES = Object.freeze(['official-doc', 'spec', 'original-paper', 'vendor', 'canonical-book', 'secondary']);
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const stable = (value) => `${JSON.stringify(value, null, 2)}\n`;
const nonempty = (value) => typeof value === 'string' && Boolean(value.trim());
const isCalendarDate = (value) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
const isHttpsUrl = (value) => { try { return new URL(value).protocol === 'https:'; } catch { return false; } };

const schemaPath = fileURLToPath(new URL('../schemas/audit.schema.json', import.meta.url));
const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat('date', { type: 'string', validate: isCalendarDate });
ajv.addFormat('uri', { type: 'string', validate: (value) => { try { return Boolean(new URL(value).protocol); } catch { return false; } } });
const validateSchema = ajv.compile(schema);

function lineAt(text, offset) { return text.slice(0, offset).split(/\r\n|\r|\n/u).length; }

export function normalizeLineEndings(text) {
  const normalizedToRaw = [0];
  const rawToNormalized = new Array(text.length + 1);
  let normalized = '', raw = 0, offset = 0;
  rawToNormalized[0] = 0;
  while (raw < text.length) {
    const ch = text[raw];
    if (ch === '\r' && text[raw + 1] === '\n') {
      rawToNormalized[raw] = offset;
      rawToNormalized[raw + 1] = offset;
      normalized += '\n'; raw += 2; offset += 1;
      rawToNormalized[raw] = offset; normalizedToRaw[offset] = raw;
    } else if (ch === '\r') {
      rawToNormalized[raw] = offset;
      normalized += '\n'; raw += 1; offset += 1;
      rawToNormalized[raw] = offset; normalizedToRaw[offset] = raw;
    } else {
      rawToNormalized[raw] = offset;
      normalized += ch; raw += 1; offset += 1;
      rawToNormalized[raw] = offset; normalizedToRaw[offset] = raw;
    }
  }
  return { normalized, normalizedToRaw, rawToNormalized };
}

export function migrateAuditToLogicalSnapshot(record, topic) {
  if (!record || !topic?.source || typeof topic.rawMarkdown !== 'string' || record.schemaVersion !== 1 || !Array.isArray(record.claims)) throw new Error('Migração requer sidecar legado válido e tópico compilado.');
  const rawHash = sha256(topic.rawMarkdown);
  if (rawHash !== topic.source.sha256 || record.topic?.source?.path !== topic.source.path || record.topic?.source?.sha256 !== rawHash || record.topic?.id !== topic.id) throw new Error('Migração abortada: hash raw/topic legado não coincide exatamente; snapshot permanece intocado.');
  const { normalized, rawToNormalized } = normalizeLineEndings(topic.rawMarkdown);
  const claims = record.claims.map((claim, index) => {
    if (claim.source?.path !== topic.source.path || claim.source.sha256 !== rawHash || topic.rawMarkdown.slice(claim.source.span?.start, claim.source.span?.end) !== claim.assertion || topic.rawMarkdown.slice(claim.source.contextSpan?.start, claim.source.contextSpan?.end) !== claim.context || claim.text !== claim.context) throw new Error(`Migração abortada: assertion/contexto legado não coincide exatamente no claim ${index}.`);
    const { start, end } = claim.source.span;
    const contextStart = claim.source.contextSpan.start, contextEnd = claim.source.contextSpan.end;
    const section = topic.sections.find((item) => item.id === claim.source.sectionId && item.source.anchor === claim.source.anchor && item.source.span.start <= start && item.source.span.end >= end);
    if (!section) throw new Error(`Migração abortada: sectionId/anchor legado não coincide no claim ${claim.id}.`);
    return { ...claim, source: { ...claim.source, sha256: sha256(normalized), rawSha256: rawHash, span: { start: rawToNormalized[start], end: rawToNormalized[end], startLine: lineAt(normalized, rawToNormalized[start]), endLine: lineAt(normalized, rawToNormalized[end] - 1) }, contextSpan: { start: rawToNormalized[contextStart], end: rawToNormalized[contextEnd], startLine: lineAt(normalized, rawToNormalized[contextStart]), endLine: lineAt(normalized, rawToNormalized[contextEnd] - 1) } } };
  });
  return { ...record, normalization: { lineEndings: 'LF', algorithm: 'Somente CRLF e CR são convertidos para LF; nenhum outro caractere é transformado.' }, topic: { id: topic.id, source: { path: topic.source.path, sha256: sha256(normalized), rawSha256: rawHash } }, claims };
}

export function validateAudit(record, topic, options = {}) {
  const errors = [];
  const fail = (path, message) => errors.push({ path, message });
  if (!record || typeof record !== 'object' || Array.isArray(record)) return { valid: false, errors: [{ path: '', message: 'Registro deve ser objeto JSON.' }] };
  if (!validateSchema(record)) for (const error of validateSchema.errors ?? []) fail(error.instancePath || '/', `${error.keyword}: ${error.message}`);
  if (!topic || typeof topic !== 'object' || !topic.source || typeof topic.rawMarkdown !== 'string' || !Array.isArray(topic.sections)) return { valid: false, errors: [...errors, { path: '/topic', message: 'Tópico compilado inválido ou ausente.' }] };
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options))) fail('/options', 'Opções de validação devem ser um objeto.');
  const reviewDate = options && typeof options === 'object' ? options.reviewDate : undefined;
  const today = reviewDate === undefined ? null : (isCalendarDate(reviewDate) ? reviewDate : (fail('/reviewDate', 'reviewDate deve ser data ISO de calendário válida.'), null));
  if (today && isCalendarDate(record.reviewedAt) && record.reviewedAt > today) fail('/reviewedAt', 'Registro posterior a reviewDate injetada.');
  const rawHash = sha256(topic.rawMarkdown);
  const { normalized, normalizedToRaw } = normalizeLineEndings(topic.rawMarkdown);
  const logicalHash = sha256(normalized);
  if (rawHash !== topic.source.sha256) fail('/topic/source/sha256', 'Hash raw do tópico não corresponde ao SHA-256 declarado pelo parser.');
  if (record.topic?.source?.path !== topic.source.path) fail('/topic/source/path', 'O sidecar pertence a outro caminho de tópico.');
  if (record.topic?.id !== topic.id) fail('/topic/id', 'O sidecar pertence a outro id de tópico.');
  if (record.normalization?.lineEndings !== 'LF' || record.topic?.source?.sha256 !== logicalHash) fail('/topic/source/sha256', 'Hash lógico LF diferente; conteúdo textual/factual mudou desde o snapshot.');
  const ids = new Set();
  for (const [i, claim] of (Array.isArray(record.claims) ? record.claims : []).entries()) {
    const p = `/claims/${i}`;
    if (!claim || typeof claim !== 'object' || Array.isArray(claim)) continue;
    if (typeof claim.id === 'string') { if (ids.has(claim.id)) fail(`${p}/id`, 'ID de claim duplicado.'); ids.add(claim.id); }
    if (!AUDIT_STATUSES.includes(claim.status)) continue;
    if (claim.source?.path !== topic.source.path) fail(`${p}/source/path`, 'A fonte do claim não corresponde ao tópico carregado.');
    if (claim.source?.sha256 !== logicalHash || claim.source?.sha256 !== record.topic?.source?.sha256 || claim.source?.rawSha256 !== record.topic?.source?.rawSha256) fail(`${p}/source/sha256`, 'Hash lógico/raw do snapshot diverge: sidecar stale ou inconsistente.');
    const { start, end, startLine, endLine } = claim.source?.span ?? {};
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || normalized.slice(start, end) !== claim.assertion) fail(`${p}/source/span`, 'Span snapshot LF não reproduz exatamente a assertion literal.');
    if (Number.isInteger(start) && (lineAt(normalized, start) !== startLine || lineAt(normalized, end - 1) !== endLine)) fail(`${p}/source/span`, 'Linhas snapshot LF não correspondem aos offsets normalizados.');
    const contextSpan = claim.source?.contextSpan;
    if (!contextSpan || !Number.isInteger(contextSpan.start) || !Number.isInteger(contextSpan.end) || contextSpan.start < 0 || contextSpan.end < end || contextSpan.start > start || normalized.slice(contextSpan.start, contextSpan.end) !== claim.context || lineAt(normalized, contextSpan.start) !== contextSpan.startLine || lineAt(normalized, contextSpan.end - 1) !== contextSpan.endLine) fail(`${p}/source/contextSpan`, 'Span de contexto snapshot LF deve conter assertion e reproduzir offsets/linhas normalizados.');
    const rawStart = normalizedToRaw[start], rawEnd = normalizedToRaw[end];
    if (!topic.sections?.some((section) => section && section.source && section.source.span && section.id === claim.source?.sectionId && section.source.anchor === claim.source?.anchor && section.source.span.start <= rawStart && section.source.span.end >= rawEnd)) fail(`${p}/source`, 'sectionId/anchor não resolvem para seção que contém o span remapeado no tópico atual.');
    if (contextSpan && Number.isInteger(contextSpan.start) && Number.isInteger(contextSpan.end) && normalized.slice(contextSpan.start, contextSpan.end) !== claim.text) fail(`${p}/context`, 'Contexto não corresponde ao snapshot normalizado.');
    for (const [j, source] of (Array.isArray(claim.externalSources) ? claim.externalSources : []).entries()) {
      const sp = `${p}/externalSources/${j}`;
      if (!source || typeof source !== 'object' || Array.isArray(source)) { fail(sp, 'Fonte externa deve ser objeto.'); continue; }
      if (!SOURCE_TYPES.includes(source.type) || !isHttpsUrl(source.url) || !nonempty(source.title) || !isCalendarDate(source.checkedAt) || !nonempty(source.locator)) fail(sp, 'Fonte deve ter tipo, URL HTTPS válida, título, data-calendário válida e localizador.');
      if (today && isCalendarDate(source.checkedAt) && source.checkedAt > today) fail(`${sp}/checkedAt`, 'Data consultada posterior a reviewDate injetada.');
    }
    if (claim.status === 'VERIFIED') {
      const refs = Array.isArray(claim.externalSources) ? claim.externalSources : [];
      const evidenceOk = nonempty(claim.evidence?.excerpt) && nonempty(claim.evidence?.locator) && ['quote', 'paraphrase', 'calculation'].includes(claim.evidence?.excerptKind);
      const reviewOk = nonempty(claim.review?.method) && nonempty(claim.review?.responsibility) && isCalendarDate(claim.review?.checkedAt);
      if (!refs.length || !evidenceOk || !reviewOk) fail(p, 'VERIFIED exige fonte, evidência localizada, data, método e responsabilidade.');
      if (!nonempty(claim.verifiedScope) || typeof claim.assertion !== 'string' || !claim.assertion.includes(claim.verifiedScope)) fail(`${p}/verifiedScope`, 'VERIFIED deve limitar explicitamente o trecho sustentado da assertion.');
      if (today && isCalendarDate(claim.review?.checkedAt) && claim.review.checkedAt > today) fail(`${p}/review/checkedAt`, 'Revisão posterior a reviewDate injetada.');
      if (refs.some((source) => !source || !isCalendarDate(source.checkedAt) || (today && source.checkedAt > today))) fail(`${p}/externalSources`, 'Fonte verificada não consultada em data válida até reviewDate.');
    }
    if (!nonempty(claim.justification)) fail(`${p}/justification`, 'Justificativa obrigatória.');
    for (const [j, proposal] of (Array.isArray(claim.proposedChanges) ? claim.proposedChanges : []).entries()) {
      if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal) || !nonempty(proposal.original) || !nonempty(proposal.proposed) || !nonempty(proposal.reason) || !Array.isArray(proposal.sources) || !proposal.sources.length) fail(`${p}/proposedChanges/${j}`, 'Proposta exige original, proposto, motivo e fontes.');
    }
  }
  return { valid: errors.length === 0, errors };
}

export function createAuditReport(record, topic, options) {
  const validation = validateAudit(record, topic, options);
  const rawHash = topic?.rawMarkdown ? sha256(topic.rawMarkdown) : null;
  const { normalized, normalizedToRaw } = normalizeLineEndings(topic?.rawMarkdown ?? '');
  const logicalHash = sha256(normalized);
  const logicalSnapshotHashMatches = Boolean(topic?.rawMarkdown) && record?.normalization?.lineEndings === 'LF' && logicalHash === record?.topic?.source?.sha256;
  const isStale = !topic?.rawMarkdown || rawHash !== topic?.source?.sha256 || !logicalSnapshotHashMatches || record?.topic?.source?.path !== topic?.source?.path || record?.topic?.id !== topic?.id;
  const rawClaims = Array.isArray(record?.claims) ? record.claims : [];
  const claims = rawClaims.map((claim, index) => {
    const item = claim && typeof claim === 'object' && !Array.isArray(claim) ? claim : { id: `invalid-${index}`, statement: 'Registro de claim malformado.', assertion: '', justification: 'Claim nulo ou não é objeto JSON.', source: {} };
    const span = item.source?.span, contextSpan = item.source?.contextSpan;
    const rangesValid = Number.isInteger(span?.start) && Number.isInteger(span?.end) && span.start >= 0 && span.end > span.start && span.end <= normalized.length && Number.isInteger(contextSpan?.start) && Number.isInteger(contextSpan?.end) && contextSpan.start >= 0 && contextSpan.start <= span.start && contextSpan.end >= span.end && contextSpan.end <= normalized.length;
    const claimStale = isStale || (item.source?.sha256 && item.source.sha256 !== logicalHash) || (item.source?.path && item.source.path !== topic?.source?.path);
    const base = { ...item, status: claimStale ? 'OUTDATED' : (validation.valid ? item.status : 'NEEDS_REVIEW'), externalSources: validation.valid && !claimStale ? (Array.isArray(item.externalSources) ? item.externalSources : []) : [], reportNote: claimStale ? 'Snapshot histórico: hash lógico difere; referência não remapeada para o tópico atual.' : (!validation.valid ? 'Registro inválido; revisão necessária e nenhuma evidência foi propagada.' : undefined) };
    if (claimStale || !validation.valid || !rangesValid) return { ...base, status: claimStale ? 'OUTDATED' : 'NEEDS_REVIEW', source: { path: item.source?.path, logicalSha256: item.source?.sha256, rawSha256: item.source?.rawSha256, snapshotSpan: span, snapshotContextSpan: contextSpan, sectionId: item.source?.sectionId, anchor: item.source?.anchor, matchesCurrentTopic: false } };
    const start = normalizedToRaw[span.start], end = normalizedToRaw[span.end];
    const contextStart = normalizedToRaw[contextSpan.start], contextEnd = normalizedToRaw[contextSpan.end];
    return { ...base, source: { ...item.source, logicalSha256: item.source.sha256, sha256: topic.source.sha256, rawSha256: topic.source.sha256, snapshotSpan: span, snapshotContextSpan: contextSpan, span: { start, end, startLine: lineAt(topic.rawMarkdown, start), endLine: lineAt(topic.rawMarkdown, end - 1) }, contextSpan: { start: contextStart, end: contextEnd, startLine: lineAt(topic.rawMarkdown, contextStart), endLine: lineAt(topic.rawMarkdown, contextEnd - 1) }, matchesCurrentTopic: true } };
  });
  const sourceMap = new Map();
  for (const claim of validation.valid ? claims : []) for (const source of claim.externalSources ?? []) {
    const key = `${source.url}\0${source.checkedAt}`;
    const previous = sourceMap.get(key);
    sourceMap.set(key, { ...source, sourceHash: topic.source.sha256, logicalSnapshotHash: record.topic.source.sha256, logicalSnapshotHashMatches, claimIds: [...(previous?.claimIds ?? []), claim.id], verifiedClaimIds: [...(previous?.verifiedClaimIds ?? []), ...(claim.status === 'VERIFIED' ? [claim.id] : [])], claimStatuses: [...(previous?.claimStatuses ?? []), claim.status] });
  }
  const externalSources = [...sourceMap.values()].map((source) => ({ ...source, claimIds: [...new Set(source.claimIds)], verifiedClaimIds: [...new Set(source.verifiedClaimIds)], claimStatuses: [...new Set(source.claimStatuses)] }));
  const counts = Object.fromEntries(AUDIT_STATUSES.map((status) => [status, claims.filter((claim) => claim.status === status).length]));
  const coverage = validation.valid ? record.coverage : { completeTopicReview: false, scope: record ? 'Registro inválido ou snapshot stale; claims não são fatos verificados.' : 'Auditoria parcial; sidecar ausente. Nenhum claim factual foi verificado.' };
  const json = { schemaVersion: 1, topic: { id: topic.id, title: topic.title, source: topic.source }, topicBinding: { sidecarSource: record?.topic?.source ?? null, currentSource: topic.source, sourceHash: topic.source.sha256, logicalSnapshotHash: record?.topic?.source?.sha256 ?? null, logicalSnapshotHashMatches, matches: !isStale }, coverage: { ...coverage, completeTopicReview: false }, validation, counts, externalSources, claims };
  const esc = (value) => String(value ?? '').replace(/[\\`*_{}\[\]()#+.!<>|]/gu, '\\$&').replace(/&/gu, '&amp;').replace(/\r\n|\r|\n/gu, '\n');
  const code = (value) => String(value ?? '').replace(/`/gu, '\\`');
  const link = (source) => `[${esc(source.title)}](<${new URL(source.url).href.replace(/[<>]/gu, (char) => char === '<' ? '%3C' : '%3E')}>)`;
  const sourceSummary = (source) => `${link(source)} — ${esc(source.type)}, consultada ${esc(source.checkedAt)}${source.version ? `, versão ${esc(source.version)}` : ''}; localizador: ${esc(source.locator)}`;
  const renderClaim = (claim) => {
    const sourceRef = claim.source?.matchesCurrentTopic
      ? `Fonte atual: \`${code(claim.source.path)}\`, SHA-256 raw \`${code(claim.source.sha256)}\`, linhas ${claim.source.span.startLine}–${claim.source.span.endLine}, offsets ${claim.source.span.start}–${claim.source.span.end}, seção \`${code(claim.source.sectionId)}\`, anchor \`${code(claim.source.anchor)}\`.`
      : `Referência histórica do snapshot (não remapeada ao tópico atual): \`${code(claim.source?.path)}\`, hash lógico \`${code(claim.source?.logicalSha256)}\`, linhas ${claim.source?.snapshotSpan?.startLine ?? 'indisponíveis'}–${claim.source?.snapshotSpan?.endLine ?? 'indisponíveis'}, seção/anchor \`${code(claim.source?.sectionId)}\` / \`${code(claim.source?.anchor)}\`.`;
    const evidenceLabel = claim.status === 'OUTDATED' ? 'Evidência histórica do snapshot (não atualizada)' : (claim.source?.matchesCurrentTopic ? 'Evidência' : 'Evidência do snapshot (não propagada)');
    const evidence = claim.evidence ? `\n\n${evidenceLabel} (${esc(claim.evidence.excerptKind)}): ${esc(claim.evidence.excerpt)} — localizador: ${esc(claim.evidence.locator)}.` : '';
    const refs = Array.isArray(claim.externalSources) && claim.externalSources.length ? `\n\nFontes consultadas:\n${claim.externalSources.map((source) => `- ${sourceSummary(source)}`).join('\n')}` : '';
    const proposals = Array.isArray(claim.proposedChanges) && claim.proposedChanges.length ? `\n\nPropostas (não aplicadas automaticamente):\n${claim.proposedChanges.map((proposal) => `- Original: ${esc(proposal?.original)}\n  Proposto: ${esc(proposal?.proposed)}\n  Motivo: ${esc(proposal?.reason)}\n  Fontes: ${(Array.isArray(proposal?.sources) ? proposal.sources : []).map((url) => { try { return `[${esc(url)}](<${new URL(url).href}>)`; } catch { return esc(url); } }).join(', ')}`).join('\n')}` : '';
    return `## ${esc(claim.status)} — ${esc(claim.id)}\n\n${esc(claim.statement)}\n\nAssertion literal: ${esc(claim.assertion)}\n\n${esc(claim.justification)}\n\n${sourceRef}${claim.reportNote ? `\n\n${esc(claim.reportNote)}` : ''}${evidence}${refs}${proposals}`;
  };
  const registry = externalSources.length ? `## Registro deduplicado de fontes externas\n\n${externalSources.map((source) => `- ${sourceSummary(source)}; claims: ${source.claimIds.map(esc).join(', ')}; verified claims: ${source.verifiedClaimIds.map(esc).join(', ') || 'nenhum'}; sourceHash atual: \`${code(source.sourceHash)}\`; logicalSnapshotHashMatches: ${source.logicalSnapshotHashMatches}.`).join('\n')}` : '## Registro deduplicado de fontes externas\n\nNenhuma fonte externa propagada.';
  const errors = validation.errors.length ? `\n\n## Erros de validação\n\n${validation.errors.map((error) => `- ${esc(error.path)}: ${esc(error.message)}`).join('\n')}` : '';
  const md = [`# Relatório de auditoria — ${esc(topic.title)}`, '', `> ${esc(coverage.scope ?? 'Auditoria parcial.')}`, '> Cobertura factual parcial: claims selecionados não significam revisão completa do tópico. A validação estrutural não prova a verdade factual.', '', `Fonte original atual: \`${code(topic.source.path)}\`; SHA-256 raw: \`${code(topic.source.sha256)}\`; hash lógico LF do snapshot: \`${code(record?.topic?.source?.sha256)}\`; lógico corresponde: ${logicalSnapshotHashMatches}.`, '', `Claims: ${claims.length} — ${AUDIT_STATUSES.map((status) => `${status}: ${counts[status]}`).join(' · ')}.`, '', ...claims.map(renderClaim), '', registry, errors, ''].join('\n');
  return { json, markdown: md };
}

export async function loadAuditForTopic(root, topic) {
  const filename = `${basename(topic.source.path).replace(/\.md$/iu, '')}.audit.json`;
  const path = join(root, 'studyforge', 'audit', 'records', topic.domain, filename);
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

export async function writeReports(root, topic, record, options) {
  const report = createAuditReport(record, topic, options);
  const dir = join(root, 'generated', 'reports', topic.domain);
  const prefix = `${basename(topic.source.path).replace(/\.md$/iu, '')}.audit`;
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, `${prefix}.json`), stable(report.json), 'utf8');
  await writeFile(join(dir, `${prefix}.md`), report.markdown, 'utf8');
  return report;
}

export { sha256 as auditSha256 };
