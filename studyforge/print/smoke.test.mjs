import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { compileAll } from '../cli.mjs';
import { buildLesson } from '../lesson/index.mjs';
import { createAuditReport } from '../audit/index.mjs';
import { renderPdf } from './index.mjs';
import { renderHtml } from '../renderers/index.mjs';

test('PDF smoke gera documento real ED01 com oito fontes auditadas',async()=>{const {topics}=await compileAll();const t=topics.find(x=>x.source.path==='engenharia-de-dados/01-modelagem-de-dados.md');const root=fileURLToPath(new URL('../..',import.meta.url));const record=JSON.parse(await readFile(new URL('../audit/records/engenharia-de-dados/01-modelagem-de-dados.audit.json',import.meta.url),'utf8'));const lesson=buildLesson(t,createAuditReport(record,t).json);const file=fileURLToPath(new URL('../../generated/pdf/engenharia-de-dados/01-modelagem-de-dados.pdf',import.meta.url));const html=fileURLToPath(new URL('../../generated/pdf/engenharia-de-dados/01-modelagem-de-dados.html',import.meta.url));assert.equal(lesson.externalSources.length,8);await (await import('node:fs/promises')).writeFile(html,await renderHtml(lesson,{outputPath:html,repositoryRoot:root}),'utf8');const result=await renderPdf(lesson,file,{repositoryRoot:root});const bytes=await readFile(file);assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok((await stat(file)).size>10000);assert.ok(result.browser.includes('Chrome'));const htmlText=await readFile(html,'utf8');assert.match(htmlText,/<table>/);assert.match(htmlText,/href="\.\.\/\.\.\/\.\.\/engenharia-de-dados\/01-modelagem-de-dados\.md"/);assert.equal((htmlText.match(/class="sources"/g)??[]).length,2);assert.match(htmlText,/Cobertura parcial/);assert.match(htmlText,/https:\/\//);});
