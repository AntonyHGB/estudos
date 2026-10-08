import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAll, selectTopics, REPO_ROOT } from './cli.mjs';
import { assertNoCriticalWarnings, validateVideoCaptions, videoInputFingerprint, videoOutputsMatch, videoRuntimeFingerprint, writeVideo } from './pipeline.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { hashFile } from './cache.mjs';

test('cached compile is byte-deterministic and selector rejects unsafe paths', async()=>{
  const first=await compileAll(REPO_ROOT,{cache:true}), second=await compileAll(REPO_ROOT,{cache:true});
  assert.equal(first.errors.length,0);
  assert.deepEqual(second.topics,first.topics);
  assert.deepEqual(second.warnings,first.warnings);
  assert.deepEqual(second.errors,first.errors);
  assert.equal(second.cacheStats.hits,24);
  assert.equal(second.cacheStats.misses,0);
  assert.equal(selectTopics(first.topics,'engenharia-de-dados/01').length,1);
  assert.throws(()=>selectTopics(first.topics,'../01'));
});

test('video runtime closure hashes JSX/config but excludes installed deps', async()=>{
  const root=await mkdtemp(join(tmpdir(),'studyforge-video-closure-'));
  try {
    await mkdir(join(root,'node_modules'),{recursive:true});
    await mkdir(join(root,'src'),{recursive:true});
    await writeFile(join(root,'src','entry.jsx'),'export const version = 1;');
    await writeFile(join(root,'package.json'),'{}');
    await writeFile(join(root,'node_modules','remotion.js'),'installed dependency');
    const first=await videoRuntimeFingerprint(root);
    await writeFile(join(root,'node_modules','remotion.js'),'changed installed dependency');
    assert.equal(await videoRuntimeFingerprint(root),first);
    await writeFile(join(root,'src','entry.jsx'),'export const version = 2;');
    assert.notEqual(await videoRuntimeFingerprint(root),first);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('video cache key includes audio bytes and render profile; all outputs must match', async()=>{
  const root=await mkdtemp(join(tmpdir(),'studyforge-video-output-'));
  try {
    const profile={pipeline:'p',videoRuntime:'v',profile:'generic',wpm:145,pauseSeconds:8,width:1920,height:1080,fps:30,audioSha256:'wav-a',browser:null};
    const key=videoInputFingerprint(profile);
    assert.notEqual(videoInputFingerprint({...profile,audioSha256:'wav-b'}),key);
    assert.notEqual(videoInputFingerprint({...profile,profile:'ed01-scd'}),key);
    const paths=['movie.mp4','captions.srt','timeline.json'].map(file=>join(root,file));
    for (const [index,path] of paths.entries()) await writeFile(path,`artifact-${index}`);
    const expected={inputHash:key,outputs:{mp4:await hashFile(paths[0]),captions:await hashFile(paths[1]),timeline:await hashFile(paths[2])}};
    assert.equal(await videoOutputsMatch(paths,expected,key),true);
    await writeFile(paths[1],'tampered');
    assert.equal(await videoOutputsMatch(paths,expected,key),false);
    await rm(paths[2]);
    assert.equal(await videoOutputsMatch(paths,expected,key),false);
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('pipeline surfaces non-critical warnings and blocks critical source warnings',()=>{
  const unknown={code:'DIFFICULTY_UNKNOWN',source:{path:'ml/01.md',span:{startLine:4}},message:'dificuldade desconhecida'};
  assert.deepEqual(assertNoCriticalWarnings([unknown]),[unknown]);
  for(const code of ['UNCLOSED_FENCE','UNCLASSIFIED_INTERVIEW']) {
    assert.throws(()=>assertNoCriticalWarnings([{code,source:{path:'domain/01.md',span:{startLine:8}},message:'warning de parser'}]),/Build abortado.*aviso\(s\) crítico\(s\)/s);
  }
});

test('video SRT validation matches timeline and caps actual cues at two 42-grapheme lines',()=>{
  const video={fps:30,scenes:[{captionCues:[{startFrame:1,endFrame:2,lines:['cidade antiga?','á'.repeat(42)]}]}]};
  const srt='1\n00:00:00,033 --> 00:00:00,067\ncidade antiga?\n'+`${'á'.repeat(42)}\n`;
  assert.deepEqual(validateVideoCaptions(video,srt),{cues:1,maxLines:2,maxGraphemes:42});
  assert.throws(()=>validateVideoCaptions({fps:30,scenes:[{captionCues:[{startFrame:0,endFrame:30,lines:['um','dois','três']}]}]},'1\n00:00:00,000 --> 00:00:01,000\num\ndois\ntrês\n'),/excede 2 linhas/);
  assert.throws(()=>validateVideoCaptions(video,'1\n00:00:00,033 --> 00:00:00,067\ncidade antiga?\n'+'á'.repeat(43)+'\n'),/excede 2 linhas/);
  assert.throws(()=>validateVideoCaptions(video,'1\n00:00:00,034 --> 00:00:00,067\ncidade antiga?\n'+'á'.repeat(42)+'\n'),/timestamps não correspondem/);
  assert.throws(()=>validateVideoCaptions(video,'1\n00:00:00,033 --> 00:00:00,066\ncidade antiga?\n'+'á'.repeat(42)+'\n'),/timestamps não correspondem/);
  assert.throws(()=>validateVideoCaptions({...video,fps:0},srt),/fps inválido/);
  assert.throws(()=>validateVideoCaptions(video,'1\n00:00:00,033 --> 00:00:00,067\ncidade antiga?\n'),/não corresponde integralmente/);
});

test('caption validation failure never records video cache success and reruns renderer',async()=>{
  const root=await mkdtemp(join(tmpdir(),'studyforge-video-cache-guard-'));
  const topic={domain:'machine-learning',order:1,source:{path:'machine-learning/01-fixture.md'}};
  const context={topic,lesson:{id:'fixture-lesson'},inputHash:'fixture-input'};
  let renders=0;
  const renderer=async(lesson,outputPath,options)=>{
    renders++;
    for(const path of [outputPath,options.captionsPath,options.timelinePath]) await mkdir(dirname(path),{recursive:true});
    await writeFile(outputPath,'fixture mp4');
    await writeFile(options.captionsPath,'1\n00:00:00,034 --> 00:00:00,067\nvalid visible text\n');
    await writeFile(options.timelinePath,'{}\n');
    return{
      output:outputPath,captionsPath:options.captionsPath,timelinePath:options.timelinePath,
      video:{fps:30,scenes:[{captionCues:[{startFrame:1,endFrame:2,lines:['valid visible text']}]}]},
      composition:{width:640,height:360,fps:30,durationInFrames:1}
    };
  };
  try{
    const attempt=()=>writeVideo(root,context,{},renderer);
    await assert.rejects(attempt(),/timestamps não correspondem/);
    const cachePath=join(root,'generated','.cache','studyforge','video.json');
    assert.equal(await hashFile(cachePath),null);
    await assert.rejects(attempt(),/timestamps não correspondem/);
    assert.equal(renders,2);
    assert.equal(await hashFile(cachePath),null);
  }finally{await rm(root,{recursive:true,force:true});}
});
