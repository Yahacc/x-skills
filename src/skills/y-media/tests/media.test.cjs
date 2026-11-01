const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CAPABILITIES,
  ProviderError,
  normalizeOutcome,
  validateManifest,
  validateRequest
} = require('../core/contract.cjs');
const {
  createMedia,
  generateMedia,
  listCapabilities,
  statusMedia,
  waitMedia
} = require('../core/orchestrator.cjs');
const {
  downloadArtifact,
  preflightOutput,
  saveArtifacts,
  withTransientRetry
} = require('../core/artifacts.cjs');
const agnes = require('../providers/agnes/provider.cjs');

function provider(overrides = {}) {
  return {
    isConfigured: () => true,
    supports: () => ({ supported: true }),
    create: async () => ({ status: 'succeeded', artifact_sources: [] }),
    ...overrides
  };
}

function entry(id, priority, overrides = {}) {
  return {
    id,
    enabled: true,
    priority,
    capabilities: ['text-to-image'],
    provider: provider(),
    ...overrides
  };
}

function credentialContext({ envValue, fileValue, mode = 0o100600, platform = 'linux' } = {}) {
  let reads = 0;
  return {
    env: envValue === undefined ? {} : { AGNES_API_KEY: envValue },
    homeDir: '/home/tester',
    platform,
    fsApi: {
      statSync() {
        if (fileValue === undefined) {
          const error = new Error('missing');
          error.code = 'ENOENT';
          throw error;
        }
        return { mode };
      },
      readFileSync(filePath, encoding) {
        reads += 1;
        assert.equal(filePath, path.join('/home/tester', '.config', 'agnes', 'api_key'));
        assert.equal(encoding, 'utf8');
        return fileValue;
      }
    },
    get reads() { return reads; }
  };
}

test('manifest rejects duplicate priorities between enabled providers', () => {
  assert.throws(
    () => validateManifest([entry('first', 10), entry('second', 10)]),
    (error) => error instanceof ProviderError
      && error.kind === 'configuration_error'
      && /priority/i.test(error.message)
  );
});

test('manifest priority order is deterministic and independent of array order', () => {
  const sorted = validateManifest([
    entry('third', 30),
    entry('first', 10),
    entry('second', 20)
  ]);

  assert.deepEqual(sorted.map(({ id }) => id), ['first', 'second', 'third']);
});

test('disabled providers do not reserve a priority', () => {
  const sorted = validateManifest([
    entry('disabled', 10, { enabled: false }),
    entry('enabled', 10)
  ]);

  assert.deepEqual(sorted.map(({ id }) => id), ['disabled', 'enabled']);
});

test('manifest rejects duplicate ids, invalid capabilities, and incomplete providers', async (t) => {
  await t.test('duplicate id', () => {
    assert.throws(
      () => validateManifest([entry('same', 10), entry('same', 20)]),
      (error) => error.kind === 'configuration_error' && /id/i.test(error.message)
    );
  });

  await t.test('duplicate capability', () => {
    assert.throws(
      () => validateManifest([
        entry('duplicate-capability', 10, {
          capabilities: ['text-to-image', 'text-to-image']
        })
      ]),
      (error) => error.kind === 'configuration_error' && /capabilit/i.test(error.message)
    );
  });

  await t.test('unknown capability', () => {
    assert.throws(
      () => validateManifest([
        entry('unknown-capability', 10, { capabilities: ['speech-to-text'] })
      ]),
      (error) => error.kind === 'configuration_error' && /capabilit/i.test(error.message)
    );
  });

  await t.test('missing create function', () => {
    const incomplete = provider();
    delete incomplete.create;
    assert.throws(
      () => validateManifest([entry('incomplete', 10, { provider: incomplete })]),
      (error) => error.kind === 'configuration_error' && /create/i.test(error.message)
    );
  });
});

test('new work accepts an optional provider but requires capability and prompt', () => {
  const request = validateRequest('create', {
    provider: 'agnes',
    capability: 'text-to-image',
    prompt: 'A clean studio product photo',
    inputs: [],
    parameters: {},
    output: { directory: 'outputs' }
  });

  assert.equal(request.provider, 'agnes');
  assert.throws(
    () => validateRequest('generate', { capability: 'text-to-image', prompt: ' ' }),
    (error) => error.kind === 'invalid_request' && /prompt/i.test(error.message)
  );
});

test('output filename accepts one safe file name and rejects unsafe Windows names', async (t) => {
  const valid = validateRequest('generate', {
    capability: 'text-to-video',
    prompt: 'A short film',
    output: { filename: '打工人治愈电影感_15秒.mp4' }
  });
  assert.equal(valid.output.filename, '打工人治愈电影感_15秒.mp4');

  for (const filename of [
    '../escape.mp4',
    'nested/video.mp4',
    'nested\\video.mp4',
    'CON.mp4',
    'CON.backup.mp4',
    'trailing. ',
    `${'x'.repeat(121)}.mp4`
  ]) {
    await t.test(filename, () => {
      assert.throws(
        () => validateRequest('generate', {
          capability: 'text-to-video',
          prompt: 'A short film',
          output: { filename }
        }),
        (error) => error.kind === 'invalid_request' && /output\.filename/.test(error.message)
      );
    });
  }
});

test('status and wait require the original provider and opaque task id', async (t) => {
  const valid = {
    provider: 'agnes',
    capability: 'image-to-video',
    task: { id: 'video_123' }
  };

  assert.equal(validateRequest('status', valid).task.id, 'video_123');
  assert.equal(validateRequest('wait', valid).provider, 'agnes');

  await t.test('missing provider', () => {
    assert.throws(
      () => validateRequest('status', { ...valid, provider: undefined }),
      (error) => error.kind === 'invalid_request' && /provider/i.test(error.message)
    );
  });

  await t.test('missing task id', () => {
    assert.throws(
      () => validateRequest('wait', { ...valid, task: {} }),
      (error) => error.kind === 'invalid_request' && /task\.id/i.test(error.message)
    );
  });
});

