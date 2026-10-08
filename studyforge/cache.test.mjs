import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, unlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite, hash, hashFile, loadParsedTopicCache, safePath } from './cache.mjs';
import { writeCached, pipelineFingerprint } from './pipeline.mjs';

test('atomic output is readable and safe paths reject traversal', async()=>{
  const root=await mkdtemp(join(tmpdir(),'studyforge-cache-'));
  try { const file=join(root,'nested','artifact.txt'); await atomicWrite(file,'stable\n'); assert.equal(await readFile(file,'utf8'),'stable\n'); assert.equal(await hashFile(file),await hashFile(file)); assert.throws(()=>safePath(root,'../outside')); }
  finally { await rm(root,{recursive:true,force:true}); }
});

test('hashing propagates filesystem errors other than a missing file', async()=>{
  const root=await mkdtemp(join(tmpdir(),'studyforge-cache-'));
  try { await assert.rejects(hashFile(root), error => error.code === 'EISDIR'); }
  finally { await rm(root,{recursive:true,force:true}); }
});

test('output cache compares current bytes, input fingerprint, deletion and tampering', async()=>{
  const root=await mkdtemp(join(tmpdir(),'studyforge-output-cache-'));
  try {
    const file=join(root,'generated','lesson.json');
    assert.equal(await writeCached(root,file,'first\n','lesson','same-input'),'generated');
    assert.equal(await writeCached(root,file,'first\n','lesson','same-input'),'SKIP');
    assert.equal(await writeCached(root,file,'second\n','lesson','same-input'),'changed');
    await writeFile(file,'tampered\n');
    assert.equal(await writeCached(root,file,'second\n','lesson','same-input'),'changed');
    await unlink(file);
    assert.equal(await writeCached(root,file,'second\n','lesson','same-input'),'generated');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('pipeline fingerprint changes when schema or audit sidecar changes', async()=>{
  const root=await mkdtemp(join(tmpdir(),'studyforge-fingerprint-'));
  try {
    for(const folder of ['studyforge/schemas','studyforge/lesson','studyforge/renderers','studyforge/audit/records/domain','studyforge/print','studyforge/video','domain']) await mkdir(join(root,folder),{recursive:true});
    for(const file of ['studyforge/parser.mjs','studyforge/model.mjs','studyforge/validate.mjs','studyforge/cli.mjs','studyforge/pipeline.mjs','studyforge/cache.mjs','package.json','package-lock.json','studyforge/schemas/topic.schema.json','studyforge/schemas/quiz.schema.json','studyforge/lesson/index.mjs','studyforge/renderers/index.mjs','studyforge/audit/index.mjs','studyforge/print/index.mjs','domain/quiz.json','studyforge/audit/records/domain/01-sample.audit.json']) await writeFile(join(root,file),file);
    const topic={domain:'domain',source:{path:'domain/01-sample.md',sha256:'sourcehash'}};
    const original=await pipelineFingerprint(root,topic);
    await writeFile(join(root,'studyforge/audit/records/domain/01-sample.audit.json'),'changed sidecar');
    const sidecarChange=await pipelineFingerprint(root,topic);
    assert.notEqual(sidecarChange,original);
    await writeFile(join(root,'studyforge/schemas/topic.schema.json'),'changed schema');
    const schemaChange=await pipelineFingerprint(root,topic);
    assert.notEqual(schemaChange,sidecarChange);
    await writeFile(join(root,'studyforge/pipeline.mjs'),'changed pipeline implementation');
    const pipelineChange=await pipelineFingerprint(root,topic);
    assert.notEqual(pipelineChange,schemaChange);
    await writeFile(join(root,'studyforge/cache.mjs'),'changed cache helper');
    assert.notEqual(await pipelineFingerprint(root,topic),pipelineChange);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('parsed-topic cache hit skips writes; corrupt and stale-key entries rebuild', async()=>{
  const root=await mkdtemp(join(tmpdir(),'studyforge-parsed-cache-'));
  const cachePath=join(root,'topic.json');
  const markdown='# Cached topic\n';
  const markdownHash=hash(markdown);
  const topic={id:'topic-fixture',rawMarkdown:markdown,source:{path:'domain/01-topic.md',sha256:markdownHash}};
  let parseCalls=0;
  let writes=0;
  const parse=()=>{parseCalls++;return{topic,warnings:[]};};
  const write=async(path,content)=>{writes++;await atomicWrite(path,content);};
  const load=(key='key-v1')=>loadParsedTopicCache({cachePath,key,relativePath:topic.source.path,markdown,markdownHash,parse,write});
  try {
    assert.equal((await load()).hit,false);
    const bytesBefore=await readFile(cachePath);
    const statBefore=await (await import('node:fs/promises')).stat(cachePath,{bigint:true});
    assert.equal((await load()).hit,true);
    assert.equal((await load()).hit,true);
    assert.equal(writes,1);
    assert.equal(parseCalls,1);
    assert.deepEqual(await readFile(cachePath),bytesBefore);
    assert.equal((await (await import('node:fs/promises')).stat(cachePath,{bigint:true})).mtimeNs,statBefore.mtimeNs);
    assert.equal((await load('key-v2')).hit,false);
    assert.equal(writes,2);
    await writeFile(cachePath,'{corrupt');
    assert.equal((await load()).hit,false);
    assert.equal(writes,3);
  } finally { await rm(root,{recursive:true,force:true}); }
});
