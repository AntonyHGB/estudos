import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileAll } from '../cli.mjs';
import { loadAuditForTopic, writeReports } from './index.mjs';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const selector = process.argv[2] ?? 'engenharia-de-dados/01';
const compiled = await compileAll(root);
const [domain, rawOrder, ...extra] = selector.split('/');
const order = Number(rawOrder);
if (extra.length || !Number.isInteger(order)) throw new Error('Uso: node studyforge/audit/pilot.mjs dominio/NN');
const topic = compiled.topics.find((item) => item.domain === domain && item.order === order);
if (!topic) throw new Error(`Tópico não encontrado: ${selector}`);
const record = await loadAuditForTopic(root, topic);
const report = await writeReports(root, topic, record);
console.log(`topic=${selector}; sidecar=${record ? 'loaded' : 'missing'}; claims=${report.json.claims.length}; valid=${report.json.validation.valid}; verifiedSources=${report.json.externalSources.length}`);
