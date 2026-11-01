const assert = require('node:assert/strict');
const test = require('node:test');

const {
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
  runtimeCapabilities,
  hasTool,
  burn,
  tts,
  mux
} = require('../core/post.cjs');

test('msToSrt pads hours, minutes, seconds, and milliseconds', () => {
  assert.equal(msToSrt(500), '00:00:00,500');
  assert.equal(msToSrt(3661000), '01:01:01,000');
  assert.equal(msToSrt(0), '00:00:00,000');
  assert.equal(msToSrt(-5), '00:00:00,000');
});

test('parseSrtTime reads comma or dot milliseconds', () => {
  assert.equal(parseSrtTime('00:00:00,500'), 500);
  assert.equal(parseSrtTime('00:00:01.250'), 1250);
  assert.equal(parseSrtTime('01:02:03,004'), 3723004);
  assert.equal(parseSrtTime('not-a-time'), null);
});

test('parseSrt parses standard blocks and infers index when absent', () => {
  const text = [
    '1',
    '00:00:00,000 --> 00:00:01,500',
    '钩子 今天推荐一款',
    '',
    '00:00:01,600 --> 00:00:03,000',
    '数据 全网最低价'
  ].join('\n');
  const entries = parseSrt(text);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { index: 1, start: 0, end: 1500, text: '钩子 今天推荐一款' });
  assert.deepEqual(entries[1], { index: 2, start: 1600, end: 3000, text: '数据 全网最低价' });
});

test('parseSrt rejects an invalid time line instead of swallowing it', () => {
  assert.throws(
    () => parseSrt('1\nNOT-ATIME --> 00:00:02,000\ntext'),
    /Invalid SRT time line/
  );
});

test('formatSrt round-trips parsed entries', () => {
  const entries = [
    { index: 1, start: 0, end: 1500, text: 'A' },
    { index: 2, start: 1600, end: 3000, text: 'B' }
  ];
  const out = formatSrt(entries);
  assert.equal(out, [
    '1',
    '00:00:00,000 --> 00:00:01,500',
    'A',
    '',
    '2',
    '00:00:01,600 --> 00:00:03,000',
    'B',
    ''
  ].join('\n'));
  assert.deepEqual(parseSrt(out).map((e) => e.text), ['A', 'B']);
});

test('parseExpected maps --expect-* flags to numeric expectations', () => {
  assert.deepEqual(parseExpected(['--expect-duration', '15', '--expect-fps', '24']), {
    duration: 15,
    fps: 24
  });
  assert.deepEqual(parseExpected(['--expect-duration', 'nope']), {});
});