test('provider outcomes normalize optional collections and reject unknown states', () => {
  assert.deepEqual(normalizeOutcome({ status: 'queued', task: { id: 'task-1' } }), {
    status: 'queued',
    task: { id: 'task-1' },
    artifact_sources: [],
    effective_parameters: {},
    warnings: []
  });

  assert.throws(
    () => normalizeOutcome({ status: 'finished' }),
    (error) => error.kind === 'invalid_response'
  );
  assert.throws(
    () => normalizeOutcome({ status: 'queued', task: [] }),
    (error) => error.kind === 'invalid_response'
  );
});

test('automatic creation uses ascending priority instead of manifest order', async () => {
  const calls = [];
  const first = provider({
    create: async () => {
      calls.push('first');
      return { status: 'succeeded', artifact_sources: [] };
    }
  });
  const second = provider({
    create: async () => {
      calls.push('second');
      return { status: 'succeeded', artifact_sources: [] };
    }
  });

  const result = await createMedia({
    capability: 'text-to-image',
    prompt: 'studio product'
  }, {
    manifest: [entry('second', 20, { provider: second }), entry('first', 10, { provider: first })],
    preflightOutput: async () => {}
  });

  assert.equal(result.provider, 'first');
  assert.deepEqual(calls, ['first']);
});

test('automatic creation skips unconfigured and unsupported providers', async () => {
  const calls = [];
  const unconfigured = provider({
    isConfigured: () => false,
    create: async () => calls.push('unconfigured')
  });
  const unsupported = provider({
    supports: () => ({ supported: false, reason: 'model mismatch' }),
    create: async () => calls.push('unsupported')
  });
  const eligible = provider({
    create: async () => {
      calls.push('eligible');
      return { status: 'queued', task: { id: 'task-1' } };
    }
  });

  const result = await createMedia({
    capability: 'text-to-image',
    prompt: 'studio product'
  }, {
    manifest: [
      entry('unconfigured', 10, { provider: unconfigured }),
      entry('unsupported', 20, { provider: unsupported }),
      entry('eligible', 30, { provider: eligible })
    ],
    preflightOutput: async () => {}
  });

  assert.equal(result.provider, 'eligible');
  assert.deepEqual(calls, ['eligible']);
});

test('automatic creation falls back only after authoritative pre-acceptance rejection', async () => {
  const calls = [];
  const rejected = provider({
    create: async () => {
      calls.push('rejected');
      throw new ProviderError('provider_unavailable', 'rejected before acceptance', {
        accepted: false
      });
    }
  });
  const fallback = provider({
    create: async () => {
      calls.push('fallback');
      return { status: 'succeeded' };
    }
  });

  const result = await createMedia({
    capability: 'text-to-image',
    prompt: 'studio product'
  }, {
    manifest: [
      entry('rejected', 10, { provider: rejected }),
      entry('fallback', 20, { provider: fallback })
    ],
    preflightOutput: async () => {}
  });

  assert.equal(result.provider, 'fallback');
  assert.deepEqual(calls, ['rejected', 'fallback']);
});

test('automatic creation blocks fallback when acceptance is unknown', async () => {
  const calls = [];
  const ambiguous = provider({
    create: async () => {
      calls.push('ambiguous');
      throw new ProviderError('network', 'response lost');
    }
  });
  const fallback = provider({
    create: async () => {
      calls.push('fallback');
      return { status: 'succeeded' };
    }
  });

  await assert.rejects(
    createMedia({ capability: 'text-to-image', prompt: 'studio product' }, {
      manifest: [
        entry('ambiguous', 10, { provider: ambiguous }),
        entry('fallback', 20, { provider: fallback })
      ],
      preflightOutput: async () => {}
    }),
    (error) => error.kind === 'network' && error.provider === 'ambiguous'
  );
  assert.deepEqual(calls, ['ambiguous']);
});

test('explicit provider selection never calls a fallback provider', async () => {
  const calls = [];
  const selected = provider({
    create: async () => {
      calls.push('selected');
      throw new ProviderError('provider_unavailable', 'not accepted', { accepted: false });
    }
  });
  const other = provider({
    create: async () => {
      calls.push('other');
      return { status: 'succeeded' };
    }
  });

  await assert.rejects(
    createMedia({
      provider: 'selected',
      capability: 'text-to-image',
      prompt: 'studio product'
    }, {
      manifest: [
        entry('other', 10, { provider: other }),
        entry('selected', 20, { provider: selected })
      ],
      preflightOutput: async () => {}
    }),
    (error) => error.provider === 'selected'
  );
  assert.deepEqual(calls, ['selected']);
});

test('status and wait stay pinned to the named provider', async () => {
  const calls = [];
  const pinned = provider({
    status: async (task) => {
      calls.push(`pinned:${task.id}`);
      return { status: 'succeeded', task: { id: task.id }, artifact_sources: [] };
    }
  });
  const higherPriority = provider({
    status: async () => {
      calls.push('higher-priority');
      return { status: 'succeeded' };
    }
  });
  const context = {
    manifest: [
      entry('higher-priority', 10, { provider: higherPriority }),
      entry('pinned', 20, { provider: pinned })
    ]
  };
  const request = {
    provider: 'pinned',
    capability: 'text-to-image',
    task: { id: 'opaque-id' }
  };

  assert.equal((await statusMedia(request, context)).provider, 'pinned');
  assert.equal((await waitMedia(request, context)).provider, 'pinned');
  assert.deepEqual(calls, ['pinned:opaque-id', 'pinned:opaque-id']);
});

test('existing task errors retain the pinned provider and task id', async () => {
  const failing = provider({
    status: async () => {
      throw new ProviderError('network', 'status unavailable', { retryable: true });
    }
  });
  const request = {
    provider: 'failing',
    capability: 'text-to-video',
    task: { id: 'opaque-failure' }
  };

  await assert.rejects(statusMedia(request, {
    manifest: [entry('failing', 10, {
      provider: failing,
      capabilities: ['text-to-video']
    })]
  }), (error) => error.provider === 'failing'
    && error.task.id === 'opaque-failure'
    && error.kind === 'network');
});

