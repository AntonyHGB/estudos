import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {compileAll,discoverTopics} from './cli.mjs';
import {parseQuiz,parseTopic,sha256} from './parser.mjs';
import {validateTopic} from './validate.mjs';

const fixture=async (p)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('ED01: 15 question titles, exact difficulty split, answers, typed follow-ups/traps and source spans',async()=>{
 const {topic}=parseTopic(await fixture('engenharia-de-dados/01-modelagem-de-dados.md'),'engenharia-de-dados/01-modelagem-de-dados.md');
 assert.equal(topic.interviewQuestions.length,15);
 assert.deepEqual(topic.interviewQuestions.reduce((a,q)=>(a[q.difficulty]=(a[q.difficulty]??0)+1,a),{}),{basic:3,intermediate:5,advanced:7});
 const first=topic.interviewQuestions[0];assert.match(first.question,/diferença entre OLTP e OLAP/);assert.ok(first.modelAnswer?.includes('padrão de acesso'));assert.equal(first.followUps.length,1);assert.equal(first.traps.length,0);
 assert.ok(first.followUps[0].answer.startsWith('Porque'));
 assert.equal(first.source.span.startLine,193);assert.equal(first.followUps[0].source.startLine,197);
 assert.equal(topic.rawMarkdown.slice(first.followUps[0].source.start,first.followUps[0].source.end).startsWith('*Follow-up esperado:*'),true);
 const grouped=topic.interviewQuestions.find(q=>q.followUps.length===3);assert.ok(grouped);assert.ok(grouped.followUps.every(f=>f.answer?.length&&f.source.startLine>0));
 const trap=topic.interviewQuestions.find(q=>q.traps.length);assert.ok(trap);assert.equal(trap.followUps.length,0);
 assert.equal(first.source.sha256,sha256(topic.rawMarkdown));assert.equal(topic.rawMarkdown.slice(first.source.span.start,first.source.span.end).includes(first.question),true);
 assert.equal(topic.metadata.verification.status,'unverified');assert.equal(topic.sections.length,3);
});

test('ED12: four resolved scenarios and five interview questions with source-attached answers',async()=>{
 const {topic}=parseTopic(await fixture('engenharia-de-dados/12-design-de-sistemas-de-dados.md'),'engenharia-de-dados/12-design-de-sistemas-de-dados.md');
 assert.equal(topic.interviewQuestions.length,9);assert.equal(topic.interviewQuestions.filter(q=>q.kind==='scenario').length,4);assert.equal(topic.interviewQuestions.filter(q=>q.kind==='question').length,5);
 assert.ok(topic.interviewQuestions.filter(q=>q.kind==='scenario').every(q=>q.modelAnswer&&q.source.span.end>q.source.span.start));
 assert.equal(topic.interviewQuestions[4].question.startsWith('P1.'),true);
});

test('ML01: 11 questions, source-tagged difficulty split, answers/follow-ups and no emoji in titles',async()=>{
 const {topic}=parseTopic(await fixture('machine-learning/01-fundamentos.md'),'machine-learning/01-fundamentos.md');
 assert.equal(topic.interviewQuestions.length,11);
 assert.deepEqual(topic.interviewQuestions.reduce((a,q)=>(a[q.difficulty]=(a[q.difficulty]??0)+1,a),{}),{basic:3,intermediate:4,advanced:4});
 assert.ok(topic.interviewQuestions.every(q=>!/^[🟢🟡🔴]/u.test(q.question)));
 assert.ok(topic.interviewQuestions.every(q=>q.modelAnswer));assert.equal(topic.interviewQuestions[0].followUps.length,2);
 assert.equal(topic.interviewQuestions[0].traps.length,0);
});

test('ML12: five cases, five calibration questions with body guidance, plus framework headings',async()=>{
 const {topic}=parseTopic(await fixture('machine-learning/12-ml-system-design.md'),'machine-learning/12-ml-system-design.md');
 assert.equal(topic.interviewQuestions.length,10);assert.equal(topic.interviewQuestions.filter(q=>q.kind==='case-study').length,5);
 const calibration=topic.interviewQuestions.filter(q=>q.kind==='calibration');assert.equal(calibration.length,5);
  assert.ok(calibration.every(q=>q.question.endsWith('?')&&q.modelAnswer&&q.modelAnswer.length>30&&q.difficulty===null&&q.difficultyReason));
 assert.ok(topic.sections.some(s=>s.title.includes('calibração')));assert.ok(topic.sections.some(s=>s.title.includes('Armadilhas')));
});

