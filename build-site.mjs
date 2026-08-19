// build-site.mjs — gera um site auto-contido para cada pasta de estudos.
// Uso: node build-site.mjs
//
// Saída por pasta:
//   index.html             página completa, auto-contida (funciona até por file://)
//   manifest.webmanifest   torna o site instalável na tela de início do celular
//   sw.js                  service worker: leitura offline após a primeira visita
//   icon-192.png / icon-512.png / apple-touch-icon-180.png
// Saída na raiz:
//   index.html             hub com links para os dois sites
//
// O index.html continua sendo o entregável autossuficiente: copiar só ele para o
// celular ainda funciona. Manifest, service worker e ícones são camada aditiva que
// só entra em ação sob http(s).

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

const SITES = [
  {
    folder: 'engenharia-de-dados',
    title: 'Engenharia de Dados',
    short: 'Eng. Dados',
    icon: 'db',
    emoji: '🛠️',
    accent: '#0e7490',
    accentDark: '#22d3ee',
  },
  {
    folder: 'machine-learning',
    title: 'Machine Learning',
    short: 'Machine Lrn',
    icon: 'net',
    emoji: '🧠',
    accent: '#7c3aed',
    accentDark: '#c4b5fd',
  },
];

const BG_LIGHT = '#f8fafc';
const BG_DARK = '#0b1120';

/* ================================ PNG (sem dependências) ================================ */

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function encodePng(size, rgb) {
  const stride = size * 3 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filtro "none"
    rgb.copy(raw, y * stride + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bits por canal
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

// Desenho por supersampling: rasteriza em 4x e reduz por média, o que dá
// antialiasing sem precisar de nenhuma biblioteca gráfica.
const SS = 4;

function makeCanvas(n, rgb) {
  const buf = Buffer.alloc(n * n * 3);
  for (let i = 0; i < n * n; i++) {
    buf[i * 3] = rgb[0];
    buf[i * 3 + 1] = rgb[1];
    buf[i * 3 + 2] = rgb[2];
  }
  return buf;
}

function setPx(buf, n, x, y, c) {
  if (x < 0 || x >= n || y < 0 || y >= n) return;
  const o = (y * n + x) * 3;
  buf[o] = c[0];
  buf[o + 1] = c[1];
  buf[o + 2] = c[2];
}

function fillRect(buf, n, x, y, w, h, c) {
  const x0 = Math.max(0, Math.round(x));
  const y0 = Math.max(0, Math.round(y));
  const x1 = Math.min(n, Math.round(x + w));
  const y1 = Math.min(n, Math.round(y + h));
  for (let py = y0; py < y1; py++) for (let px = x0; px < x1; px++) setPx(buf, n, px, py, c);
}

function fillEllipse(buf, n, cx, cy, rx, ry, c) {
  const y0 = Math.max(0, Math.floor(cy - ry));
  const y1 = Math.min(n - 1, Math.ceil(cy + ry));
  for (let py = y0; py <= y1; py++) {
    const dy = (py + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.max(0, Math.floor(cx - half));
    const x1 = Math.min(n - 1, Math.ceil(cx + half));
    for (let px = x0; px <= x1; px++) {
      const dx = (px + 0.5 - cx) / rx;
      if (dx * dx + dy * dy <= 1) setPx(buf, n, px, py, c);
    }
  }
}

function strokeLine(buf, n, x1, y1, x2, y2, w, c) {
  const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillEllipse(buf, n, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, w / 2, w / 2, c);
  }
}

function downsample(hi, n, size) {
  const out = Buffer.alloc(size * size * 3);
  const f = n / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < f; sy++) {
        for (let sx = 0; sx < f; sx++) {
          const o = ((y * f + sy) * n + (x * f + sx)) * 3;
          r += hi[o]; g += hi[o + 1]; b += hi[o + 2];
        }
      }
      const cnt = f * f;
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / cnt);
      out[o + 1] = Math.round(g / cnt);
      out[o + 2] = Math.round(b / cnt);
    }
  }
  return out;
}

// Cilindro de banco de dados — engenharia de dados.
function drawDatabase(buf, n, c) {
  const cx = n / 2;
  const rx = n * 0.21;
  const ry = n * 0.072;
  const top = n * 0.30;
  const bottom = n * 0.70;
  fillEllipse(buf, n, cx, bottom, rx, ry, c);
  fillRect(buf, n, cx - rx, top, rx * 2, bottom - top, c);
  fillEllipse(buf, n, cx, top, rx, ry, c);
  return { cx, rx, ry, top, bottom };
}

// Rede neural 3–2 — machine learning.
function drawNetwork(buf, n, c) {
  const r = n * 0.052;
  const lw = n * 0.026;
  const lx = n * 0.34;
  const rxp = n * 0.66;
  const left = [n * 0.30, n * 0.5, n * 0.70];
  const right = [n * 0.385, n * 0.615];
  for (const ly of left) for (const ry of right) strokeLine(buf, n, lx, ly, rxp, ry, lw, c);
  for (const ly of left) fillEllipse(buf, n, lx, ly, r, r, c);
  for (const ry of right) fillEllipse(buf, n, rxp, ry, r, r, c);
}

// Ícone: fundo sólido na cor do tema + marca branca, com margem folgada para
// sobreviver ao recorte "maskable" do Android.
function makeIcon(size, bgHex, kind) {
  const n = size * SS;
  const bg = hexToRgb(bgHex);
  const white = [255, 255, 255];
  const hi = makeCanvas(n, bg);
  if (kind === 'db') {
    const d = drawDatabase(hi, n, white);
    // Cada junta é o arco inferior de uma elipse: pinta a elipse na cor do fundo
    // e cobre de volta com a mesma elipse deslocada para cima, sobrando só a curva.
    // De baixo para cima: senão a elipse de cobertura da junta inferior
    // apagaria parte do arco da junta de cima.
    const t = n * 0.022;
    for (const f of [0.68, 0.36]) {
      const jy = d.top + (d.bottom - d.top) * f;
      fillEllipse(hi, n, d.cx, jy, d.rx, d.ry, bg);
      fillEllipse(hi, n, d.cx, jy - t, d.rx, d.ry, white);
    }
  } else {
    drawNetwork(hi, n, white);
  }
  return encodePng(size, downsample(hi, n, size));
}

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/* ================================ markdown → HTML ================================ */

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

/* ================================ parsing dos tópicos ================================ */

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

  const secId = (t) => 'sec-' + t.toLowerCase().replace(/[^a-z0-9à-ú]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60);

  const studyHtml = studySections
    .map((s) => `<section class="study-sec" id="${secId(s.title)}"><h2>${inline(s.title, linkMap)}</h2>${mdToHtml(s.body, linkMap)}</section>`)
    .join('\n');

  return {
    fullTitle,
    subtitle: quote[0] || '',
    studyHtml,
    toc: studySections.map((s) => ({ id: secId(s.title), title: s.title })),
    questionsIntroHtml: questions.intro ? mdToHtml(questions.intro, linkMap) : '',
    cards: questions.cards.map((c) => ({
      titleHtml: inline(c.title, linkMap),
      level: c.level,
      levelName: c.level ? LEVEL_NAME[c.level] : 'sem-nivel',
      bodyHtml: mdToHtml(c.body, linkMap),
    })),
  };
}

/* ================================ CSS compartilhado ================================ */

