import {createHash} from 'node:crypto';
import {copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {bundle} from '@remotion/bundler';
import {renderMedia, renderStill, selectComposition} from '@remotion/renderer';
import {buildVideoLesson, retimeVideo, toSrt} from './src/model.mjs';

const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(packageRoot, '../..');
const bundlePromises = new Map();
const hash = value => createHash('sha256').update(value).digest('hex');

async function filesUnder(directory) {
  const entries = await readdir(directory, {withFileTypes: true});
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(item));
    else if (entry.isFile()) files.push(item);
  }
  return files;
}

async function bundleSourceHash() {
  const digest = createHash('sha256');
  for (const file of [path.join(packageRoot, 'package.json'), ...(await filesUnder(path.join(packageRoot, 'src')))]) {
    digest.update(path.relative(packageRoot, file)).update(await readFile(file));
  }
  return digest.digest('hex');
}

function localInput(value, label) {
  if (typeof value !== 'string' || /^(?:https?:|file:|\\\\|\/\/)/i.test(value)) {
    throw new TypeError(`${label} deve ser caminho local; URLs e caminhos UNC não são aceitos.`);
  }
  return path.resolve(value);
}

async function existingLocalFile(value, label) {
  const input = localInput(value, label);
  const file = await realpath(input);
  const info = await stat(file);
  if (!info.isFile()) throw new TypeError(`${label} deve apontar para um arquivo.`);
  return file;
}

async function wavInfo(file) {
  const data = await readFile(file);
  if (data.length < 44 || data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') {
    throw new TypeError('audioFile precisa ser WAV RIFF local válido.');
  }
  let byteRate = 0, dataBytes = 0;
  for (let offset = 12; offset + 8 <= data.length;) {
    const id = data.toString('ascii', offset, offset + 4);
    const length = data.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (payload + length > data.length) throw new TypeError('WAV com bloco truncado.');
    if (id === 'fmt ' && length >= 16) byteRate = data.readUInt32LE(payload + 8);
    if (id === 'data') dataBytes = length;
    offset = payload + length + (length % 2);
  }
  if (!byteRate || !dataBytes) throw new TypeError('WAV precisa conter blocos fmt e data válidos.');
  return {bytes: data.length, durationSeconds: dataBytes / byteRate, sha256: hash(data)};
}

async function getBundle({assetHash, publicDir, cache}) {
  const sourceHash = await bundleSourceHash();
  const remotion = JSON.parse(await readFile(path.join(packageRoot, 'node_modules/remotion/package.json'), 'utf8')).version;
  const key = hash(JSON.stringify({sourceHash, remotion, entry: 'src/entry.jsx', rootDir: packageRoot,
    publicAssetPath: assetHash ? 'audio.wav' : null, assetHash}));
  if (!cache.has(key)) {
    const pending = bundle({entryPoint: path.join(packageRoot, 'src/entry.jsx'), rootDir: packageRoot,
      publicDir, publicPath: './'}).catch(error => {cache.delete(key); throw error;});
    cache.set(key, pending);
  }
  return cache.get(key);
}