test('existing task outcome cannot replace its pinned task id', async () => {
  const replacing = provider({
    status: async () => ({ status: 'running', task: { id: 'different' } })
  });
  const context = {
    manifest: [entry('replacing', 10, {
      provider: replacing,
      capabilities: ['text-to-video']
    })]
  };
  const request = {
    provider: 'replacing',
    capability: 'text-to-video',
    task: { id: 'original' }
  };

  await assert.rejects(
    statusMedia(request, context),
    (error) => error.kind === 'invalid_response'
      && error.task.id === 'original'
      && error.provider === 'replacing'
  );
});

test('existing task outcome fills a missing task with the pinned task id', async () => {
  const omitting = provider({
    status: async () => ({ status: 'succeeded', artifact_sources: [] })
  });
  const result = await statusMedia({
    provider: 'omitting',
    capability: 'text-to-video',
    task: { id: 'original' }
  }, {
    manifest: [entry('omitting', 10, {
      provider: omitting,
      capabilities: ['text-to-video']
    })]
  });

  assert.equal(result.task.id, 'original');
});

test('wait timeout preserves the pinned task without resubmitting work', async () => {
  let currentMs = 0;
  let statusCalls = 0;
  const pinned = provider({
    status: async (task) => {
      statusCalls += 1;
      return { status: 'running', task: { id: task.id, progress: 20 }, poll_after_ms: 800 };
    }
  });

  const result = await waitMedia({
    provider: 'pinned',
    capability: 'text-to-video',
    task: { id: 'video-1' },
    wait: { timeout_seconds: 1 }
  }, {
    manifest: [entry('pinned', 10, {
      provider: pinned,
      capabilities: ['text-to-video']
    })],
    now: () => currentMs,
    sleep: async (delayMs) => { currentMs += delayMs; }
  });

  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'wait_timeout');
  assert.equal(result.provider, 'pinned');
  assert.equal(result.task.id, 'video-1');
  assert.equal(statusCalls, 2);
});

test('generate preflights output before create and materializes successful sources', async () => {
  const events = [];
  const selected = provider({
    create: async () => {
      events.push('create');
      return {
        status: 'succeeded',
        artifact_sources: [{ kind: 'base64', mime_type: 'image/png', value: 'aGVsbG8=' }]
      };
    }
  });

  const result = await generateMedia({
    capability: 'text-to-image',
    prompt: 'studio product'
  }, {
    manifest: [entry('selected', 10, { provider: selected })],
    preflightOutput: async () => { events.push('preflight'); },
    saveArtifacts: async (sources) => {
      events.push(`save:${sources.length}`);
      return [{ type: 'image', path: 'C:/outputs/result-01.png', bytes: 5 }];
    }
  });

  assert.deepEqual(events, ['preflight', 'create', 'save:1']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.artifacts, [
    { type: 'image', path: 'C:/outputs/result-01.png', bytes: 5 }
  ]);
});

test('capabilities are derived from the manifest without checking credentials', () => {
  let configuredChecks = 0;
  const manifest = [
    entry('video', 20, {
      capabilities: ['text-to-video'],
      provider: provider({ isConfigured: () => { configuredChecks += 1; return true; } })
    }),
    entry('image', 10, {
      capabilities: ['text-to-image', 'image-to-image'],
      provider: provider({ isConfigured: () => { configuredChecks += 1; return true; } })
    })
  ];

  assert.deepEqual(listCapabilities(manifest), {
    ok: true,
    providers: [
      { id: 'image', enabled: true, priority: 10, capabilities: ['text-to-image', 'image-to-image'] },
      { id: 'video', enabled: true, priority: 20, capabilities: ['text-to-video'] }
    ],
    capabilities: ['text-to-image', 'image-to-image', 'text-to-video']
  });
  assert.equal(configuredChecks, 0);
});

test('capability_limits are exposed in the capabilities output and parsed without aliasing the manifest', () => {
  const manifest = [entry('limited', 10, {
    capabilities: ['text-to-video'],
    capability_limits: {
      'text-to-video': {
        maxSingleSegmentDuration: 18,
        maxFrames: 441,
        defaultFrameRate: 24,
        supportedAspectRatios: ['16:9', '9:16'],
        frameCountRule: '8n+1'
      }
    }
  })];

  const output = listCapabilities(manifest);
  assert.deepEqual(output.providers[0].capability_limits, {
    'text-to-video': {
      maxSingleSegmentDuration: 18,
      maxFrames: 441,
      defaultFrameRate: 24,
      supportedAspectRatios: ['16:9', '9:16'],
      frameCountRule: '8n+1'
    }
  });
  // Mutating the output must not leak into the manifest
  output.providers[0].capability_limits['text-to-video'].maxSingleSegmentDuration = 999;
  assert.equal(manifest[0].capability_limits['text-to-video'].maxSingleSegmentDuration, 18);
});

test('manifest rejects unknown fields, wrong types, and undeclared capabilities in capability_limits', async (t) => {
  await t.test('unknown limit field', () => {
    assert.throws(
      () => validateManifest([entry('bad', 10, {
        capabilities: ['text-to-video'],
        capability_limits: { 'text-to-video': { madeUpField: 1 } }
      })]),
      (error) => error.kind === 'configuration_error' && /capability_limits/.test(error.message)
    );
  });

  await t.test('undeclared capability in capability_limits', () => {
    assert.throws(
      () => validateManifest([entry('bad', 10, {
        capabilities: ['text-to-video'],
        capability_limits: { 'text-to-image': { maxFrames: 100 } }
      })]),
      (error) => error.kind === 'configuration_error' && /not declared in capabilities/.test(error.message)
    );
  });

  await t.test('non-numeric numeric field', () => {
    assert.throws(
      () => validateManifest([entry('bad', 10, {
        capabilities: ['text-to-video'],
        capability_limits: { 'text-to-video': { maxFrames: '441' } }
      })]),
      (error) => error.kind === 'configuration_error' && /maxFrames/.test(error.message)
    );
  });

  await t.test('non-array supportedAspectRatios', () => {
    assert.throws(
      () => validateManifest([entry('bad', 10, {
        capabilities: ['text-to-video'],
        capability_limits: { 'text-to-video': { supportedAspectRatios: '16:9' } }
      })]),
      (error) => error.kind === 'configuration_error' && /supportedAspectRatios/.test(error.message)
    );
  });

  await t.test('non-boolean requiresImageInput', () => {
    assert.throws(
      () => validateManifest([entry('bad', 10, {
        capabilities: ['text-to-video'],
        capability_limits: { 'text-to-video': { requiresImageInput: 'true' } }
      })]),
      (error) => error.kind === 'configuration_error' && /requiresImageInput/.test(error.message)
    );
  });
});

