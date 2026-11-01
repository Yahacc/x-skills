'use strict';
/**
 * post · 后期引擎(可选依赖 ffmpeg/ffprobe/edge-tts)
 *
 * 交付必需的最小后期能力:产物级质量门 + 字幕烧录 + 配音 TTS 混入。
 * 字幕/配音默认走后期(M4 §6 / M5 §7):文案从 storyboard 产出 SRT 与 TTS 同源,
 * ffmpeg 烧录字幕、混入配音;环境音/BGM 仍由 prompt 直出。
 *
 * 能力:
 *  - C 产物级质量门(主):用 ffprobe 客观校验(时长/宽高/帧率)。禁止抽帧——质检只播放成片人工审。
 *  - B 字幕烧录:SRT 后期烧录为主(M5 §7),样式可传参。
 *  - V 配音 TTS + 混入:edge-tts 生成人声音轨,ffmpeg 混入视频原音轨(M4 §6)。
 *
 * 依赖可降级:
 *  - probe / burn / mux 需要 ffmpeg 与 ffprobe;tts 需要 edge-tts(缺失时报能力缺口,不伪造)。
 *
 * 用法:
 *   node core/post.cjs probe  <video> [--expect-duration 15] [--expect-width 720] [--expect-height 1280] [--expect-fps 24]
 *   node core/post.cjs burn   <video> --srt <file.srt> --out <out.mp4>
 *   node core/post.cjs tts    --text <文案> --voice <zh-CN-XiaoxiaoNeural> --out <voice.mp3>
 *   node core/post.cjs mux    <video> --audio <voice.mp3> --out <out.mp4> [--volume 1.0]
 *   node core/post.cjs verify <video> [--expect-*]
 */
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);

// ---------------- 纯函数: 解析与构图 ----------------