function makeRenderer({bundleCache = bundlePromises} = {}) {
  return async function renderVideo(lesson, outputPath, options = {}) {
    const video = buildVideoLesson(lesson, options);
    const output = path.resolve(outputPath);
    if (path.extname(output).toLowerCase() !== '.mp4') throw new TypeError('outputPath deve terminar em .mp4.');
    const captionsPath = path.resolve(options.captionsPath ?? `${output}.srt`);
    const timelinePath = path.resolve(options.timelinePath ?? `${output}.timeline.json`);
    if (new Set([output, captionsPath, timelinePath]).size !== 3) throw new TypeError('MP4, SRT e timeline precisam de destinos distintos.');
    await mkdir(path.dirname(output), {recursive: true});

    let audioPath = null, audioInfo = null, stageDir = null, browserExecutable;
    try {
      if (options.audioFile) {
        audioPath = await existingLocalFile(options.audioFile, 'audioFile');
        if (path.extname(audioPath).toLowerCase() !== '.wav') throw new TypeError('audioFile aceita somente WAV local.');
        audioInfo = await wavInfo(audioPath);
        if ([output, captionsPath, timelinePath].includes(audioPath)) throw new TypeError('Saída não pode sobrescrever o WAV de entrada.');
      }
      if (options.browserExecutable) browserExecutable = await existingLocalFile(options.browserExecutable, 'browserExecutable');

      let publicDir;
      if (audioPath) {
        const tempRoot = process.platform === 'win32'
          ? path.join(os.homedir(), 'AppData', 'Local', 'Temp', 'opencode') : os.tmpdir();
        await mkdir(tempRoot, {recursive: true});
        stageDir = await mkdtemp(path.join(tempRoot, 'studyforge-video-'));
        await copyFile(audioPath, path.join(stageDir, 'audio.wav'));
        publicDir = stageDir;
        video.audioAsset = 'audio.wav';
        const audioFrames = Math.ceil(audioInfo.durationSeconds * video.fps);
        if (audioFrames > video.durationInFrames) retimeVideo(video, (audioFrames - video.durationInFrames) / video.fps);
        /** @type {any} */ (video.metadata).audio = {included: true, durationSeconds: audioInfo.durationSeconds, assetSha256: audioInfo.sha256};
      } else {
        publicDir = path.join(packageRoot, 'public');
        await mkdir(publicDir, {recursive: true});
        video.audioAsset = null;
        /** @type {any} */ (video.metadata).audio = {included: false, durationSeconds: null, assetSha256: null};
      }
      video.outputHash = hash(JSON.stringify({renderHash: video.renderHash, audioSha256: audioInfo?.sha256 ?? null,
        audioDurationSeconds: audioInfo?.durationSeconds ?? null, codec: 'h264'}));

      const serveUrl = await getBundle({assetHash: audioInfo?.sha256 ?? null, publicDir, cache: bundleCache});
      const inputProps = {video, audioAsset: video.audioAsset};
      const browserOptions = browserExecutable ? {browserExecutable} : {};
      const composition = await selectComposition({serveUrl, id: 'StudyLessonVideo', inputProps, ...browserOptions});
      await renderMedia({composition, serveUrl, codec: 'h264', outputLocation: output, inputProps, ...browserOptions});

      if (options.captureFrames) {
        const frameDir = path.resolve(options.captureFrames === true ? `${output}.frames` : options.captureFrames);
        await mkdir(frameDir, {recursive: true});
        for (const kind of ['title', 'concept', 'code', 'diagram', 'comparison', 'question', 'answer']) {
          const scene = video.scenes.find(item => item.kind === kind);
          if (!scene) continue;
          await renderStill({composition, serveUrl, output: path.join(frameDir, `${kind}.png`),
            frame: scene.startFrame + Math.min(20, scene.durationInFrames - 1), inputProps, ...browserOptions});
          if (['question', 'answer'].includes(kind) && scene.captionCues.length) {
            const lastCue = scene.captionCues.at(-1);
            await renderStill({composition, serveUrl, output: path.join(frameDir, `${kind}-last-cue.png`),
              frame: Math.min(lastCue.endFrame - 1, scene.endFrame - 1), inputProps, ...browserOptions});
          }
        }
        for (const [index, scene] of video.scenes.filter(item => item.kind === 'sources').entries()) {
          await renderStill({composition, serveUrl, output: path.join(frameDir, `sources-${String(index + 1).padStart(2, '0')}.png`),
            frame: scene.startFrame + Math.min(20, scene.durationInFrames - 1), inputProps, ...browserOptions});
        }
      }
      await mkdir(path.dirname(captionsPath), {recursive: true});
      await mkdir(path.dirname(timelinePath), {recursive: true});
      await writeFile(captionsPath, toSrt(video), 'utf8');
      const timeline = {...video, output: path.basename(output), captions: path.basename(captionsPath), audioAsset: undefined};
      await writeFile(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`, 'utf8');
      return {video, output, captionsPath, timelinePath, bytes: (await stat(output)).size, composition, serveUrl};
    } finally {
      if (stageDir) await rm(stageDir, {recursive: true, force: true});
    }
  };
}

export const createVideoRenderer = makeRenderer;
export const renderVideo = makeRenderer();

function slug(value) {return String(value).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'lesson';}

async function cli(args) {
  const flags = args.filter(arg => arg.startsWith('--'));
  const inputArg = args.find(arg => !arg.startsWith('--'));
  const profileArg = flags.find(arg => arg.startsWith('--profile='));
  const wpmArg = flags.find(arg => arg.startsWith('--wpm='));
  const captureFrames = flags.includes('--capture-frames');
  const profile = profileArg?.slice('--profile='.length) ?? 'generic';
  const wpm = wpmArg ? Number(wpmArg.slice('--wpm='.length)) : 145;
  if (flags.some(flag => flag !== profileArg && flag !== wpmArg && flag !== '--capture-frames') || (inputArg && args.filter(arg => !arg.startsWith('--')).length > 2)) {
    throw new Error('Uso: node render.mjs [StudyLesson.json] [video.mp4] [--profile=generic|ed01-scd] [--wpm=N] [--capture-frames]');
  }
  const lessonPath = inputArg ? await existingLocalFile(inputArg, 'StudyLesson JSON')
    : path.join(repositoryRoot, 'generated', 'lessons', 'engenharia-de-dados', '01-modelagem-de-dados.json');
  const lesson = JSON.parse(await readFile(lessonPath, 'utf8'));
  const domain = slug(lesson.domain ?? 'lesson');
  const lessonSlug = slug(path.basename(lesson.source?.path ?? lesson.id ?? 'lesson', path.extname(lesson.source?.path ?? '')));
  const output = path.resolve(args.filter(arg => !arg.startsWith('--'))[1]
    ?? path.join(repositoryRoot, 'generated', 'video', domain, `${lessonSlug}.mp4`));
  const captionsPath = path.join(repositoryRoot, 'generated', 'captions', domain, `${lessonSlug}.video.srt`);
  const result = await renderVideo(lesson, output, {profile, wpm, captionsPath, captureFrames});
  console.log(JSON.stringify({output: path.relative(repositoryRoot, result.output), captions: path.relative(repositoryRoot, result.captionsPath),
    bytes: result.bytes, width: result.composition.width, height: result.composition.height, fps: result.composition.fps,
    durationInFrames: result.composition.durationInFrames, durationSeconds: result.video.durationSeconds,
    profile, wpm, sourceHash: result.video.sourceHash, renderHash: result.video.renderHash, outputHash: result.video.outputHash}, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).catch(error => {console.error(error.message); process.exitCode = 1;});
}