test('live Agnes manifest declares capability_limits for every image capability', () => {
  const manifest = require('../providers/manifest.cjs');
  const sorted = validateManifest(manifest);
  const limits = sorted[0].capability_limits;
  for (const capability of ['text-to-image', 'image-to-image']) {
    assert.ok(limits?.[capability], `${capability} should declare capability_limits`);
    assert.equal(limits[capability].minWidth, 256);
    assert.equal(limits[capability].maxWidth, 2048);
    assert.equal(limits[capability].minHeight, 256);
    assert.equal(limits[capability].maxHeight, 2048);
  }
  assert.equal(limits['image-to-image'].requiresImageInput, true);
});

test('live Agnes manifest declares capability_limits for every video capability', () => {
  const manifest = require('../providers/manifest.cjs');
  const sorted = validateManifest(manifest);
  const limits = sorted[0].capability_limits;
  for (const capability of ['text-to-video', 'image-to-video', 'keyframes-to-video']) {
    assert.ok(limits?.[capability], `${capability} should declare capability_limits`);
    assert.equal(limits[capability].maxSingleSegmentDuration, 18);
    assert.equal(limits[capability].maxFrames, 441);
    assert.equal(limits[capability].frameCountRule, '8n+1');
  }
});

test('manifest registers Agnes once at priority 100 for every media capability', () => {
  const manifest = require('../providers/manifest.cjs');
  const sorted = validateManifest(manifest);

  assert.equal(sorted.length, 1);
  assert.equal(sorted[0].id, 'agnes');
  assert.equal(sorted[0].enabled, true);
  assert.equal(sorted[0].priority, 100);
  assert.deepEqual(sorted[0].capabilities, CAPABILITIES);
  assert.equal(sorted[0].provider, agnes);
});

test('Agnes credential resolution prefers environment then a private config file', () => {
  const fromEnvironment = credentialContext({ envValue: ' env-key ', fileValue: 'file-key' });
  assert.equal(agnes.resolveCredentials(fromEnvironment), 'env-key');
  assert.equal(fromEnvironment.reads, 0);

  const fromFile = credentialContext({ fileValue: ' file-key\n' });
  assert.equal(agnes.resolveCredentials(fromFile), 'file-key');
  assert.equal(fromFile.reads, 1);
});

test('Agnes rejects credential files readable by other POSIX users', () => {
  const context = credentialContext({ fileValue: 'file-key', mode: 0o100644 });
  assert.throws(
    () => agnes.resolveCredentials(context),
    (error) => error.kind === 'configuration' && /0600/.test(error.message)
  );
});