/** ms -> "HH:MM:SS,mmm"(SRT 时间) */
function msToSrt(ms) {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const mm = total % 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mm).padStart(3, '0')}`;
}

/** "HH:MM:SS,mmm" -> ms */
function parseSrtTime(str) {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(String(str).trim());
  if (!match) return null;
  const [, hh, mm, ss, mi] = match;
  return Number(hh) * 3600000 + Number(mm) * 60000 + Number(ss) * 1000 + Number(mi.padEnd(3, '0'));
}

/**
 * 解析标准 SRT 文本 -> [{ index, start, end, text }]
 * 校验严格: 时间行必须为 "-->" 且两端可解析;失败抛错(不静默吞掉格式问题)。
 */
function parseSrt(text) {
  const blocks = String(text).replace(/^\uFEFF/, '').trim().split(/\r?\n\r?\n+/);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length === 0) continue;
    let idxLine = 0;
    let index = entries.length + 1;
    if (/^\d+$/.test(lines[0].trim())) {
      index = Number(lines[0].trim());
      idxLine = 1;
    }
    const timeLine = lines[idxLine];
    const tm = /^([\d:,.]+)\s*-->\s*([\d:,.]+)/.exec(timeLine);
    if (!tm) {
      throw new Error(`Invalid SRT time line: "${timeLine}"`);
    }
    const start = parseSrtTime(tm[1]);
    const end = parseSrtTime(tm[2]);
    if (start === null || end === null) {
      throw new Error(`Invalid SRT time value: "${timeLine}"`);
    }
    const text = lines.slice(idxLine + 1).join('\n');
    entries.push({ index, start, end, text });
  }
  return entries;
}

/** 标准 SRT 文本生成(供 agent 伴生文档直接产出) */
function formatSrt(entries) {
  return entries
    .map((e, i) => `${e.index ?? i + 1}\n${msToSrt(e.start)} --> ${msToSrt(e.end)}\n${e.text}\n`)
    .join('\n')
    .trim() + '\n';
}

/** 从 CLI --expect-* 解析期望值 */
function parseExpected(args) {
  const expected = {};
  const map = {
    '--expect-duration': 'duration',
    '--expect-width': 'width',
    '--expect-height': 'height',
    '--expect-fps': 'fps'
  };
  for (let i = 0; i < args.length; i += 1) {
    const key = map[args[i]];
    if (key) {
      const v = Number(args[i + 1]);
      if (Number.isFinite(v)) expected[key] = v;
    }
  }
  return expected;
}

/**
 * 校验 ffprobe JSON 与期望值。
 * @returns {{ ok:boolean, checks:Array<{name,expected,actual,status}>, meta:object }}
 */
function validateProbe(probe, expected = {}) {
  const format = probe?.format ?? {};
  const video = (probe?.streams ?? []).find((s) => s.codec_type === 'video');
  const fpsOf = (s) => {
    if (!s) return NaN;
    const m = /^(\d+)\/(\d+)$/.exec(s.r_frame_rate || s.avg_frame_rate || '');
    return m ? Number(m[1]) / Number(m[2]) : NaN;
  };
  const actual = {
    duration: format.duration !== undefined ? Number(format.duration) : NaN,
    width: video ? Number(video.width) : NaN,
    height: video ? Number(video.height) : NaN,
    fps: fpsOf(video),
    codec: video ? video.codec_name : null
  };
  const checks = [];
  if (expected.duration !== undefined) {
    const ok = Number.isFinite(actual.duration) && Math.abs(actual.duration - expected.duration) <= 0.5;
    checks.push({ name: 'duration', expected: expected.duration, actual: actual.duration, status: ok ? 'pass' : 'fail' });
  }
  if (expected.width !== undefined) {
    const ok = Number.isFinite(actual.width) && actual.width === expected.width;
    checks.push({ name: 'width', expected: expected.width, actual: actual.width, status: ok ? 'pass' : 'fail' });
  }
  if (expected.height !== undefined) {
    const ok = Number.isFinite(actual.height) && actual.height === expected.height;
    checks.push({ name: 'height', expected: expected.height, actual: actual.height, status: ok ? 'pass' : 'fail' });
  }
  if (expected.fps !== undefined) {
    const ok = Number.isFinite(actual.fps) && Math.abs(actual.fps - expected.fps) <= 1;
    checks.push({ name: 'fps', expected: expected.fps, actual: actual.fps, status: ok ? 'pass' : 'fail' });
  }
  if (checks.length === 0) {
    checks.push({ name: 'readable', expected: 'video stream', actual: actual.codec || 'none', status: actual.codec ? 'pass' : 'fail' });
  }
  return { ok: checks.every((c) => c.status === 'pass'), checks, meta: actual };
}

// ---------------- 命令构图(纯函数,便于测试) ----------------

/** ffprobe 到 JSON 的参数 */
function buildProbeArgs(video) {
  return ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', video];
}

/** 字幕烧录: -vf subtitles=<escaped>。Windows 路径需转义冒号与反斜杠。 */
function escapeSubtitlePath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
}
function buildBurnArgs(video, srt, out, opts = {}) {
  const style = opts.style || 'FontName=Source Han Sans SC Bold,FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=1,Outline=2';
  const filter = `subtitles=${escapeSubtitlePath(srt)}:force_style='${style.replace(/'/g, "\\'")}'`;
  return ['-y', '-i', video, '-vf', filter, '-c:a', 'copy', out];
}

/** 配音 TTS: edge-tts CLI 参数(文案/音色/输出)。 */
function buildTtsArgs(text, voice, out) {
  return ['--text', String(text), '--voice', voice || 'zh-CN-XiaoxiaoNeural', '--write-media', out];
}

/** 配音混入: 将配音音轨与视频原音轨(环境音/BGM)amix 合成。normalize=0 避免音量衰减。 */
function buildMuxArgs(video, audio, out, opts = {}) {
  const volume = opts.volume === undefined ? 1.0 : opts.volume;
  const filter = `[1:a]volume=${volume}[v];[0:a][v]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]`;
  return ['-y', '-i', video, '-i', audio, '-filter_complex', filter, '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-shortest', out];
}

// ---------------- 运行层(可注入 execFile 便于测试) ----------------

function runtimeContext(ctx = {}) {
  return {
    execFile: ctx.execFile ?? execFileAsync,
    env: ctx.env ?? process.env,
    cwd: ctx.cwd ?? process.cwd()
  };
}

async function hasTool(bin, ctx) {
  const probeCmd = process.platform === 'win32' ? 'where' : 'which';
  try {
    await ctx.execFile(probeCmd, [bin], { env: ctx.env });
    return true;
  } catch {
    return false;
  }
}

