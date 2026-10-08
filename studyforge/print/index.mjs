import puppeteer from 'puppeteer';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderHtml } from '../renderers/index.mjs';

export async function renderPdf(lessonOrHtml, output, options = {}) {
  const html = typeof lessonOrHtml === 'string' ? lessonOrHtml : await renderHtml(lessonOrHtml, { outputPath: output, repositoryRoot: options.repositoryRoot });
  if (!html.startsWith('<!doctype html>')) throw new TypeError('Esperado HTML completo ou StudyLesson');
  let browser;
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run'] });
    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(options.timeout ?? 30000);
    const failed = [];
    page.on('requestfailed', req => failed.push(`${req.method()} ${req.url()}: ${req.failure()?.errorText ?? 'falha'}`));
    await page.setRequestInterception(true);
    page.on('request', request => {
      const url = request.url();
      if (url.startsWith('data:') || url.startsWith('about:') || url.startsWith('file:') || url === 'https://local.invalid/') request.continue();
      else request.abort('blockedbyclient');
    });
    await page.setContent(html, { waitUntil: 'load', timeout: options.timeout ?? 30000 });
    await page.evaluate(() => document.fonts.ready);
    if (failed.length) throw new Error(`Falha ao carregar recursos locais: ${failed.join('; ')}`);
    const bytes = await page.pdf({ path: output, format: 'A4', printBackground: true, preferCSSPageSize: true, waitForFonts: true, timeout: options.timeout ?? 30000 });
    return { output: path.resolve(output), bytes: bytes.length, browser: await browser.version() };
  } finally { if (browser) await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { compileAll } = await import('../cli.mjs');
  const { buildLesson } = await import('../lesson/index.mjs');
  const { createAuditReport } = await import('../audit/index.mjs');
  const { mkdir } = await import('node:fs/promises');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const { topics } = await compileAll(root);
  const topic = topics.find(t => t.source.path === 'engenharia-de-dados/01-modelagem-de-dados.md');
  if (!topic) throw new Error('ED01 não encontrado na raiz do repositório');
  const auditRecord = JSON.parse(await (await import('node:fs/promises')).readFile(path.join(root, 'studyforge', 'audit', 'records', 'engenharia-de-dados', '01-modelagem-de-dados.audit.json'), 'utf8'));
  const lesson = buildLesson(topic, createAuditReport(auditRecord, topic).json);
  const output = path.join(root,'generated','pdf','engenharia-de-dados','01-modelagem-de-dados.pdf');
  await mkdir(path.dirname(output),{recursive:true});
  const htmlPath = output.replace(/\.pdf$/i,'.html');
  await writeFile(htmlPath, await renderHtml(lesson, { outputPath: htmlPath, repositoryRoot: root }),'utf8');
  console.log(JSON.stringify(await renderPdf(lesson,output,{repositoryRoot:root}),null,2));
}