test('Agnes image mapping uses current defaults and converts local PNG input', async (t) => {
  assert.deepEqual(await agnes.buildImageRequest({
    capability: 'text-to-image',
    prompt: 'A glass cube in a white studio'
  }), {
    model: 'agnes-image-2.1-flash',
    prompt: 'A glass cube in a white studio',
    size: '1K',
    ratio: '1:1',
    extra_body: { response_format: 'url' }
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-agnes-input-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const inputPath = path.join(tempDir, 'input.png');
  fs.writeFileSync(inputPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const mapped = await agnes.buildImageRequest({
    capability: 'image-to-image',
    prompt: 'Make it matte black',
    inputs: [{ type: 'image', source: { kind: 'path', value: inputPath } }]
  });

  assert.deepEqual(mapped.extra_body.image, ['data:image/png;base64,iVBORw==']);
});

test('Agnes image mapping enforces size tiers, supported ratios, and rejects negative_prompt', async (t) => {
  assert.deepEqual(await agnes.buildImageRequest({
    capability: 'text-to-image',
    prompt: 'A product shot',
    parameters: { size: '2K', ratio: '9:16' }
  }), {
    model: 'agnes-image-2.1-flash',
    prompt: 'A product shot',
    size: '2K',
    ratio: '9:16',
    extra_body: { response_format: 'url' }
  });
  await assert.rejects(agnes.buildImageRequest({
    capability: 'text-to-image',
    prompt: 'A product shot',
    parameters: { size: '512x512' }
  }), /size must be one of/);
  await assert.rejects(agnes.buildImageRequest({
    capability: 'text-to-image',
    prompt: 'A product shot',
    parameters: { ratio: '2:1' }
  }), /ratio must be one of/);
  await assert.rejects(agnes.buildImageRequest({
    capability: 'text-to-image',
    prompt: 'A product shot',
    parameters: { negative_prompt: 'blur, watermark' }
  }), (error) => error.kind === 'invalid_request'
    && /negative_prompt/.test(error.message)
    && /no X, no Y/.test(error.message));
});

test('Agnes image mapping rejects non-positive, fractional, or out-of-range dimensions', async () => {
  for (const parameters of [
    { width: 0 },
    { width: -1 },
    { height: 1.5 },
    { width: '1024' },
    { width: 128 },
    { height: 4096 }
  ]) {
    await assert.rejects(agnes.buildImageRequest({
      capability: 'text-to-image',
      prompt: 'A product shot',
      parameters
    }), (error) => error.kind === 'invalid_request'
      && (/positive integer/.test(error.message) || /between 256 and 2048/.test(error.message)));
  }
});

test('Agnes image mapping forwards optional width, height, seed, and steps', async () => {
  const mapped = await agnes.buildImageRequest({
    capability: 'text-to-image',
    prompt: 'A studio photo',
    parameters: {
      width: 1024,
      height: 1024,
      seed: 42,
      num_inference_steps: 20
    }
  });
  assert.equal(mapped.width, 1024);
  assert.equal(mapped.height, 1024);
  assert.equal(mapped.seed, 42);
  assert.equal(mapped.num_inference_steps, 20);
});

test('Agnes provider image limits stay consistent with the manifest capability_limits', async () => {
  const manifest = require('../providers/manifest.cjs');
  const sorted = validateManifest(manifest);
  const limits = sorted[0].capability_limits['text-to-image'];
  const request = (parameters) => ({ capability: 'text-to-image', prompt: 'A product shot', parameters });

  await assert.doesNotReject(agnes.buildImageRequest(request({ width: limits.minWidth, height: limits.minHeight })));
  await assert.doesNotReject(agnes.buildImageRequest(request({ width: limits.maxWidth, height: limits.maxHeight })));
  await assert.rejects(
    agnes.buildImageRequest(request({ width: limits.minWidth - 1 })),
    /between 256 and 2048/
  );
  await assert.rejects(
    agnes.buildImageRequest(request({ height: limits.maxHeight + 1 })),
    /between 256 and 2048/
  );
});

test('Agnes video mapping enforces defaults, frame rule, and public URL inputs', () => {
  assert.deepEqual(agnes.buildVideoRequest({
    capability: 'text-to-video',
    prompt: 'A camera glides through a neon city'
  }), {
    model: 'agnes-video-v2.0',
    prompt: 'A camera glides through a neon city',
    width: 1152,
    height: 768,
    num_frames: 121,
    frame_rate: 24
  });
  assert.throws(() => agnes.buildVideoRequest({
    capability: 'text-to-video',
    prompt: 'A short animation',
    parameters: { num_frames: 120 }
  }), /8n \+ 1/);
  assert.throws(() => agnes.buildVideoRequest({
    capability: 'image-to-video',
    prompt: 'Orbit the subject',
    inputs: [{ type: 'image', source: { kind: 'path', value: 'input.png' } }]
  }), /public HTTPS URL/);
});

test('Agnes video mapping merges negative prompt into the submitted prompt', () => {
  const mapped = agnes.buildVideoRequest({
    capability: 'text-to-video',
    prompt: 'Shot 1: A red bicycle crosses a rainy street.',
    parameters: {
      negative_prompt: 'blur, watermark, distorted wheels'
    }
  });

  assert.equal(mapped.prompt, [
    'Shot 1: A red bicycle crosses a rainy street.',
    'Negative constraints: blur, watermark, distorted wheels'
  ].join('\n\n'));
  assert.equal(Object.hasOwn(mapped, 'negative_prompt'), false);
});

test('Agnes video mapping omits blank negative prompt placeholders', () => {
  const mapped = agnes.buildVideoRequest({
    capability: 'text-to-video',
    prompt: 'Shot 1: Morning light over a quiet lake.',
    parameters: {
      negative_prompt: '   '
    }
  });

  assert.equal(mapped.prompt, 'Shot 1: Morning light over a quiet lake.');
  assert.equal(Object.hasOwn(mapped, 'negative_prompt'), false);
});

test('Agnes video mapping rejects non-positive or fractional dimensions', () => {
  for (const parameters of [{ width: 0 }, { width: -1 }, { height: 1.5 }, { width: '1152' }]) {
    assert.throws(() => agnes.buildVideoRequest({
      capability: 'text-to-video',
      prompt: 'A short animation',
      parameters
    }), /positive integer/);
  }
});

test('Agnes provider video limits stay consistent with the manifest capability_limits', () => {
  const manifest = require('../providers/manifest.cjs');
  const sorted = validateManifest(manifest);
  const limits = sorted[0].capability_limits['text-to-video'];
  const request = (parameters) => ({ capability: 'text-to-video', prompt: 'A short animation', parameters });

  assert.doesNotThrow(() => agnes.buildVideoRequest(request({ num_frames: limits.maxFrames })));
  assert.throws(
    () => agnes.buildVideoRequest(request({ num_frames: limits.maxFrames + 8 })),
    /8n \+ 1/
  );
  assert.doesNotThrow(() => agnes.buildVideoRequest(request({ frame_rate: limits.minFrameRate })));
  assert.doesNotThrow(() => agnes.buildVideoRequest(request({ frame_rate: limits.maxFrameRate })));
  assert.throws(
    () => agnes.buildVideoRequest(request({ frame_rate: limits.minFrameRate - 1 })),
    /frame_rate/
  );
  assert.throws(
    () => agnes.buildVideoRequest(request({ frame_rate: limits.maxFrameRate + 1 })),
    /frame_rate/
  );
});

test('Agnes manifest advertises the five documented image aspect ratios', () => {
  const manifest = require('../providers/manifest.cjs');
  const sorted = validateManifest(manifest);
  for (const capability of ['text-to-image', 'image-to-image']) {
    assert.deepEqual(
      sorted[0].capability_limits[capability].supportedAspectRatios,
      ['16:9', '9:16', '1:1', '4:3', '3:4']
    );
  }
});

test('Agnes manifest advertises the five documented video aspect ratios', () => {
  const manifest = require('../providers/manifest.cjs');
  const sorted = validateManifest(manifest);
  for (const capability of ['text-to-video', 'image-to-video', 'keyframes-to-video']) {
    assert.deepEqual(
      sorted[0].capability_limits[capability].supportedAspectRatios,
      ['16:9', '9:16', '1:1', '4:3', '3:4']
    );
  }
});

test('Agnes supports performs detailed checks without credentials or network', () => {
  assert.deepEqual(agnes.supports({
    capability: 'text-to-image',
    prompt: 'A product photo'
  }), { supported: true });
  const unsupported = agnes.supports({
    capability: 'image-to-video',
    prompt: 'Animate',
    inputs: [{ type: 'image', source: { kind: 'path', value: 'local.png' } }]
  });
  assert.equal(unsupported.supported, false);
  assert.match(unsupported.reason, /public HTTPS URL/);
});

test('Agnes image create calls the fixed cn endpoint once and returns Artifact Sources', async () => {
  const calls = [];
  const outcome = await agnes.create({
    capability: 'text-to-image',
    prompt: 'A luminous floating city'
  }, {
    env: { AGNES_API_KEY: 'test-secret' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({
        created: 1780000000,
        data: [
          { url: 'https://cdn.example.com/one.png' },
          { b64_json: 'BQYH' }
        ]
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.agnes-ai.cn/v1/images/generations');
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-secret');
  assert.equal(outcome.status, 'succeeded');
  assert.deepEqual(outcome.artifact_sources, [
    { kind: 'url', mime_type: 'image/png', value: 'https://cdn.example.com/one.png' },
    { kind: 'base64', mime_type: 'image/png', value: 'BQYH' }
  ]);
});

test('Agnes video create and status normalize one opaque task without resubmission', async () => {
  const calls = [];
  const responses = [
    {
      task_id: 'task_1', video_id: 'video_1', status: 'queued', progress: 0,
      seconds: '5.0', size: '1152x768'
    },
    {
      task_id: 'task_1', video_id: 'video_1', status: 'completed', progress: 100,
      seconds: '5.0', size: '1152x768',
      metadata: { url: 'https://cdn.example.com/video.mp4' }
    }
  ];
  const context = {
    env: { AGNES_API_KEY: 'test-secret' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  };
  const created = await agnes.create({
    capability: 'text-to-video',
    prompt: 'A short product animation'
  }, context);
  const completed = await agnes.status(created.task, {
    ...context,
    capability: 'text-to-video'
  });

  assert.equal(created.status, 'queued');
  assert.equal(created.task.id, 'video_1');
  assert.equal(completed.status, 'succeeded');
  assert.deepEqual(completed.artifact_sources, [
    { kind: 'url', mime_type: 'video/mp4', value: 'https://cdn.example.com/video.mp4' }
  ]);
  assert.equal(calls[0].url, 'https://api.agnes-ai.cn/v1/videos');
  assert.equal(calls[1].url, 'https://api.agnes-ai.cn/agnesapi?video_id=video_1');
  assert.deepEqual(calls.map(({ options }) => options.method), ['POST', 'GET']);
});

test('Agnes status keeps the created task identity when result identifiers drift', async () => {
  const result = await statusMedia({
    provider: 'agnes',
    capability: 'text-to-video',
    task: { id: 'video-created', task_id: 'task-created' }
  }, {
    manifest: require('../providers/manifest.cjs'),
    env: { AGNES_API_KEY: 'test-secret' },
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'task-result',
      task_id: 'task-result',
      video_id: 'task-result',
      status: 'completed',
      progress: 100,
      metadata: { url: 'https://cdn.example.com/video.mp4' }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  });

  assert.equal(result.status, 'succeeded');
  assert.deepEqual(result.task, {
    id: 'video-created',
    task_id: 'task-created',
    provider_id: 'task-result',
    provider_task_id: 'task-result',
    provider_video_id: 'task-result',
    provider_status: 'completed',
    progress: 100
  });
});

test('Agnes accepts only evidence-backed completed video URL fields', async (t) => {
  const fixtures = [
    ['metadata.url', { metadata: { url: 'https://cdn.example.com/metadata.mp4' } }, 'metadata.url'],
    ['video_url', { video_url: 'https://cdn.example.com/video-url.mp4' }, 'video_url'],
    ['url', { url: 'https://cdn.example.com/url.mp4' }, 'url'],
    ['output_url', { output_url: 'https://cdn.example.com/output.mp4' }, 'output_url'],
    ['data[].url', { data: [{ url: 'https://cdn.example.com/data.mp4' }] }, 'data[0].url']
  ];

  for (const [name, shape, sourceField] of fixtures) {
    await t.test(name, async () => {
      const outcome = await agnes.status({ id: 'video-created', task_id: 'task-created' }, {
        capability: 'text-to-video',
        env: { AGNES_API_KEY: 'test-secret' },
        fetchImpl: async () => new Response(JSON.stringify({
          video_id: 'task-result',
          task_id: 'task-result',
          status: 'completed',
          ...shape
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      });

      assert.equal(outcome.task.id, 'video-created');
      assert.match(outcome.artifact_sources[0].value, /^https:\/\/cdn\.example\.com\//);
      if (sourceField === 'metadata.url') assert.deepEqual(outcome.warnings, []);
      else assert.deepEqual(outcome.warnings, [`Agnes used legacy video artifact field ${sourceField}.`]);
    });
  }
});

test('Agnes summarizes a completed response that has no artifact URL', async () => {
  await assert.rejects(agnes.status({ id: 'video-created', task_id: 'task-created' }, {
    capability: 'text-to-video',
    env: { AGNES_API_KEY: 'test-secret' },
    fetchImpl: async () => new Response(JSON.stringify({
      id: 'task-result',
      task_id: 'task-result',
      video_id: 'task-result',
      status: 'completed',
      progress: 100,
      size: '1280x768',
      metadata: { size_mapping: { adjusted: true } }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }), (error) => {
    assert.equal(error.kind, 'invalid_response');
    assert.deepEqual(error.details, {
      response_keys: ['id', 'metadata', 'progress', 'size', 'status', 'task_id', 'video_id'],
      metadata_keys: ['size_mapping'],
      requested_task: { id: 'video-created', task_id: 'task-created' },
      returned_identifiers: {
        id: 'task-result',
        task_id: 'task-result',
        video_id: 'task-result'
      },
      identifier_changes: { task_id: true, video_id: true },
      artifact_url_fields: []
    });
    return true;
  });
});

test('Agnes POST transport ambiguity never claims accepted false', async () => {
  let calls = 0;
  await assert.rejects(agnes.create({
    capability: 'text-to-video',
    prompt: 'A short animation'
  }, {
    env: { AGNES_API_KEY: 'test-secret' },
    fetchImpl: async () => {
      calls += 1;
      throw new TypeError('connection reset');
    }
  }), (error) => error.kind === 'network'
    && error.accepted === undefined
    && error.retryable === false
    && error.details.acceptance_unknown === true);
  assert.equal(calls, 1);
});

test('transient artifact retries stop after success and respect non-retryable errors', async () => {
  let attempts = 0;
  const delays = [];
  const result = await withTransientRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new ProviderError('network', 'temporary', { retryable: true });
    return 'done';
  }, {
    random: () => 0,
    baseDelayMs: 100,
    sleep: async (delay) => delays.push(delay)
  });
  assert.equal(result, 'done');
  assert.deepEqual(delays, [100, 200]);

  let rejectedCalls = 0;
  await assert.rejects(withTransientRetry(async () => {
    rejectedCalls += 1;
    throw new ProviderError('invalid_request', 'bad', { retryable: false });
  }), /bad/);
  assert.equal(rejectedCalls, 1);
});

test('artifact URL download is credential-free, redirect-safe, and atomic', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-artifact-url-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  let options;
  const artifact = await downloadArtifact(
    'https://cdn.example.com/result.png',
    path.join(tempDir, 'result-01'),
    {
      fetchImpl: async (_url, fetchOptions) => {
        options = fetchOptions;
        return new Response(Buffer.from([1, 2, 3, 4]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        });
      }
    }
  );

  assert.equal(options.redirect, 'manual');
  assert.equal(options.headers?.Authorization, undefined);
  assert.equal(artifact.path, path.join(tempDir, 'result-01.png'));
  assert.deepEqual(fs.readFileSync(artifact.path), Buffer.from([1, 2, 3, 4]));
  assert.equal(fs.existsSync(`${artifact.path}.part`), false);

  let calls = 0;
  await assert.rejects(downloadArtifact(
    'https://cdn.example.com/source.png',
    path.join(tempDir, 'blocked'),
    {
      fetchImpl: async () => {
        calls += 1;
        return new Response(null, {
          status: 302,
          headers: { Location: 'https://192.168.1.20/private.png' }
        });
      }
    }
  ), (error) => error.kind === 'download_failed' && /public HTTPS URL/.test(error.message));
  assert.equal(calls, 1);
});

test('artifact saver materializes Base64 and bytes without overwriting files', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-artifact-data-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const options = {
    provider: 'agnes',
    capability: 'text-to-image',
    output: { directory: tempDir },
    startedAt: Date.parse('2026-07-30T07:30:12Z')
  };
  const sources = [
    { kind: 'base64', mime_type: 'image/png', value: 'AQIDBA==' },
    { kind: 'bytes', mime_type: 'image/png', value: Buffer.from([5, 6, 7]) }
  ];
  const first = await saveArtifacts(sources, options);
  const second = await saveArtifacts(sources, options);

  assert.deepEqual(first.map(({ bytes }) => bytes), [4, 3]);
  assert.equal(first.every(({ path: filePath }) => fs.existsSync(filePath)), true);
  assert.equal(second.every(({ path: filePath }) => !first.some((item) => item.path === filePath)), true);
});

test('artifact saver keeps task ids out of paths and numbers readable multi-artifact names', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-artifact-short-path-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const taskId = `video_${'x'.repeat(180)}`;
  const artifacts = await saveArtifacts([
    { kind: 'bytes', mime_type: 'video/mp4', value: Buffer.from([1, 2, 3]) },
    { kind: 'bytes', mime_type: 'video/mp4', value: Buffer.from([4, 5, 6]) }
  ], {
    provider: 'agnes',
    capability: 'text-to-video',
    task: { id: taskId },
    output: {
      directory: tempDir,
      filename: '打工人治愈电影感_15秒.mp4'
    },
    startedAt: Date.parse('2026-07-30T07:30:12Z')
  });

  assert.deepEqual(
    artifacts.map(({ path: filePath }) => path.basename(filePath)),
    ['打工人治愈电影感_15秒-01.mp4', '打工人治愈电影感_15秒-02.mp4']
  );
  assert.equal(artifacts.every(({ path: filePath }) => !filePath.includes(taskId)), true);
  assert.equal(path.basename(path.dirname(artifacts[0].path)), '20260730T073012Z');
});

test('artifact saver replaces a requested extension with the actual media extension', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-artifact-extension-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  const [artifact] = await saveArtifacts([
    { kind: 'bytes', mime_type: 'video/mp4', value: Buffer.from([1, 2, 3]) }
  ], {
    provider: 'agnes',
    capability: 'text-to-video',
    output: { directory: tempDir, filename: '可读成片.avi' },
    startedAt: Date.parse('2026-07-30T07:30:12Z')
  });

  assert.equal(path.basename(artifact.path), '可读成片.mp4');
});

test('output preflight rejects an occupied Provider directory before remote creation', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-output-preflight-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, 'agnes'), 'occupied');

  await assert.rejects(preflightOutput({
    provider: 'agnes',
    capability: 'text-to-image',
    prompt: 'A product photo',
    output: { directory: tempDir }
  }, { provider: 'agnes' }), (error) => error.kind === 'invalid_request');
});

test('automatic generate preflights the selected Provider directory before create', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-selected-preflight-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, 'selected'), 'occupied');
  let createCalls = 0;
  const selected = provider({
    create: async () => {
      createCalls += 1;
      return { status: 'succeeded', artifact_sources: [] };
    }
  });

  await assert.rejects(generateMedia({
    capability: 'text-to-image',
    prompt: 'A product photo',
    output: { directory: tempDir }
  }, {
    manifest: [entry('selected', 10, { provider: selected })]
  }), (error) => error.kind === 'invalid_request');
  assert.equal(createCalls, 0);
});

test('create preflights the selected Provider directory before remote submission', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-create-preflight-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(tempDir, 'selected'), 'occupied');
  let createCalls = 0;
  const selected = provider({
    create: async () => {
      createCalls += 1;
      return { status: 'queued', task: { id: 'remote-task' } };
    }
  });

  await assert.rejects(createMedia({
    provider: 'selected',
    capability: 'text-to-video',
    prompt: 'A product animation',
    output: { directory: tempDir }
  }, {
    manifest: [entry('selected', 10, {
      provider: selected,
      capabilities: ['text-to-video']
    })]
  }), (error) => error.kind === 'invalid_request');
  assert.equal(createCalls, 0);
});

test('wait aborts a hanging Provider status call at the local deadline', async () => {
  const hanging = provider({
    status: async (_task, context) => new Promise((_resolve, reject) => {
      context.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      }, { once: true });
    })
  });
  const startedAt = Date.now();

  const result = await waitMedia({
    provider: 'hanging',
    capability: 'text-to-video',
    task: { id: 'video-hanging' },
    wait: { timeout_seconds: 0.02 }
  }, {
    manifest: [entry('hanging', 10, {
      provider: hanging,
      capabilities: ['text-to-video']
    })]
  });

  assert.equal(result.error.kind, 'wait_timeout');
  assert.equal(result.task.id, 'video-hanging');
  assert.ok(Date.now() - startedAt < 500);
});