test('partition and UTF-16 spans reconstruct CRLF raw exactly; fence marker length/nesting protects fake questions',()=>{
 const raw='# T\r\n\r\n## 1. Perguntas\r\n### 🟢 Básico\r\n**P1. Real?**\r\n````md\r\n```short closer must not terminate\r\n**P99. fictícia?**\r\n````\r\n*Resposta modelo:* resposta\r\n';
 const a=parseTopic(raw,'engenharia-de-dados/01-fixture.md'),b=parseTopic(raw,'engenharia-de-dados/01-fixture.md');
 assert.equal(a.topic.partitions.map(p=>p.markdown).join(''),raw);assert.equal(a.topic.rawMarkdown,raw);assert.equal(a.topic.interviewQuestions.length,1);
 assert.equal(a.topic.interviewQuestions[0].id,b.topic.interviewQuestions[0].id);assert.deepEqual(a.topic.interviewQuestions,b.topic.interviewQuestions);
 for(const p of a.topic.partitions)assert.equal(raw.slice(p.source.start,p.source.end),p.markdown);
});

test('follow-up arrow answer and source span are individual; malformed interview labels warn with excerpt/span',()=>{
 const raw='## 2. Perguntas de entrevista\n### 🟢 Básico\n**P1. Teste?**\n*Resposta modelo:* corpo\n*Follow-up esperado:* "Pergunta?" → Porque a resposta importa.\n*Resposta modêlo:* rótulo incorreto\n**Bloco sem classificação**\n';
 const {topic,warnings}=parseTopic(raw,'engenharia-de-dados/01-test.md');const follow=topic.interviewQuestions[0].followUps[0];
 assert.equal(follow.answer,'Porque a resposta importa.');assert.equal(raw.slice(follow.source.start,follow.source.end),'*Follow-up esperado:* "Pergunta?" → Porque a resposta importa.\n');
 assert.ok(warnings.some(w=>w.code==='UNCLASSIFIED_LABEL'&&w.source.span.startLine===6));
 assert.ok(warnings.some(w=>w.code==='UNCLASSIFIED_INTERVIEW'&&w.source.span.startLine===7));
});

test('CR-only line endings are indexed without rewriting raw source; H3 case difficulty does not leak',()=>{
 const raw='# T\r## 2. Cenários\r### 🔴 Cenário 1 — Tagged\rtexto\r### P2. Untagged\rresposta\r';
 const {topic}=parseTopic(raw,'engenharia-de-dados/12-fixture.md');
 assert.equal(topic.rawMarkdown,raw);assert.equal(topic.interviewQuestions.length,2);
 assert.equal(topic.interviewQuestions[0].difficulty,'advanced');assert.equal(topic.interviewQuestions[1].difficulty,null);
 assert.equal(topic.interviewQuestions[1].source.span.startLine,5);
});

test('quiz validation rejects missing, empty and out-of-range values; retains JSON pointer and hash',()=>{
 for(const q of [{q:'x',a:['a'],c:0,e:'e'}, {n:'🟢',q:' ',a:['a'],c:0,e:'e'}, {n:'🟢',q:'x',a:[],c:0,e:'e'}, {n:'🟢',q:'x',a:['a'],c:1,e:'e'}, {n:'🟢',q:'x',a:['a'],c:0,e:' '}]) {
  const result=parseQuiz(JSON.stringify({'01':[q]}),'engenharia-de-dados/quiz.json');assert.equal(result.valid,false);assert.ok(result.errors.length);
 }
 assert.equal(parseQuiz('{','x').errors[0].code,'JSON_INVALID');
 const good=parseQuiz(JSON.stringify({'01':[{n:'🟢',q:'Q',a:['A'],c:0,e:'E'}]}),'engenharia-de-dados/quiz.json');
 assert.equal(good.questions[0].pointer,'/01/0');assert.equal(good.questions[0].source.sha256,sha256(JSON.stringify({'01':[{n:'🟢',q:'Q',a:['A'],c:0,e:'E'}]})));
});

