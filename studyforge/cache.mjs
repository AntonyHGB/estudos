import { createHash } from 'node:crypto';
import { readFile, mkdir, rename, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

export const hash = value => createHash('sha256').update(value).digest('hex');
export async function hashFile(path) {
  try { return hash(await readFile(path)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export function safePath(root, path) {
  const base = resolve(root), target = resolve(base, path);
  if (target !== base && !target.startsWith(base + sep)) throw new Error(`Caminho fora da raiz: ${path}`);
  return target;
}
export async function atomicWrite(path, content) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  try { await import('node:fs/promises').then(fs => fs.writeFile(temp, content)); await rename(temp, path); }
  catch (error) { await rm(temp, { force: true }).catch(() => {}); throw error; }
}
export async function readJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return null; throw error; }
}

export async function loadParsedTopicCache({ cachePath, key, relativePath, markdown, markdownHash, parse, write = atomicWrite }) {
  let cached = null;
  try { cached = JSON.parse(await readFile(cachePath, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }

  const topic = cached?.topic;
  const validHit = cached?.key === key
    && topic && typeof topic === 'object' && !Array.isArray(topic)
    && topic.source?.path === relativePath
    && topic.source?.sha256 === markdownHash
    && topic.rawMarkdown === markdown
    && typeof topic.id === 'string' && topic.id.length > 0
    && Array.isArray(cached.warnings)
    && cached.warnings.every(warning => warning && typeof warning === 'object' && !Array.isArray(warning));

  if (validHit) return { topic, warnings: cached.warnings, hit: true };

  const parsed = parse();
  if (!parsed?.topic || parsed.topic.source?.path !== relativePath
    || parsed.topic.source?.sha256 !== markdownHash || parsed.topic.rawMarkdown !== markdown
    || !parsed.topic.id || !Array.isArray(parsed.warnings)) {
    throw new Error(`Parser produziu resultado sem binding íntegro para ${relativePath}`);
  }
  await write(cachePath, `${JSON.stringify({ key, topic: parsed.topic, warnings: parsed.warnings })}\n`);
  return { ...parsed, hit: false };
}
