import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { compileAll } from './cli.mjs';
import { parseTopic } from './parser.mjs';
import { createAuditReport, loadAuditForTopic, migrateAuditToLogicalSnapshot, normalizeLineEndings, validateAudit, writeReports } from './audit/index.mjs';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const compiled = await compileAll(root);
const topic = compiled.topics.find((item) => item.domain === 'engenharia-de-dados' && item.order === 1);
const topic2 = compiled.topics.find((item) => item.domain === 'engenharia-de-dados' && item.order === 2);
const sidecarPath = resolve(root, 'studyforge/audit/records/engenharia-de-dados/01-modelagem-de-dados.audit.json');
const sidecarBytes = await readFile(sidecarPath);
const record = JSON.parse(sidecarBytes);

test('Ajv2020 valida sidecar usando formats date/uri próprios e rejeita datas/URLs inválidas', async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat('date', { type: 'string', validate: (value) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value });
  ajv.addFormat('uri', { type: 'string', validate: (value) => { try { return Boolean(new URL(value).protocol); } catch { return false; } } });
  const schema = JSON.parse(await readFile(resolve(root, 'studyforge/schemas/audit.schema.json'), 'utf8'));
  const valid = ajv.compile(schema);
  assert.equal(valid(record), true);
  const bad = structuredClone(record); bad.reviewedAt = '2026-02-30';
  assert.equal(valid(bad), false);
  const badUrl = structuredClone(record); badUrl.claims[0].externalSources[0].url = 'https://';
  assert.equal(valid(badUrl), false);
});

test('registro original é válido, claims têm IDs únicos e scope de VERIFIED é explícito', () => {
  assert.deepEqual(validateAudit(record, topic), { valid: true, errors: [] });
  assert.equal(new Set(record.claims.map((claim) => claim.id)).size, record.claims.length);
  assert.ok(record.claims.filter((claim) => claim.status === 'VERIFIED').every((claim) => claim.verifiedScope));
});

test('snapshots LF aceitam o Markdown raw LF/CRLF equivalente e relatórios remapeiam spans ao tópico atual', () => {
  const logical = normalizeLineEndings(topic.rawMarkdown).normalized;
  const lfTopic = parseTopic(logical, topic.source.path).topic;
  const crlfTopic = parseTopic(logical.replace(/\n/gu, '\r\n'), topic.source.path).topic;
  const crTopic = parseTopic(logical.replace(/\n/gu, '\r'), topic.source.path).topic;
  assert.equal(validateAudit(record, lfTopic).valid, true);
  assert.equal(validateAudit(record, crlfTopic).valid, true);
  assert.equal(validateAudit(record, crTopic).valid, true);
  assert.equal(createAuditReport(record, lfTopic).json.topicBinding.logicalSnapshotHashMatches, true);
  const crlfReport = createAuditReport(record, crlfTopic);
  assert.equal(crlfReport.json.topicBinding.sourceHash, crlfTopic.source.sha256);
  assert.equal(crlfReport.json.topicBinding.logicalSnapshotHashMatches, true);
  assert.ok(crlfReport.json.externalSources.every((source) => source.sourceHash === crlfTopic.source.sha256 && source.logicalSnapshotHashMatches === true));
  for (const claim of crlfReport.json.claims) {
    assert.equal(crlfTopic.rawMarkdown.slice(claim.source.span.start, claim.source.span.end), claim.assertion);
    assert.equal(claim.source.sha256, crlfTopic.source.sha256);
    assert.equal(claim.source.logicalSha256, record.topic.source.sha256);
  }
  assert.deepEqual(crlfReport.json.counts, createAuditReport(record, lfTopic).json.counts);
  assert.deepEqual(crlfReport.json.externalSources.map((source) => source.claimIds), createAuditReport(record, lfTopic).json.externalSources.map((source) => source.claimIds));
  const crReport = createAuditReport(record, crTopic);
  assert.ok(crReport.json.claims.every((claim) => crTopic.rawMarkdown.slice(claim.source.span.start, claim.source.span.end) === claim.assertion));
});

