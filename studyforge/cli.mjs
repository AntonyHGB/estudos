import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseQuiz, parseTopic } from './parser.mjs';
import { validateQuiz, validateTopic } from './validate.mjs';
import { DOMAINS, normalizeQuizQuestion } from './model.mjs';
import { atomicWrite, loadParsedTopicCache } from './cache.mjs';
export { DOMAINS };

export const REPO_ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sourcePath=(p)=>p.split(sep).join('/');

export async function discoverTopics(root=REPO_ROOT) {
  const entries=[];
  for(const domain of DOMAINS){
    const dir=join(root,domain);
    for(const ent of await readdir(dir,{withFileTypes:true})) if(ent.isFile()&&/^\d{2}-.+\.md$/i.test(ent.name)) entries.push({domain,path:join(dir,ent.name),relativePath:`${domain}/${ent.name}`,order:Number(ent.name.slice(0,2))});
  }
  return entries.sort((a,b)=>a.domain.localeCompare(b.domain)||a.order-b.order||a.relativePath.localeCompare(b.relativePath));
}
export async function compileAll(root=REPO_ROOT, options={}) {
  const entries=await discoverTopics(root), topics=[],warnings=[],errors=[];
  const cacheStats={hits:0,misses:0};
  const quizByDomain=new Map();
  for(const domain of DOMAINS){
    const path=join(root,domain,'quiz.json'), raw=await readFile(path,'utf8'), checked=validateQuiz(raw);
    const parsed=parseQuiz(raw,`${domain}/quiz.json`);
    if(!checked.valid) errors.push(...checked.errors.map(e=>({...e,source:`${domain}/quiz.json`})));
    quizByDomain.set(domain,parsed);errors.push(...parsed.errors);
  }
  const seen=new Set();
  for(const entry of entries){
    let topic, topicWarnings;
    if(options.cache){
      const {createHash}=await import('node:crypto');
      const cacheDir=join(root,'generated','.cache','parsed-topics');
      const [markdown,parser,model,validator,cliSource,cacheSource,quizHash,lock,packageJson,topicSchema,quizSchema]=await Promise.all([readFile(entry.path,'utf8'),readFile(fileURLToPath(new URL('./parser.mjs',import.meta.url))),readFile(fileURLToPath(new URL('./model.mjs',import.meta.url))),readFile(fileURLToPath(new URL('./validate.mjs',import.meta.url))),readFile(fileURLToPath(new URL('./cli.mjs',import.meta.url))),readFile(fileURLToPath(new URL('./cache.mjs',import.meta.url))),readFile(join(root,entry.domain,'quiz.json')),readFile(join(root,'package-lock.json')).catch(error=>error.code==='ENOENT'?'':Promise.reject(error)),readFile(join(root,'package.json')).catch(error=>error.code==='ENOENT'?'':Promise.reject(error)),readFile(fileURLToPath(new URL('./schemas/topic.schema.json',import.meta.url))),readFile(fileURLToPath(new URL('./schemas/quiz.schema.json',import.meta.url)))]);
      const markdownHash=createHash('sha256').update(markdown,'utf8').digest('hex');
      const key=createHash('sha256').update(JSON.stringify([markdown,parser,model,validator,cliSource,cacheSource,quizHash,lock,packageJson,topicSchema,quizSchema,process.version])).digest('hex'), cachePath=join(cacheDir,`${entry.domain}-${entry.order}.json`);
      const cached=await loadParsedTopicCache({cachePath,key,relativePath:entry.relativePath,markdown,markdownHash,parse:()=>parseTopic(markdown,entry.relativePath)});
      topic=cached.topic;topicWarnings=cached.warnings;
      cacheStats[cached.hit?'hits':'misses']++;
    }else ({topic,warnings:topicWarnings}=parseTopic(await readFile(entry.path,'utf8'),entry.relativePath));
    warnings.push(...topicWarnings);
    const quiz=quizByDomain.get(entry.domain), matches=quiz.errors.length ? [] : quiz.questions.filter(q=>q.theme===String(entry.order).padStart(2,'0'));
    if(seen.has(`${entry.domain}/${entry.order}`))errors.push({code:'DUPLICATE_TOPIC',message:`Módulo duplicado ${entry.domain}/${entry.order}`,source:entry.relativePath});seen.add(`${entry.domain}/${entry.order}`);
    if(!matches.length)errors.push({code:'QUIZ_TOPIC_MISSING',message:`Sem perguntas de quiz para tema ${entry.order}`,source:`${entry.domain}/quiz.json`});
    topic.quizQuestions=matches.map(q=>normalizeQuizQuestion(q,topic));
    const result=validateTopic(topic);errors.push(...result.errors.map(e=>({...e,source:entry.relativePath})));
    topics.push(topic);
  }
  for(const [domain,quiz] of quizByDomain)for(const q of quiz.questions)if(!entries.some(e=>e.domain===domain&&String(e.order).padStart(2,'0')===q.theme))errors.push({code:'QUIZ_ORPHAN',message:`${q.pointer}: nenhum módulo Markdown correspondente`,source:q.source.path});
  return {topics,warnings,errors,cacheStats};
}
export function selectTopics(topics,selector){
  if(selector==='--all')return topics;
  const [domain,number,...rest]=selector.split('/');
  if(!DOMAINS.includes(domain)||!/^\d{1,2}$/.test(number)||Number(number)<1||rest.length)throw Error('Seletor inválido; use dominio/NN, por exemplo engenharia-de-dados/01.');
  const matches=topics.filter(t=>t.domain===domain&&t.order===Number(number));
  if(matches.length!==1)throw Error(`Seletor não resolve para exatamente um módulo: ${selector}`);
  return matches;
}
export async function main(args){
  const [command,...rest]=args;
  if(['lesson','flashcards','html','pdf','audio-script','video','build','verify'].includes(command)){
    const {runBuild,runLesson,runVerify,runFlashcards,runHtml,runAudio,runPdf,runVideo}=await import('./pipeline.mjs');
    const selector=rest.find(x=>x==='--all'||/^(?:engenharia-de-dados|machine-learning)\/\d{1,2}$/.test(x))??'engenharia-de-dados/01';
    const allowed = command === 'build'
      ? new Set(['--all','--pdf','--video','--skip-pdf','--skip-video','--text-only'])
      : command === 'video' ? new Set(['--all']) : new Set(['--all']);
    const audioOptions = new Map();
    const videoOptions = new Map();
    for (const token of rest) {
      const option = token.match(/^--(wpm|pause-seconds)=(\d+(?:\.\d+)?)$/);
      if (option && (command === 'build' || command === 'audio-script')) {
        audioOptions.set(option[1], Number(option[2]));
        continue;
      }
      const videoOption = token.match(/^--(video-profile|video-wpm)=(.+)$/);
      if (videoOption && (command === 'build' || command === 'video')) {
        videoOptions.set(videoOption[1], videoOption[1] === 'video-wpm' ? Number(videoOption[2]) : videoOption[2]);
        continue;
      }
      const localOption = token.match(/^--(audio-file|browser-executable)=(.+)$/);
      if (localOption && (command === 'build' || command === 'video')) {
        videoOptions.set(localOption[1], localOption[2]);
        continue;
      }
      if (token.startsWith('--') && !allowed.has(token)) throw Error(`Opção desconhecida para ${command}: ${token}`);
    }
    const wpm = audioOptions.get('wpm') ?? 145;
    const pauseSeconds = audioOptions.get('pause-seconds') ?? 8;
    if (!Number.isFinite(wpm) || wpm <= 0 || !Number.isFinite(pauseSeconds) || pauseSeconds < 0) throw Error('Use --wpm=POSITIVO e --pause-seconds=NÃO_NEGATIVO.');
    const videoProfile = videoOptions.get('video-profile');
    const videoWpm = videoOptions.get('video-wpm');
    if (videoProfile && !['generic','ed01-scd'].includes(videoProfile)) throw Error('--video-profile precisa ser generic ou ed01-scd.');
    if (videoWpm !== undefined && (!Number.isFinite(videoWpm) || videoWpm <= 0)) throw Error('--video-wpm precisa ser positivo.');
    for(const token of rest)if(!token.startsWith('--')&&token!==selector)throw Error(`Argumento inesperado: ${token}`);
    if(command==='verify')return runVerify(REPO_ROOT,selector);
    if(command==='lesson')return runLesson(REPO_ROOT,selector);
    if(command==='flashcards')return runFlashcards(REPO_ROOT,selector);
    if(command==='html')return runHtml(REPO_ROOT,selector);
    if(command==='audio-script')return runAudio(REPO_ROOT,selector,{wpm,pauseSeconds});
    if(command==='pdf')return runPdf(REPO_ROOT,selector);
    const mediaOptions = {
      videoProfile,
      videoWpm,
      audioFile: videoOptions.get('audio-file'),
      browserExecutable: videoOptions.get('browser-executable')
    };
    if(command==='video')return runVideo(REPO_ROOT,selector,mediaOptions);
    if(command==='build'&&rest.includes('--text-only')&&(rest.includes('--pdf')||rest.includes('--video'))) throw Error('--text-only não pode ser combinado com --pdf/--video.');
    if(command==='build'&&rest.includes('--pdf')&&rest.includes('--skip-pdf')) throw Error('--pdf e --skip-pdf são opções incompatíveis.');
    if(command==='build'&&rest.includes('--video')&&rest.includes('--skip-video')) throw Error('--video e --skip-video são opções incompatíveis.');
    if(command==='build'&&videoOptions.size&&!rest.includes('--video')&&selector==='--all') throw Error('Opções de vídeo exigem --video.');
    const all = selector === '--all';
    const pdf = rest.includes('--pdf') || (!all && !rest.includes('--skip-pdf') && !rest.includes('--text-only'));
    const video = rest.includes('--video') || (!all && !rest.includes('--skip-video') && !rest.includes('--text-only'));
    if(command==='build'&&videoOptions.size&&!video) throw Error('Opções de vídeo exigem vídeo habilitado.');
    return runBuild(REPO_ROOT,selector,{pdf,video,wpm,pauseSeconds,...mediaOptions});
  }
  if(!['inventory','validate','parse'].includes(command))throw Error('Uso: inventory|parse|validate|verify|lesson|flashcards|html|pdf|audio-script|video|build [dominio/NN|--all]');
  if(command==='parse'&&(rest.length>1||(rest[0]&&rest[0]!=='--all'&&!/^(?:engenharia-de-dados|machine-learning)\/\d{1,2}$/.test(rest[0]))))throw Error('Uso: study:parse [dominio/NN|--all]');
  if(command==='inventory'){const {runInventory}=await import('./pipeline.mjs');return runInventory(REPO_ROOT,{json:rest.includes('--json')});}
  const compiled=await compileAll(REPO_ROOT,{cache:true});
  if(command==='inventory'){
    const inventory={topics:compiled.topics.map(t=>({domain:t.domain,order:t.order,id:t.id,title:t.title,interviewQuestions:t.interviewQuestions.length,quizQuestions:t.quizQuestions.length,warnings:compiled.warnings.filter(w=>w.source?.path===t.source.path).map(w=>({code:w.code,line:w.source.span?.startLine,excerpt:w.excerpt}))})),totals:Object.fromEntries(DOMAINS.map(d=>[d,{topics:compiled.topics.filter(t=>t.domain===d).length,openQuestions:compiled.topics.filter(t=>t.domain===d).reduce((n,t)=>n+t.interviewQuestions.length,0),quizQuestions:compiled.topics.filter(t=>t.domain===d).reduce((n,t)=>n+t.quizQuestions.length,0)}])),errors:compiled.errors,warnings:compiled.warnings};
    if(rest.includes('--json')) console.log(JSON.stringify(inventory,null,2));
    else { console.log(`StudyForge: ${compiled.topics.length} tópicos; ${compiled.warnings.length} avisos; ${compiled.errors.length} erros.`); for(const [domain,total] of Object.entries(inventory.totals)) console.log(`${domain}: ${total.topics} tópicos, ${total.openQuestions} perguntas abertas, ${total.quizQuestions} quiz.`); for(const w of compiled.warnings) console.log(`⚠ ${w.source?.path}:${w.source?.span?.startLine} ${w.code}: ${w.message}${w.excerpt?` — ${w.excerpt}`:''}`); }
    return compiled.errors.length?1:0;
  }
  if(command==='validate'){
    const counts=compiled.topics.reduce((o,t)=>(o[t.domain]=(o[t.domain]??0)+1,o),{});
    console.log(`Validação: ${compiled.topics.length} tópicos (${JSON.stringify(counts)}), ${compiled.errors.length} erro(s), ${compiled.warnings.length} warning(s).`);
    for(const e of compiled.errors)console.error(`${e.source??''}: ${e.code}: ${e.message}`);
    for(const w of compiled.warnings)console.error(`${w.source?.path}:${w.source?.span?.startLine}: ${w.code}: ${w.message}${w.excerpt?` — ${w.excerpt}`:''}`);
    return compiled.errors.length?1:0;
  }
  if(command==='parse'){
    const selector=rest[0]??'engenharia-de-dados/01';
    if(rest.length>1)throw Error('Uso: study:parse [dominio/NN|--all]');
    const criticalWarnings=compiled.warnings.filter(w=>['UNCLOSED_FENCE','UNCLASSIFIED_INTERVIEW'].includes(w.code));
    if(compiled.errors.length||criticalWarnings.length){console.error(`Parse abortado: ${compiled.errors.length} erro(s), ${criticalWarnings.length} aviso(s) crítico(s); nenhuma saída foi escrita.`);return 1;}
    const selected=selectTopics(compiled.topics,selector);
    for(const topic of selected){const output=join(REPO_ROOT,'generated','canonical',topic.domain,`${String(topic.order).padStart(2,'0')}-${topic.source.path.split('/').at(-1).replace(/^\d+-|\.md$/g,'')}.json`);await atomicWrite(output,`${JSON.stringify(topic,null,2)}\n`);console.log(`Gerado ${relative(REPO_ROOT,output)}`);}
    return 0;
  }
  throw Error('Uso: study:inventory | study:parse [dominio/NN|--all] | study:validate | study:test');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