/**
 * 探测本机 ffmpeg 实际能力(不假设)。不同构建可能缺滤镜/输入源。
 * 返回独立可用的后期能力,缺失的如实报告并给出降级路径。
 */
async function runtimeCapabilities(ctx = {}) {
  const rt = runtimeContext(ctx);
  const hasBin = await hasTool('ffmpeg', rt);
  const hasProbe = await hasTool('ffprobe', rt);
  const hasTts = await hasTool('edge-tts', rt);
  const filters = new Set();
  let hasLavfi = false;
  if (hasBin) {
    try {
      const { stdout } = await rt.execFile('ffmpeg', ['-hide_banner', '-filters'], { env: rt.env });
      for (const line of stdout.split(/\r?\n/)) {
        const m = / ([A-Za-z0-9_]+) +V\.\.\.| ([A-Za-z0-9_]+) +A\.\.\./.exec(line);
        const name = m ? (m[1] || m[2]) : /^\s*[A-Z.]+\s+([a-z0-9_]+)\s/.exec(line)?.[1];
        if (name) filters.add(name);
      }
    } catch { /* ignore */ }
  }
  if (hasBin) {
    try {
      const { stdout } = await rt.execFile('ffmpeg', ['-hide_banner', '-formats'], { env: rt.env });
      hasLavfi = /^\s*[DE]{0,2}\s+lavfi\b/s.test(stdout);
    } catch { /* ignore */ }
  }
  // 字幕烧录需要 subtitles 滤镜
  const hasSubtitles = filters.has('subtitles') || filters.has('ass');
  return {
    ffmpeg: hasBin,
    ffprobe: hasProbe,
    lavfi: hasLavfi,
    subtitles: hasSubtitles,
    tts: hasTts,
    filters: [...filters].sort()
  };
}

/** B·字幕烧录的降级菜谱(在任何完整 ffmpeg / 剪映 上可执行) */
function burnRecipe(video, srt, out) {
  return [
    '# 字幕烧录(本机 ffmpeg 缺 subtitles 滤镜,请用完整版 ffmpeg 或剪映):',
    `ffmpeg -i "${video}" -vf "subtitles=${escapeSubtitlePath(srt)}:force_style='FontName=Source Han Sans SC Bold,FontSize=18,PrimaryColour=&HFFFFFF,OutlineColour=&H000000,BorderStyle=1,Outline=2'" -c:a copy "${out}"`
  ].join('\n');
}

/** V·配音 TTS 的降级菜谱(任何有 edge-tts / python 的环境可执行) */
function ttsRecipe(text, voice, out) {
  return [
    '# 配音 TTS(本机缺 edge-tts,请先安装: pip install edge-tts):',
    `edge-tts --text "${String(text).replace(/"/g, '\\"')}" --voice ${voice || 'zh-CN-XiaoxiaoNeural'} --write-media "${out}"`
  ].join('\n');
}

/** V·配音混入的降级菜谱(任何完整 ffmpeg 可执行) */
function muxRecipe(video, audio, out) {
  return [
    '# 配音混入(本机 ffmpeg 不可用,请在完整 ffmpeg 环境执行):',
    `ffmpeg -y -i "${video}" -i "${audio}" -filter_complex "[1:a]volume=1.0[v];[0:a][v]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -shortest "${out}"`
  ].join('\n');
}

async function probe(video, ctx = {}) {
  const rt = runtimeContext(ctx);
  const { stdout } = await rt.execFile('ffprobe', buildProbeArgs(video), { env: rt.env });
  return JSON.parse(stdout);
}

async function burn(video, srt, out, opts, ctx = {}) {
  const rt = runtimeContext(ctx);
  const caps = await runtimeCapabilities(rt);
  if (!caps.ffmpeg) {
    const err = new Error('ffmpeg unavailable: cannot burn subtitles.');
    err.kind = 'capability_gap';
    err.recipe = burnRecipe(video, srt, out);
    throw err;
  }
  if (!caps.subtitles) {
    const err = new Error('This ffmpeg lacks the subtitles filter; cannot burn subtitles here.');
    err.kind = 'capability_gap';
    err.recipe = burnRecipe(video, srt, out);
    throw err;
  }
  await rt.execFile('ffmpeg', buildBurnArgs(video, srt, out, opts), { env: rt.env });
  return out;
}

