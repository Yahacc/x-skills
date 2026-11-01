const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { ProviderError } = require('../core/contract.cjs');
const { findTask, main, parseBrief, requestFromBrief, submitBrief } = require('../core/orchestrator.cjs');

function fakeProvider(overrides = {}) {
  return {
    isConfigured: () => true,
    supports: () => ({ supported: true }),
    create: async () => ({ status: 'queued', task: { id: 'task-abc' } }),
    status: async () => ({ status: 'succeeded', artifact_sources: [] }),
    ...overrides
  };
}

function entry(overrides = {}) {
  return {
    id: 'agnes',
    enabled: true,
    priority: 100,
    capabilities: ['text-to-image', 'image-to-image', 'text-to-video', 'image-to-video', 'keyframes-to-video'],
    provider: fakeProvider(),
    ...overrides
  };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'y-media-cli-'));
}

function writeBrief(dir, name, text) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
}

const T2V_BRIEF = `
## 1. 视频主要目标

\`产品 × 人群 × 兴趣 × 骨架A × 15s × 竖屏9:16\`

- **默认假设**: 纯生成;无真人;无对白;单段直出;9:16 @ 720×1280。

## 2. 分镜表格

| 镜号 | 时长 | 景别 | 主体动作 |
| --- | --- | --- | --- |
| S01-01 | 15s | 全景 | 主体入画 |

## 5. 视频 prompt(执行层)

\`\`\`text
Vertical 9:16, 15 seconds. A gentle cat walks through soft morning light.
\`\`\`
`;

const I2V_BRIEF = `
## 1. 视频主要目标

\`产品 × 人群 × 兴趣 × 锚定生成 × 10s × 1:1\`

- **默认假设**: 锚定图;image_paths: https://cdn.example.com/ref.png, https://cdn.example.com/ref2.png;1:1。

## 5. 视频 prompt(执行层)

\`\`\`text
Square 1:1, 10 seconds. A product spins slowly.
\`\`\`
`;

const T2I_BRIEF = `
## 1. 图片主要目标

\`品牌 BlackBeats × 25-35 男性通勤族 × 转化(转化) × 骨架A(主体居中) × 画幅 1:1(方图) × 用途:电商详情页主图\`

- **默认假设**: 无实拍参考图 → G 纯生成。

## 2. 视觉规范表

| 字段 | 内容 |
| --- | --- |
| 区域 ID | Z01 |

## 3. 图片 prompt

\`\`\`text
Product photography, square 1:1, minimalist tech aesthetic. A matte-black earphone case.
\`\`\`
`;

const I2I_BRIEF = `
## 1. 图片主要目标

\`品牌 一杯咖啡的午后 × 25-35 文艺女性 × 兴趣(种草) × 骨架B(分区拼贴) × 画幅 3:4(竖版海报) × 用途:活动封面\`

- **默认假设**: 参考图: https://cdn.example.com/coffee.png;H 多图分区拼贴。

## 2. 视觉规范表

| 字段 | 内容 |
| --- | --- |
| 区域 ID | Z01 |

## 3. 图片 prompt

\`\`\`text
Lifestyle collage poster, vertical 3:4, warm indie zine aesthetic.
\`\`\`
`;

async function capture(method, fn) {
  const original = console[method];
  const lines = [];
  console[method] = (line) => lines.push(String(line));
  try {
    await fn();
  } finally {
    console[method] = original;
  }
  return lines;
}

async function withExitCode(fn) {
  const original = process.exitCode;
  try {
    await fn();
  } finally {
    process.exitCode = original;
  }
}

test('parseBrief extracts the last fenced prompt and defaults to text-to-video', () => {
  const brief = parseBrief(T2V_BRIEF, 'nature.video-brief.md');
  assert.equal(brief.name, 'nature');
  assert.equal(brief.capability, 'text-to-video');
  assert.match(brief.prompt, /gentle cat walks/);
  assert.deepEqual(brief.inputs, []);
});

test('parseBrief derives dimensions and 8n+1 frames from the brief header', () => {
  const brief = parseBrief(T2V_BRIEF, 'nature.video-brief.md');
  assert.deepEqual(brief.parameters, { width: 720, height: 1280, num_frames: 361 });
});

test('parseBrief detects image-to-video from image_paths and keeps public HTTPS inputs', () => {
  const brief = parseBrief(I2V_BRIEF, 'product.video-brief.md');
  assert.equal(brief.capability, 'image-to-video');
  assert.equal(brief.inputs.length, 2);
  assert.deepEqual(brief.inputs[0], { type: 'image', source: { kind: 'url', value: 'https://cdn.example.com/ref.png' } });
  assert.deepEqual(brief.parameters, { width: 1024, height: 1024, num_frames: 241 });
});

