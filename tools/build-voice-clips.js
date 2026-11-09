const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const inputDir = path.join(root, 'קבצי קול');
const outputDir = path.join(root, 'shared', 'audio');
const coursePath = path.join(root, 'course.json');
const timelinePath = path.join(root, 'export', 'mp4-timeline.json');
const alignmentPath = path.join(outputDir, 'alignment.csv');
const filesByScene = [
  'פתיחה + פרק 1.wav',
  'פרק 2.wav',
  'פרק 3.wav',
  'פרק 4.wav',
  'פרק 5.wav',
  'פרק 6.wav',
  'פרק 7.wav'
];
const scenesWithoutNarration = new Set([7]);
const removedChapterSevenSources = new Set(['S084', 'S085']);
const silenceThreshold = 0.003;
const windowSeconds = 0.01;

function readPcmWave(filePath) {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`Not a RIFF/WAVE file: ${filePath}`);
  }

  let format = null;
  let dataOffset = -1;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const chunkName = buffer.toString('ascii', offset, offset + 4);
    const chunkLength = buffer.readUInt32LE(offset + 4);
    const payload = offset + 8;
    if (payload + chunkLength > buffer.length) throw new Error(`Truncated WAV chunk: ${filePath}`);
    if (chunkName === 'fmt ') {
      format = {
        code: buffer.readUInt16LE(payload),
        channels: buffer.readUInt16LE(payload + 2),
        sampleRate: buffer.readUInt32LE(payload + 4),
        blockAlign: buffer.readUInt16LE(payload + 12),
        bitsPerSample: buffer.readUInt16LE(payload + 14)
      };
    } else if (chunkName === 'data') {
      dataOffset = payload;
      dataLength = chunkLength;
      break;
    }
    offset = payload + chunkLength + (chunkLength & 1);
  }

  if (!format || dataOffset < 0 || format.code !== 1 || format.channels !== 1 || format.bitsPerSample !== 16) {
    throw new Error(`Expected mono 16-bit PCM WAV: ${filePath}`);
  }
  if (dataLength % format.blockAlign !== 0) throw new Error(`Invalid PCM frame length: ${filePath}`);
  return {
    buffer,
    dataOffset,
    dataLength,
    sampleRate: format.sampleRate,
    frameCount: dataLength / format.blockAlign
  };
}

function silenceSpans(wav) {
  const samplesPerWindow = Math.max(1, Math.round(wav.sampleRate * windowSeconds));
  const spans = [];
  let silenceStart = -1;
  let firstActive = null;
  let lastActive = null;

  for (let frame = 0; frame < wav.frameCount; frame += samplesPerWindow) {
    const endFrame = Math.min(wav.frameCount, frame + samplesPerWindow);
    let sumSquares = 0;
    for (let sample = frame; sample < endFrame; sample++) {
      const value = wav.buffer.readInt16LE(wav.dataOffset + sample * 2) / 32768;
      sumSquares += value * value;
    }
    const rms = Math.sqrt(sumSquares / (endFrame - frame));
    const isSilent = rms < silenceThreshold;
    if (isSilent && silenceStart < 0) silenceStart = frame;
    if (!isSilent) {
      if (firstActive === null) firstActive = frame;
      lastActive = endFrame;
      if (silenceStart >= 0) {
        spans.push({ start: silenceStart, end: frame });
        silenceStart = -1;
      }
    }
  }
  if (silenceStart >= 0) spans.push({ start: silenceStart, end: wav.frameCount });
  if (firstActive === null || lastActive === null) throw new Error('No voice activity found in audio track.');

  const minFrames = Math.round(0.12 * wav.sampleRate);
  const mergeFrames = Math.round(0.07 * wav.sampleRate);
  const merged = [];
  for (const span of spans) {
    const previous = merged[merged.length - 1];
    if (previous && span.start - previous.end <= mergeFrames) previous.end = span.end;
    else merged.push({ ...span });
  }
  return {
    voiceStart: Math.max(0, firstActive - Math.round(0.04 * wav.sampleRate)),
    voiceEnd: Math.min(wav.frameCount, lastActive + Math.round(0.08 * wav.sampleRate)),
    pauses: merged.filter((span) => span.end - span.start >= minFrames && span.start > firstActive && span.end < lastActive)
  };
}

function countWords(text) {
  return String(text || '').trim().split(/\s+/u).filter(Boolean).length;
}