/** V·配音 TTS: edge-tts 合成人声音轨(缺 edge-tts 时报能力缺口+菜谱,不伪造)。 */
async function tts(text, voice, out, ctx = {}) {
  const rt = runtimeContext(ctx);
  const caps = await runtimeCapabilities(rt);
  if (!caps.tts) {
    const err = new Error('edge-tts unavailable: cannot synthesize voice. Install with: pip install edge-tts');
    err.kind = 'capability_gap';
    err.recipe = ttsRecipe(text, voice, out);
    throw err;
  }
  await rt.execFile('edge-tts', buildTtsArgs(text, voice, out), { env: rt.env });
  return out;
}

/** V·配音混入: 将 TTS 音轨混入视频原音轨(保留环境音/BGM),输出带配音的成片。 */
async function mux(video, audio, out, opts, ctx = {}) {
  const rt = runtimeContext(ctx);
  const caps = await runtimeCapabilities(rt);
  if (!caps.ffmpeg) {
    const err = new Error('ffmpeg unavailable: cannot mux voice track.');
    err.kind = 'capability_gap';
    err.recipe = muxRecipe(video, audio, out);
    throw err;
  }
  await rt.execFile('ffmpeg', buildMuxArgs(video, audio, out, opts), { env: rt.env });
  return out;
}

/** 质检门: 能力报告 + probe(客观校验) + 决策清单。禁止抽帧——成片直接播放人工审(见 C1-flow §14)。 */
async function verify(video, opts = {}, ctx = {}) {
  const rt = runtimeContext(ctx);
  const expected = opts.expected || {};
  const report = {
    file: video,
    capabilities: await runtimeCapabilities(rt),
    format: null,
    decision: null
  };
  if (!report.capabilities.ffprobe) {
    report.error = 'ffprobe unavailable: cannot run objective checks.';
    return report;
  }
  const data = await probe(video, rt);
  const validation = validateProbe(data, expected);
  report.format = validation.meta;
  report.checks = validation.checks;
  report.decision = buildVerdict(validation);
  return report;
}

/** 客观失败 -> 重生成;通过 -> 接受(成片人工审在 skill 层,见 C2-quality §7)。 */
function buildVerdict(validation) {
  if (!validation.ok) {
    return { action: 'regenerate', reason: 'objective checks failed, see checks.' };
  }
  return { action: 'accept', reason: 'objective checks passed; play the clip for manual review.' };
}

// ---------------- CLI ----------------

async function main(argv) {
  const [cmd, ...rest] = argv;
  const flag = (name, dflt) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : dflt;
  };
  try {
    switch (cmd) {
      case 'probe': {
        const video = rest[0];
        const data = await probe(video);
        const validation = validateProbe(data, parseExpected(rest));
        console.log(JSON.stringify({ ok: validation.ok, checks: validation.checks, meta: validation.meta }, null, 2));
        return;
      }
      case 'burn': {
        const video = rest[0];
        const srt = flag('--srt');
        const out = flag('--out');
        await burn(video, srt, out, {});
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      case 'tts': {
        const text = flag('--text');
        const voice = flag('--voice');
        const out = flag('--out');
        await tts(text, voice, out);
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      case 'mux': {
        const video = rest[0];
        const audio = flag('--audio');
        const out = flag('--out');
        const volume = Number(flag('--volume', '1.0'));
        await mux(video, audio, out, { volume });
        console.log(JSON.stringify({ ok: true, out }, null, 2));
        return;
      }
      case 'verify': {
        const video = rest[0];
        const report = await verify(video, { expected: parseExpected(rest) });
        console.log(JSON.stringify(report, null, 2));
        return;
      }
      default:
        console.error('Usage:\n  probe/burn/tts/mux/verify <video> [options]');
        process.exitCode = 2;
    }
  } catch (error) {
    console.error(`post: ${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  msToSrt,
  parseSrtTime,
  parseSrt,
  formatSrt,
  parseExpected,
  validateProbe,
  buildProbeArgs,
  escapeSubtitlePath,
  buildBurnArgs,
  buildTtsArgs,
  buildMuxArgs,
  buildVerdict,
  runtimeContext,
  runtimeCapabilities,
  hasTool,
  probe,
  burn,
  tts,
  mux,
  verify
};