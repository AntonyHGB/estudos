import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileAll, selectTopics } from '../cli.mjs';
import { parseTopic } from '../parser.mjs';
import { createAuditReport } from '../audit/index.mjs';
import { buildLesson, validateLesson, serialiseLesson } from './index.mjs';

test('ED01 constrói lesson determinística com recall sustentado e refs canônicas',async()=>{
 const {topics,errors}=await compileAll(); assert.deepEqual(errors,[]);
 const [topic]=selectTopics(topics,'engenharia-de-dados/01');
 const lesson=buildLesson(topic);assert.deepEqual(buildLesson(topic),lesson);
 assert.equal(validateLesson(lesson,topic).valid,true);assert.equal(JSON.parse(serialiseLesson(lesson)).id,lesson.id);
 assert.equal(lesson.concepts.length,9);assert.ok(lesson.examples.length>=3);
 for(const n of ['recall','application','scenario','conceptual','comparison','find-error'])assert.ok(lesson.questions.some(q=>q.kind===n),`faltou ${n}`);
 for(const ref of [...lesson.objectives.map(x=>x.sourceRef),...lesson.concepts.map(x=>x.sourceRef),...lesson.examples.map(x=>x.sourceRef),...lesson.questions.map(x=>x.sourceRef)]){
  if(ref.pointer){const q=topic.quizQuestions.find(x=>x.source.pointer===ref.pointer);assert.ok(q);assert.equal(ref.path,q.source.path);assert.equal(ref.sha256,q.source.sha256);}
  else {assert.equal(ref.path,topic.source.path);assert.equal(ref.sha256,topic.source.sha256);}
  if(ref.span){assert.ok(ref.span.start>=0&&ref.span.end>=ref.span.start);}
 }
 for(const concept of lesson.concepts){const {start,end}=concept.sourceRef.span;assert.equal(topic.rawMarkdown.slice(start,end).trim(),concept.markdown);assert.ok(topic.rawMarkdown.slice(start,end).includes(`### ${concept.sourceRef.anchor}`));}
 assert.ok(lesson.questions.some(q=>q.answer&&q.explanation));
 assert.ok(lesson.concepts.some(c=>c.markdown.includes('| Star |')));
 assert.ok(lesson.summary.plainText.length>0);
});
test('Lesson rejeita structure inválida e preserva texto plain sem executar HTML',async()=>{
 const {topics}=await compileAll();const topic=selectTopics(topics,'engenharia-de-dados/01')[0];
 const lesson=buildLesson(topic);lesson.title='<img src=x onerror=alert(1)>';
 assert.equal(validateLesson(lesson,topic).valid,true);assert.ok(!lesson.summary.plainText.includes('<img'));
 lesson.summary.sourceRef.sha256='0'.repeat(64);assert.equal(validateLesson(lesson,topic).valid,false);
 lesson.schemaVersion=7;assert.equal(validateLesson(lesson,topic).valid,false);assert.throws(()=>serialiseLesson(lesson));
});
test('selector de módulo 12 continua seletivo, sem assumir conteúdo específico',async()=>{
 const {topics}=await compileAll();const topic=selectTopics(topics,'engenharia-de-dados/12')[0];
 const lesson=buildLesson(topic);assert.equal(lesson.sourceTopic,topic.id);assert.ok(lesson.concepts.length>0);
 assert.ok(!lesson.summary.plainText.includes('cliente muda de cidade'));assert.ok(!lesson.summary.plainText.includes('SCD Tipo 2'));
});

test('CRLF e CR não removem headings; tópico sem headings vazios continua serializável',async()=>{
 const {topics}=await compileAll();const original=selectTopics(topics,'engenharia-de-dados/01')[0];
 const expected=buildLesson(original);
 for(const eol of ['\r\n','\r']){
  const clone=structuredClone(original);clone.rawMarkdown=clone.rawMarkdown.replace(/\r\n|\n|\r/g,eol);
  for(const section of clone.sections)section.markdown=section.markdown.replace(/\r\n|\n|\r/g,eol);
  const lesson=buildLesson(clone);assert.equal(lesson.concepts.length,expected.concepts.length);
  assert.deepEqual(lesson.concepts.map(c=>c.title),expected.concepts.map(c=>c.title));
 }
 const ml=buildLesson(selectTopics(topics,'machine-learning/12')[0]);assert.equal(validateLesson(ml).valid,true);
});

test('anexa apenas fontes de auditoria válidas e vinculadas ao snapshot',async()=>{
 const {topics}=await compileAll();const topic=selectTopics(topics,'engenharia-de-dados/01')[0];
 const record=JSON.parse(await readFile(new URL('../audit/records/engenharia-de-dados/01-modelagem-de-dados.audit.json',import.meta.url),'utf8'));
 const report=createAuditReport(record,topic);assert.equal(report.json.validation.valid,true);
 const lesson=buildLesson(topic,report.json);
 assert.equal(lesson.externalSources.length,8);assert.equal(lesson.audit.bindingStatus,'bound');
 assert.ok(lesson.externalSources.every(s=>s.sourceHash===topic.source.sha256&&s.logicalSnapshotHashMatches));
 assert.ok(lesson.externalSources.some(s=>s.verifiedClaimIds.length>0));
 assert.equal(lesson.verificationStatus,topic.metadata.verification.status);
 assert.equal(serialiseLesson(buildLesson(topic,report.json)),serialiseLesson(lesson));
 assert.equal(validateLesson(lesson,topic).valid,true);

 const altered=structuredClone(report.json);altered.externalSources[0].sourceHash='0'.repeat(64);
 assert.equal(buildLesson(topic,altered).externalSources.length,7);
 const wrongTopic=structuredClone(report.json);wrongTopic.topic.id='outro-id';
 const stale=buildLesson(topic,wrongTopic);assert.equal(stale.externalSources.length,0);assert.equal(stale.audit.bindingStatus,'stale');
 const invalid=structuredClone(report.json);invalid.validation.valid=false;
 assert.equal(buildLesson(topic,invalid).audit.bindingStatus,'invalid');
 const missing=buildLesson(topic);assert.deepEqual(missing.externalSources,[]);assert.equal(missing.audit.bindingStatus,'missing');
});

test('relatório do audit ABI mantém binding com LF, CRLF e CR',async()=>{
 const {topics}=await compileAll();const original=selectTopics(topics,'engenharia-de-dados/01')[0];
 const record=JSON.parse(await readFile(new URL('../audit/records/engenharia-de-dados/01-modelagem-de-dados.audit.json',import.meta.url),'utf8'));
 for(const eol of ['\n','\r\n','\r']){
  const raw=original.rawMarkdown.replace(/\r\n|\n|\r/g,eol);
  const {topic}=parseTopic(raw,original.source.path);
  const report=createAuditReport(record,topic);
  assert.equal(report.json.validation.valid,true);
  assert.equal(report.json.topicBinding.logicalSnapshotHashMatches,true);
  assert.equal(buildLesson(topic,report.json).externalSources.length,8);
 }
});