test('validateProbe checks duration, dimensions, and fps with tolerance', () => {
  const probe = {
    format: { duration: '15.2' },
    streams: [
      { codec_type: 'video', codec_name: 'h264', width: 720, height: 1280, r_frame_rate: '24/1' }
    ]
  };
  const ok = validateProbe(probe, { duration: 15, width: 720, height: 1280, fps: 24 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.meta, { duration: 15.2, width: 720, height: 1280, fps: 24, codec: 'h264' });

  const bad = validateProbe(probe, { duration: 30 });
  assert.equal(bad.ok, false);
  assert.equal(bad.checks.find((c) => c.name === 'duration').status, 'fail');
});

test('validateProbe falls back to a readable-stream check when no expectations are given', () => {
  const ok = validateProbe({ format: {}, streams: [{ codec_type: 'video', codec_name: 'av1' }] });
  assert.equal(ok.ok, true);
  assert.equal(ok.checks[0].name, 'readable');
});

test('buildVerdict routes objective pass/fail (frame review removed; play for manual review)', () => {
  const pass = { ok: true, checks: [] };
  const fail = { ok: false, checks: [] };
  assert.deepEqual(buildVerdict(fail), { action: 'regenerate', reason: 'objective checks failed, see checks.' });
  assert.equal(buildVerdict(pass).action, 'accept');
});

test('escapeSubtitlePath escapes colons for the ffmpeg subtitles filter', () => {
  assert.equal(escapeSubtitlePath('C:\\clips\\my.srt'), 'C\\:/clips/my.srt');
  const args = buildBurnArgs('in.mp4', 'C:\\clips\\my.srt', 'out.mp4');
  assert.equal(args[0], '-y');
  assert.ok(args.join(' ').includes('subtitles=C\\:/clips/my.srt'));
  assert.ok(args.join(' ').includes('force_style'));
  assert.ok(args.includes('out.mp4'));
});

test('buildProbeArgs requests JSON format and streams', () => {
  const args = buildProbeArgs('in.mp4');
  assert.deepEqual(args, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', 'in.mp4']);
});

test('runtimeCapabilities reports subtitles and tts from the ffmpeg filter list', async () => {
  function fakeExecFile(bin, args) {
    if (bin === 'where' || bin === 'which') return Promise.resolve({ stdout: '' });
    if (args.includes('-filters')) {
      return Promise.resolve({ stdout: [
        ' ...',
        ' ..F. subtitles   V->V ..... Render text subtitles onto input video.',
        ' ..F. volume       A->A ..... Change input volume.',
        ' ..F. amix         AACCC    Audio mixing.',
        ' ..F. adelay       A->A     Delay audio',
        ' ..F. fps          V->V     Force constant framerate.'
      ].join('\n') });
    }
    if (args.includes('-formats')) return Promise.resolve({ stdout: ' DE lavfi  ...' });
    return Promise.resolve({ stdout: '' });
  }
  const caps = await runtimeCapabilities({ execFile: fakeExecFile });
  assert.equal(caps.ffmpeg, true);
  assert.equal(caps.ffprobe, true);
  assert.equal(caps.subtitles, true);
  assert.equal(caps.lavfi, true);
  assert.equal(caps.tts, true);
});

test('burn throws a capability_gap with a recipe when subtitles filter is missing', async () => {
  function fakeExecFile(bin, args) {
    if (bin === 'where' || bin === 'which') return Promise.resolve({ stdout: '' });
    if (args.includes('-filters')) {
      return Promise.resolve({ stdout: ' ..F. volume A->A ...\n ..F. fps     V->V ...\n' });
    }
    if (args.includes('-formats')) return Promise.resolve({ stdout: 'DE lavfi ...\n' });
    return Promise.resolve({ stdout: '' });
  }
  await assert.rejects(
    burn('in.mp4', 'C:\\s.srt', 'out.mp4', {}, { execFile: fakeExecFile }),
    (error) => error.kind === 'capability_gap' && typeof error.recipe === 'string'
  );
});

test('hasTool returns false when the binary probe fails', async () => {
  const ctx = { env: {}, execFile: async () => { throw new Error('missing'); } };
  assert.equal(await hasTool('ffmpeg', ctx), false);
});

test('buildTtsArgs shapes the edge-tts invocation with text, voice, and output', () => {
  const args = buildTtsArgs('三块九,包邮到家', 'zh-CN-XiaoxiaoNeural', 'voice.mp3');
  assert.deepEqual(args, ['--text', '三块九,包邮到家', '--voice', 'zh-CN-XiaoxiaoNeural', '--write-media', 'voice.mp3']);
  // voice 缺省时回落到默认中文女声
  assert.deepEqual(buildTtsArgs('你好', undefined, 'v.mp3').slice(0, 4), ['--text', '你好', '--voice', 'zh-CN-XiaoxiaoNeural']);
});

test('buildMuxArgs mixes voice onto the original audio without normalizing', () => {
  const args = buildMuxArgs('in.mp4', 'voice.mp3', 'out.mp4');
  const joined = args.join(' ');
  assert.ok(joined.includes('[1:a]volume=1[v]'));
  assert.ok(joined.includes('amix=inputs=2:duration=first:dropout_transition=0:normalize=0'));
  assert.ok(joined.includes('-map 0:v'));
  assert.ok(joined.includes('-c:v copy'));
  assert.ok(joined.includes('-c:a aac'));
  assert.ok(joined.includes('-shortest'));
  const vol = buildMuxArgs('in.mp4', 'voice.mp3', 'out.mp4', { volume: 0.8 }).join(' ');
  assert.ok(vol.includes('volume=0.8'));
});

test('tts throws a capability_gap with a recipe when edge-tts is missing', async () => {
  function fakeExecFile(bin, args) {
    if (bin === 'where' || bin === 'which') {
      if (args[0] === 'edge-tts') return Promise.reject(new Error('missing edge-tts'));
      return Promise.resolve({ stdout: '' });
    }
    if (args.includes('-filters')) return Promise.resolve({ stdout: '' });
    if (args.includes('-formats')) return Promise.resolve({ stdout: '' });
    return Promise.resolve({ stdout: '' });
  }
  await assert.rejects(
    tts('你好', 'zh-CN-XiaoxiaoNeural', 'v.mp3', { execFile: fakeExecFile }),
    (error) => error.kind === 'capability_gap' && /edge-tts/.test(error.message) && typeof error.recipe === 'string'
  );
});

test('tts invokes edge-tts when the binary is present', async () => {
  const calls = [];
  function fakeExecFile(bin, args) {
    calls.push([bin, args]);
    if (bin === 'where' || bin === 'which') return Promise.resolve({ stdout: '' });
    if (args.includes('-filters')) return Promise.resolve({ stdout: '' });
    if (args.includes('-formats')) return Promise.resolve({ stdout: '' });
    return Promise.resolve({ stdout: '' });
  }
  await tts('三块九', 'zh-CN-XiaoxiaoNeural', 'v.mp3', { execFile: fakeExecFile });
  const call = calls.find(([bin]) => bin === 'edge-tts');
  assert.ok(call, 'edge-tts should be invoked');
  assert.ok(call[1].includes('--text') && call[1].includes('v.mp3'));
});

test('mux throws a capability_gap with a recipe when ffmpeg is missing', async () => {
  const ctx = { env: {}, execFile: async () => { throw new Error('missing'); } };
  await assert.rejects(
    mux('in.mp4', 'voice.mp3', 'out.mp4', {}, ctx),
    (error) => error.kind === 'capability_gap' && typeof error.recipe === 'string'
  );
});