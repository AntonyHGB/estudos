import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/core';
import sql from 'highlight.js/lib/languages/sql';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import path from 'node:path';
import { access } from 'node:fs/promises';

hljs.registerLanguage('sql', sql);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('json', json);
const md = new MarkdownIt({
  html: false,
  linkify: false,
  breaks: false,
  highlight(code, language) {
    if (language && hljs.getLanguage(language)) {
      try { return `<span class="hljs">${hljs.highlight(code, { language }).value}</span>`; } catch {}
    }
    return '';
  }
});
const defaultValidate = md.validateLink.bind(md);
md.validateLink = url => {
  try { const parsed = new URL(url, 'https://local.invalid'); return (parsed.protocol === 'https:' || parsed.origin === 'https://local.invalid') && defaultValidate(url); }
  catch { return false; }
};

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
export const renderMarkdown = value => md.render(String(value ?? ''));
export const inlineMarkdown = value => md.renderInline(String(value ?? ''));
export function plainMarkdown(value) {
  const lines = String(value ?? '').replace(/```([^\n]*)\n([\s\S]*?)```/g, (_, language, code) => `\nBloco de código${language ? ` ${language}` : ''}: ${code.trim()}\n`).split(/\r?\n/);
  const isTableRow = line => /^\s*\|.*\|\s*$/.test(line);
  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim());
  const output = [];
  for (let i = 0; i < lines.length;) {
    if (i + 1 < lines.length && isTableRow(lines[i]) && isTableRow(lines[i + 1]) && cells(lines[i + 1]).every(cell => /^:?-{3,}:?$/.test(cell))) {
      const headers = cells(lines[i]);
      i += 2;
      while (i < lines.length && isTableRow(lines[i])) {
        output.push(`Linha da tabela: ${cells(lines[i]).map((cell, index) => `${headers[index] || `Coluna ${index + 1}`}: ${cell}`).join('; ')}.`);
        i++;
      }
      continue;
    }
    output.push(lines[i++]);
  }
  return output.join(' ').replace(/`([^`]+)`/g, '$1').replace(/!?\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s{0,3}#{1,6}\s+/gm, '').replace(/^\s*[-*+]\s+/gm, 'Item: ').replace(/^\s*\d+[.)]\s+/gm, 'Item: ').replace(/\*\*|__|~~|\*/g, '').replace(/\s+/g, ' ').trim();
}

function sourceLabel(ref, heading = '') {
  if (ref.pointer) return `${ref.path} · SHA-256 ${ref.sha256} · ${heading ? `${heading} · ` : ''}JSON Pointer ${ref.pointer}`;
  const anchorLabel = ref.anchor && /^\d+(?:\.\d+)+$/.test(ref.anchor) ? `Seção ${ref.anchor}` : ref.anchor ? `Referência ${ref.anchor}` : '';
  return `${ref.path} · SHA-256 ${ref.sha256} · ${heading ? `${heading} · ` : anchorLabel ? `${anchorLabel} · ` : ''}linhas ${ref.span.startLine}–${ref.span.endLine}`;
}
function safeSourcePath(ref) {
  const value = ref.path;
  if (typeof value !== 'string' || value.includes('\\') || value.includes('\0')) throw new TypeError('Caminho de fonte inválido');
    if (/^https:\/\//i.test(value)) {
      const url = new URL(value);
      if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError('URL externa insegura');
      return { external: url.href };
    }
  if (/^[a-z][a-z\d+.-]*:/i.test(value) || path.posix.isAbsolute(value) || value.split('/').some(part => part === '..' || part === '.')) throw new TypeError('Caminho de fonte fora do repositório');
  return { relative: value };
}

export async function lessonDocument(lesson, { outputPath, repositoryRoot } = {}) {
  const link = async (ref, heading = '') => {
    const safe = safeSourcePath(ref);
    if (safe.external) return { href: safe.external, external: true, label: sourceLabel(ref, heading) };
    if (!outputPath || !repositoryRoot) return { href: null, external: false, label: sourceLabel(ref, heading) };
    const root = path.resolve(repositoryRoot);
    const target = path.resolve(root, ...safe.relative.split('/'));
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) throw new TypeError('Caminho de fonte fora do repositório');
    await access(target);
    const relative = path.relative(path.dirname(path.resolve(outputPath)), target).split(path.sep).map(encodeURIComponent).join('/');
    return { href: relative, external: false, label: sourceLabel(ref, heading) };
  };
  const refHtml = async (ref, heading = '') => { const item = await link(ref, heading); return item.href ? `<a href="${escapeHtml(item.href)}"${item.external ? ' rel="noopener noreferrer"' : ''}>${escapeHtml(item.label)}</a>` : escapeHtml(item.label); };
  const content = async (item, heading = '') => `<section>${heading ? `<h3>${escapeHtml(heading)}</h3>` : ''}${renderMarkdown(item.markdown)}<p class="source-ref">Fonte: ${await refHtml(item.sourceRef, heading || item.title || '')}</p></section>`;
  const out = [`<header><p class="eyebrow">${escapeHtml(lesson.domain)} · ${escapeHtml(lesson.difficulty)}</p><h1>${escapeHtml(lesson.title)}</h1><p>${escapeHtml(lesson.sourceTopic)}</p></header>`, '<nav aria-label="Conteúdo"><strong>Nesta lição</strong><ol><li><a href="#saber">O que você precisa saber</a></li><li><a href="#conceitos">Conceitos</a></li><li><a href="#exemplos">Exemplos</a></li><li><a href="#questoes">Questões comentadas</a></li><li><a href="#resumo">Resumo e fontes</a></li></ol></nav>', '<h2 id="saber">O que você precisa saber</h2>'];
  for (const [i,x] of lesson.objectives.entries()) out.push(await content(x, `Objetivo ${i+1}`));
  out.push('<h2 id="conceitos">Conceito e como funciona</h2>'); for (const x of lesson.concepts) out.push(await content(x,x.title));
  out.push('<h2 id="exemplos">Exemplos</h2>'); for (const x of lesson.examples) out.push(await content(x));
  out.push('<h2>Armadilhas</h2>'); for (const x of lesson.pitfalls) out.push(await content(x));
  out.push('<h2 id="questoes">Questões com resposta comentada</h2>'); for(const q of lesson.questions) out.push(`<article class="question"><h3>${escapeHtml(q.kind)} · ${escapeHtml(q.difficulty ?? 'nível não indicado')}</h3>${renderMarkdown(q.question)}<h4>Resposta</h4>${renderMarkdown(q.answer ?? 'Resposta não fornecida.')}${q.explanation ? `<h4>Comentário</h4>${renderMarkdown(q.explanation)}` : ''}${q.followUps.map(f=>`<h4>Continuação</h4>${renderMarkdown(f.question)}${f.answer ? renderMarkdown(f.answer) : ''}`).join('')}<p class="source-ref">Fonte: ${await refHtml(q.sourceRef)}</p></article>`);
  out.push('<h2 id="resumo">Resumo</h2>'); out.push(await content(lesson.summary)); for (const x of lesson.recap) out.push(await content(x));
  out.push('<h2>Fontes</h2><ul class="sources">'); for (const s of lesson.sources) out.push(`<li>${escapeHtml(s.path)} <code>SHA-256 ${escapeHtml(s.sha256)}</code></li>`); out.push('</ul>');
  const audit = lesson.audit ?? { bindingStatus: 'missing' };
  out.push(`<h2>Auditoria</h2><p>Vinculação: ${escapeHtml(audit.bindingStatus)}. ${audit.bindingStatus === 'bound' ? 'Cobertura parcial: fontes e claims auditadas não significam que toda a lição foi verificada.' : 'Não há cobertura integral verificada para esta lição.'}${audit.warning ? ` ${escapeHtml(audit.warning)}` : ''}</p>`);
  if (lesson.externalSources?.length) {
    out.push('<h3>Fontes externas consultadas</h3><ol class="sources">');
    for (const source of lesson.externalSources) {
      const url = new URL(source.url);
      if (url.protocol !== 'https:' || url.username || url.password) throw new TypeError('URL de fonte externa insegura');
      out.push(`<li><a href="${escapeHtml(url.href)}" rel="noopener noreferrer">${escapeHtml(source.title)}</a> — URL: <code>${escapeHtml(url.href)}</code>; consultada em ${escapeHtml(source.checkedAt)}; ${escapeHtml(source.locator)}${source.version ? `; versão ${escapeHtml(source.version)}` : ''}. <code>sourceHash ${escapeHtml(source.sourceHash)}</code>; snapshot vinculado: ${source.logicalSnapshotHashMatches ? 'sim' : 'não'}; claims: ${escapeHtml(source.claimIds.join(', ') || 'nenhuma')}; claims verificadas: ${escapeHtml(source.verifiedClaimIds.join(', ') || 'nenhuma')}; status: ${escapeHtml(source.claimStatuses.join(', ') || 'não informado')}.</li>`);
    }
    out.push('</ol>');
  }
  return out.join('\n');
}

export const lessonCss = `:root{font-family:Arial,"Noto Sans",sans-serif;color:#18232d;background:#fff;font-size:11pt;line-height:1.55}body{max-width:820px;margin:2rem auto;padding:0 1.4rem}h1{font-size:2.2rem}h2{margin-top:2rem;border-bottom:2px solid #315a70;padding-bottom:.3rem;break-after:avoid}h3,h4{break-after:avoid}nav,.question{border:1px solid #c8d4db;border-radius:8px;padding:1rem;margin:1rem 0}a{color:#075985;text-decoration:underline;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;background:#f3f6f8;padding:1rem;border-left:3px solid #567;break-inside:auto}code{font-family:Consolas,"Cascadia Mono",monospace;white-space:pre-wrap;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse;font-size:10pt}thead{display:table-header-group}tr{break-inside:avoid}th,td{border:1px solid #9eabb4;padding:.4rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}.source-ref{font-size:9pt;color:#435562}.eyebrow{color:#435562;text-transform:uppercase}.hljs{color:#1f2937}.hljs-keyword,.hljs-operator{color:#7c3aed}.hljs-string{color:#047857}.hljs-comment{color:#64748b}.hljs-number{color:#b45309}@page{size:A4;margin:18mm 17mm 20mm}@media print{body{max-width:none;margin:0;padding:0;font-size:10.5pt}nav{break-inside:avoid}a{color:#18232d;text-decoration:none}}`;