function buildCss(site) {
  return `
:root{
  color-scheme:light dark;
  --accent:${site.accent};
  --accent-soft:${site.accent}18;
  --bg:${BG_LIGHT}; --panel:#ffffff; --text:#0f172a; --muted:#64748b;
  --border:#e2e8f0; --code-bg:#f1f5f9; --shadow:0 1px 3px rgba(15,23,42,.08);
  --green:#16a34a; --yellow:#ca8a04; --red:#dc2626;
  --bar:56px;
}
@media (prefers-color-scheme: dark){
  :root{
    --accent:${site.accentDark};
    --accent-soft:${site.accentDark}22;
    --bg:${BG_DARK}; --panel:#111a2e; --text:#e2e8f0; --muted:#94a3b8;
    --border:#1e293b; --code-bg:#1a2440; --shadow:0 1px 3px rgba(0,0,0,.4);
    --green:#4ade80; --yellow:#facc15; --red:#f87171;
  }
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);
  line-height:1.65;font-size:15.5px;overflow-x:hidden;-webkit-tap-highlight-color:transparent}
a{color:var(--accent)}
code{background:var(--code-bg);padding:.12em .38em;border-radius:5px;font-size:.88em;
  font-family:'Cascadia Code','JetBrains Mono',Consolas,monospace;overflow-wrap:anywhere}
p,li,td,th,.qtext,.qt{overflow-wrap:break-word}
pre{background:var(--code-bg);padding:14px 16px;border-radius:10px;overflow-x:auto;border:1px solid var(--border)}
pre code{background:none;padding:0;font-size:.85em;line-height:1.5;overflow-wrap:normal}
blockquote{margin:0 0 1em;padding:.6em 1em;border-left:3px solid var(--accent);background:var(--accent-soft);
  border-radius:0 8px 8px 0;color:var(--muted)}
blockquote p{margin:.25em 0}
hr{border:none;border-top:1px solid var(--border);margin:1.6em 0}
h1,h2,h3,h4{line-height:1.3;scroll-margin-top:80px}
.table-wrap{overflow-x:auto;margin:1em 0;border:1px solid var(--border);border-radius:10px;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:.92em}
th,td{padding:8px 12px;border-bottom:1px solid var(--border);text-align:left;vertical-align:top}
th{background:var(--accent-soft);white-space:nowrap}
tr:last-child td{border-bottom:none}
.ref{color:var(--accent);font-weight:600}
.cb{color:var(--accent)}

.layout{display:flex;min-height:100vh}
aside{width:290px;flex-shrink:0;background:var(--panel);border-right:1px solid var(--border);
  position:sticky;top:0;height:100vh;height:100dvh;overflow-y:auto;padding:18px 14px;
  padding-bottom:max(18px,env(safe-area-inset-bottom))}
main{flex:1;min-width:0;padding:28px clamp(16px,4vw,56px) 80px;max-width:980px;margin:0 auto}
.brand{display:flex;align-items:center;gap:10px;padding:6px 8px 16px;border-bottom:1px solid var(--border);margin-bottom:12px}
.brand .em{font-size:1.7em}
.brand h1{font-size:1.02em;margin:0;line-height:1.25}
.brand small{color:var(--muted);display:block;font-weight:400}
.nav-item{display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:9px;cursor:pointer;
  color:var(--text);text-decoration:none;font-size:.92em;margin:2px 0;min-height:40px}
.nav-item.active{background:var(--accent);color:#fff;font-weight:600}
@media (prefers-color-scheme: dark){.nav-item.active{color:${BG_DARK}}}
.nav-item .num{font-weight:700;font-size:.82em;opacity:.65;width:20px;flex-shrink:0}
.nav-item .prog{margin-left:auto;font-size:.72em;opacity:.75;white-space:nowrap;text-align:right}
.nav-label{font-size:.72em;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);padding:14px 10px 4px}

.topbar{display:none}
.scrim{display:none;position:fixed;inset:0;z-index:29;background:rgba(0,0,0,.5);
  opacity:0;transition:opacity .18s;-webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px)}
.scrim.on{display:block;opacity:1}

.topic-head h1{font-size:1.55em;margin:.1em 0 .15em}
.topic-head .sub{color:var(--muted);margin:0 0 18px}
.tabs{display:flex;gap:8px;margin:18px 0 26px;border-bottom:2px solid var(--border);flex-wrap:wrap}
.tab{padding:11px 18px;cursor:pointer;border:none;background:none;font:inherit;font-weight:600;color:var(--muted);
  border-bottom:3px solid transparent;margin-bottom:-2px;min-height:44px}
.tab.active{color:var(--accent);border-bottom-color:var(--accent)}
.tab .count{font-size:.8em;opacity:.7}

.toc{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:14px 18px;margin-bottom:22px;box-shadow:var(--shadow)}
.toc b{font-size:.8em;text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.toc a{display:block;padding:6px 0;text-decoration:none;font-size:.93em}
.study-sec{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:8px 26px 18px;
  margin-bottom:22px;box-shadow:var(--shadow)}
.study-sec>h2{border-bottom:2px solid var(--accent-soft);padding-bottom:.35em}

.q-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:20px}
.q-tools .spacer{flex:1}
.chip{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:999px;
  padding:7px 15px;cursor:pointer;font:inherit;font-size:.85em;min-height:38px}
.chip.active{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
@media (prefers-color-scheme: dark){.chip.active{color:${BG_DARK}}}
.card{background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--border);border-radius:12px;
  margin-bottom:16px;box-shadow:var(--shadow);overflow:hidden}
.card.l-basico{border-left-color:var(--green)}
.card.l-intermediario{border-left-color:var(--yellow)}
.card.l-avancado{border-left-color:var(--red)}
.card-q{padding:15px 20px;cursor:pointer;display:flex;gap:12px;align-items:flex-start}
.card-q .qt{font-weight:600;flex:1}
.card-q .toggle{color:var(--muted);font-size:.82em;white-space:nowrap;padding-top:2px}
.card-a{display:none;padding:4px 22px 14px;border-top:1px dashed var(--border)}
.card.open .card-a{display:block}
.card-mark{display:flex;gap:8px;align-items:center;padding:10px 20px 14px;border-top:1px solid var(--border);
  flex-wrap:wrap;background:color-mix(in srgb, var(--panel) 70%, var(--bg))}
.card-mark span.lbl{font-size:.78em;color:var(--muted);margin-right:4px}
.mark-btn{border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:8px;
  padding:7px 12px;cursor:pointer;font-size:.85em;min-height:38px}
.mark-btn.sel-ok{background:var(--green);border-color:var(--green);color:#fff}
.mark-btn.sel-meh{background:var(--yellow);border-color:var(--yellow);color:#fff}
.mark-btn.sel-bad{background:var(--red);border-color:var(--red);color:#fff}
.q-intro{margin-bottom:18px;color:var(--muted)}
.empty{color:var(--muted);text-align:center;padding:40px 0;font-style:italic}

.quiz-head{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--border);
  border-radius:12px;padding:12px 18px;margin-bottom:22px;box-shadow:var(--shadow)}
.quiz-head .score{font-weight:700;font-size:1.05em}
.quiz-head .score .ok{color:var(--green)}
.quiz-head .detail{color:var(--muted);font-size:.85em;flex:1;min-width:180px}
.qz{background:var(--panel);border:1px solid var(--border);border-left:4px solid var(--border);border-radius:12px;
  margin-bottom:18px;box-shadow:var(--shadow);padding:16px 20px 14px}
.qz.l-basico{border-left-color:var(--green)}
.qz.l-intermediario{border-left-color:var(--yellow)}
.qz.l-avancado{border-left-color:var(--red)}
.qz .qnum{font-size:.75em;font-weight:700;color:var(--muted);letter-spacing:.05em}
.qz .qtext{font-weight:600;margin:4px 0 12px}
.alt{display:flex;gap:11px;padding:12px 14px;border:1px solid var(--border);border-radius:10px;margin:8px 0;
  cursor:pointer;align-items:flex-start;transition:border-color .1s, background .1s;min-height:44px}
.alt .letter{font-weight:700;color:var(--accent);flex-shrink:0}
.alt:active{border-color:var(--accent)}
.alt.locked{cursor:default}
.alt.correct{border-color:var(--green);background:color-mix(in srgb, var(--green) 14%, var(--panel))}
.alt.correct .letter{color:var(--green)}
.alt.wrong{border-color:var(--red);background:color-mix(in srgb, var(--red) 12%, var(--panel))}
.alt.wrong .letter{color:var(--red)}
.alt.dim{opacity:.55}
.qz-exp{margin-top:12px;padding:12px 16px;border-radius:10px;font-size:.94em;background:var(--accent-soft);border:1px solid var(--border)}
.qz-exp .verdict{font-weight:700;display:block;margin-bottom:4px}
.qz-exp .verdict.ok{color:var(--green)}
.qz-exp .verdict.nok{color:var(--red)}

.home-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;margin:24px 0}
.home-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px;cursor:pointer;
  box-shadow:var(--shadow);transition:transform .12s}
.home-card .n{font-size:.78em;font-weight:700;color:var(--accent)}
.home-card .t{font-weight:600;margin:2px 0 6px}
.home-card .s{font-size:.83em;color:var(--muted)}
.home-card .qn{font-size:.76em;color:var(--muted);margin-top:8px}
.readme{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:8px 26px 18px;box-shadow:var(--shadow)}

.sync-box{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:18px 22px;
  margin-bottom:18px;box-shadow:var(--shadow)}
.sync-box h3{margin:.2em 0 .5em}
.sync-box p{color:var(--muted);font-size:.92em}
.sync-box textarea{width:100%;min-height:80px;font-family:'Cascadia Code',Consolas,monospace;font-size:.82em;
  padding:10px;border-radius:9px;border:1px solid var(--border);background:var(--code-bg);color:var(--text);resize:vertical}
.btn{border:1px solid var(--accent);background:var(--accent);color:#fff;border-radius:9px;padding:10px 18px;
  cursor:pointer;font:inherit;font-weight:600;min-height:44px;margin:6px 6px 0 0}
@media (prefers-color-scheme: dark){.btn{color:${BG_DARK}}}
.btn.ghost{background:var(--panel);color:var(--text);border-color:var(--border)}
.note{font-size:.85em;padding:10px 14px;border-radius:9px;margin-top:10px}
.note.ok{background:color-mix(in srgb, var(--green) 15%, var(--panel));border:1px solid var(--green)}
.note.err{background:color-mix(in srgb, var(--red) 12%, var(--panel));border:1px solid var(--red)}

/* desempenho por nível */
.perf{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:16px 20px;
  margin-bottom:18px;box-shadow:var(--shadow)}
.perf h3{margin:.1em 0 .7em;font-size:1em}
.perf-row{display:flex;align-items:center;gap:10px;margin:7px 0;font-size:.9em}
.perf-row .lv{width:78px;flex-shrink:0}
.perf-row .bar{flex:1;height:9px;background:var(--code-bg);border-radius:99px;overflow:hidden;min-width:60px}
.perf-row .bar i{display:block;height:100%;border-radius:99px;background:var(--accent)}
.perf-row .bar i.hi{background:var(--green)}
.perf-row .bar i.mid{background:var(--yellow)}
.perf-row .bar i.lo{background:var(--red)}
.perf-row .val{width:74px;text-align:right;flex-shrink:0;color:var(--muted);font-variant-numeric:tabular-nums}
.perf .hint{color:var(--muted);font-size:.84em;margin:10px 0 0}
.mini-perf{font-size:.78em;color:var(--muted);margin-top:6px}

/* atalhos da home */
.acoes{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:18px 0 22px}
.acao{display:flex;flex-direction:column;gap:2px;background:var(--panel);border:1px solid var(--border);
  border-radius:12px;padding:13px 15px;cursor:pointer;box-shadow:var(--shadow);text-align:left;
  font:inherit;color:inherit;min-height:64px}
.acao b{font-size:.95em}
.acao span{font-size:.79em;color:var(--muted)}
.acao.destaque{border-color:var(--accent)}

/* busca */
.busca-campo{display:flex;gap:8px;margin-bottom:16px}
.busca-campo input{flex:1;padding:12px 14px;border-radius:10px;border:1px solid var(--border);
  background:var(--panel);color:var(--text);font:inherit;font-size:1em;min-height:46px}
.busca-campo input:focus{outline:2px solid var(--accent);outline-offset:-1px}
.hit{background:var(--panel);border:1px solid var(--border);border-radius:11px;padding:12px 16px;
  margin-bottom:10px;cursor:pointer;box-shadow:var(--shadow)}
.hit .onde{font-size:.74em;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);font-weight:700}
.hit .tit{font-weight:600;margin:3px 0}
.hit .trecho{font-size:.87em;color:var(--muted);line-height:1.5}
mark{background:var(--accent-soft);color:var(--text);font-weight:700;padding:0 2px;border-radius:3px}

/* simulado */
.seg{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}
.seg button{flex:1;min-width:96px;min-height:52px;border:1px solid var(--border);background:var(--panel);
  color:var(--text);border-radius:11px;cursor:pointer;font:inherit;font-weight:600}
.seg button.on{background:var(--accent);border-color:var(--accent);color:#fff}
@media (prefers-color-scheme: dark){.seg button.on{color:${BG_DARK}}}
.sim-top{display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:var(--panel);
  border:1px solid var(--border);border-radius:12px;padding:11px 16px;margin-bottom:16px;box-shadow:var(--shadow)}
.sim-top .cont{font-weight:700;font-variant-numeric:tabular-nums}
.sim-top .barra{flex:1;height:7px;background:var(--code-bg);border-radius:99px;overflow:hidden;min-width:80px}
.sim-top .barra i{display:block;height:100%;background:var(--accent);border-radius:99px}
.sim-nav{display:flex;gap:10px;margin-top:16px;flex-wrap:wrap}
.sim-nav .btn{flex:1;min-width:120px}
.alt.escolhida{border-color:var(--accent);background:var(--accent-soft);font-weight:600}
.resultado{background:var(--panel);border:1px solid var(--border);border-radius:14px;padding:20px;
  margin-bottom:18px;box-shadow:var(--shadow);text-align:center}
.resultado .nota{font-size:2.5em;font-weight:800;line-height:1.1}
.resultado .sub{color:var(--muted)}

@media (hover:hover) and (pointer:fine){
  .nav-item:hover{background:var(--accent-soft)}
  .acao:hover{border-color:var(--accent)}
  .hit:hover{border-color:var(--accent)}
  .card-q:hover{background:var(--accent-soft)}
  .alt:hover{border-color:var(--accent);background:var(--accent-soft)}
  .alt.locked:hover{border-color:var(--border);background:none}
  .home-card:hover{transform:translateY(-2px);border-color:var(--accent)}
}

@media (max-width: 860px){
  html{scroll-behavior:auto}
  h1,h2,h3,h4{scroll-margin-top:calc(var(--bar) + 8px)}
  .topbar{display:flex;position:sticky;top:0;z-index:20;align-items:center;gap:12px;height:var(--bar);
    padding:0 14px;background:color-mix(in srgb, var(--bg) 92%, transparent);
    -webkit-backdrop-filter:saturate(180%) blur(12px);backdrop-filter:saturate(180%) blur(12px);
    border-bottom:1px solid var(--border)}
  .topbar button{border:none;background:none;color:var(--text);font-size:1.5em;cursor:pointer;
    width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
  .topbar .tb-title{font-weight:700;font-size:.98em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .layout{display:block}
  aside{position:fixed;top:0;left:0;z-index:30;width:min(300px,86vw);transform:translateX(-100%);
    transition:transform .2s ease;border-right:1px solid var(--border)}
  aside.open{transform:none;box-shadow:0 0 40px rgba(0,0,0,.35)}
  main{padding:18px 16px 64px;max-width:none}
  body.locked{overflow:hidden}
  .study-sec{padding:6px 16px 14px;border-radius:12px}
  .qz{padding:14px 15px 12px}
  .card-q{padding:14px 15px}
  .card-a{padding:4px 15px 12px}
  .card-mark{padding:10px 15px 12px}
  .quiz-head{padding:12px 15px}
  .toc{padding:12px 16px}
  .readme{padding:6px 16px 14px}
  .sync-box{padding:16px}
  .chip,.mark-btn{min-height:44px;padding:10px 16px;font-size:.88em}
  .nav-item{min-height:44px;padding:11px 12px}
  .tabs{gap:2px}
  .tab{padding:11px 12px;font-size:.94em}
  .topic-head h1{font-size:1.3em}
  .home-grid{grid-template-columns:1fr}
}
`;
}