test('parseBrief detects image-to-video from a 参考图 label and keeps public HTTPS inputs', () => {
  const text = I2V_BRIEF.replace(
    '锚定图;image_paths: https://cdn.example.com/ref.png, https://cdn.example.com/ref2.png;1:1。',
    '锚定图;参考图: https://cdn.example.com/ref.png;1:1。'
  );
  const brief = parseBrief(text, 'product.video-brief.md');
  assert.equal(brief.capability, 'image-to-video');
  assert.equal(brief.inputs.length, 1);
  assert.deepEqual(brief.inputs[0], { type: 'image', source: { kind: 'url', value: 'https://cdn.example.com/ref.png' } });
});

test('parseBrief rejects an i2v declaration that carries no image URL', () => {
  const text = T2V_BRIEF.replace(
    '纯生成;无真人;无对白;单段直出;9:16 @ 720×1280',
    '锚定生成;参考图;9:16'
  );
  assert.throws(
    () => parseBrief(text, 'product.video-brief.md'),
    (error) => error instanceof ProviderError && /public HTTPS image URL/i.test(error.message)
  );
});

test('parseBrief rejects a brief without a fenced prompt', () => {
  assert.throws(
    () => parseBrief('# 视频主要目标\n\n没有代码块。', 'empty.video-brief.md'),
    (error) => error instanceof ProviderError && /no fenced Final Prompt/i.test(error.message)
  );
});

test('requestFromBrief builds a submit request with safe defaults', () => {
  const request = requestFromBrief(parseBrief(T2V_BRIEF, 'nature.video-brief.md'));
  assert.equal(request.capability, 'text-to-video');
  assert.deepEqual(request.output, { directory: 'outputs', filename: 'nature.mp4' });
  assert.deepEqual(request.parameters, { width: 720, height: 1280, num_frames: 361 });
});

test('submitBrief submits once, records the task, and findTask resolves it', async () => {
  const dir = tempDir();
  const briefFile = writeBrief(dir, 'nature.video-brief.md', T2V_BRIEF);
  const context = { cwd: dir, manifest: [entry()] };

  const { brief, result } = await submitBrief(briefFile, {}, context);
  assert.equal(brief.capability, 'text-to-video');
  assert.equal(result.ok, true);
  assert.equal(result.task.id, 'task-abc');

  const recorded = findTask('task-abc', context);
  assert.equal(recorded.provider, 'agnes');
  assert.equal(recorded.capability, 'text-to-video');
  assert.equal(recorded.brief, briefFile);
  assert.equal(fs.existsSync(path.join(dir, '.y-media', 'tasks.json')), true);
});

test('submitBrief materializes a synchronous success with no task id', async () => {
  const dir = tempDir();
  const briefFile = writeBrief(dir, 'cat.video-brief.md', T2V_BRIEF);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  const context = {
    cwd: dir,
    manifest: [entry({
      capabilities: ['text-to-video'],
      provider: fakeProvider({
        create: async () => ({
          status: 'succeeded',
          artifact_sources: [{ kind: 'bytes', mime_type: 'image/png', value: png }]
        })
      })
    })]
  };

  const { result } = await submitBrief(briefFile, {}, context);
  assert.equal(result.ok, true);
  assert.equal(result.artifacts.length, 1);
  assert.equal(fs.statSync(result.artifacts[0].path).size, png.length);
});

test('submitBrief reports a missing brief file instead of guessing', async () => {
  const dir = tempDir();
  await assert.rejects(
    submitBrief(path.join(dir, 'missing.video-brief.md'), {}, { cwd: dir }),
    (error) => error instanceof ProviderError && /Unable to read brief/i.test(error.message)
  );
});

test('findTask lists known ids when the requested task id is unknown', () => {
  const dir = tempDir();
  assert.throws(
    () => findTask('nope', { cwd: dir }),
    (error) => error instanceof ProviderError && /Known task ids: \(none\)/.test(error.message)
  );
});

