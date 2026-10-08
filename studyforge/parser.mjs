import { createHash } from 'node:crypto';
import { MODEL_VERSION, VERIFICATION_STATUS } from './model.mjs';

export const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');
const stableId = (kind, source, anchor) => `${kind}-${sha256(`${source}\0${anchor}`).slice(0, 20)}`;
const plain = (s) => s.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/!??\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[`*_>#~]/g, '').replace(/\s+/g, ' ').trim();
const difficulty = (value) => /b[aá]sico|🟢/iu.test(value) ? 'basic' : /intermedi[aá]rio|🟡/iu.test(value) ? 'intermediate' : /avan[cç]ado|🔴/iu.test(value) ? 'advanced' : null;
const looksLikeQuestion = (value) => /\?\s*["”]?$/u.test(value) || /^(?:O que|Qual|Como|Quando|Por que|Por quê|Explique|Descreva|Você|Sua|Seu|Erro de treino|Multiclasse|Naive Bayes|t-SNE|RAG ou|E se|Há|Existe|XGBoost|Modelo|Treino|Acurácia)\b/iu.test(value.trim());

function makeLineMap(raw) {
  const lines = [];
  const lineEnding = /\r\n|\n|\r/g;
  let start = 0, match;
  while ((match = lineEnding.exec(raw))) {
    const end = lineEnding.lastIndex;
    lines.push({ raw: raw.slice(start, end), text: raw.slice(start, match.index), start, end });
    start = end;
  }
  if (start < raw.length) lines.push({ raw: raw.slice(start), text: raw.slice(start), start, end: raw.length });
  return lines;
}
function span(lines, from, to, length) {
  const first = lines[from];
  const last = lines[Math.max(from, to - 1)];
  return { start: first?.start ?? length, end: last?.end ?? length, startLine: from + 1, endLine: Math.max(from + 1, to) };
}
function fenceTransition(text, state) {
  const m = text.match(/^\s{0,3}(`{3,}|~{3,})(.*)$/);
  if (!m) return false;
  const marker = m[1][0], width = m[1].length;
  if (!state) { state = { marker, width }; return state; }
  if (marker === state.marker && width >= state.width && !m[2].trim()) return null;
  return state;
}
function partitionMarkdown(raw, source, lines) {
  const parts = [], warnings = [];
  let fence = null, blockStart = 0, blockKind = null;
  const flush = (end) => {
    if (blockStart >= end) return;
    const sourceSpan = span(lines, blockStart, end, raw.length);
    const text = lines.slice(blockStart, end).map(x => x.text).join('\n');
    parts.push({ kind: blockKind, markdown: raw.slice(sourceSpan.start, sourceSpan.end), plainText: blockKind === 'code' ? text.replace(/^\s*(`{3,}|~{3,}).*$/gm, '').trim() : plain(text), source: sourceSpan });
  };
  for (let i=0;i<lines.length;i++) {
    const text = lines[i].text;
    const before = fence;
    const next = fenceTransition(text, fence);
    if (before || next) {
      if (!before) { flush(i); blockStart=i; blockKind='code'; }
      fence=next;
      if (before && !next) { flush(i+1); blockStart=i+1; blockKind=null; }
      continue;
    }
    const kind = !text.trim() ? 'blank' : /^#{1,6}\s/.test(text) ? 'heading' : /^\s*(?:[-*+]\s+|\d+[.)]\s+)/.test(text) ? 'list' : /^\s*\|.*\|\s*$/.test(text) ? 'table' : /^\s*>/.test(text) ? 'blockquote' : /^\s*\*\*/.test(text) ? 'question-or-emphasis' : 'paragraph';
    if (kind !== blockKind) { flush(i); blockStart=i; blockKind=kind; }
  }
  flush(lines.length);
  if (fence) warnings.push({code:'UNCLOSED_FENCE',message:'Bloco de código sem fechamento',source:{path:source,...span(lines,Math.max(0,lines.length-1),lines.length,raw.length)},excerpt:lines.at(-1)?.text.slice(0,180)??''});
  return {parts,warnings};
}

function parseInterview(lines, sourcePath, sourceHash, warnings) {
  const out=[]; let fence=null, group=null, sectionTitle='';
  for (let i=0;i<lines.length;i++) {
    const line=lines[i].text;
    const f=fenceTransition(line,fence); if(fence||f){fence=f;continue;}
    const h=line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(h) {
      if(h[1].length===2){sectionTitle=h[2];group=null;}
      if(h[1].length===3){const found=difficulty(h[2]);if(found)group=found;else if(/perguntas|cen[aá]rios|estudos de caso/iu.test(sectionTitle))group=null;}
      if(h[1].length===3 && /(?:Cenário\s+\d+|3\.\d+\s+|P\d+\.)/iu.test(h[2])) {
        let end=i+1, localFence=null;while(end<lines.length){const ft=fenceTransition(lines[end].text,localFence);if(localFence||ft){localFence=ft;end++;continue;}if(/^#{1,3}\s/.test(lines[end].text))break;end++;}
        const title=h[2].replace(/^(?:[🟢🟡🔴]\s*)/u,''); const kind=/cenário/iu.test(title)?'scenario':/^P\d+\./iu.test(title)?'question':'case-study';
        addQuestion({kind,title,body:lines.slice(i+1,end).map(x=>x.text).join('\n'),from:i,to:end,explicit:difficulty(h[2]),sectionTitle});i=end-1;
      }
      continue;
    }
    const p=line.match(/^\s*\*\*(?:([🟢🟡🔴])\s*)?P(\d+)\.\s*(.+?)\*\*\s*$/u);
    const genericCandidate=/perguntas/iu.test(sectionTitle)?line.match(/^\s*\*\*(?:([🟢🟡🔴])\s*)?(.+?)\*\*\s*$/u):null;
    const generic=genericCandidate&&(genericCandidate[1]||looksLikeQuestion(genericCandidate[2]))?genericCandidate:null;
    const calibrationLine=/calibra[cç][aã]o/iu.test(sectionTitle)?line.match(/^\s*\*\*(["“].+[?？]["”])\*\*\s*(?:[-—:]\s*)?(.*)$/u):null;
    const calibration=Boolean(calibrationLine);
    if(!p&&!generic&&!calibration) {
      const unknown=line.match(/^\s*\*\*(.+?)\*\*\s*$/u);
      if(/perguntas/iu.test(sectionTitle)&&unknown&&!/^(?:Resposta(?: modelo| esperada)?|Follow[- ]?up|Armadilha|Pegadinha)\b/i.test(unknown[1])) {
        warnings.push({code:'UNCLASSIFIED_INTERVIEW',message:'Bloco em seção de perguntas não reconhecido como enunciado; fonte preservada',source:{path:sourcePath,sha256:sourceHash,span:span(lines,i,i+1,0),anchor:sectionTitle},excerpt:unknown[1].slice(0,180)});
      }
      continue;
    }
    let end=i+1, localFence=null;
    while(end<lines.length) {
      const t=lines[end].text;
      const ft=fenceTransition(t,localFence);if(localFence||ft){localFence=ft;end++;continue;}
      if(/^#{1,6}\s/.test(t)||/^\s*\*\*(?:[🟢🟡🔴]\s*)?P\d+\./u.test(t))break;
      if(/calibra[cç][aã]o/iu.test(sectionTitle)&&/^\s*\*\*["“].+[?？]["”]\*\*/u.test(t))break;
      if(/perguntas/iu.test(sectionTitle)&&/^\s*\*\*(?:[🟢🟡🔴]\s*)?.+\*\*\s*$/.test(t)&&!/^\s*\*\*(?:Resposta|Follow-up|Armadilha|Pegadinha)\b/i.test(t))break;
      end++;
    }
    const rawBody=lines.slice(i+1,end).map(x=>x.text).join('\n');
    const label=calibration?calibrationLine[1]:p?p[3]:generic[2];
    const question=label.replace(/^(?:["“](.*)["”])$/u,'$1').trim();
    const m=rawBody.match(/(?:\*(?:Resposta modelo|Resposta esperada|Resposta)\s*:\*|\*\*(?:Resposta modelo|Resposta esperada|Resposta)\s*:\*\*)\s*([\s\S]*?)(?=\n\s*\*{1,2}\s*(?:Resposta|Follow-up|Armadilha|Pegadinha)|$)/iu);
    const answer=m?.[1]?.trim()??(calibration?[calibrationLine[2],rawBody].filter(Boolean).join('\n').trim():null);
    const followUps=[],traps=[];
    const bodyLines=rawBody.split('\n'), codeLines=new Set();let bodyFence=null;
    for(let n=0;n<bodyLines.length;n++){const ft=fenceTransition(bodyLines[n],bodyFence);if(bodyFence||ft){bodyFence=ft;codeLines.add(n);}}
    const searchableBody=bodyLines.map((s,n)=>codeLines.has(n)?' '.repeat(s.length):s).join('\n');
    for(const fm of searchableBody.matchAll(/(\*\*|\*)\s*(Follow-up(?:\s+[^:*]{1,40})?|Armadilha(?:\s+[^:*]{1,40})?|Pegadinha(?:\s+[^:*]{1,40})?)\s*:\1\s*([\s\S]*?)(?=\n\s*\*{1,2}\s*(?:Resposta|Follow-up|Armadilha|Pegadinha)|$)/giu)) {
      const relativeLine=rawBody.slice(0,fm.index).split('\n').length-1;
      const sourceSpan=span(lines,i+1+relativeLine,i+2+relativeLine,0);
      if(/Follow-up/i.test(fm[2])) {
        const content=fm[3].trim();
        let questionText=content, answerText=null;
        const arrow=content.match(/^([\s\S]*?)\s+→\s+([\s\S]*)$/u);
        const dash=content.match(/^([\s\S]*?["”']\*?)\s+[—–-]\s+([\s\S]*)$/u);
        const split=arrow??dash;
        if(split){questionText=split[1];answerText=split[2].trim().replace(/(?:\r?\n)?\s*---\s*$/u,'').trim();}
        followUps.push({question:questionText.replace(/^[*_]+|[*_]+$/g,'').trim(),answer:answerText,source:sourceSpan});
      } else traps.push(fm[3].trim().replace(/(?:\r?\n)?\s*---\s*$/u,'').trim());
    }
    let inFollowUpList=false;
    bodyLines.forEach((bodyLine,index)=>{
      if(codeLines.has(index))return;
      if(/^\s*\*Follow-ups?\b[^*]*:\*\s*$/iu.test(bodyLine)){inFollowUpList=true;return;}
      if(/^\s*\*{1,2}(?:Resposta|Armadilha|Pegadinha)\b/i.test(bodyLine))inFollowUpList=false;
      if(!inFollowUpList)return;
      const bullet=bodyLine.match(/^\s*[-*+]\s+(.+)$/u);if(!bullet)return;
      const relativeLine=i+1+index, content=bullet[1];
      const arrow=content.match(/^([\s\S]*?)\s+→\s+([\s\S]*)$/u);
      const dash=content.match(/^([\s\S]*?["”']\*?)\s+[—–-]\s+([\s\S]*)$/u);
      const split=arrow??dash;
      followUps.push({question:(split?split[1]:content).replace(/^[*_]+|[*_]+$/g,'').trim(),answer:split?split[2].trim().replace(/(?:\r?\n)?\s*---\s*$/u,'').trim():null,source:span(lines,relativeLine,relativeLine+1,0)});
    });
    bodyLines.forEach((bodyLine,index)=>{
      if(codeLines.has(index))return;
      const label=bodyLine.match(/^\s*\*{1,2}(Follow[- ]?up|Resposta(?:\s+modelo|\s+esperada)?|Armadilha|Pegadinha)[^*\r\n]*\*{0,2}/iu);
      const knownAnswer=/^\s*\*{1,2}Resposta(?: modelo| esperada)?\s*:\*{1,2}/iu.test(bodyLine);
      const knownTrap=/^\s*\*{1,2}(?:Armadilha|Pegadinha)(?:\s+[^:*]{1,40})?\s*:\*{1,2}/iu.test(bodyLine);
      const knownFollow=/^\s*\*{1,2}Follow-ups?(?:\s+[^:*]{1,40})?\s*:\*{1,2}/iu.test(bodyLine);
      if(label&&!knownAnswer&&!knownTrap&&!knownFollow) {
        const lineIndex=i+1+index;
        warnings.push({code:'UNCLASSIFIED_LABEL',message:'Rótulo de resposta/follow-up/trap não reconhecido; trecho preservado',source:{path:sourcePath,sha256:sourceHash,span:span(lines,lineIndex,lineIndex+1,0),anchor:sectionTitle},excerpt:bodyLine.slice(0,180)});
      }
    });
    const explicit=difficulty(p?.[1]??generic?.[1]??'');
    addQuestion({kind:calibration?'calibration':'question',title:question,body:rawBody,from:i,to:end,explicit,sectionTitle,answer,followUps,traps});
    i=end-1;
  }
  function addQuestion({kind,title,body,from,to,explicit,sectionTitle,answer,followUps=[],traps=[]}) {
    const sourceSpan=span(lines,from,to,0), anchor=`${sectionTitle}#${title}`;
    const level=explicit??group??null;
    const modelAnswer=answer??body.match(/(?:\*(?:Resposta modelo|Resposta esperada|Resposta)\s*:\*|\*\*(?:Resposta modelo|Resposta esperada|Resposta)\s*:\*\*)\s*([\s\S]*?)(?=\n\s*\*\s*(?:Follow-up|Armadilha|Pegadinha)|$)/iu)?.[1]?.trim()??(['scenario','case-study'].includes(kind)?body.trim():null);
    if(!level)warnings.push({code:'DIFFICULTY_UNKNOWN',message:'Dificuldade não identificada no conteúdo; mantida como null',source:{path:sourcePath,sha256:sourceHash,span:sourceSpan,anchor},excerpt:title.slice(0,180)});
    out.push({id:stableId('iq',sourcePath,anchor),kind,difficulty:level,difficultyReason:level?null:'A fonte não explicita grupo/emoji de dificuldade',question:title,modelAnswer,followUps,traps,sourceAnchor:anchor,source:{path:sourcePath,sha256:sourceHash,span:sourceSpan,anchor}});
  }
  return out;
}

export function parseTopic(rawMarkdown, sourcePath, options={}) {
  const lines=makeLineMap(rawMarkdown), sourceHash=sha256(rawMarkdown), {parts,warnings}=partitionMarkdown(rawMarkdown,sourcePath,lines);
  const headings=[];let fence=null;
  for(let i=0;i<lines.length;i++){const f=fenceTransition(lines[i].text,fence);if(fence||f){fence=f;continue;}const h=lines[i].text.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);if(h)headings.push({i,level:h[1].length,title:h[2]});}
  const h1=headings.find(x=>x.level===1), title=h1?.title.replace(/^\d+\s*[-—:]\s*/,'')??sourcePath.split('/').at(-1).replace(/^\d+-|\.md$/g,'');
  const sectionHeads=headings.filter(x=>x.level===2),sections=sectionHeads.map((h,index)=>{
    const end=sectionHeads[index+1]?.i??lines.length, s=span(lines,h.i,end,rawMarkdown.length),markdown=rawMarkdown.slice(s.start,s.end), heading=h.title;
    return {id:stableId('sec',sourcePath,heading),level:2,title:heading,markdown,plainText:plain(markdown.replace(/^##[^\r\n]*(?:\r?\n|$)/,'')),source:{path:sourcePath,sha256:sourceHash,span:s,anchor:stableId('anchor',sourcePath,heading)}};
  });
  const order=Number(sourcePath.match(/(?:^|\/)(\d{2})-/)?.[1]??0),domain=sourcePath.split('/')[0];
  const subtitle=lines.find((x,i)=>i>0&&/^>/.test(x.text))?.text.replace(/^>\s*/, '')??null;
  const topic={schemaVersion:MODEL_VERSION,id:stableId('topic',domain,sourcePath),order,domain,title,subtitle,source:{path:sourcePath,sha256:sourceHash},rawMarkdown,partitions:parts,sections,interviewQuestions:parseInterview(lines,sourcePath,sourceHash,warnings),quizQuestions:[],metadata:{verification:{status:VERIFICATION_STATUS,reason:'Factual review is a separate phase and has not been performed.'}}};
  return {topic,warnings};
}

export function parseQuiz(raw,source) {
  const hash=sha256(raw),errors=[],questions=[];let data;
  try{data=JSON.parse(raw);}catch(e){return {valid:false,errors:[{code:'JSON_INVALID',message:e.message,source}],questions:[],source:{path:source,sha256:hash}};}
  if(!data||typeof data!=='object'||Array.isArray(data))errors.push({code:'QUIZ_ROOT',message:'Esperado objeto mapeado por tema',source});
  for(const [theme,items] of Object.entries(data??{})){
    if(!/^\d{2}$/.test(theme)||!Array.isArray(items)){errors.push({code:'QUIZ_THEME',message:`${theme}: chave/lista de tema inválida`,source});continue;}
    items.forEach((q,index)=>{
      const pointer=`/${theme}/${index}`, fail=(message)=>errors.push({code:'QUIZ_ITEM',message:`${pointer}: ${message}`,source});
      if(!q||typeof q!=='object'||Array.isArray(q)){fail('item deve ser objeto');return;}
      if(!['🟢','🟡','🔴'].includes(q.n))fail('n deve ser dificuldade conhecida');
      if(typeof q.q!=='string'||!q.q.trim())fail('q obrigatório não vazio');
      if(!Array.isArray(q.a)||!q.a.length||q.a.some(x=>typeof x!=='string'||!x.trim()))fail('a deve conter alternativas não vazias');
      if(!Number.isInteger(q.c)||q.c<0||!Array.isArray(q.a)||q.c>=q.a.length)fail('c fora da faixa das alternativas');
      if(typeof q.e!=='string'||!q.e.trim())fail('e obrigatório não vazio');
      questions.push({id:stableId('qq',source,pointer),theme,index,n:q.n,q:q.q,a:q.a,c:q.c,e:q.e,pointer,source:{path:source,sha256:hash,pointer}});
    });
  }
  return {valid:errors.length===0,errors,questions,source:{path:source,sha256:hash}};
}