/* ================================ auditoria do quiz ================================ */

// Um quiz só serve para autoavaliação se não der para gabaritar sem saber o
// assunto. Os dois vazamentos clássicos são a correta ser sempre a alternativa
// mais longa e a correta cair sempre na mesma letra — os dois são medidos aqui,
// e o build reclama alto quando passam do alvo.
const ALVO_MAIS_LONGA = 0.45; // acaso com 4 alternativas = 25%
const ALVO_POR_LETRA = 0.35; // acaso = 25%

function auditarQuiz(folder, quizBank) {
  const semMarcacao = (s) => s.replace(/\*\*/g, '').replace(/`/g, '').replace(/\*/g, '');
  const avisos = [];
  const letras = [0, 0, 0, 0, 0];
  let total = 0;
  let maisLonga = 0;

  for (const [tid, questoes] of Object.entries(quizBank)) {
    questoes.forEach((q, i) => {
      total++;
      letras[q.c]++;
      const tam = q.a.map((a) => semMarcacao(a).length);
      const maior = Math.max(...tam);
      const menor = Math.min(...tam);
      const correta = tam[q.c];
      const outras = tam.filter((_, k) => k !== q.c);
      const mediaOutras = outras.reduce((a, b) => a + b, 0) / outras.length;

      if (correta === maior) maisLonga++;

      const ref = `tema ${tid} questão ${i + 1}`;
      if (correta === maior && correta > mediaOutras * 1.3) {
        avisos.push(
          `${ref}: correta é a maior e passa ${(((correta / mediaOutras) - 1) * 100).toFixed(0)}% da média das outras`
        );
      }
      if ((maior - menor) / maior > 0.55) {
        avisos.push(`${ref}: maior alternativa tem ${maior} e menor tem ${menor} caracteres`);
      }
    });
  }

  if (!total) return;

  const pctLonga = maisLonga / total;
  const pctLetras = letras.map((n) => n / total);
  const piorLetra = Math.max(...pctLetras);
  const okLonga = pctLonga <= ALVO_MAIS_LONGA;
  const okLetra = piorLetra <= ALVO_POR_LETRA;

  const dist = pctLetras
    .slice(0, 4)
    .map((p, k) => `${'ABCD'[k]} ${(p * 100).toFixed(0)}%`)
    .join(' · ');

  console.log(`  auditoria do quiz (${total} questões)`);
  console.log(
    `    ${okLonga ? '✔' : '✖'} correta é a mais longa: ${(pctLonga * 100).toFixed(0)}% ` +
      `(alvo ≤ ${ALVO_MAIS_LONGA * 100}%)`
  );
  console.log(
    `    ${okLetra ? '✔' : '✖'} distribuição da correta: ${dist} ` +
      `(alvo ≤ ${ALVO_POR_LETRA * 100}% por letra)`
  );

  if (avisos.length) {
    console.log(`    ⚠ ${avisos.length} questão(ões) com alternativa desbalanceada:`);
    avisos.slice(0, 10).forEach((a) => console.log(`       ${a}`));
    if (avisos.length > 10) console.log(`       ... e mais ${avisos.length - 10}`);
  }
  if (!okLonga || !okLetra) {
    console.error(
      `    ✖ ${folder}: o quiz está gabaritável sem saber o assunto — reescreva as alternativas` +
        (okLetra ? '' : ' e rode "node balancear-quiz.mjs"')
    );
  }
}

/* ================================ site principal ================================ */

function buildSite(site) {
  const dir = join(ROOT, site.folder);
  const files = readdirSync(dir).filter((f) => /^\d{2}-.*\.md$/.test(f)).sort();

  const linkMap = {};
  for (const f of files) linkMap[f] = f.slice(0, 2);

  let quizBank = {};
  const quizPath = join(dir, 'quiz.json');
  if (existsSync(quizPath)) quizBank = JSON.parse(readFileSync(quizPath, 'utf8'));

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

  const totalQuestions = topics.reduce((a, t) => a + t.cards.length, 0);
  const totalQuiz = topics.reduce((a, t) => a + t.quiz.length, 0);

  // Impressão digital do layout: se as contagens mudarem, um código de progresso
  // antigo deixa de bater e o import avisa em vez de bagunçar as marcações.
  const layoutKey = topics.map((t) => `${t.id}:${t.cards.length}:${t.quiz.length}`).join('|');
  const fingerprint = fnv1a(layoutKey) & 0xffff;

  const data = {
    siteKey: site.folder,
    title: site.title,
    short: site.short,
    emoji: site.emoji,
    fp: fingerprint,
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
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="${BG_LIGHT}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${BG_DARK}" media="(prefers-color-scheme: dark)">
<meta name="apple-mobile-web-app-title" content="${site.short}">
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="apple-touch-icon-180.png">
<link rel="icon" type="image/png" sizes="192x192" href="icon-192.png">
<title>${site.emoji} ${site.title} — Estudos</title>
<style>${buildCss(site)}</style>
</head>
<body>
<header class="topbar">
  <button id="menuBtn" aria-label="Abrir menu de temas">☰</button>
  <span class="tb-title" id="tbTitle">${site.title}</span>
</header>
<div class="scrim" id="scrim"></div>
<div class="layout">
  <aside id="sidebar"></aside>
  <main id="main"></main>
</div>
<script id="site-data" type="application/json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<script>
const DATA = JSON.parse(document.getElementById('site-data').textContent);
DATA.readmeHtml = READMEHTML;
const SKEY = 'estudos:' + DATA.siteKey;
const LETTERS = ['A','B','C','D','E'];

/* localStorage seguro: em modo privado do iOS o acesso pode lancar excecao,
   e sem esta guarda o site inteiro morreria com tela em branco. */
const LS = (function(){
  try {
    var t = '__probe__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return { ok: true, get: function(k){ return localStorage.getItem(k); },
             set: function(k,v){ try { localStorage.setItem(k, v); } catch(e){} },
             del: function(k){ try { localStorage.removeItem(k); } catch(e){} } };
  } catch (e) {
    var mem = {};
    return { ok: false, get: function(k){ return k in mem ? mem[k] : null; },
             set: function(k,v){ mem[k] = String(v); },
             del: function(k){ delete mem[k]; } };
  }
})();

if (navigator.storage && navigator.storage.persist) { try { navigator.storage.persist(); } catch(e){} }

var ordemRevisao = LS.get(SKEY + ':ordem') === '1';
function toggleOrdem(){
  ordemRevisao = !ordemRevisao;
  LS.set(SKEY + ':ordem', ordemRevisao ? '1' : '0');
  renderHome();
}
function getMark(t, i){ return LS.get(SKEY + ':' + t + ':' + i) || ''; }
function setMark(t, i, v){ var k = SKEY + ':' + t + ':' + i; if (v) LS.set(k, v); else LS.del(k); }
function getQuizAns(t, i){ var v = LS.get(SKEY + ':quiz:v2:' + t + ':' + i); return v === null ? null : +v; }
function setQuizAns(t, i, v){ LS.set(SKEY + ':quiz:v2:' + t + ':' + i, String(v)); }
function clearQuiz(t){
  var top = DATA.topics.find(function(x){ return x.id === t; });
  if (top) top.quiz.forEach(function(_, i){ LS.del(SKEY + ':quiz:v2:' + t + ':' + i); });
}
function topicProgress(t){
  var done = 0;
  t.cards.forEach(function(c, i){ if (getMark(t.id, i)) done++; });
  return { done: done, total: t.cards.length };
}
function quizProgress(t){
  var answered = 0, correct = 0;
  t.quiz.forEach(function(q, i){
    var a = getQuizAns(t.id, i);
    if (a !== null){ answered++; if (a === q.c) correct++; }
  });
  return { answered: answered, correct: correct, total: t.quiz.length };
}

/* ---------- codigo de progresso (transferencia entre aparelhos) ----------
   Empacota em bits: 2 por questao aberta (vazio/ok/parcial/errei) e 3 por
   questao de quiz (nao respondida + ate 5 alternativas). Resultado em
   base64url cabe folgado numa URL ou numa mensagem. */
var MARKS = ['', 'ok', 'meh', 'bad'];
function b64url(bytes){
  var s = '';
  for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
}
function unb64url(str){
  var s = str.replace(/-/g,'+').replace(/_/g,'/');
  while (s.length % 4) s += '=';
  var bin = atob(s), out = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function encodeProgress(){
  var bits = [];
  var push = function(val, n){ for (var b = n - 1; b >= 0; b--) bits.push((val >> b) & 1); };
  push(2, 8);                    // versao do formato (2 = posicoes balanceadas)
  push(DATA.fp & 0xffff, 16);    // impressao digital do layout
  DATA.topics.forEach(function(t){
    t.cards.forEach(function(_, i){ push(MARKS.indexOf(getMark(t.id, i)) < 0 ? 0 : MARKS.indexOf(getMark(t.id, i)), 2); });
  });
  DATA.topics.forEach(function(t){
    t.quiz.forEach(function(_, i){
      var a = getQuizAns(t.id, i);
      push(a === null ? 0 : Math.min(a + 1, 7), 3);
    });
  });
  var bytes = new Uint8Array(Math.ceil(bits.length / 8));
  for (var i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 128 >> (i & 7);
  return b64url(bytes);
}
function decodeProgress(code){
  var bytes;
  try { bytes = unb64url(code.trim()); } catch (e) { return { error: 'Código inválido — confira se foi copiado por inteiro.' }; }
  var pos = 0;
  var read = function(n){ var v = 0; for (var k = 0; k < n; k++){ var bit = (bytes[pos >> 3] >> (7 - (pos & 7))) & 1; v = (v << 1) | bit; pos++; } return v; };
  var need = 24;
  DATA.topics.forEach(function(t){ need += t.cards.length * 2 + t.quiz.length * 3; });
  if (bytes.length * 8 < need) return { error: 'Código incompleto para este material.' };
  var ver = read(8);
  if (ver !== 2) return { error: 'Código gerado antes do rebalanceamento do quiz — as respostas não valem mais.' };
  var fp = read(16);
  var marks = [], quiz = [], nMarks = 0, nQuiz = 0;
  DATA.topics.forEach(function(t){
    t.cards.forEach(function(_, i){ var v = read(2); marks.push([t.id, i, MARKS[v]]); if (v) nMarks++; });
  });
  DATA.topics.forEach(function(t){
    t.quiz.forEach(function(_, i){ var v = read(3); quiz.push([t.id, i, v]); if (v) nQuiz++; });
  });
  return { fpMatch: fp === (DATA.fp & 0xffff), marks: marks, quiz: quiz, nMarks: nMarks, nQuiz: nQuiz };
}
function applyProgress(p){
  p.marks.forEach(function(m){ setMark(m[0], m[1], m[2]); });
  p.quiz.forEach(function(q){ if (q[2] > 0) setQuizAns(q[0], q[1], q[2] - 1); else LS.del(SKEY + ':quiz:v2:' + q[0] + ':' + q[1]); });
}

/* ---------- desempenho por nivel ----------
   A media geral esconde o que importa: dar 90% no basico e 30% no avancado
   soma um numero confortavel que nao diz se voce esta pronto. */
var NIVEIS = ['🟢','🟡','🔴'];
var NOME_NIVEL = { '🟢':'Básico', '🟡':'Intermediário', '🔴':'Avançado' };

function statsNivel(topicoId){
  var acc = { '🟢':{ok:0,n:0,tot:0}, '🟡':{ok:0,n:0,tot:0}, '🔴':{ok:0,n:0,tot:0} };
  DATA.topics.forEach(function(t){
    if (topicoId && t.id !== topicoId) return;
    t.quiz.forEach(function(q, i){
      var nv = acc[q.n]; if (!nv) return;
      nv.tot++;
      var a = getQuizAns(t.id, i);
      if (a !== null){ nv.n++; if (a === q.c) nv.ok++; }
    });
  });
  return acc;
}
function barraPerf(st){
  var h = '';
  NIVEIS.forEach(function(nv){
    var s = st[nv];
    var pct = s.n ? Math.round(100 * s.ok / s.n) : 0;
    var cls = !s.n ? '' : pct >= 75 ? 'hi' : pct >= 50 ? 'mid' : 'lo';
    h += '<div class="perf-row"><span class="lv">' + nv + ' ' + NOME_NIVEL[nv] + '</span>' +
         '<span class="bar"><i class="' + cls + '" style="width:' + (s.n ? pct : 0) + '%"></i></span>' +
         '<span class="val">' + (s.n ? pct + '% (' + s.ok + '/' + s.n + ')' : '—') + '</span></div>';
  });
  return h;
}
function miniPerf(topicoId){
  var st = statsNivel(topicoId), partes = [];
  NIVEIS.forEach(function(nv){
    var s = st[nv];
    if (s.tot) partes.push(nv + ' ' + (s.n ? s.ok + '/' + s.n : '—'));
  });
  return partes.join(' · ');
}

/* ---------- o que precisa de revisao ---------- */
function quizErrados(){
  var out = [];
  DATA.topics.forEach(function(t){
    t.quiz.forEach(function(q, i){
      var a = getQuizAns(t.id, i);
      if (a !== null && a !== q.c) out.push({ t: t.id, i: i });
    });
  });
  return out;
}
function abertasRevisar(){
  var out = [];
  DATA.topics.forEach(function(t){
    t.cards.forEach(function(c, i){
      var m = getMark(t.id, i);
      if (m === 'meh' || m === 'bad') out.push({ t: t.id, i: i, m: m });
    });
  });
  return out;
}

/* ---------- repeticao espacada leve ----------
   Sem virar Anki: guarda quando o tema foi tocado pela ultima vez e usa o
   desempenho para decidir quem esta devendo revisao primeiro. */
function marcarRevisao(tid){ LS.set(SKEY + ':rev:' + tid, String(Date.now())); }
function infoRevisao(t){
  var ts = LS.get(SKEY + ':rev:' + t.id);
  var qp = quizProgress(t);
  var acc = qp.answered ? qp.correct / qp.answered : null;
  if (!ts) return { dias: null, acc: acc, devendo: qp.answered > 0, prio: qp.answered ? 5 : 0 };
  var dias = Math.floor((Date.now() - (+ts)) / 86400000);
  // Desempenho ruim encurta o intervalo: 70% ou menos pede revisao em 3 dias.
  var limite = acc === null ? 7 : acc <= 0.7 ? 3 : acc <= 0.9 ? 7 : 14;
  return { dias: dias, acc: acc, devendo: dias >= limite, prio: dias / limite };
}
function temasDevendo(){
  return DATA.topics.filter(function(t){ return t.quiz.length && infoRevisao(t).devendo; });
}
function textoRevisao(t){
  var r = infoRevisao(t);
  if (r.dias === null) return '';
  if (r.dias === 0) return 'revisado hoje';
  if (r.dias === 1) return 'revisado ontem';
  return 'há ' + r.dias + ' dias';
}

/* ---------- navegacao lateral ---------- */
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('scrim').classList.remove('on');
  document.body.classList.remove('locked');
}
function openSidebar(){
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('scrim').classList.add('on');
  document.body.classList.add('locked');
}
document.getElementById('menuBtn').addEventListener('click', function(){
  var open = document.getElementById('sidebar').classList.contains('open');
  if (open) closeSidebar(); else openSidebar();
});
document.getElementById('scrim').addEventListener('click', closeSidebar);
document.addEventListener('keydown', function(e){ if (e.key === 'Escape') closeSidebar(); });

function renderSidebar(activeId){
  var el = document.getElementById('sidebar');
  var h = '<div class="brand"><span class="em">' + DATA.emoji + '</span><h1>' + DATA.title +
          '<small>material de entrevistas</small></h1></div>';
  h += '<a class="nav-item' + (activeId === 'home' ? ' active' : '') + '" href="#home"><span class="num">🏠</span> Início &amp; guia</a>';
  h += '<a class="nav-item' + (activeId === 'busca' ? ' active' : '') + '" href="#busca"><span class="num">🔎</span> Buscar</a>';
  h += '<div class="nav-label">Praticar</div>';
  h += '<a class="nav-item' + (activeId === 'simulado' ? ' active' : '') + '" href="#simulado"><span class="num">📝</span> Simulado</a>';
  var nRev = quizErrados().length + abertasRevisar().length;
  h += '<a class="nav-item' + (activeId === 'revisar' ? ' active' : '') + '" href="#revisar"><span class="num">🔁</span> Revisar erros' +
       '<span class="prog">' + (nRev ? nRev : '') + '</span></a>';
  h += '<a class="nav-item' + (activeId === 'sync' ? ' active' : '') + '" href="#sync"><span class="num">📲</span> Levar progresso</a>';
  h += '<div class="nav-label">Temas</div>';
  DATA.topics.forEach(function(t){
    var qp = quizProgress(t);
    var rev = infoRevisao(t);
    var badge = qp.total ? (qp.answered ? '🎯 ' + qp.correct + '/' + qp.answered : '🎯 ' + qp.total) : '';
    if (rev.devendo && qp.answered) badge = '⏰ ' + badge;
    h += '<a class="nav-item' + (activeId === t.id ? ' active' : '') + '" href="#topic/' + t.id + '">' +
         '<span class="num">' + t.id + '</span><span>' + t.shortTitle + '</span>' +
         '<span class="prog">' + badge + '</span></a>';
  });
  el.innerHTML = h;
  el.querySelectorAll('.nav-item').forEach(function(a){ a.addEventListener('click', closeSidebar); });
}

/* ---------- home ---------- */
function renderHome(){
  renderSidebar('home');
  document.getElementById('tbTitle').textContent = DATA.title;
  var totalQ = DATA.topics.reduce(function(a,t){ return a + t.cards.length; }, 0);
  var totalZ = DATA.topics.reduce(function(a,t){ return a + t.quiz.length; }, 0);
  var h = '<div class="topic-head"><h1>' + DATA.emoji + ' ' + DATA.title + '</h1>' +
          '<p class="sub">' + DATA.topics.length + ' temas · ' + totalQ + ' questões abertas comentadas · ' + totalZ + ' de múltipla escolha</p></div>';
  if (!LS.ok) h += '<div class="note err">⚠️ Este navegador está bloqueando o armazenamento local (modo privado?). O material funciona, mas o progresso não será salvo.</div>';

  var nRev = quizErrados().length + abertasRevisar().length;
  var devendo = temasDevendo();
  h += '<div class="acoes">' +
       '<button class="acao destaque" onclick="location.hash=\\'#simulado\\'"><b>📝 Simulado</b>' +
       '<span>Questões de todos os temas, misturadas</span></button>' +
       '<button class="acao" onclick="location.hash=\\'#revisar\\'"><b>🔁 Revisar erros</b>' +
       '<span>' + (nRev ? nRev + ' questões esperando' : 'Nada pendente') + '</span></button>' +
       '<button class="acao" onclick="location.hash=\\'#busca\\'"><b>🔎 Buscar</b>' +
       '<span>Procurar em todo o material</span></button>' +
       '</div>';

  var st = statsNivel(null);
  var respondidas = NIVEIS.reduce(function(a,nv){ return a + st[nv].n; }, 0);
  if (respondidas){
    h += '<div class="perf"><h3>Seu desempenho por nível</h3>' + barraPerf(st) +
         '<p class="hint">A média geral esconde o que decide: ir bem no básico e mal no avançado soma um número confortável que não diz se você está pronto.</p></div>';
  }

  if (ordemRevisao && devendo.length){
    h += '<div class="note ok" style="margin-bottom:14px">⏰ ' + devendo.length +
         ' tema(s) pedindo revisão aparecem primeiro.</div>';
  }

  var lista = DATA.topics.slice();
  if (ordemRevisao) lista.sort(function(a,b){ return infoRevisao(b).prio - infoRevisao(a).prio; });
  h += '<div class="q-tools" style="margin-bottom:10px">' +
       '<button class="chip' + (ordemRevisao ? ' active' : '') + '" onclick="toggleOrdem()">' +
       (ordemRevisao ? '⏰ Ordenado por revisão' : '⏰ Priorizar revisão') + '</button>' +
       (devendo.length ? '<span style="color:var(--muted);font-size:.85em;align-self:center">' + devendo.length + ' tema(s) devendo</span>' : '') +
       '</div>';

  h += '<div class="home-grid">';
  lista.forEach(function(t){
    var qp = quizProgress(t);
    var rev = infoRevisao(t);
    var quando = textoRevisao(t);
    h += '<div class="home-card" onclick="location.hash=\\'#topic/' + t.id + '\\'">' +
         '<div class="n">TEMA ' + t.id + (rev.devendo && qp.answered ? ' · ⏰ revisar' : '') + '</div>' +
         '<div class="t">' + t.shortTitle + '</div>' +
         '<div class="s">' + t.subtitle + '</div>' +
         '<div class="qn">❓ ' + t.cards.length + ' abertas · 🎯 ' + t.quiz.length + ' quiz' +
         (qp.answered ? ' — ' + qp.correct + '/' + qp.answered + ' acertos' : '') +
         (quando ? ' · ' + quando : '') + '</div>' +
         (qp.answered ? '<div class="mini-perf">' + miniPerf(t.id) + '</div>' : '') +
         '</div>';
  });
  h += '</div>';
  h += '<div class="readme"><h2>Como usar este material</h2>' + DATA.readmeHtml + '</div>';
  document.getElementById('main').innerHTML = h;
  bindTopicLinks();
  window.scrollTo(0,0);
}

/* ---------- transferir progresso ---------- */
function renderSync(){
  renderSidebar('sync');
  document.getElementById('tbTitle').textContent = 'Levar progresso';
  var code = encodeProgress();
  var marks = 0, quizzes = 0;
  DATA.topics.forEach(function(t){
    t.cards.forEach(function(_, i){ if (getMark(t.id, i)) marks++; });
    t.quiz.forEach(function(_, i){ if (getQuizAns(t.id, i) !== null) quizzes++; });
  });
  var base = location.origin + location.pathname;
  var link = base + '?p=' + code;
  var h = '<div class="topic-head"><h1>📲 Levar progresso para outro aparelho</h1>' +
          '<p class="sub">Seu progresso fica salvo só neste navegador. Para continuar de onde parou no celular (ou voltar para o PC), use o link ou o código abaixo.</p></div>';
  h += '<div class="sync-box"><h3>1. Exportar deste aparelho</h3>' +
       '<p>Marcações: <strong>' + marks + '</strong> · Respostas de quiz: <strong>' + quizzes + '</strong></p>' +
       '<p>Abra este link no outro aparelho (mande no WhatsApp para você mesmo, por exemplo):</p>' +
       '<textarea id="expLink" readonly onclick="this.select()">' + link + '</textarea>' +
       '<button class="btn" onclick="copyText(document.getElementById(\\'expLink\\').value, this)">📋 Copiar link</button>' +
       '<button class="btn ghost" onclick="downloadBackup()">💾 Baixar backup</button>' +
       '<div id="copyNote"></div></div>';
  h += '<div class="sync-box"><h3>2. Importar neste aparelho</h3>' +
       '<p>Cole aqui um link ou código gerado no outro aparelho:</p>' +
       '<textarea id="impCode" placeholder="Cole o link ou o código aqui..."></textarea>' +
       '<button class="btn" onclick="doImport()">⬇️ Importar progresso</button>' +
       '<div id="impNote"></div></div>';
  h += '<div class="sync-box"><h3>Dica para o celular</h3>' +
       '<p>Instale o material na tela de início (no iPhone: Compartilhar → <em>Adicionar à Tela de Início</em>; no Android: menu → <em>Instalar app</em>). ' +
       'Além de abrir sem a barra do navegador e funcionar offline, isso protege seu progresso: o Safari apaga dados de sites não visitados por 7 dias, mas não os de apps instalados. ' +
       'Importe seu progresso <strong>depois</strong> de instalar — o app instalado tem armazenamento separado da aba normal.</p></div>';
  document.getElementById('main').innerHTML = h;
  window.scrollTo(0,0);
}
function copyText(txt, btn){
  var done = function(){ document.getElementById('copyNote').innerHTML = '<div class="note ok">✅ Copiado! Agora é só colar no outro aparelho.</div>'; };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(done, function(){ fallbackCopy(txt, done); });
  } else fallbackCopy(txt, done);
}
function fallbackCopy(txt, done){
  var ta = document.getElementById('expLink');
  ta.select(); ta.setSelectionRange(0, 99999);
  try { document.execCommand('copy'); done(); }
  catch (e) { document.getElementById('copyNote').innerHTML = '<div class="note err">Não consegui copiar automaticamente — selecione o texto acima e copie manualmente.</div>'; }
}
function downloadBackup(){
  var payload = { v: 1, site: DATA.siteKey, code: encodeProgress() };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'progresso-' + DATA.siteKey + '.json';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(a.href); }, 1000);
}
function doImport(){
  var raw = document.getElementById('impCode').value.trim();
  var note = document.getElementById('impNote');
  if (!raw){ note.innerHTML = '<div class="note err">Cole o link ou o código primeiro.</div>'; return; }
  var m = raw.match(/[?&]p=([A-Za-z0-9_-]+)/);
  var code = m ? m[1] : raw;
  var p = decodeProgress(code);
  if (p.error){ note.innerHTML = '<div class="note err">' + p.error + '</div>'; return; }
  var aviso = p.fpMatch ? '' : '\\n\\nATENÇÃO: este código foi gerado para uma versão diferente do material. As marcações podem ficar trocadas.';
  if (!confirm('Importar ' + p.nMarks + ' marcações e ' + p.nQuiz + ' respostas de quiz?\\n\\nIsto substitui o progresso deste aparelho.' + aviso)) return;
  applyProgress(p);
  note.innerHTML = '<div class="note ok">✅ Progresso importado! ' + p.nMarks + ' marcações e ' + p.nQuiz + ' respostas restauradas.</div>';
  renderSidebar('sync');
}

/* ---------- simulado ----------
   Estudar tema a tema da uma falsa sensacao de dominio, porque o contexto ja
   entrega metade da resposta. Aqui as questoes vem de todos os temas
   misturadas e o gabarito so aparece no fim. */
function simGet(){ try { return JSON.parse(LS.get(SKEY + ':sim') || 'null'); } catch(e){ return null; } }
function simSet(s){ LS.set(SKEY + ':sim', JSON.stringify(s)); }
function simClear(){ LS.del(SKEY + ':sim'); }

function simIniciar(n){
  var todas = [];
  DATA.topics.forEach(function(t){ t.quiz.forEach(function(_, i){ todas.push([t.id, i]); }); });
  for (var k = todas.length - 1; k > 0; k--){
    var j = Math.floor(Math.random() * (k + 1));
    var tmp = todas[k]; todas[k] = todas[j]; todas[j] = tmp;
  }
  var itens = todas.slice(0, Math.min(n, todas.length));
  simSet({ itens: itens, resp: itens.map(function(){ return null; }), pos: 0, fim: false });
  renderSimulado();
}
function simEscolher(j){
  var s = simGet(); if (!s || s.fim) return;
  s.resp[s.pos] = j; simSet(s); renderSimulado();
}
function simIr(d){
  var s = simGet(); if (!s) return;
  s.pos = Math.max(0, Math.min(s.itens.length - 1, s.pos + d)); simSet(s); renderSimulado();
}
function simFinalizar(){
  var s = simGet(); if (!s) return;
  var faltam = s.resp.filter(function(r){ return r === null; }).length;
  if (faltam && !confirm(faltam + ' questão(ões) sem resposta serão contadas como erro. Finalizar mesmo assim?')) return;
  s.fim = true; simSet(s);
  s.itens.forEach(function(ref){ marcarRevisao(ref[0]); });
  renderSimulado();
}
function simQuestao(ref){
  var t = DATA.topics.find(function(x){ return x.id === ref[0]; });
  return { t: t, q: t.quiz[ref[1]] };
}

function renderSimulado(){
  renderSidebar('simulado');
  document.getElementById('tbTitle').textContent = 'Simulado';
  var s = simGet();
  var h = '';

  if (!s){
    var totalQ = DATA.topics.reduce(function(a,t){ return a + t.quiz.length; }, 0);
    h += '<div class="topic-head"><h1>📝 Simulado</h1>' +
         '<p class="sub">Questões sorteadas de todos os ' + DATA.topics.length + ' temas, misturadas. ' +
         'O gabarito só aparece no fim, com o resultado separado por tema e por nível.</p></div>';
    h += '<div class="sync-box"><h3>Quantas questões?</h3>' +
         '<div class="seg">' +
         '<button onclick="simIniciar(20)">20<br><span style="font-weight:400;font-size:.8em">~10 min</span></button>' +
         '<button onclick="simIniciar(40)">40<br><span style="font-weight:400;font-size:.8em">~20 min</span></button>' +
         '<button onclick="simIniciar(' + totalQ + ')">Todas<br><span style="font-weight:400;font-size:.8em">' + totalQ + ' questões</span></button>' +
         '</div>' +
         '<p style="color:var(--muted);font-size:.87em;margin-top:12px">As respostas do simulado são independentes do quiz por tema — fazer simulado não altera o seu progresso nos temas.</p>' +
         '</div>';
    document.getElementById('main').innerHTML = h;
    window.scrollTo(0,0);
    return;
  }

  if (s.fim){
    var acertos = 0;
    var porTema = {}, porNivel = { '🟢':{ok:0,n:0}, '🟡':{ok:0,n:0}, '🔴':{ok:0,n:0} };
    s.itens.forEach(function(ref, k){
      var o = simQuestao(ref), ok = s.resp[k] === o.q.c;
      if (ok) acertos++;
      if (!porTema[ref[0]]) porTema[ref[0]] = { ok:0, n:0, nome:o.t.shortTitle };
      porTema[ref[0]].n++; if (ok) porTema[ref[0]].ok++;
      var nv = porNivel[o.q.n]; if (nv){ nv.n++; if (ok) nv.ok++; }
    });
    var pct = Math.round(100 * acertos / s.itens.length);
    h += '<div class="topic-head"><h1>📝 Resultado do simulado</h1></div>';
    h += '<div class="resultado"><div class="nota">' + pct + '%</div>' +
         '<div class="sub">' + acertos + ' de ' + s.itens.length + ' questões</div></div>';

    h += '<div class="perf"><h3>Por nível</h3>';
    NIVEIS.forEach(function(nv){
      var d = porNivel[nv];
      var p = d.n ? Math.round(100 * d.ok / d.n) : 0;
      var cls = !d.n ? '' : p >= 75 ? 'hi' : p >= 50 ? 'mid' : 'lo';
      h += '<div class="perf-row"><span class="lv">' + nv + ' ' + NOME_NIVEL[nv] + '</span>' +
           '<span class="bar"><i class="' + cls + '" style="width:' + p + '%"></i></span>' +
           '<span class="val">' + (d.n ? p + '% (' + d.ok + '/' + d.n + ')' : '—') + '</span></div>';
    });
    h += '</div>';

    h += '<div class="perf"><h3>Por tema</h3>';
    Object.keys(porTema).sort().forEach(function(tid){
      var d = porTema[tid];
      var p = Math.round(100 * d.ok / d.n);
      var cls = p >= 75 ? 'hi' : p >= 50 ? 'mid' : 'lo';
      h += '<div class="perf-row"><span class="lv">' + tid + '</span>' +
           '<span class="bar"><i class="' + cls + '" style="width:' + p + '%"></i></span>' +
           '<span class="val">' + d.ok + '/' + d.n + '</span></div>';
    });
    h += '<p class="hint">Tema com desempenho baixo aqui é onde vale voltar a estudar.</p></div>';

    h += '<button class="btn" onclick="simClear();renderSimulado()">🔁 Novo simulado</button>' +
         '<button class="btn ghost" onclick="location.hash=\\'#home\\'">Voltar ao início</button>';

    h += '<h2 style="margin-top:26px">Revisão das questões</h2>';
    s.itens.forEach(function(ref, k){
      var o = simQuestao(ref), marcou = s.resp[k], ok = marcou === o.q.c;
      h += '<div class="qz l-' + o.q.levelName + '">' +
           '<div class="qnum">' + (k+1) + ' · TEMA ' + ref[0] + ' · ' + o.q.n + ' · ' + (ok ? '✅ acertou' : '❌ errou') + '</div>' +
           '<div class="qtext">' + o.q.q + '</div>';
      o.q.a.forEach(function(alt, j){
        var cls = 'alt locked' + (j === o.q.c ? ' correct' : (j === marcou ? ' wrong' : ' dim'));
        h += '<div class="' + cls + '"><span class="letter">' + LETTERS[j] + '</span><span>' + alt + '</span></div>';
      });
      h += '<div class="qz-exp">' + o.q.e + '</div></div>';
    });
    document.getElementById('main').innerHTML = h;
    window.scrollTo(0,0);
    return;
  }

  var ref = s.itens[s.pos], o = simQuestao(ref);
  var respondidas = s.resp.filter(function(r){ return r !== null; }).length;
  h += '<div class="sim-top"><span class="cont">' + (s.pos+1) + ' / ' + s.itens.length + '</span>' +
       '<span class="barra"><i style="width:' + Math.round(100*respondidas/s.itens.length) + '%"></i></span>' +
       '<button class="chip" onclick="simFinalizar()">Finalizar</button>' +
       '<button class="chip" onclick="if(confirm(\\'Descartar este simulado?\\')){simClear();renderSimulado()}">Sair</button></div>';
  h += '<div class="qz l-' + o.q.levelName + '">' +
       '<div class="qnum">' + o.q.n + ' · TEMA ' + ref[0] + '</div>' +
       '<div class="qtext">' + o.q.q + '</div>';
  o.q.a.forEach(function(alt, j){
    h += '<div class="alt' + (s.resp[s.pos] === j ? ' escolhida' : '') + '" onclick="simEscolher(' + j + ')">' +
         '<span class="letter">' + LETTERS[j] + '</span><span>' + alt + '</span></div>';
  });
  h += '</div>';
  h += '<div class="sim-nav">' +
       (s.pos > 0 ? '<button class="btn ghost" onclick="simIr(-1)">← Anterior</button>' : '') +
       (s.pos < s.itens.length - 1
          ? '<button class="btn" onclick="simIr(1)">Próxima →</button>'
          : '<button class="btn" onclick="simFinalizar()">Ver resultado</button>') +
       '</div>';
  document.getElementById('main').innerHTML = h;
  window.scrollTo(0,0);
}

/* ---------- revisar erros ---------- */
var revFeitos = {};
function revResponderQuiz(tid, i, j){
  var t = DATA.topics.find(function(x){ return x.id === tid; });
  setQuizAns(tid, i, j);
  marcarRevisao(tid);
  if (j === t.quiz[i].c) revFeitos[tid + ':' + i] = true;
  renderRevisar();
}
function revMarcar(tid, i, v){
  setMark(tid, i, v);
  marcarRevisao(tid);
  if (v === 'ok') revFeitos['a' + tid + ':' + i] = true;
  renderRevisar();
}
function renderRevisar(){
  renderSidebar('revisar');
  document.getElementById('tbTitle').textContent = 'Revisar erros';
  var errs = quizErrados();
  var abertas = abertasRevisar();
  var resolvidosQuiz = Object.keys(revFeitos).filter(function(k){ return k.indexOf('a') !== 0; });
  var resolvidasAb = Object.keys(revFeitos).filter(function(k){ return k.indexOf('a') === 0; });

  var h = '<div class="topic-head"><h1>🔁 Revisar erros</h1>' +
          '<p class="sub">Tudo que você errou ou marcou como dúvida, de todos os temas, reunido para refazer. Ao acertar, sai da lista.</p></div>';

  if (!errs.length && !abertas.length && !resolvidosQuiz.length && !resolvidasAb.length){
    h += '<p class="empty">Nada para revisar — você não tem questões erradas nem marcadas como dúvida.</p>';
    document.getElementById('main').innerHTML = h;
    window.scrollTo(0,0);
    return;
  }

  if (errs.length || resolvidosQuiz.length){
    h += '<h2>🎯 Quiz errado (' + errs.length + ')</h2>';
    var vistos = {};
    errs.concat(resolvidosQuiz.map(function(k){ var p = k.split(':'); return { t:p[0], i:+p[1] }; }))
      .forEach(function(r){
        var key = r.t + ':' + r.i;
        if (vistos[key]) return; vistos[key] = 1;
        var t = DATA.topics.find(function(x){ return x.id === r.t; });
        var q = t.quiz[r.i], ans = getQuizAns(r.t, r.i), acertou = ans === q.c;
        h += '<div class="qz l-' + q.levelName + '">' +
             '<div class="qnum">TEMA ' + r.t + ' · ' + q.n + (acertou ? ' · ✅ resolvido' : '') + '</div>' +
             '<div class="qtext">' + q.q + '</div>';
        q.a.forEach(function(alt, j){
          if (acertou){
            var cls = 'alt locked' + (j === q.c ? ' correct' : ' dim');
            h += '<div class="' + cls + '"><span class="letter">' + LETTERS[j] + '</span><span>' + alt + '</span></div>';
          } else {
            h += '<div class="alt" onclick="revResponderQuiz(\\'' + r.t + '\\',' + r.i + ',' + j + ')">' +
                 '<span class="letter">' + LETTERS[j] + '</span><span>' + alt + '</span></div>';
          }
        });
        if (acertou) h += '<div class="qz-exp"><span class="verdict ok">✅ Agora sim — sai da lista.</span>' + q.e + '</div>';
        else if (ans !== null) h += '<div class="qz-exp"><span class="verdict nok">Você marcou ' + LETTERS[ans] + ' da última vez.</span>Tente de novo antes de ver a explicação.</div>';
        h += '</div>';
      });
  }

  if (abertas.length || resolvidasAb.length){
    h += '<h2 style="margin-top:24px">❓ Questões abertas em dúvida (' + abertas.length + ')</h2>';
    var vistas = {};
    abertas.concat(resolvidasAb.map(function(k){ var p = k.slice(1).split(':'); return { t:p[0], i:+p[1] }; }))
      .forEach(function(r){
        var key = r.t + ':' + r.i;
        if (vistas[key]) return; vistas[key] = 1;
        var t = DATA.topics.find(function(x){ return x.id === r.t; });
        var c = t.cards[r.i], m = getMark(r.t, r.i);
        h += '<div class="card l-' + c.levelName + '" id="rev-' + r.t + '-' + r.i + '">' +
             '<div class="card-q" onclick="var e=document.getElementById(\\'rev-' + r.t + '-' + r.i + '\\');e.classList.toggle(\\'open\\')">' +
             '<span class="qt"><span style="color:var(--muted);font-size:.8em">TEMA ' + r.t + '</span><br>' + c.titleHtml + '</span>' +
             '<span class="toggle">ver ▾</span></div>' +
             '<div class="card-a">' + c.bodyHtml +
             '<div class="card-mark"><span class="lbl">' + (m === 'ok' ? '✅ resolvido — sai da lista' : 'Como você foi agora?') + '</span>' +
             '<button class="mark-btn' + (m==='ok'?' sel-ok':'') + '" onclick="revMarcar(\\'' + r.t + '\\',' + r.i + ',\\'ok\\')">✅ Acertei</button>' +
             '<button class="mark-btn' + (m==='meh'?' sel-meh':'') + '" onclick="revMarcar(\\'' + r.t + '\\',' + r.i + ',\\'meh\\')">⚠️ Parcial</button>' +
             '<button class="mark-btn' + (m==='bad'?' sel-bad':'') + '" onclick="revMarcar(\\'' + r.t + '\\',' + r.i + ',\\'bad\\')">❌ Errei</button>' +
             '</div></div></div>';
      });
  }
  document.getElementById('main').innerHTML = h;
  bindTopicLinks();
  window.scrollTo(0,0);
}

/* ---------- busca ---------- */
var _idx = null;
function escHtml(s){ return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function semTags(h){
  return h.replace(/<[^>]+>/g,' ')
          .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"')
          .replace(/&#39;/g,"'").replace(/&amp;/g,'&')
          .replace(/\\s+/g,' ').trim();
}
function norm(s){ return s.normalize('NFD').replace(/[\\u0300-\\u036f]/g,'').toLowerCase(); }
function idxBusca(){
  if (_idx) return _idx;
  _idx = [];
  DATA.topics.forEach(function(t){
    var re = /<section class="study-sec" id="([^"]+)"><h2>(.*?)<\\/h2>/g, m, partes = [];
    while ((m = re.exec(t.studyHtml)) !== null) partes.push({ id:m[1], titulo:semTags(m[2]), ini:m.index });
    partes.forEach(function(p, k){
      var fim = k + 1 < partes.length ? partes[k+1].ini : t.studyHtml.length;
      _idx.push({ tid:t.id, tab:'estudo', tipo:'Estudo', ancora:p.id,
                  titulo:p.titulo, texto:semTags(t.studyHtml.slice(p.ini, fim)) });
    });
    t.cards.forEach(function(c, i){
      _idx.push({ tid:t.id, tab:'questoes', tipo:'Questão aberta', foco:'card-' + i,
                  titulo:semTags(c.titleHtml), texto:semTags(c.titleHtml + ' ' + c.bodyHtml) });
    });
    t.quiz.forEach(function(q, i){
      _idx.push({ tid:t.id, tab:'quiz', tipo:'Quiz', foco:'qz-' + i,
                  titulo:semTags(q.q), texto:semTags(q.q + ' ' + q.a.join(' · ') + ' ' + q.e) });
    });
  });
  return _idx;
}
function destacar(txt, alvo){
  var n = norm(txt), out = '', ini = 0, p = n.indexOf(alvo);
  while (p !== -1){
    out += escHtml(txt.slice(ini, p)) + '<mark>' + escHtml(txt.slice(p, p + alvo.length)) + '</mark>';
    ini = p + alvo.length;
    p = n.indexOf(alvo, ini);
  }
  return out + escHtml(txt.slice(ini));
}
var focoPendente = null;
function irPara(tid, tab, ancora, foco){
  focoPendente = { ancora: ancora, foco: foco };
  location.hash = '#topic/' + tid + '/' + tab;
}
function aplicarFoco(){
  if (!focoPendente) return;
  var f = focoPendente; focoPendente = null;
  setTimeout(function(){
    var el = document.getElementById(f.foco || f.ancora);
    if (!el) return;
    el.scrollIntoView({ block:'center' });
    var antes = el.style.outline;
    el.style.outline = '3px solid var(--accent)';
    el.style.outlineOffset = '3px';
    setTimeout(function(){ el.style.outline = antes; el.style.outlineOffset = ''; }, 1600);
  }, 60);
}
function buscar(){
  var termo = document.getElementById('q').value.trim();
  var alvo = norm(termo);
  var cx = document.getElementById('res');
  if (alvo.length < 2){ cx.innerHTML = '<p class="empty">Digite ao menos 2 caracteres.</p>'; return; }
  var achados = [];
  idxBusca().forEach(function(e){
    var p = norm(e.texto).indexOf(alvo);
    if (p === -1) return;
    var ini = Math.max(0, p - 70), fim = Math.min(e.texto.length, p + 160);
    achados.push({ e:e, trecho: (ini > 0 ? '… ' : '') + e.texto.slice(ini, fim) + (fim < e.texto.length ? ' …' : '') });
  });
  if (!achados.length){ cx.innerHTML = '<p class="empty">Nada encontrado para “' + escHtml(termo) + '”.</p>'; return; }
  var h = '<p style="color:var(--muted);font-size:.88em">' + achados.length + ' trecho(s) encontrados</p>';
  achados.slice(0, 40).forEach(function(a){
    var e = a.e;
    h += '<div class="hit" onclick="irPara(\\'' + e.tid + '\\',\\'' + e.tab + '\\',\\'' + (e.ancora||'') + '\\',\\'' + (e.foco||'') + '\\')">' +
         '<div class="onde">Tema ' + e.tid + ' · ' + e.tipo + '</div>' +
         '<div class="tit">' + destacar(e.titulo, alvo) + '</div>' +
         '<div class="trecho">' + destacar(a.trecho, alvo) + '</div></div>';
  });
  if (achados.length > 40) h += '<p class="empty">Mostrando os 40 primeiros de ' + achados.length + '.</p>';
  cx.innerHTML = h;
}
function renderBusca(){
  renderSidebar('busca');
  document.getElementById('tbTitle').textContent = 'Buscar';
  document.getElementById('main').innerHTML =
    '<div class="topic-head"><h1>🔎 Buscar no material</h1>' +
    '<p class="sub">Procura em resumos, questões abertas e quiz de todos os temas.</p></div>' +
    '<div class="busca-campo"><input id="q" type="search" placeholder="Ex.: idempotência, watermark, leakage..." autocomplete="off"></div>' +
    '<div id="res"></div>';
  var inp = document.getElementById('q');
  inp.addEventListener('input', buscar);
  inp.focus();
  window.scrollTo(0,0);
}

/* ---------- topico ---------- */
var levelFilter = 'todos';
var statusFilter = 'todas';

function renderTopic(id, tab){
  var t = DATA.topics.find(function(x){ return x.id === id; });
  if (!t){ location.hash = '#home'; return; }
  renderSidebar(id);
  document.getElementById('tbTitle').textContent = t.shortTitle;
  var cur = tab || 'estudo';
  if (cur === 'quiz' && !t.quiz.length) cur = 'questoes';

  var h = '<div class="topic-head"><h1>' + t.fullTitle + '</h1>' +
          (t.subtitle ? '<p class="sub">' + t.subtitle + '</p>' : '') + '</div>';
  h += '<div class="tabs">' +
       '<button class="tab' + (cur==='estudo'?' active':'') + '" onclick="goTab(\\'' + id + '\\',\\'estudo\\')">📖 Estudo</button>' +
       '<button class="tab' + (cur==='quiz'?' active':'') + '" onclick="goTab(\\'' + id + '\\',\\'quiz\\')">🎯 Quiz <span class="count">(' + t.quiz.length + ')</span></button>' +
       '<button class="tab' + (cur==='questoes'?' active':'') + '" onclick="goTab(\\'' + id + '\\',\\'questoes\\')">❓ Abertas <span class="count">(' + t.cards.length + ')</span></button>' +
       '</div>';

  if (cur === 'estudo'){
    if (t.toc.length > 1){
      h += '<nav class="toc"><b>Nesta página</b>';
      t.toc.forEach(function(s){
        h += '<a href="#' + s.id + '" onclick="event.preventDefault();document.getElementById(\\'' + s.id + '\\').scrollIntoView({behavior:\\'smooth\\'})">' + s.title + '</a>';
      });
      h += '</nav>';
    }
    h += t.studyHtml || '<p class="empty">Sem conteúdo de estudo neste tema.</p>';
  } else if (cur === 'quiz'){
    h += renderQuiz(t);
  } else {
    h += renderOpenQuestions(t);
  }
  document.getElementById('main').innerHTML = h;
  bindTopicLinks();
}

function goTab(id, tab){
  location.hash = '#topic/' + id + '/' + tab;
}

function renderQuiz(t){
  var qp = quizProgress(t);
  var h = '<div class="quiz-head">' +
          '<span class="score"><span class="ok">' + qp.correct + '</span> / ' + qp.answered + ' acertos</span>' +
          '<span class="detail">' + qp.answered + ' de ' + qp.total + ' respondidas — toque numa alternativa para responder.</span>' +
          '<button class="chip" onclick="if(confirm(\\'Apagar suas respostas deste tema?\\')){clearQuiz(\\'' + t.id + '\\');rerenderQuiz(\\'' + t.id + '\\');}">↺ Refazer</button>' +
          '</div>';
  // Acerto separado por nivel: e o que diz se o dominio e real ou so no basico.
  if (qp.answered) h += '<div class="perf"><h3>Neste tema, por nível</h3>' + barraPerf(statsNivel(t.id)) + '</div>';
  t.quiz.forEach(function(q, i){
    h += quizCardHtml(t, q, i);
  });
  return h;
}
function quizCardHtml(t, q, i){
  var ans = getQuizAns(t.id, i);
  var answered = ans !== null;
  var h = '<div class="qz l-' + q.levelName + '" id="qz-' + i + '">' +
          '<div class="qnum">QUESTÃO ' + (i+1) + ' DE ' + t.quiz.length + ' · ' + q.n + '</div>' +
          '<div class="qtext">' + q.q + '</div>';
  q.a.forEach(function(alt, j){
    var cls = 'alt';
    if (answered){
      cls += ' locked';
      if (j === q.c) cls += ' correct';
      else if (j === ans) cls += ' wrong';
      else cls += ' dim';
    }
    var click = answered ? '' : ' onclick="answerQuiz(\\'' + t.id + '\\',' + i + ',' + j + ')"';
    h += '<div class="' + cls + '"' + click + '><span class="letter">' + LETTERS[j] + '</span><span>' + alt + '</span></div>';
  });
  if (answered){
    var ok = ans === q.c;
    h += '<div class="qz-exp"><span class="verdict ' + (ok?'ok':'nok') + '">' +
         (ok ? '✅ Correto!' : '❌ Você marcou ' + LETTERS[ans] + ' — a correta é ' + LETTERS[q.c] + '.') +
         '</span>' + q.e + '</div>';
  }
  h += '</div>';
  return h;
}
/* Responder atualiza SO o card tocado: nada de re-render global, que perderia
   a posicao do scroll e fecharia as respostas ja abertas. */
function answerQuiz(tid, i, j){
  if (getQuizAns(tid, i) !== null) return;
  setQuizAns(tid, i, j);
  var t = DATA.topics.find(function(x){ return x.id === tid; });
  var el = document.getElementById('qz-' + i);
  if (el){
    var tmp = document.createElement('div');
    tmp.innerHTML = quizCardHtml(t, t.quiz[i], i);
    el.replaceWith(tmp.firstChild);
  }
  marcarRevisao(tid);
  var qp = quizProgress(t);
  var head = document.querySelector('.quiz-head');
  if (head){
    head.querySelector('.score').innerHTML = '<span class="ok">' + qp.correct + '</span> / ' + qp.answered + ' acertos';
    head.querySelector('.detail').textContent = qp.answered + ' de ' + qp.total + ' respondidas — toque numa alternativa para responder.';
    // O painel por nivel acompanha a resposta; se ainda nao existe (primeira do
    // tema), e criado logo depois do cabecalho, sem redesenhar a lista.
    var perf = document.querySelector('#main .perf');
    var corpo = '<h3>Neste tema, por nível</h3>' + barraPerf(statsNivel(tid));
    if (perf) perf.innerHTML = corpo;
    else {
      var novo = document.createElement('div');
      novo.className = 'perf';
      novo.innerHTML = corpo;
      head.insertAdjacentElement('afterend', novo);
    }
  }
  renderSidebar(tid);
}
function rerenderQuiz(tid){
  var t = DATA.topics.find(function(x){ return x.id === tid; });
  var main = document.getElementById('main');
  var head = main.querySelector('.quiz-head');
  if (!head) return;
  var wrapper = document.createElement('div');
  wrapper.innerHTML = renderQuiz(t);
  var first = main.querySelector('.quiz-head');
  var nodes = [];
  var n = first;
  while (n){ nodes.push(n); n = n.nextElementSibling; }
  nodes.forEach(function(x){ x.remove(); });
  while (wrapper.firstChild) main.appendChild(wrapper.firstChild);
  renderSidebar(tid);
}

function renderOpenQuestions(t){
  var h = '<div class="q-tools">' +
       chip('nivel','todos','Todos') + chip('nivel','🟢','🟢') + chip('nivel','🟡','🟡') + chip('nivel','🔴','🔴') +
       '<span class="spacer"></span>' +
       chip('status','todas','Todas') + chip('status','pendentes','Não marcadas') + chip('status','revisar','Revisar') +
       '</div>';
  if (t.questionsIntroHtml) h += '<div class="q-intro">' + t.questionsIntroHtml + '</div>';
  var shown = 0;
  t.cards.forEach(function(c, i){
    var mark = getMark(t.id, i);
    if (levelFilter !== 'todos' && c.level !== levelFilter) return;
    if (statusFilter === 'pendentes' && mark) return;
    if (statusFilter === 'revisar' && mark !== 'meh' && mark !== 'bad') return;
    shown++;
    h += '<div class="card l-' + c.levelName + '" id="card-' + i + '">' +
         '<div class="card-q" onclick="toggleCard(' + i + ')"><span class="qt">' + c.titleHtml + '</span>' +
         '<span class="toggle">ver ▾</span></div>' +
         '<div class="card-a">' + c.bodyHtml +
         '<div class="card-mark" id="cm-' + i + '"><span class="lbl">Como você foi?</span>' + markBtns(t.id, i, mark) +
         '</div></div></div>';
  });
  if (!shown) h += '<p class="empty">Nenhuma questão com esse filtro.</p>';
  return h;
}
function markBtns(tid, i, mark){
  var b = function(v, label){
    return '<button class="mark-btn' + (mark===v ? ' sel-' + v : '') + '" onclick="mark(\\'' + tid + '\\',' + i + ',\\'' + v + '\\')">' + label + '</button>';
  };
  return b('ok','✅ Acertei') + b('meh','⚠️ Parcial') + b('bad','❌ Errei') +
    (mark ? '<button class="mark-btn" onclick="mark(\\'' + tid + '\\',' + i + ',\\'\\')">limpar</button>' : '');
}
/* Marcar tambem atualiza so o proprio card. */
function mark(tid, i, v){
  setMark(tid, i, v);
  marcarRevisao(tid);
  var cm = document.getElementById('cm-' + i);
  if (cm) cm.innerHTML = '<span class="lbl">Como você foi?</span>' + markBtns(tid, i, getMark(tid, i));
  renderSidebar(tid);
}
function chip(kind, val, label){
  var active = (kind==='nivel' ? levelFilter : statusFilter) === val;
  return '<button class="chip' + (active?' active':'') + '" onclick="setFilter(\\'' + kind + '\\',\\'' + val + '\\')">' + label + '</button>';
}
function setFilter(kind, val){
  if (kind==='nivel') levelFilter = val; else statusFilter = val;
  var m = (location.hash || '').match(/^#topic\\/(\\d{2})(?:\\/(\\w+))?/);
  if (m) renderTopic(m[1], m[2] || 'estudo');
}
function toggleCard(i){
  var el = document.getElementById('card-' + i);
  el.classList.toggle('open');
  el.querySelector('.toggle').textContent = el.classList.contains('open') ? 'ocultar ▴' : 'ver ▾';
}
function bindTopicLinks(){
  document.querySelectorAll('.topic-link').forEach(function(a){
    a.addEventListener('click', function(e){ e.preventDefault(); location.hash = '#topic/' + a.dataset.topic; });
  });
}

/* ---------- roteamento (a aba entra no hash: #topic/03/quiz) ---------- */
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
function route(){
  var hash = location.hash || '#home';
  closeSidebar();
  // Os itens acertados ficam visiveis com a explicacao enquanto voce esta na
  // tela de revisao; ao sair, somem de vez.
  if (hash !== '#revisar') revFeitos = {};
  var m = hash.match(/^#topic\\/(\\d{2})(?:\\/(\\w+))?/);
  if (m){
    renderTopic(m[1], m[2] || 'estudo');
    window.scrollTo(0, 0);
    aplicarFoco();
  } else if (hash === '#sync'){
    renderSync();
  } else if (hash === '#simulado'){
    renderSimulado();
  } else if (hash === '#revisar'){
    renderRevisar();
  } else if (hash === '#busca'){
    renderBusca();
  } else {
    renderHome();
  }
}
window.addEventListener('hashchange', route);

/* Importa progresso vindo por link (?p=...) antes de desenhar a tela. */
(function(){
  var m = location.search.match(/[?&]p=([A-Za-z0-9_-]+)/);
  if (m){
    var p = decodeProgress(m[1]);
    if (!p.error){
      var aviso = p.fpMatch ? '' : '\\n\\nATENÇÃO: código gerado para outra versão do material.';
      if (confirm('Importar progresso deste link?\\n\\n' + p.nMarks + ' marcações e ' + p.nQuiz + ' respostas de quiz.\\nIsto substitui o progresso deste aparelho.' + aviso)) {
        applyProgress(p);
      }
    }
    history.replaceState(null, '', location.pathname + location.hash);
  }
  route();
})();

/* Service worker: leitura offline depois da primeira visita. So faz sentido
   sob http(s) — em file:// o arquivo ja e local. */
if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('sw.js').catch(function(){});
  });
}
</script>
</body>
</html>`;

  const finalHtml = html.replace('READMEHTML', JSON.stringify(readmeHtml));

  writeFileSync(join(dir, 'index.html'), finalHtml, 'utf8');

  // Manifest: caminhos relativos para o site continuar portátil em subpasta.
  const manifest = {
    name: `${site.title} — Estudos`,
    short_name: site.short,
    id: './',
    start_url: './',
    scope: './',
    display: 'standalone',
    orientation: 'portrait-primary',
    lang: 'pt-BR',
    dir: 'ltr',
    background_color: BG_LIGHT,
    theme_color: site.accent,
    description: `Material de estudo e quiz de ${site.title} para entrevistas técnicas.`,
    icons: [
      { src: './icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: './icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  writeFileSync(join(dir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2), 'utf8');

  // Cache versionado pelo conteúdo: rebuild novo ⇒ sw.js novo ⇒ cache novo.
  const version = (fnv1a(finalHtml) >>> 0).toString(36);
  const sw = `// Gerado por build-site.mjs — não editar à mão.
const CACHE = 'estudos-${site.folder}-${version}';
const ASSETS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon-180.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: abre instantâneo (e offline), mas busca a versão
// nova em segundo plano para a próxima abertura.
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // Links de importação de progresso (?p=) e de cache-busting (?v=) apontam para
  // o mesmo documento. Sem normalizar, cada variação guardaria uma cópia de
  // ~600 KB no cache.
  const key = url.search ? new Request(url.origin + url.pathname, { headers: e.request.headers }) : e.request;
  e.respondWith(
    caches.match(key).then((cached) => {
      const net = fetch(e.request)
        .then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(key, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || net;
    })
  );
});
`;
  writeFileSync(join(dir, 'sw.js'), sw, 'utf8');

  writeFileSync(join(dir, 'icon-192.png'), makeIcon(192, site.accent, site.icon));
  writeFileSync(join(dir, 'icon-512.png'), makeIcon(512, site.accent, site.icon));
  writeFileSync(join(dir, 'apple-touch-icon-180.png'), makeIcon(180, site.accent, site.icon));

  console.log(
    `✔ ${site.folder}/ — ${topics.length} temas, ${totalQuestions} abertas, ${totalQuiz} quiz, ` +
      `${(finalHtml.length / 1024).toFixed(0)} KB (v ${version})`
  );

  for (const t of topics) {
    if (t.cards.length === 0) console.warn(`  ⚠ tema ${t.id} sem questões abertas`);
    if (t.quiz.length === 0) console.warn(`  ⚠ tema ${t.id} sem quiz`);
  }
  for (const [tid, qs] of Object.entries(quizBank)) {
    qs.forEach((q, i) => {
      if (!Array.isArray(q.a) || q.a.length < 2 || q.c < 0 || q.c >= q.a.length) {
        console.error(`  ✖ quiz inválido: tema ${tid}, questão ${i + 1}`);
      }
    });
  }

  auditarQuiz(site.folder, quizBank);

  return { totalQuestions, totalQuiz, topics: topics.length };
}

/* ================================ hub da raiz ================================ */

function buildHub(stats) {
  const cards = SITES.map((s, i) => {
    const st = stats[i];
    return `    <a class="hub-card" href="./${s.folder}/" style="--c:${s.accent};--cd:${s.accentDark}">
      <span class="hub-em">${s.emoji}</span>
      <span class="hub-t">${s.title}</span>
      <span class="hub-s">${st.topics} temas · ${st.totalQuestions} questões abertas · ${st.totalQuiz} de múltipla escolha</span>
      <span class="hub-go">Abrir →</span>
    </a>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="theme-color" content="${BG_LIGHT}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${BG_DARK}" media="(prefers-color-scheme: dark)">
<title>Estudos — Engenharia de Dados &amp; Machine Learning</title>
<style>
:root{color-scheme:light dark;--bg:${BG_LIGHT};--panel:#fff;--text:#0f172a;--muted:#64748b;--border:#e2e8f0}
@media (prefers-color-scheme:dark){:root{--bg:${BG_DARK};--panel:#111a2e;--text:#e2e8f0;--muted:#94a3b8;--border:#1e293b}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;
  background:var(--bg);color:var(--text);font-family:'Segoe UI',system-ui,-apple-system,sans-serif;
  padding:24px 18px calc(24px + env(safe-area-inset-bottom));line-height:1.6}
.wrap{width:100%;max-width:560px}
h1{font-size:1.5em;margin:0 0 .2em;text-align:center}
.sub{color:var(--muted);text-align:center;margin:0 0 28px;font-size:.95em}
.hub-card{display:block;background:var(--panel);border:1px solid var(--border);border-left:5px solid var(--c);
  border-radius:14px;padding:20px 22px;margin-bottom:16px;text-decoration:none;color:inherit;
  box-shadow:0 1px 3px rgba(15,23,42,.08);transition:transform .12s,border-color .12s}
@media (prefers-color-scheme:dark){.hub-card{border-left-color:var(--cd);box-shadow:0 1px 3px rgba(0,0,0,.4)}}
@media (hover:hover){.hub-card:hover{transform:translateY(-2px)}}
.hub-card:active{transform:scale(.99)}
.hub-em{font-size:1.9em;display:block;margin-bottom:6px}
.hub-t{font-size:1.15em;font-weight:700;display:block}
.hub-s{color:var(--muted);font-size:.86em;display:block;margin-top:5px}
.hub-go{color:var(--c);font-weight:600;font-size:.9em;display:block;margin-top:12px}
@media (prefers-color-scheme:dark){.hub-go{color:var(--cd)}}
.foot{color:var(--muted);font-size:.8em;text-align:center;margin-top:26px;line-height:1.7}
</style>
</head>
<body>
<div class="wrap">
  <h1>📚 Material de Estudos</h1>
  <p class="sub">Preparação para entrevistas técnicas</p>
${cards}
  <p class="foot">Cada área abre um app próprio, que pode ser instalado na tela de início<br>e funciona offline depois da primeira visita.</p>
</div>
</body>
</html>`;
  writeFileSync(join(ROOT, 'index.html'), html, 'utf8');
  console.log(`✔ index.html (hub da raiz)`);
}

/* ================================ execução ================================ */

const stats = SITES.map((s) => buildSite(s));
buildHub(stats);
console.log('\nPronto. Abra index.html na raiz, ou publique a pasta inteira.');