test('runtime validator rejects foreign and duplicate quiz references',async()=>{
 const {topic}=parseTopic(await fixture('engenharia-de-dados/01-modelagem-de-dados.md'),'engenharia-de-dados/01-modelagem-de-dados.md');
 const q={id:'x',theme:'02',index:0,n:'🟢',q:'q',a:['a'],c:0,e:'e',pointer:'/02/0',source:{path:'machine-learning/quiz.json',sha256:'0'.repeat(64),pointer:'/02/0'}};
 topic.quizQuestions=[q,{...q}];const result=validateTopic(topic);assert.ok(result.errors.some(e=>e.code==='QUIZ_FOREIGN_REFERENCE'));assert.ok(result.errors.some(e=>e.code==='DUPLICATE_QUIZ_REF'));
});

test('versioned schemas and runtime validator reject required-contract omissions',async()=>{
 const schema=JSON.parse(await fixture('studyforge/schemas/topic.schema.json'));
 assert.equal(schema.properties.schemaVersion.const,1);for(const key of ['sections','interviewQuestions','quizQuestions','metadata','rawMarkdown','partitions'])assert.ok(schema.required.includes(key));
 const {topic}=parseTopic(await fixture('engenharia-de-dados/01-modelagem-de-dados.md'),'engenharia-de-dados/01-modelagem-de-dados.md');
 const invalid={...topic,title:'',metadata:{verification:{status:'verified',reason:''}}};const result=validateTopic(invalid);
 assert.ok(result.errors.some(e=>e.code==='TOPIC_REQUIRED'));assert.ok(result.errors.some(e=>e.code==='VERIFICATION_DEFAULT'));
});

test('automatic discovery restricts to the two domains and NN-*.md; safe synthetic root',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studyforge-'));try{
  for(const d of ['engenharia-de-dados','machine-learning','extra'])await mkdir(join(root,d));
  for(const f of ['engenharia-de-dados/01-a.md','engenharia-de-dados/README.md','machine-learning/12-z.md','extra/02-no.md'])await writeFile(join(root,f),'# T\n');
  const found=await discoverTopics(root);assert.deepEqual(found.map(x=>x.relativePath),['engenharia-de-dados/01-a.md','machine-learning/12-z.md']);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('association validator reports missing quiz modules, orphan themes and duplicate module numbers',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studyforge-links-'));try{
  const md='# 01 — A\n## 1. Teoria\n';
  for(const d of ['engenharia-de-dados','machine-learning']){
   await mkdir(join(root,d));await writeFile(join(root,d,'01-a.md'),md);
   if(d==='engenharia-de-dados')await writeFile(join(root,d,'01-b.md'),md);
   const bank={};if(d==='engenharia-de-dados')bank['02']=[{n:'🟢',q:'Q',a:['A'],c:0,e:'E'}];
   await writeFile(join(root,d,'quiz.json'),JSON.stringify(bank));
  }
  const result=await compileAll(root);assert.ok(result.errors.some(e=>e.code==='QUIZ_TOPIC_MISSING'));assert.ok(result.errors.some(e=>e.code==='QUIZ_ORPHAN'));assert.ok(result.errors.some(e=>e.code==='DUPLICATE_TOPIC'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('full inventory, quiz joins and canonical topics validate across all 24 modules',async()=>{
 const {topics,errors,warnings}=await compileAll();assert.equal(topics.length,24);assert.deepEqual(errors,[]);
 assert.ok(warnings.some(w=>w.code==='DIFFICULTY_UNKNOWN'));
 assert.ok(topics.every(t=>validateTopic(t).valid&&t.quizQuestions.length===8));
 assert.equal(topics.filter(t=>t.domain==='engenharia-de-dados').reduce((n,t)=>n+t.interviewQuestions.length,0),172);
 const ml=topics.filter(t=>t.domain==='machine-learning');assert.equal(ml.reduce((n,t)=>n+t.interviewQuestions.length,0),121);
});