test('mudança textual factual (não EOL) torna snapshot OUTDATED e bloqueia fontes/anchors stale', () => {
  const edited = topic.rawMarkdown.replace('Declarar o grão é a primeira coisa', 'Definir o grão é a primeira coisa');
  const changedTopic = parseTopic(edited, topic.source.path).topic;
  const report = createAuditReport(record, changedTopic);
  assert.equal(report.json.topicBinding.logicalSnapshotHashMatches, false);
  assert.ok(report.json.claims.every((claim) => claim.status === 'OUTDATED'));
  assert.deepEqual(report.json.externalSources, []);
  assert.ok(report.json.claims.every((claim) => claim.source.matchesCurrentTopic === false && claim.source.span === undefined));
});

test('migrador exige igualdade raw legada antes, converte somente EOL e preserva statuses/evidências/datas', () => {
  const logical = normalizeLineEndings(topic.rawMarkdown).normalized;
  const crlfRaw = logical.replace(/\n/gu, '\r\n');
  const crlfTopic = parseTopic(crlfRaw, topic.source.path).topic;
  const lfTopic = parseTopic(logical, topic.source.path).topic;
  const normalized = normalizeLineEndings(crlfRaw);
  const legacy = structuredClone(record);
  delete legacy.normalization;
  legacy.topic.source = { path: topic.source.path, sha256: crlfTopic.source.sha256 };
  for (const claim of legacy.claims) {
    for (const key of ['sha256', 'rawSha256']) delete claim.source[key];
    claim.source.sha256 = crlfTopic.source.sha256;
    for (const spanKey of ['span', 'contextSpan']) {
      const span = claim.source[spanKey];
      span.start = normalized.normalizedToRaw[span.start];
      span.end = normalized.normalizedToRaw[span.end];
      span.startLine = crlfRaw.slice(0, span.start).split(/\r\n|\r|\n/u).length;
      span.endLine = crlfRaw.slice(0, span.end - 1).split(/\r\n|\r|\n/u).length;
    }
  }
  assert.equal(validateAudit(legacy, lfTopic).valid, false, 'O sidecar raw-CRLF legado falha contra checkout LF antes da migração.');
  const migrated = migrateAuditToLogicalSnapshot(legacy, crlfTopic);
  assert.equal(migrated.topic.source.sha256, record.topic.source.sha256);
  assert.deepEqual(migrated.claims.map((claim) => claim.status), record.claims.map((claim) => claim.status));
  assert.deepEqual(migrated.claims.map((claim) => claim.evidence), record.claims.map((claim) => claim.evidence));
  assert.deepEqual(migrated.claims.map((claim) => claim.review), record.claims.map((claim) => claim.review));
  assert.deepEqual(migrated.claims.map((claim) => claim.source.span), record.claims.map((claim) => claim.source.span));
  assert.throws(() => migrateAuditToLogicalSnapshot(legacy, parseTopic(`${crlfRaw}!`, topic.source.path).topic), /Migração abortada/u);
});

test('datas futuras são opcionais e avaliadas somente com reviewDate injetada; datas inválidas/null são graciosas', () => {
  const copy = structuredClone(record);
  copy.claims[0].review.checkedAt = '2027-01-01';
  assert.equal(validateAudit(copy, topic).valid, true);
  assert.equal(validateAudit(copy, topic, { reviewDate: '2026-12-31' }).valid, false);
  assert.equal(validateAudit(copy, topic, { reviewDate: '2026-02-30' }).valid, false);
  assert.equal(validateAudit(null, topic).valid, false);
});

test('stale hash rebaixa claim e remove fontes externas propagáveis sem tocar sidecar', async () => {
  const changed = { ...topic, source: { ...topic.source, sha256: '0'.repeat(64) } };
  const report = createAuditReport(record, changed);
  assert.ok(report.json.claims.every((claim) => claim.status === 'OUTDATED' && claim.externalSources.length === 0));
  assert.deepEqual(report.json.externalSources, []);
  assert.match(report.markdown, /Evidência histórica do snapshot/u);
  assert.doesNotMatch(report.markdown, /Fontes consultadas:/u);
  assert.equal(validateAudit(record, changed).valid, false);
  const temp = await mkdtemp(join(tmpdir(), 'studyforge-stale-'));
  try { await writeReports(temp, changed, record); assert.deepEqual(await readFile(sidecarPath), sidecarBytes); }
  finally { await rm(temp, { recursive: true, force: true }); }
  assert.deepEqual(await readFile(sidecarPath), sidecarBytes);
});