test('Agnes transient status retry cannot cross the core wait deadline', async () => {
  let currentMs = 0;
  let attempts = 0;
  const result = await waitMedia({
    provider: 'agnes',
    capability: 'text-to-video',
    task: { id: 'video-deadline' },
    wait: { timeout_seconds: 1 }
  }, {
    manifest: require('../providers/manifest.cjs'),
    env: { AGNES_API_KEY: 'test-secret' },
    fetchImpl: async () => {
      attempts += 1;
      return new Response(JSON.stringify({ message: 'temporary' }), { status: 503 });
    },
    now: () => currentMs,
    sleep: async (delayMs) => { currentMs += delayMs; },
    retryOptions: { random: () => 0 }
  });

  assert.equal(result.error.kind, 'wait_timeout');
  assert.equal(result.task.id, 'video-deadline');
  assert.equal(currentMs, 1_000);
  assert.equal(attempts, 1);
});

test('Agnes HTTP responses preserve stable kinds and POST acceptance certainty', async (t) => {
  const classifications = [
    [400, 'invalid_request', false],
    [401, 'authentication', false],
    [402, 'quota_exhausted', false],
    [403, 'permission', false],
    [422, 'invalid_request', false],
    [429, 'rate_limited', true],
    [503, 'provider_unavailable', true]
  ];
  for (const [status, kind, retryable] of classifications) {
    await t.test(`classifies HTTP ${status}`, () => {
      const error = agnes.classifyHttpError(status, { error: { message: `status ${status}` } });
      assert.equal(error.kind, kind);
      assert.equal(error.retryable, retryable);
      assert.equal(error.httpStatus, status);
    });
  }

  for (const [status, accepted] of [[408, undefined], [429, false], [503, undefined]]) {
    await t.test(`POST HTTP ${status} acceptance`, async () => {
      let calls = 0;
      await assert.rejects(agnes.create({
        capability: 'text-to-video',
        prompt: 'A short animation'
      }, {
        env: { AGNES_API_KEY: 'test-secret' },
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({ message: `HTTP ${status}` }), { status });
        }
      }), (error) => error.accepted === accepted && error.retryable === false);
      assert.equal(calls, 1);
    });
  }
});