function selectCuts(scene, wav, silences) {
  const shots = scene.shots.filter((shot) => String(shot.narration || '').trim());
  if (shots.length <= 1) return { shots, cuts: [] };
  if (silences.pauses.length < shots.length - 1) {
    throw new Error(`Scene ${scene.sceneNumber} has ${silences.pauses.length} usable pauses for ${shots.length} narrated shots.`);
  }

  const words = shots.map((shot) => countWords(shot.narration));
  const totalWords = words.reduce((sum, count) => sum + count, 0);
  const voiceDuration = (silences.voiceEnd - silences.voiceStart) / wav.sampleRate;
  const voiceStartSeconds = silences.voiceStart / wav.sampleRate;
  const pauses = silences.pauses.map((pause) => ({
    ...pause,
    at: (pause.start + pause.end) / 2,
    duration: (pause.end - pause.start) / wav.sampleRate
  }));
  const cutCount = shots.length - 1;
  const tolerance = Math.max(0.45, voiceDuration * 0.018);
  let cumulativeWords = 0;
  const targets = [];
  for (let i = 0; i < cutCount; i++) {
    cumulativeWords += words[i];
    targets.push(voiceStartSeconds + voiceDuration * cumulativeWords / totalWords);
  }

  let previous = pauses.map((pause, index) => {
    const error = (pause.at / wav.sampleRate - targets[0]) / tolerance;
    return index < pauses.length ? error * error - 0.5 * Math.min(pause.duration, 0.6) : Infinity;
  });
  const parents = [new Array(pauses.length).fill(-1)];
  for (let cut = 1; cut < cutCount; cut++) {
    const current = new Array(pauses.length).fill(Infinity);
    const parent = new Array(pauses.length).fill(-1);
    for (let j = cut; j < pauses.length; j++) {
      const error = (pauses[j].at / wav.sampleRate - targets[cut]) / tolerance;
      const cost = error * error - 0.5 * Math.min(pauses[j].duration, 0.6);
      for (let k = cut - 1; k < j; k++) {
        if (previous[k] + cost < current[j]) {
          current[j] = previous[k] + cost;
          parent[j] = k;
        }
      }
    }
    previous = current;
    parents.push(parent);
  }

  let bestIndex = -1;
  let bestCost = Infinity;
  for (let j = cutCount - 1; j < pauses.length; j++) {
    const expectedLastDuration = voiceDuration * words[words.length - 1] / totalWords;
    const actualLastDuration = silences.voiceEnd / wav.sampleRate - pauses[j].at / wav.sampleRate;
    const cost = previous[j] + ((actualLastDuration - expectedLastDuration) / tolerance) ** 2;
    if (cost < bestCost) { bestCost = cost; bestIndex = j; }
  }

  const selected = new Array(cutCount);
  for (let i = cutCount - 1, j = bestIndex; i >= 0; i--) {
    selected[i] = pauses[j].at;
    j = parents[i][j];
  }
  return { shots, cuts: selected, words };
}

function makeWave(samples, sampleRate) {
  const header = Buffer.alloc(44);
  const dataBytes = samples.length;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + dataBytes, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(dataBytes, 40);
  return Buffer.concat([header, samples]);
}

function csv(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

const course = JSON.parse(fs.readFileSync(coursePath, 'utf8'));
if (course.scenes.length !== filesByScene.length) throw new Error('Expected one source WAV per course scene.');
const prepared = [];

for (let sceneIndex = 0; sceneIndex < course.scenes.length; sceneIndex++) {
  const scene = course.scenes[sceneIndex];
  if (scenesWithoutNarration.has(scene.sceneNumber)) {
    for (const shot of scene.shots) shot.voiceFilename = null;
    continue;
  }
  const sourcePath = path.join(inputDir, filesByScene[sceneIndex]);
  const wav = readPcmWave(sourcePath);
  const silence = silenceSpans(wav);
  const { shots, cuts, words } = selectCuts(scene, wav, silence);
  let previous = silence.voiceStart;
  const boundaries = [silence.voiceStart, ...cuts, silence.voiceEnd];
  const segments = shots.map((shot, index) => {
    const start = Math.max(previous, boundaries[index]);
    const end = boundaries[index + 1];
    previous = end;
    if (end <= start) throw new Error(`Non-positive audio segment for ${shot.label}.`);
    const clipName = `voice_${shot.sourceId}.wav`;
    const audioPath = `shared/audio/${clipName}`;
    return { shot, start, end, words: words[index], clipName, audioPath };
  });
  prepared.push({ scene, wav, segments });
}

fs.mkdirSync(outputDir, { recursive: true });
for (const scene of course.scenes) {
  if (!scenesWithoutNarration.has(scene.sceneNumber)) continue;
  for (const shot of scene.shots) fs.rmSync(path.join(outputDir, `voice_${shot.sourceId}.wav`), { force: true });
  for (const sourceId of removedChapterSevenSources) fs.rmSync(path.join(outputDir, `voice_${sourceId}.wav`), { force: true });
}
const report = ['scene,shot,sourceWav,startSeconds,endSeconds,durationSeconds,words,audioPath,narration'];
for (const { scene, wav, segments } of prepared) {
  for (const segment of segments) {
    const firstByte = wav.dataOffset + Math.floor(segment.start) * 2;
    const finalByte = wav.dataOffset + Math.floor(segment.end) * 2;
    const pcm = wav.buffer.subarray(firstByte, finalByte);
    fs.writeFileSync(path.join(outputDir, segment.clipName), makeWave(pcm, wav.sampleRate));
    segment.shot.voiceFilename = segment.audioPath;
    const startSeconds = segment.start / wav.sampleRate;
    const endSeconds = segment.end / wav.sampleRate;
    report.push([
      scene.sceneNumber,
      segment.shot.label,
      filesByScene[scene.sceneNumber - 1],
      startSeconds.toFixed(3),
      endSeconds.toFixed(3),
      (endSeconds - startSeconds).toFixed(3),
      segment.words,
      segment.audioPath,
      segment.shot.narration
    ].map(csv).join(','));
  }
  for (const shot of scene.shots) {
    if (!String(shot.narration || '').trim()) shot.voiceFilename = null;
  }
}

fs.writeFileSync(coursePath, `${JSON.stringify(course, null, 2)}\n`, 'utf8');
fs.writeFileSync(alignmentPath, `${report.join('\n')}\n`, 'utf8');

const timeline = JSON.parse(fs.readFileSync(timelinePath, 'utf8'));
const pathsByShot = new Map(course.scenes.flatMap((scene) => scene.shots.map((shot) => [shot.sourceId, shot.voiceFilename || null])));
for (const shot of timeline.shots) shot.audioPath = pathsByShot.get(shot.sourceId) || null;
timeline.audioIncluded = true;
fs.writeFileSync(timelinePath, `${JSON.stringify(timeline, null, 2)}\n`, 'utf8');

console.log(`Created ${report.length - 1} shot audio clips and updated course.json and the MP4 timeline.`);