test('report agrega fontes com binding claimIds; sidecar ausente gera cobertura parcial genérica sem fatos', async () => {
  assert.equal(validateAudit(record, topic).valid, true);
  const report = createAuditReport(record, topic);
  assert.ok(report.json.externalSources.length > 0);
  assert.ok(report.json.externalSources.every((source) => source.claimIds.length && source.claimIds.every((id) => record.claims.some((claim) => claim.id === id))));
  assert.ok(report.json.externalSources.some((source) => source.url.includes('qlik.com') && source.verifiedClaimIds.length === 0));
  assert.equal(report.json.topicBinding.matches, true);
  const missing = createAuditReport(null, topic2);
  assert.equal(missing.json.claims.length, 0);
  assert.deepEqual(missing.json.externalSources, []);
  assert.doesNotMatch(missing.json.coverage.scope, /ED01|24 tópicos/u);
});

test('report malformado não lança exceção, rebaixa claims a NEEDS_REVIEW e bloqueia fontes frescas', () => {
  const malformedRecords = [
    (copy) => { copy.claims[0].source.span = null; },
    (copy) => { copy.claims[0].source.contextSpan = 'bad-span'; },
    (copy) => { copy.claims[0].source.contextSpan = null; },
    (copy) => { copy.claims.push(null); },
    (copy) => { copy.claims[0].proposedChanges = [null]; },
    (copy) => { copy.claims[0].externalSources = [null]; },
  ];
  for (const mutate of malformedRecords) {
    const copy = structuredClone(record); mutate(copy);
    const report = createAuditReport(copy, topic);
    assert.equal(report.json.validation.valid, false);
    assert.deepEqual(report.json.externalSources, []);
    assert.ok(report.json.claims.every((claim) => claim.status === 'NEEDS_REVIEW'));
    assert.ok(report.json.claims.every((claim) => claim.externalSources.length === 0));
  }
});

test('Markdown mantém fontes, evidência, localização e proposta auditáveis com texto escapado', () => {
  const report = createAuditReport(record, topic);
  assert.match(report.markdown, /Fontes consultadas:/u);
  assert.match(report.markdown, /Evidence|Evidência \(paraphrase\)/u);
  assert.match(report.markdown, /Registro deduplicado de fontes externas/u);
  assert.match(report.markdown, /Original:.*sempre/u);
  assert.match(report.markdown, /Proposto:/u);
  assert.match(report.markdown, /Motivo:/u);
  assert.match(report.markdown, /kimballgroup\.com/u);
  const hostile = createAuditReport(record, { ...topic, title: '<script>alert(1)</script>' });
  assert.doesNotMatch(hostile.markdown, /<script>/u);
});

test('load/write usam basename geral e nomes JSON/MD sem mutar texto original', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'studyforge-audit-'));
  try {
    const fakeTopic = { ...topic2, source: { ...topic2.source, path: 'engenharia-de-dados/02-modelagem-x.md' } };
    const records = join(temp, 'studyforge', 'audit', 'records', fakeTopic.domain);
    await mkdir(records, { recursive: true });
    await writeFile(join(records, '02-modelagem-x.audit.json'), JSON.stringify({ schemaVersion: 1, topic: { id: fakeTopic.id, source: fakeTopic.source }, reviewedAt: '2026-10-07', coverage: { completeTopicReview: false, scope: 'Nenhuma afirmação selecionada.' }, sourceHierarchy: [], claims: [] }));
    assert.ok(await loadAuditForTopic(temp, fakeTopic));
    const before = fakeTopic.rawMarkdown;
    await writeReports(temp, fakeTopic, await loadAuditForTopic(temp, fakeTopic));
    assert.ok(await readFile(join(temp, 'generated', 'reports', fakeTopic.domain, '02-modelagem-x.audit.json')));
    assert.ok(await readFile(join(temp, 'generated', 'reports', fakeTopic.domain, '02-modelagem-x.audit.md')));
    assert.equal(fakeTopic.rawMarkdown, before);
  } finally { await rm(temp, { recursive: true, force: true }); }
});

test('proposta Data Vault aponta para texto literal e fonte; original não é alterado', () => {
  const proposalClaim = createAuditReport(record, topic).json.claims.find((claim) => claim.id === 'vault-always-presentation');
  assert.equal(proposalClaim.proposedChanges.length, 1);
  assert.equal(proposalClaim.proposedChanges[0].original, proposalClaim.context);
  assert.ok(proposalClaim.proposedChanges[0].sources[0].startsWith('https://'));
  assert.equal(topic.rawMarkdown.slice(proposalClaim.source.span.start, proposalClaim.source.span.end), proposalClaim.assertion);
});