test('CLI submit, status, and download resolve one pinned task end to end', async () => {
  const dir = tempDir();
  const briefFile = writeBrief(dir, 'nature.video-brief.md', T2V_BRIEF);
  const context = { cwd: dir, manifest: [entry()] };
  let log = [];
  let exitCode;

  await withExitCode(async () => {
    log = await capture('log', () => main(['submit', briefFile], context));
    exitCode = process.exitCode;
  });
  assert.equal(exitCode ?? 0, 0);
  assert.match(fs.readFileSync(path.join(dir, '.y-media', 'tasks.json'), 'utf8'), /task-abc/);

  await withExitCode(async () => {
    log = await capture('log', () => main(['status', 'task-abc'], context));
    exitCode = process.exitCode;
  });
  assert.equal(exitCode ?? 0, 0);
  assert.match(log.join('\n'), /"succeeded"/);

  await withExitCode(async () => {
    log = await capture('log', () => main(['download', 'task-abc', '--out', path.join(dir, 'final')], context));
    exitCode = process.exitCode;
  });
  assert.equal(exitCode ?? 0, 0);
  assert.match(log.join('\n'), /"ok": true/);
});

test('CLI prints usage and sets exit code 2 for an unknown command', async () => {
  const dir = tempDir();
  let error = [];
  let exitCode;
  await withExitCode(async () => {
    error = await capture('error', () => main(['bogus'], { cwd: dir }));
    exitCode = process.exitCode;
  });
  assert.equal(exitCode, 2);
  assert.match(error.join('\n'), /Usage:/);
});

// ---------------- 图片 brief(.image-brief.md) ----------------

test('parseBrief derives text-to-image from an image brief and maps 画幅 to ratio', () => {
  const brief = parseBrief(T2I_BRIEF, 'earphones.image-brief.md');
  assert.equal(brief.name, 'earphones');
  assert.equal(brief.capability, 'text-to-image');
  assert.deepEqual(brief.inputs, []);
  assert.deepEqual(brief.parameters, { ratio: '1:1' });
});

test('parseBrief ignores a negated 参考图 mention and stays on the G (text-to-image) path', () => {
  const brief = parseBrief(T2I_BRIEF, 'earphones.image-brief.md');
  assert.equal(brief.capability, 'text-to-image');
  assert.equal(brief.inputs.length, 0);
});

test('parseBrief detects image-to-image from a 参考图 URL and keeps the public HTTPS input', () => {
  const brief = parseBrief(I2I_BRIEF, 'poster.image-brief.md');
  assert.equal(brief.capability, 'image-to-image');
  assert.equal(brief.inputs.length, 1);
  assert.deepEqual(brief.inputs[0], { type: 'image', source: { kind: 'url', value: 'https://cdn.example.com/coffee.png' } });
  assert.deepEqual(brief.parameters, { ratio: '3:4' });
});

test('parseBrief rejects an image i2i declaration that carries no image URL', () => {
  const text = I2I_BRIEF.replace('参考图: https://cdn.example.com/coffee.png;H 多图分区拼贴。', '参考图;H 多图分区拼贴。');
  assert.throws(
    () => parseBrief(text, 'poster.image-brief.md'),
    (error) => error instanceof ProviderError && /public HTTPS image URL/i.test(error.message)
  );
});

test('requestFromBrief names image output .png', () => {
  const request = requestFromBrief(parseBrief(T2I_BRIEF, 'earphones.image-brief.md'));
  assert.equal(request.capability, 'text-to-image');
  assert.deepEqual(request.output, { directory: 'outputs', filename: 'earphones.png' });
  assert.deepEqual(request.parameters, { ratio: '1:1' });
});

test('submitBrief records an image task in the ledger with a .png output', async () => {
  const dir = tempDir();
  const briefFile = writeBrief(dir, 'poster.image-brief.md', I2I_BRIEF);
  const context = { cwd: dir, manifest: [entry()] };

  const { brief, result } = await submitBrief(briefFile, {}, context);
  assert.equal(brief.capability, 'image-to-image');
  assert.equal(result.ok, true);

  const recorded = findTask('task-abc', context);
  assert.equal(recorded.capability, 'image-to-image');
  assert.equal(recorded.output.filename, 'poster.png');
});

test('CLI submit resolves an image brief end to end', async () => {
  const dir = tempDir();
  const briefFile = writeBrief(dir, 'earphones.image-brief.md', T2I_BRIEF);
  const context = { cwd: dir, manifest: [entry()] };
  let log = [];
  let exitCode;
  await withExitCode(async () => {
    log = await capture('log', () => main(['submit', briefFile], context));
    exitCode = process.exitCode;
  });
  assert.equal(exitCode ?? 0, 0);
  assert.match(log.join('\n'), /"capability": "text-to-image"/);
  assert.match(fs.readFileSync(path.join(dir, '.y-media', 'tasks.json'), 'utf8'), /earphones\.png/);
});