test('Agnes input mapping rejects credentialed and private HTTPS literals', async (t) => {
  const blocked = [
    'https://user:pass@example.com/input.png',
    'https://localhost/input.png',
    'https://media.localhost/input.png',
    'https://127.0.0.1/input.png',
    'https://10.0.0.1/input.png',
    'https://172.16.0.1/input.png',
    'https://192.168.1.1/input.png',
    'https://169.254.1.1/input.png',
    'https://[::1]/input.png',
    'https://[fc00::1]/input.png',
    'https://[fe80::1]/input.png'
  ];
  for (const value of blocked) {
    await t.test(value, async () => {
      await assert.rejects(agnes.buildImageRequest({
        capability: 'image-to-image',
        prompt: 'Edit this image',
        inputs: [{ type: 'image', source: { kind: 'url', value } }]
      }), (error) => error.kind === 'invalid_request' && /public HTTPS URL/.test(error.message));
    });
  }
});

test('artifact download retries HTTP 408 and removes partial output on bad MIME', async (t) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-artifact-retry-'));
  t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));
  let calls = 0;
  const artifact = await downloadArtifact(
    'https://cdn.example.com/result.png',
    path.join(tempDir, 'retry'),
    {
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) return new Response('timeout', { status: 408 });
        return new Response(Buffer.from([1, 2, 3]), {
          status: 200,
          headers: { 'Content-Type': 'image/png' }
        });
      },
      retryOptions: { sleep: async () => {}, random: () => 0 }
    }
  );
  assert.equal(calls, 2);
  assert.equal(artifact.bytes, 3);

  await assert.rejects(downloadArtifact(
    'https://cdn.example.com/error',
    path.join(tempDir, 'bad'),
    {
      fetchImpl: async () => new Response('<html>expired</html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' }
      })
    }
  ), (error) => error.kind === 'download_failed');
  assert.equal(fs.readdirSync(tempDir).some((name) => name.includes('.part')), false);
});

test('Agnes status retries only idempotent GET and normalizes provider failure', async () => {
  let attempts = 0;
  const outcome = await agnes.status({ id: 'video id/1' }, {
    capability: 'text-to-video',
    env: { AGNES_API_KEY: 'test-secret' },
    fetchImpl: async (url, options) => {
      attempts += 1;
      assert.equal(url, 'https://api.agnes-ai.cn/agnesapi?video_id=video+id%2F1');
      assert.equal(options.method, 'GET');
      if (attempts === 1) throw new TypeError('temporary reset');
      return new Response(JSON.stringify({
        video_id: 'video id/1', status: 'failed', progress: 35
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    retryOptions: { sleep: async () => {}, random: () => 0 }
  });
  assert.equal(attempts, 2);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.task.id, 'video id/1');
});
