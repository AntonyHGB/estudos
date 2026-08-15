// build-site.mjs — gera um site auto-contido (index.html) para cada pasta de estudos.
// Uso: node build-site.mjs
// Lê os arquivos .md de cada pasta (+ quiz.json, se existir), converte para HTML e embute
// tudo num único index.html com: área de Estudo, área de Questões abertas (respostas
// ocultas) e área de Quiz de múltipla escolha, com progresso salvo em localStorage.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const SITES = [
  {
    folder: 'engenharia-de-dados',
    title: 'Engenharia de Dados',
    emoji: '🛠️',
    accent: '#0e7490',
    accentDark: '#22d3ee',
  },
  {
    folder: 'machine-learning',
    title: 'Machine Learning',
    emoji: '🧠',
    accent: '#7c3aed',
    accentDark: '#c4b5fd',
  },
];

/* ---------------------------------- markdown → HTML ---------------------------------- */

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function inline(md, linkMap) {
  let s = escapeHtml(md);
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, text, href) => {
    const mdMatch = href.match(/^([0-9]{2}-[^)#]*\.md)/);
    if (mdMatch && linkMap && linkMap[mdMatch[1]]) {
      return `<a href="#" class="topic-link" data-topic="${linkMap[mdMatch[1]]}">${text}</a>`;
    }
    if (href.endsWith('.md')) return `<span class="ref">${text}</span>`;
    return `<a href="${href}" target="_blank" rel="noopener">${text}</a>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[\s(>—·])\*([^*\n]+)\*(?=[\s.,;:)!?»\u2014]|$)/g, '$1<em>$2</em>');
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
  return s;
}

function mdToHtml(md, linkMap) {
  const lines = md.split('\n');
  const out = [];
  let i = 0;

  const isTableSep = (l) => /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(l) && l.includes('-');

  while (i < lines.length) {
    const line = lines[i];

    if (/^\s*$/.test(line)) { i++; continue; }

    if (/^```/.test(line)) {
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push(`<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const text = h[2].trim();
      const id = 'h-' + text.toLowerCase().replace(/[^a-z0-9à-ú]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      out.push(`<h${lvl} id="${id}">${inline(text, linkMap)}</h${lvl}>`);
      i++;
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

    if (line.trim().startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const header = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) {
        rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
        i++;
      }
      let t = '<div class="table-wrap"><table><thead><tr>';
      t += header.map((c) => `<th>${inline(c, linkMap)}</th>`).join('');
      t += '</tr></thead><tbody>';
      for (const r of rows) t += '<tr>' + r.map((c) => `<td>${inline(c, linkMap)}</td>`).join('') + '</tr>';
      t += '</tbody></table></div>';
      out.push(t);
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'), linkMap)}</blockquote>`);
      continue;
    }

    const listStart = line.match(/^(\s*)([-*]|\d+\.)\s+/);
    if (listStart) {
      const ordered = /^\d+\./.test(listStart[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
        if (m) {
          items.push({ indent: m[1].length, text: m[3] });
          i++;
          while (
            i < lines.length &&
            /^\s+\S/.test(lines[i]) &&
            !lines[i].match(/^(\s*)([-*]|\d+\.)\s+/) &&
            !/^\s*$/.test(lines[i])
          ) {
            items[items.length - 1].text += ' ' + lines[i].trim();
            i++;
          }
        } else if (/^\s*$/.test(lines[i]) && i + 1 < lines.length && lines[i + 1].match(/^(\s*)([-*]|\d+\.)\s+/)) {
          i++;
        } else break;
      }
      const tag = ordered ? 'ol' : 'ul';
      let html = `<${tag}>`;
      let k = 0;
      while (k < items.length) {
        const it = items[k];
        const cb = it.text.match(/^\[( |x)\]\s+(.*)$/);
        const body = cb ? `<span class="cb">${cb[1] === 'x' ? '☑' : '☐'}</span> ${inline(cb[2], linkMap)}` : inline(it.text, linkMap);
        const subs = [];
        let j = k + 1;
        while (j < items.length && items[j].indent > it.indent + 1) { subs.push(items[j]); j++; }
        if (subs.length) {
          html += `<li>${body}<ul>` + subs.map((s) => `<li>${inline(s.text, linkMap)}</li>`).join('') + '</ul></li>';
          k = j;
        } else {
          html += `<li>${body}</li>`;
          k++;
        }
      }
      html += `</${tag}>`;
      out.push(html);
      continue;
    }

    const buf = [line];
    i++;
    while (
      i < lines.length &&
      !/^\s*$/.test(lines[i]) &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*(---+)\s*$/.test(lines[i]) &&
      !lines[i].match(/^(\s*)([-*]|\d+\.)\s+/) &&
      !(lines[i].trim().startsWith('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i++;
    }
    out.push(`<p>${inline(buf.join(' '), linkMap)}</p>`);
  }
  return out.join('\n');
}

/* ---------------------------------- parsing dos tópicos ---------------------------------- */

function splitH2Sections(md) {
  const lines = md.split('\n');
  const sections = [];
  let current = null;
  const pre = [];
  let inCode = false;
  for (const line of lines) {
    if (/^```/.test(line)) inCode = !inCode;
    const m = !inCode && line.match(/^##\s+(.*)$/);
    if (m) {
      if (current) sections.push(current);
      current = { title: m[1].trim(), body: [] };
    } else if (current) current.body.push(line);
    else pre.push(line);
  }
  if (current) sections.push(current);
  return { pre: pre.join('\n'), sections: sections.map((s) => ({ title: s.title, body: s.body.join('\n') })) };
}

const LEVEL_RE = /(🟢|🟡|🔴)/;
const LEVEL_NAME = { '🟢': 'basico', '🟡': 'intermediario', '🔴': 'avancado' };

function isQuestionSection(title) {
  return /perguntas|cenários resolvidos|estudos de caso/i.test(title);
}

function parseQuestionSection(body) {
  const lines = body.split('\n');
  const cards = [];
  const intro = [];
  let current = null;
  let inCode = false;

  const flush = () => { if (current) { cards.push(current); current = null; } };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    if (/^```/.test(line)) inCode = !inCode;

    if (!inCode) {
      if (/^###\s+(🟢|🟡|🔴)\s+(Básico|Intermediário|Avançado)\s*$/.test(line)) continue;

      const h3 = line.match(/^###\s+(.*)$/);
      if (h3) {
        flush();
        const t = h3[1].replace(/^\d+\.\d+\s+/, '').trim();
        const lv = (t.match(LEVEL_RE) || [])[1] || null;
        current = { title: t, level: lv, body: [] };
        continue;
      }

      const bq = line.match(/^\*\*((🟢|🟡|🔴)[^*]+)\*\*\s*$/);
      if (bq) {
        flush();
        current = { title: bq[1].trim(), level: bq[2], body: [] };
        continue;
      }

      const quoted = line.match(/^\*\*("[^"]+"|“[^”]+”)\*\*\s*(.*)$/);
      if (quoted) {
        flush();
        current = { title: quoted[1].replace(/^["“]|["”]$/g, ''), level: null, body: quoted[2] ? [quoted[2]] : [] };
        continue;
      }

      if (/^\s*---+\s*$/.test(line)) { continue; }
    }

    if (current) current.body.push(line);
    else intro.push(line);
  }
  flush();
  return {
    intro: intro.join('\n').trim(),
    cards: cards.map((c) => ({ title: c.title, level: c.level, body: c.body.join('\n').trim() })),
  };
}

function parseTopic(md, linkMap) {
  const lines = md.split('\n');
  const titleLine = lines.find((l) => /^#\s+/.test(l)) || '# Sem título';
  const fullTitle = titleLine.replace(/^#\s+/, '').trim();
  const quote = [];
  for (const l of lines.slice(lines.indexOf(titleLine) + 1)) {
    if (/^>\s?/.test(l)) quote.push(l.replace(/^>\s?/, ''));
    else if (quote.length) break;
    else if (!/^\s*$/.test(l)) break;
  }
  const bodyMd = lines.slice(lines.indexOf(titleLine) + 1).join('\n');
  const { sections } = splitH2Sections(bodyMd);

  const studySections = [];
  let questions = { intro: '', cards: [] };

  for (const sec of sections) {
    if (isQuestionSection(sec.title)) {
      const parsed = parseQuestionSection(sec.body);
      questions.intro += (questions.intro ? '\n\n' : '') + parsed.intro;
      questions.cards.push(...parsed.cards);
    } else {
      studySections.push(sec);
    }
  }

  const studyHtml = studySections
    .map((s) => {
      const id = 'sec-' + s.title.toLowerCase().replace(/[^a-z0-9à-ú]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60);
      return `<section class="study-sec" id="${id}"><h2>${inline(s.title, linkMap)}</h2>${mdToHtml(s.body, linkMap)}</section>`;
    })
    .join('\n');

  const toc = studySections.map((s) => ({
    id: 'sec-' + s.title.toLowerCase().replace(/[^a-z0-9à-ú]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60),
    title: s.title,
  }));

  return {
    fullTitle,
    subtitle: quote[0] || '',
    studyHtml,
    toc,
    questionsIntroHtml: questions.intro ? mdToHtml(questions.intro, linkMap) : '',
    cards: questions.cards.map((c) => ({
      titleHtml: inline(c.title, linkMap),
      level: c.level,
      levelName: c.level ? LEVEL_NAME[c.level] : 'sem-nivel',
      bodyHtml: mdToHtml(c.body, linkMap),
    })),
  };
}

/* ---------------------------------- template do site ---------------------------------- */

function buildSite(site) {
  const dir = join(ROOT, site.folder);
  const files = readdirSync(dir)
    .filter((f) => /^\d{2}-.*\.md$/.test(f))
    .sort();

  const linkMap = {};
  for (const f of files) linkMap[f] = f.slice(0, 2);

  // banco de quiz (múltipla escolha), se existir
  let quizBank = {};
  const quizPath = join(dir, 'quiz.json');
  if (existsSync(quizPath)) {
    quizBank = JSON.parse(readFileSync(quizPath, 'utf8'));
  }

  const topics = files.map((f) => {
    const md = readFileSync(join(dir, f), 'utf8');
    const t = parseTopic(md, linkMap);
    const id = f.slice(0, 2);
    const quiz = (quizBank[id] || []).map((q) => ({
      n: q.n || '🟡',
      levelName: LEVEL_NAME[q.n] || 'intermediario',
      q: inline(q.q, linkMap),
      a: q.a.map((alt) => inline(alt, linkMap)),
      c: q.c,
      e: inline(q.e, linkMap),
    }));
    return { id, file: f, quiz, ...t };
  });

  const readmeMd = readFileSync(join(dir, 'README.md'), 'utf8');
  const readmeHtml = mdToHtml(readmeMd.replace(/^#\s+.*$/m, ''), linkMap);
  const readmeTitle = (readmeMd.match(/^#\s+(.*)$/m) || [null, site.title])[1];

  const totalQuestions = topics.reduce((a, t) => a + t.cards.length, 0);
  const totalQuiz = topics.reduce((a, t) => a + t.quiz.length, 0);

  const data = {
    siteKey: site.folder,
    title: site.title,
    emoji: site.emoji,
    readmeTitle,
    topics: topics.map((t) => ({
      id: t.id,
      fullTitle: t.fullTitle,
      shortTitle: t.fullTitle.replace(/^\d+\s*[—-]\s*/, ''),
      subtitle: t.subtitle,
      toc: t.toc,
      studyHtml: t.studyHtml,
      questionsIntroHtml: t.questionsIntroHtml,
      cards: t.cards,
      quiz: t.quiz,
    })),
  };

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${site.emoji} ${site.title} — Estudos</title>
<style>
:root{
  --accent:${site.accent};
  --accent-soft:${site.accent}18;
  --bg:#f8fafc; --panel:#ffffff; --text:#0f172a; --muted:#64748b;
  --border:#e2e8f0; --code-bg:#f1f5f9; --shadow:0 1px 3px rgba(15,23,42,.08);
  --green:#16a34a; --yellow:#ca8a04; --red:#dc2626;
}
@media (prefers-color-scheme: dark){
  :root{
    --accent:${site.accentDark};
    --accent-soft:${site.accentDark}22;
    --bg:#0b1120; --panel:#111a2e; --text:#e2e8f0; --muted:#94a3b8;
    --border:#1e293b; --code-bg:#1a2440; --shadow:0 1px 3px rgba(0,0,0,.4);
    --green:#4ade80; --yellow:#facc15; --red:#f87171;
  }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.65;font-size:15.5px}
a{color:var(--accent)}
code{background:var(--code-bg);padding:.12em .38em;border-radius:5px;font-size:.88em;font-family:'Cascadia Code','JetBrains Mono',Consolas,monospace}
pre{background:var(--code-bg);padding:14px 16px;border-radius:10px;overflow-x:auto;border:1px solid var(--border)}
pre code{background:none;padding:0;font-size:.85em;line-height:1.5}
blockquote{margin:0 0 1em;padding:.6em 1em;border-left:3px solid var(--accent);background:var(--accent-soft);border-radius:0 8px 8px 0;color:var(--muted)}
blockquote p{margin:.25em 0}
hr{border:none;border-top:1px solid var(--border);margin:1.6em 0}
h1,h2,h3,h4{line-height:1.3;scroll-margin-top:80px}
.table-wrap{overflow-x:auto;margin:1em 0;border:1px solid var(--border);border-radius:10px}
table{border-collapse:collapse;width:100%;font-size:.92em}
th,td{padding:8px 12px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{background:var(--accent-soft);white-space:nowrap}
tr:last-child td{border-bottom:none}
.ref{color:var(--accent);font-weight:600}
.cb{color:var(--accent)}

/* layout */
.layout{display:flex;min-height:100vh}
aside{width:290px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--border);position:sticky;top:0;height:100vh;overflow-y:auto;padding:18px 14px}
main{flex:1;min-width:0;padding:28px clamp(16px,4vw,56px) 80px;max-width:980px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;padding:6px 8px 16px;border-bottom:1px solid var(--border);margin-bottom:12px}
.brand .em{font-size:1.7em}
.brand h1{font-size:1.02em;margin:0;line-height:1.25}
.brand small{color:var(--muted);display:block;font-weight:400}
.nav-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:9px;cursor:pointer;color:var(--text);text-decoration:none;font-size:.92em;margin:2px 0}
.nav-item:hover{background:var(--accent-soft)}
.nav-item.active{background:var(--accent);color:#fff;font-weight:600}
@media (prefers-color-scheme: dark){.nav-item.active{color:#0b1120}}
.nav-item .num{font-weight:700;font-size:.82em;opacity:.65;width:20px;flex-shrink:0}
.nav-item .prog{margin-left:auto;font-size:.72em;opacity:.75;white-space:nowrap;text-align:right}
.nav-label{font-size:.72em;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);padding:14px 10px 4px}

/* topo do tópico */
.topic-head h1{font-size:1.55em;margin:.1em 0 .15em}
.topic-head .sub{color:var(--muted);margin:0 0 18px}
.tabs{display:flex;gap:8px;margin:18px 0 26px;border-bottom:2px solid var(--border);flex-wrap:wrap}
.tab{padding:9px 18px;cursor:pointer;border:none;background:none;font:inherit;font-weight:600;color:var(--muted);border-bottom:3px solid transparent;margin-bottom:-2px}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab .count{font-size:.8em;opacity:.7}

/* estudo */
.toc{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin-bottom:22px;box-shadow:var(--shadow)}
.toc b{font-size:.8em;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.toc a{display:block;padding:3px 0;text-decoration:none;font-size:.93em}
.study-sec{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:8px 26px 18px;margin-bottom:22px;box-shadow:var(--shadow)}
.study-sec>h2{border-bottom:2px solid var(--accent-soft);padding-bottom:.35em}

/* questões abertas */
.q-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:20px}
.q-tools .spacer{flex:1}
.chip{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:999px;padding:5px 14px;cursor:pointer;font:inherit;font-size:.85em}
.chip.active{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
@media (prefers-color-scheme: dark){.chip.active{color:#0b1120}}
.card{background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--border);border-radius:12px;margin-bottom:16px;box-shadow:var(--shadow);overflow:hidden}
.card.l-basico{border-left-color:var(--green)}
.card.l-intermediario{border-left-color:var(--yellow)}
.card.l-avancado{border-left-color:var(--red)}
.card-q{padding:15px 20px;cursor:pointer;display:flex;gap:12px;align-items:flex-start}
.card-q:hover{background:var(--accent-soft)}
.card-q .qt{font-weight:600;flex:1}
.card-q .toggle{color:var(--muted);font-size:.82em;white-space:nowrap;padding-top:2px}
.card-a{display:none;padding:4px 22px 14px;border-top:1px dashed var(--border)}
.card.open .card-a{display:block}
.card-mark{display:flex;gap:6px;align-items:center;padding:8px 20px 12px;border-top:1px solid var(--border);flex-wrap:wrap;background:color-mix(in srgb, var(--panel) 70%, var(--bg))}
.card-mark span{font-size:.78em;color:var(--muted);margin-right:4px}
.mark-btn{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:8px;padding:3px 10px;cursor:pointer;font-size:.85em}
.mark-btn.sel-ok{background:var(--green);border-color:var(--green);color:#fff}
.mark-btn.sel-meh{background:var(--yellow);border-color:var(--yellow);color:#fff}
.mark-btn.sel-bad{background:var(--red);border-color:var(--red);color:#fff}
.q-intro{margin-bottom:18px;color:var(--muted)}
.empty{color:var(--muted);text-align:center;padding:40px 0;font-style:italic}

/* quiz de múltipla escolha */
.quiz-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:12px 18px;margin-bottom:22px;box-shadow:var(--shadow)}
.quiz-head .score{font-weight:700;font-size:1.05em}
.quiz-head .score .ok{color:var(--green)}
.quiz-head .detail{color:var(--muted);font-size:.85em;flex:1}
.qz{background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--border);border-radius:12px;margin-bottom:18px;box-shadow:var(--shadow);padding:16px 20px 14px}
.qz.l-basico{border-left-color:var(--green)}
.qz.l-intermediario{border-left-color:var(--yellow)}
.qz.l-avancado{border-left-color:var(--red)}
.qz .qnum{font-size:.75em;font-weight:700;color:var(--muted);letter-spacing:.05em}
.qz .qtext{font-weight:600;margin:4px 0 12px}
.alt{display:flex;gap:11px;padding:10px 14px;border:1px solid var(--border);border-radius:10px;margin:7px 0;cursor:pointer;align-items:flex-start;transition:border-color .1s, background .1s}
.alt:hover{border-color:var(--accent);background:var(--accent-soft)}
.alt .letter{font-weight:700;color:var(--accent);flex-shrink:0}
.alt.locked{cursor:default}
.alt.locked:hover{border-color:var(--border);background:none}
.alt.correct{border-color:var(--green);background:color-mix(in srgb, var(--green) 14%, var(--panel))}
.alt.correct .letter{color:var(--green)}
.alt.wrong{border-color:var(--red);background:color-mix(in srgb, var(--red) 12%, var(--panel))}
.alt.wrong .letter{color:var(--red)}
.alt.dim{opacity:.55}
.qz-exp{margin-top:12px;padding:12px 16px;border-radius:10px;font-size:.94em;background:var(--accent-soft);border:1px solid var(--border)}
.qz-exp .verdict{font-weight:700;display:block;margin-bottom:4px}
.qz-exp .verdict.ok{color:var(--green)}
.qz-exp .verdict.nok{color:var(--red)}

/* home */
.home-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin:24px 0}
.home-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px;cursor:pointer;box-shadow:var(--shadow);transition:transform .12s}
.home-card:hover{transform:translateY(-2px);border-color:var(--accent)}
.home-card .n{font-size:.78em;font-weight:700;color:var(--accent)}
.home-card .t{font-weight:600;margin:2px 0 6px}
.home-card .s{font-size:.83em;color:var(--muted)}
.home-card .qn{font-size:.76em;color:var(--muted);margin-top:8px}
.readme{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:8px 26px 18px;box-shadow:var(--shadow)}

.mobile-toggle{display:none}
@media (max-width: 860px){
  aside{position:fixed;z-index:30;transform:translateX(-100%);transition:transform .2s}
  aside.open{transform:none;box-shadow:0 0 40px rgba(0,0,0,.35)}
  .mobile-toggle{display:block;position:fixed;bottom:18px;left:18px;z-index:40;background:var(--accent);color:#fff;border:none;border-radius:50%;width:52px;height:52px;font-size:1.3em;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.3)}
  main{padding-top:16px}
}
</style>
</head>
<body>
<div class="layout">
  <aside id="sidebar"></aside>
  <main id="main"></main>
</div>
<button class="mobile-toggle" onclick="document.getElementById('sidebar').classList.toggle('open')">☰</button>
<script id="site-data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
const DATA = JSON.parse(document.getElementById('site-data').textContent);
const SKEY = 'estudos:' + DATA.siteKey;
const LETTERS = ['A','B','C','D','E'];

/* ------- progresso em localStorage ------- */
function getMark(topicId, idx){ return localStorage.getItem(SKEY + ':' + topicId + ':' + idx) || ''; }
function setMark(topicId, idx, v){
  const k = SKEY + ':' + topicId + ':' + idx;
  if (v) localStorage.setItem(k, v); else localStorage.removeItem(k);
}
function getQuizAns(topicId, idx){
  const v = localStorage.getItem(SKEY + ':quiz:' + topicId + ':' + idx);
  return v === null ? null : +v;
}
function setQuizAns(topicId, idx, v){ localStorage.setItem(SKEY + ':quiz:' + topicId + ':' + idx, String(v)); }
function clearQuiz(topicId){
  const t = DATA.topics.find(x => x.id === topicId);
  if (!t) return;
  t.quiz.forEach((_, i) => localStorage.removeItem(SKEY + ':quiz:' + topicId + ':' + i));
}
function topicProgress(t){
  let done = 0;
  t.cards.forEach((c, i) => { if (getMark(t.id, i)) done++; });
  return { done, total: t.cards.length };
}
function quizProgress(t){
  let answered = 0, correct = 0;
  t.quiz.forEach((q, i) => {
    const a = getQuizAns(t.id, i);
    if (a !== null){ answered++; if (a === q.c) correct++; }
  });
  return { answered, correct, total: t.quiz.length };
}

/* ------- sidebar ------- */
function renderSidebar(activeId){
  const el = document.getElementById('sidebar');
  let h = '<div class="brand"><span class="em">' + DATA.emoji + '</span><h1>' + DATA.title +
          '<small>material de entrevistas</small></h1></div>';
  h += '<a class="nav-item' + (activeId === 'home' ? ' active' : '') + '" href="#home"><span class="num">🏠</span> Início &amp; guia de uso</a>';
  h += '<div class="nav-label">Temas</div>';
  for (const t of DATA.topics){
    const qp = quizProgress(t);
    const badge = qp.total ? (qp.answered ? '🎯 ' + qp.correct + '/' + qp.answered : '🎯 ' + qp.total) : '';
    h += '<a class="nav-item' + (activeId === t.id ? ' active' : '') + '" href="#topic/' + t.id + '">' +
         '<span class="num">' + t.id + '</span><span>' + t.shortTitle + '</span>' +
         '<span class="prog">' + badge + '</span></a>';
  }
  el.innerHTML = h;
}

/* ------- home ------- */
function renderHome(){
  renderSidebar('home');
  const totalQ = DATA.topics.reduce((a,t)=>a+t.cards.length,0);
  const totalZ = DATA.topics.reduce((a,t)=>a+t.quiz.length,0);
  let h = '<div class="topic-head"><h1>' + DATA.emoji + ' ' + DATA.title + '</h1>' +
          '<p class="sub">' + DATA.topics.length + ' temas · ' + totalQ + ' questões abertas comentadas · ' + totalZ + ' questões de múltipla escolha</p></div>';
  h += '<div class="home-grid">';
  for (const t of DATA.topics){
    const qp = quizProgress(t);
    h += '<div class="home-card" onclick="location.hash=\\'#topic/' + t.id + '\\'">' +
         '<div class="n">TEMA ' + t.id + '</div><div class="t">' + t.shortTitle + '</div>' +
         '<div class="s">' + t.subtitle + '</div>' +
         '<div class="qn">❓ ' + t.cards.length + ' abertas · 🎯 ' + t.quiz.length + ' de múltipla escolha' +
         (qp.answered ? ' — ' + qp.correct + '/' + qp.answered + ' acertos' : '') + '</div></div>';
  }
  h += '</div>';
  h += '<div class="readme"><h2>Como usar este material</h2>' + DATA.readmeHtmlPlaceholder + '</div>';
  document.getElementById('main').innerHTML = h;
  bindTopicLinks();
  window.scrollTo(0,0);
}

/* ------- tópico ------- */
let currentTab = 'estudo';
let levelFilter = 'todos';
let statusFilter = 'todas';

function renderTopic(id, tab){
  const t = DATA.topics.find(x => x.id === id);
  if (!t){ location.hash = '#home'; return; }
  renderSidebar(id);
  currentTab = tab || currentTab || 'estudo';
  if (currentTab === 'quiz' && !t.quiz.length) currentTab = 'questoes';

  let h = '<div class="topic-head"><h1>' + t.fullTitle + '</h1>' +
          (t.subtitle ? '<p class="sub">' + t.subtitle + '</p>' : '') + '</div>';
  h += '<div class="tabs">' +
       '<button class="tab' + (currentTab==='estudo'?' active':'') + '" onclick="switchTab(\\'estudo\\')">📖 Estudo</button>' +
       '<button class="tab' + (currentTab==='quiz'?' active':'') + '" onclick="switchTab(\\'quiz\\')">🎯 Quiz <span class="count">(' + t.quiz.length + ')</span></button>' +
       '<button class="tab' + (currentTab==='questoes'?' active':'') + '" onclick="switchTab(\\'questoes\\')">❓ Questões abertas <span class="count">(' + t.cards.length + ')</span></button>' +
       '</div>';

  if (currentTab === 'estudo'){
    if (t.toc.length > 1){
      h += '<nav class="toc"><b>Nesta página</b>';
      for (const s of t.toc) h += '<a href="#' + s.id + '" onclick="event.preventDefault();document.getElementById(\\'' + s.id + '\\').scrollIntoView({behavior:\\'smooth\\'})">' + s.title + '</a>';
      h += '</nav>';
    }
    h += t.studyHtml || '<p class="empty">Sem conteúdo de estudo neste tema.</p>';
  } else if (currentTab === 'quiz'){
    h += renderQuiz(t);
  } else {
    h += renderOpenQuestions(t);
  }
  document.getElementById('main').innerHTML = h;
  bindTopicLinks();
  window.scrollTo(0,0);
}

/* ------- quiz de múltipla escolha ------- */
function renderQuiz(t){
  const qp = quizProgress(t);
  let h = '<div class="quiz-head">' +
          '<span class="score"><span class="ok">' + qp.correct + '</span> / ' + qp.answered + ' acertos</span>' +
          '<span class="detail">' + qp.answered + ' de ' + qp.total + ' respondidas — clique numa alternativa para responder; a correção aparece na hora.</span>' +
          '<button class="chip" onclick="if(confirm(\\'Apagar suas respostas deste tema?\\')){clearQuiz(\\'' + t.id + '\\');route(true);}">↺ Refazer quiz</button>' +
          '</div>';
  t.quiz.forEach((q, i) => {
    const ans = getQuizAns(t.id, i);
    const answered = ans !== null;
    h += '<div class="qz l-' + q.levelName + '" id="qz-' + i + '">' +
         '<div class="qnum">QUESTÃO ' + (i+1) + ' DE ' + t.quiz.length + ' · ' + q.n + '</div>' +
         '<div class="qtext">' + q.q + '</div>';
    q.a.forEach((alt, j) => {
      let cls = 'alt';
      if (answered){
        cls += ' locked';
        if (j === q.c) cls += ' correct';
        else if (j === ans) cls += ' wrong';
        else cls += ' dim';
      }
      const click = answered ? '' : ' onclick="answerQuiz(\\'' + t.id + '\\',' + i + ',' + j + ')"';
      h += '<div class="' + cls + '"' + click + '><span class="letter">' + LETTERS[j] + '</span><span>' + alt + '</span></div>';
    });
    if (answered){
      const ok = ans === q.c;
      h += '<div class="qz-exp"><span class="verdict ' + (ok?'ok':'nok') + '">' +
           (ok ? '✅ Correto!' : '❌ Você marcou ' + LETTERS[ans] + ' — a correta é ' + LETTERS[q.c] + '.') +
           '</span>' + q.e + '</div>';
    }
    h += '</div>';
  });
  return h;
}
function answerQuiz(tid, i, j){
  if (getQuizAns(tid, i) !== null) return;
  setQuizAns(tid, i, j);
  route(true);
  const el = document.getElementById('qz-' + i);
  if (el) el.scrollIntoView({block:'nearest'});
}

/* ------- questões abertas ------- */
function renderOpenQuestions(t){
  let h = '<div class="q-tools">' +
       chip('nivel','todos','Todos') + chip('nivel','🟢','🟢 Básico') + chip('nivel','🟡','🟡 Intermediário') + chip('nivel','🔴','🔴 Avançado') +
       '<span class="spacer"></span>' +
       chip('status','todas','Todas') + chip('status','pendentes','Não marcadas') + chip('status','revisar','Revisar ⚠️❌') +
       '<button class="chip" onclick="toggleAll(true)">Revelar todas</button>' +
       '<button class="chip" onclick="toggleAll(false)">Ocultar todas</button>' +
       '</div>';
  if (t.questionsIntroHtml) h += '<div class="q-intro">' + t.questionsIntroHtml + '</div>';
  let shown = 0;
  t.cards.forEach((c, i) => {
    const mark = getMark(t.id, i);
    if (levelFilter !== 'todos' && c.level !== levelFilter) return;
    if (statusFilter === 'pendentes' && mark) return;
    if (statusFilter === 'revisar' && mark !== 'meh' && mark !== 'bad') return;
    shown++;
    h += '<div class="card l-' + c.levelName + '" id="card-' + i + '">' +
         '<div class="card-q" onclick="toggleCard(' + i + ')"><span class="qt">' + c.titleHtml + '</span>' +
         '<span class="toggle">mostrar resposta ▾</span></div>' +
         '<div class="card-a">' + c.bodyHtml +
         '<div class="card-mark"><span>Como você foi?</span>' +
         markBtn(t.id, i, 'ok', '✅ Acertei', mark) +
         markBtn(t.id, i, 'meh', '⚠️ Parcial', mark) +
         markBtn(t.id, i, 'bad', '❌ Errei', mark) +
         (mark ? '<button class="mark-btn" onclick="mark(\\'' + t.id + '\\',' + i + ',\\'\\')">limpar</button>' : '') +
         '</div></div></div>';
  });
  if (!shown) h += '<p class="empty">Nenhuma questão com esse filtro.</p>';
  return h;
}

function chip(kind, val, label){
  const active = (kind==='nivel' ? levelFilter : statusFilter) === val;
  return '<button class="chip' + (active?' active':'') + '" onclick="setFilter(\\'' + kind + '\\',\\'' + val + '\\')">' + label + '</button>';
}
function markBtn(tid, i, v, label, current){
  return '<button class="mark-btn' + (current===v ? ' sel-' + v : '') + '" onclick="mark(\\'' + tid + '\\',' + i + ',\\'' + v + '\\')">' + label + '</button>';
}
function setFilter(kind, val){
  if (kind==='nivel') levelFilter = val; else statusFilter = val;
  route();
}
function switchTab(tab){
  currentTab = tab;
  route();
}
function toggleCard(i){
  const el = document.getElementById('card-' + i);
  el.classList.toggle('open');
  el.querySelector('.toggle').textContent = el.classList.contains('open') ? 'ocultar ▴' : 'mostrar resposta ▾';
}
function toggleAll(open){
  document.querySelectorAll('.card').forEach(el => {
    el.classList.toggle('open', open);
    el.querySelector('.toggle').textContent = open ? 'ocultar ▴' : 'mostrar resposta ▾';
  });
}
function mark(tid, i, v){
  setMark(tid, i, v);
  route(true);
  const el = document.getElementById('card-' + i);
  if (el){ el.classList.add('open'); el.querySelector('.toggle').textContent = 'ocultar ▴'; el.scrollIntoView({block:'nearest'}); }
}
function bindTopicLinks(){
  document.querySelectorAll('.topic-link').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      location.hash = '#topic/' + a.dataset.topic;
    });
  });
}

/* ------- roteamento ------- */
function route(keepScroll){
  const hash = location.hash || '#home';
  const scroll = keepScroll ? window.scrollY : 0;
  const m = hash.match(/^#topic\\/(\\d{2})/);
  if (m) renderTopic(m[1]);
  else renderHome();
  if (keepScroll) window.scrollTo(0, scroll);
  document.getElementById('sidebar').classList.remove('open');
}
window.addEventListener('hashchange', () => { route(); });
route();
</script>
</body>
</html>`;

  const finalHtml = html.replace('DATA.readmeHtmlPlaceholder', JSON.stringify(readmeHtml));

  const outPath = join(dir, 'index.html');
  writeFileSync(outPath, finalHtml, 'utf8');
  console.log(`✔ ${site.folder}/index.html — ${topics.length} temas, ${totalQuestions} questões abertas, ${totalQuiz} de quiz, ${(finalHtml.length / 1024).toFixed(0)} KB`);

  for (const t of topics) {
    if (t.cards.length === 0) console.warn(`  ⚠ tema ${t.id} (${t.file}) sem questões detectadas`);
    if (t.quiz.length === 0) console.warn(`  ⚠ tema ${t.id} (${t.file}) sem quiz no quiz.json`);
  }
  // valida índices do quiz
  for (const [tid, qs] of Object.entries(quizBank)) {
    qs.forEach((q, i) => {
      if (!Array.isArray(q.a) || q.a.length < 2 || q.c < 0 || q.c >= q.a.length) {
        console.error(`  ✖ quiz inválido: tema ${tid}, questão ${i + 1}`);
      }
    });
  }
}

for (const site of SITES) buildSite(site);
