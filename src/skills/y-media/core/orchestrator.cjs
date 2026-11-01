const fs = require('node:fs');
const path = require('node:path');

const {
  ProviderError,
  normalizeOutcome,
  validateManifest,
  validateRequest
} = require('./contract.cjs');

function runtimeContext(context = {}) {
  return {
    ...context,
    manifest: context.manifest ?? require('../providers/manifest.cjs'),
    now: context.now ?? Date.now,
    sleep: context.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)))
  };
}

function annotateError(error, provider) {
  const normalized = error instanceof ProviderError
    ? error
    : new ProviderError('invalid_response', 'Provider failed without a normalized error.');
  if (normalized.provider === undefined) normalized.provider = provider;
  return normalized;
}

function resultFromOutcome(entry, capability, outcome, startedAt, completedAt) {
  const result = {
    ok: outcome.status !== 'failed',
    provider: entry.id,
    capability,
    status: outcome.status,
    artifacts: [],
    effective_parameters: outcome.effective_parameters,
    warnings: outcome.warnings,
    timing: {
      started_at_ms: startedAt,
      completed_at_ms: completedAt,
      duration_ms: Math.max(0, completedAt - startedAt)
    }
  };
  if (outcome.task !== undefined) result.task = outcome.task;
  if (outcome.artifact_sources.length > 0) result.artifact_sources = outcome.artifact_sources;
  if (outcome.status === 'failed') {
    result.error = {
      kind: 'task_failed',
      message: `${entry.id} reported that the media task failed.`,
      retryable: false
    };
  }
  return result;
}

function selectExistingProvider(entries, request) {
  const entry = entries.find((candidate) => candidate.id === request.provider);
  if (!entry || !entry.enabled) {
    throw new ProviderError('provider_unavailable', `Provider is not enabled: ${request.provider}.`, {
      provider: request.provider,
      accepted: false
    });
  }
  if (!entry.capabilities.includes(request.capability)) {
    throw new ProviderError(
      'invalid_request',
      `Provider ${entry.id} does not register capability ${request.capability}.`,
      { provider: entry.id, accepted: false }
    );
  }
  return entry;
}

function configurationState(entry, request, context) {
  if (!entry.provider.isConfigured(context)) {
    return { eligible: false, reason: 'not configured' };
  }
  const support = entry.provider.supports(request);
  if (!support || typeof support !== 'object' || typeof support.supported !== 'boolean') {
    throw new ProviderError('invalid_response', `Provider ${entry.id} returned an invalid supports() result.`, {
      provider: entry.id
    });
  }
  if (!support.supported) {
    return { eligible: false, reason: support.reason || 'request is not supported' };
  }
  return { eligible: true };
}

async function selectAndCreate(request, context = {}) {
  const runtime = runtimeContext(context);
  const entries = validateManifest(runtime.manifest);
  const explicit = request.provider !== undefined;
  const candidates = explicit
    ? [selectExistingProvider(entries, request)]
    : entries.filter((entry) => entry.enabled && entry.capabilities.includes(request.capability));
  const skipped = [];

  for (const entry of candidates) {
    let state;
    try {
      state = configurationState(entry, request, runtime);
    } catch (error) {
      throw annotateError(error, entry.id);
    }
    if (!state.eligible) {
      if (explicit) {
        throw new ProviderError('provider_unavailable', `Provider ${entry.id} ${state.reason}.`, {
          provider: entry.id,
          accepted: false
        });
      }
      skipped.push({ provider: entry.id, reason: state.reason });
      continue;
    }

    try {
      if (typeof runtime.beforeCreate === 'function') {
        await runtime.beforeCreate(entry);
      }
      return {
        entry,
        outcome: normalizeOutcome(await entry.provider.create(request, runtime))
      };
    } catch (error) {
      const normalized = annotateError(error, entry.id);
      if (!explicit && normalized.accepted === false) {
        skipped.push({ provider: entry.id, reason: normalized.message });
        continue;
      }
      throw normalized;
    }
  }

  throw new ProviderError(
    'no_provider_available',
    'No configured Provider can handle this media request.',
    { accepted: false, details: { skipped } }
  );
}

async function createMedia(request, context = {}) {
  validateRequest('create', request);
  const runtime = runtimeContext(context);
  const preflightOutput = runtime.preflightOutput ?? require('./artifacts.cjs').preflightOutput;
  runtime.beforeCreate = async (entry) => preflightOutput(request, {
    ...runtime,
    provider: entry.id
  });
  const startedAt = runtime.now();
  const { entry, outcome } = await selectAndCreate(request, runtime);
  return resultFromOutcome(entry, request.capability, outcome, startedAt, runtime.now());
}

async function queryStatus(request, context = {}) {
  const runtime = runtimeContext(context);
  const entries = validateManifest(runtime.manifest);
  const entry = selectExistingProvider(entries, request);
  if (typeof entry.provider.status !== 'function') {
    throw new ProviderError('invalid_request', `Provider ${entry.id} does not support asynchronous tasks.`, {
      provider: entry.id
    });
  }
  let outcome;
  try {
    outcome = normalizeOutcome(await entry.provider.status(request.task, {
      ...runtime,
      capability: request.capability,
      request
    }));
  } catch (error) {
    const normalized = annotateError(error, entry.id);
    if (normalized.task === undefined) normalized.task = request.task;
    if (normalized.capability === undefined) normalized.capability = request.capability;
    throw normalized;
  }
  if (outcome.task === undefined || outcome.task.id === undefined) {
    outcome.task = { ...(outcome.task ?? {}), id: request.task.id };
  } else if (outcome.task.id !== request.task.id) {
    throw new ProviderError(
      'invalid_response',
      `Provider ${entry.id} returned a different task.id for pinned work.`,
      {
        provider: entry.id,
        capability: request.capability,
        task: request.task
      }
    );
  }
  return { entry, outcome, runtime };
}

async function statusMedia(request, context = {}) {
  validateRequest('status', request);
  const runtime = runtimeContext(context);
  const startedAt = runtime.now();
  const result = await queryStatus(request, runtime);
  return resultFromOutcome(
    result.entry,
    request.capability,
    result.outcome,
    startedAt,
    runtime.now()
  );
}

function timeoutResult(entry, request, outcome, startedAt, completedAt) {
  const result = resultFromOutcome(entry, request.capability, outcome, startedAt, completedAt);
  result.ok = false;
  result.error = {
    kind: 'wait_timeout',
    message: `Waiting timed out while the ${entry.id} task remains active.`,
    retryable: true
  };
  return result;
}

async function materialize(result, outcome, request, runtime) {
  if (outcome.artifact_sources.length === 0) {
    delete result.artifact_sources;
    return result;
  }
  const saveArtifacts = runtime.saveArtifacts ?? require('./artifacts.cjs').saveArtifacts;
  try {
    result.artifacts = await saveArtifacts(outcome.artifact_sources, {
      provider: result.provider,
      capability: result.capability,
      task: result.task,
      output: request.output,
      startedAt: result.timing.started_at_ms
    }, runtime);
    delete result.artifact_sources;
    return result;
  } catch (error) {
    const normalized = annotateError(error, result.provider);
    result.ok = false;
    result.error = {
      kind: 'download_failed',
      message: normalized.message,
      retryable: Boolean(normalized.retryable)
    };
    if (normalized.details !== undefined) result.error.details = normalized.details;
    delete result.artifact_sources;
    return result;
  }
}

async function waitMedia(request, context = {}) {
  validateRequest('wait', request);
  const runtime = runtimeContext(context);
  const entries = validateManifest(runtime.manifest);
  const entry = selectExistingProvider(entries, request);
  const startedAt = runtime.now();
  const timeoutMs = (request.wait?.timeout_seconds ?? 1_200) * 1_000;
  const deadline = startedAt + timeoutMs;
  let latest = normalizeOutcome({ status: 'running', task: request.task });

  while (runtime.now() < deadline) {
    const remainingBeforeStatus = Math.max(0, deadline - runtime.now());
    const controller = new AbortController();
    const abortFromParent = () => controller.abort();
    if (runtime.signal?.aborted) controller.abort();
    else runtime.signal?.addEventListener('abort', abortFromParent, { once: true });
    const abortTimer = setTimeout(() => controller.abort(), remainingBeforeStatus);
    let queried;
    try {
      queried = await queryStatus(request, {
        ...runtime,
        signal: controller.signal,
        retryOptions: {
          ...(runtime.retryOptions ?? {}),
          deadlineMs: deadline,
          nowMs: runtime.now,
          sleep: runtime.sleep
        }
      });
    } catch (error) {
      if (controller.signal.aborted || error.kind === 'wait_timeout') {
        return timeoutResult(entry, request, latest, startedAt, runtime.now());
      }
      throw error;
    } finally {
      clearTimeout(abortTimer);
      runtime.signal?.removeEventListener('abort', abortFromParent);
    }
    latest = queried.outcome;
    const completedAt = runtime.now();
    const result = resultFromOutcome(entry, request.capability, latest, startedAt, completedAt);
    if (latest.status === 'succeeded') return materialize(result, latest, request, runtime);
    if (latest.status === 'failed') return result;

    const remainingMs = deadline - completedAt;
    if (remainingMs <= 0) break;
    const requestedDelay = Number.isFinite(latest.poll_after_ms) && latest.poll_after_ms > 0
      ? latest.poll_after_ms
      : 5_000;
    await runtime.sleep(Math.min(requestedDelay, remainingMs));
  }

  return timeoutResult(entry, request, latest, startedAt, runtime.now());
}

async function generateMedia(request, context = {}) {
  validateRequest('generate', request);
  const runtime = runtimeContext(context);
  const preflightOutput = runtime.preflightOutput ?? require('./artifacts.cjs').preflightOutput;
  runtime.beforeCreate = async (entry) => preflightOutput(request, {
    ...runtime,
    provider: entry.id
  });

  const startedAt = runtime.now();
  const { entry, outcome } = await selectAndCreate(request, runtime);
  if (outcome.status === 'queued' || outcome.status === 'running') {
    if (!outcome.task?.id) {
      throw new ProviderError('invalid_response', `Provider ${entry.id} returned an asynchronous outcome without task.id.`, {
        provider: entry.id
      });
    }
    return waitMedia({
      provider: entry.id,
      capability: request.capability,
      task: outcome.task,
      output: request.output,
      wait: request.wait
    }, runtime);
  }
  const result = resultFromOutcome(entry, request.capability, outcome, startedAt, runtime.now());
  if (outcome.status === 'succeeded') return materialize(result, outcome, request, runtime);
  return result;
}

function listCapabilities(manifest) {
  const entries = validateManifest(manifest);
  const capabilities = [];
  for (const entry of entries) {
    if (!entry.enabled) continue;
    for (const capability of entry.capabilities) {
      if (!capabilities.includes(capability)) capabilities.push(capability);
    }
  }
  return {
    ok: true,
    providers: entries.map(({ id, enabled, priority, capabilities: registered, capability_limits }) => {
      const providerEntry = { id, enabled, priority, capabilities: [...registered] };
      if (capability_limits !== undefined) {
        providerEntry.capability_limits = JSON.parse(JSON.stringify(capability_limits));
      }
      return providerEntry;
    }),
    capabilities
  };
}

// ---------------- CLI ----------------
//
// 用法(见 references/library/C1-flow.md §12 / references/image/I1-flow.md §8):
//   node core/orchestrator.cjs submit <name>.video-brief.md|image-brief.md [--provider <id>] [--directory <dir>]
//   node core/orchestrator.cjs status <task_id>
//   node core/orchestrator.cjs download <task_id> [--out <dir>]
//
// submit 只提交一次,把固定任务记入 <cwd>/.y-media/tasks.json;status/download 凭 task_id
// 从台账恢复 provider/capability/output 后查询或等待取回。台账缺失/未命中时如实报错,不伪造。

const CLI_STATE_DIR = '.y-media';
const CLI_STATE_FILE = 'tasks.json';
const RATIO_DIMENSIONS = Object.freeze({
  '16:9': [1280, 720],
  '9:16': [720, 1280],
  '1:1': [1024, 1024],
  '4:3': [1152, 864],
  '3:4': [864, 1152]
});

function cliStatePath(context = {}) {
  return path.join(context.cwd ?? process.cwd(), CLI_STATE_DIR, CLI_STATE_FILE);
}

/**
 * 解析 <name>.video-brief.md / <name>.image-brief.md:
 * - Final Prompt = 文档最后一个 fenced 代码块(C1-flow §10 / I1-flow §7 约定固定最后)
 * - capability: 默认假设/Inputs/参考图/锚定图/image_paths 声明参考图 → image-to-video / image-to-image,否则 text-to-video / text-to-image
 * - 参数: 从文档头部(分镜/规范表之前)取显式 W×H、画幅 A:B、目标时长 s/秒 → width/height/ratio(图片) / num_frames(视频,8n+1)
 */
function parseBrief(text, sourceName = 'brief') {
  const body = String(text ?? '');
  const basename = path.basename(sourceName);
  const name = basename
    .replace(/\.video-brief\.md$/i, '')
    .replace(/\.image-brief\.md$/i, '')
    .replace(/\.md$/i, '');
  if (!name) {
    throw new ProviderError('invalid_request', `Unable to derive a brief name from: ${sourceName}.`);
  }
  const isImage = /\.image-brief\.md$/i.test(basename) || /视觉规范表/.test(body);

  const fences = [...body.matchAll(/```[a-zA-Z0-9_-]*\n([\s\S]*?)(?:```|$)/g)];
  if (fences.length === 0) {
    throw new ProviderError('invalid_request', `${sourceName} has no fenced Final Prompt block.`);
  }
  const prompt = fences[fences.length - 1][1].trim();
  if (!prompt) {
    throw new ProviderError('invalid_request', `${sourceName} Final Prompt block is empty.`);
  }

  const section2Index = body.search(/\n##\s*2/);
  const head = section2Index >= 0 ? body.slice(0, section2Index) : body;
  // 显式否定("无参考图")不视为参考声明,避免 G 路径(纯生成)被误判为需要参考图
  const negatedReference = /无(?:实拍|真实|额外|合成)?\s*参考图|不需要参考图|无需参考图|非参考图|no reference/i.test(head);
  const declaresReferenceImage = /image_paths/i.test(body) || (!negatedReference && /Inputs|参考图|锚定图|i2v/i.test(head));

  const inputs = [];
  if (declaresReferenceImage) {
    const urlMatch = body.match(/(?:image_paths|Inputs|参考图|锚定图)\s*[：:]\s*([^\n]+)/i);
    if (urlMatch) {
      for (const match of urlMatch[1].matchAll(/https?:\/\/[^\s,，;；。]+/gi)) {
        inputs.push({ type: 'image', source: { kind: 'url', value: match[0] } });
      }
    }
    if (inputs.length === 0) {
      throw new ProviderError(
        'invalid_request',
        `${sourceName} declares ${isImage ? 'i2i' : 'i2v'} (参考图/Inputs/image_paths) but no public HTTPS image URL was found in the brief.`
      );
    }
  }

  const parameters = {};
  const dimensionMatch = head.match(/\b(\d{3,4})\s*[x×]\s*(\d{3,4})\b/);
  if (dimensionMatch) {
    parameters.width = Number(dimensionMatch[1]);
    parameters.height = Number(dimensionMatch[2]);
  } else {
    const ratioMatch = head.match(/\b(\d{1,2}):(\d{1,2})\b/);
    const ratio = ratioMatch ? `${ratioMatch[1]}:${ratioMatch[2]}` : undefined;
    if (ratio && RATIO_DIMENSIONS[ratio]) {
      if (isImage) {
        // 图片 provider 原生支持 ratio(只取受支持的画幅,避免误吞"光比 3:1"等非画幅 A:B)
        parameters.ratio = ratio;
      } else {
        parameters.width = RATIO_DIMENSIONS[ratio][0];
        parameters.height = RATIO_DIMENSIONS[ratio][1];
      }
    }
  }
  if (!isImage) {
    const durationMatch = head.match(/\b(\d+(?:\.\d+)?)\s*(?:s|秒|seconds?)\b/);
    if (durationMatch) {
      const frames = Math.floor((Number(durationMatch[1]) * 24) / 8) * 8 + 1;
      parameters.num_frames = Math.max(1, Math.min(441, frames));
    }
  }

  return {
    name,
    prompt,
    capability: isImage
      ? (inputs.length > 0 ? 'image-to-image' : 'text-to-image')
      : (inputs.length > 0 ? 'image-to-video' : 'text-to-video'),
    inputs,
    parameters
  };
}

function requestFromBrief(brief, options = {}) {
  const isImage = brief.capability === 'text-to-image' || brief.capability === 'image-to-image';
  const request = {
    capability: brief.capability,
    prompt: brief.prompt,
    output: {
      directory: options.directory || 'outputs',
      filename: `${brief.name}${isImage ? '.png' : '.mp4'}`
    }
  };
  if (options.provider) request.provider = options.provider;
  if (brief.inputs.length > 0) request.inputs = brief.inputs;
  if (Object.keys(brief.parameters).length > 0) request.parameters = brief.parameters;
  return request;
}

function readTaskLedger(context = {}) {
  const file = cliStatePath(context);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed?.tasks) ? parsed.tasks : [];
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new ProviderError('invalid_request', `Unable to read task ledger ${file}: ${error.message}`);
  }
}

function writeTaskLedger(tasks, context = {}) {
  const file = cliStatePath(context);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, tasks }, null, 2));
}

function recordTask(entry, context = {}) {
  const tasks = readTaskLedger(context);
  const index = tasks.findIndex((item) => item.task_id === entry.task_id);
  if (index >= 0) tasks[index] = entry;
  else tasks.push(entry);
  writeTaskLedger(tasks, context);
}

function findTask(taskId, context = {}) {
  const tasks = readTaskLedger(context);
  const entry = tasks.find((item) => item.task_id === taskId);
  if (!entry) {
    const known = tasks.map((item) => item.task_id).join(', ') || '(none)';
    throw new ProviderError(
      'invalid_request',
      `No recorded task matches ${taskId}. Known task ids: ${known}.`
    );
  }
  return entry;
}

async function submitBrief(briefFile, options = {}, context = {}) {
  const fsApi = context.fsApi ?? fs;
  let text;
  try {
    text = await fsApi.promises.readFile(briefFile, 'utf8');
  } catch (error) {
    throw new ProviderError('invalid_request', `Unable to read brief ${briefFile}: ${error.message}`);
  }
  const brief = parseBrief(text, briefFile);
  const request = requestFromBrief(brief, options);
  const result = await createMedia(request, context);
  if (result.task?.id) {
    recordTask({
      task_id: result.task.id,
      provider: result.provider,
      capability: result.capability,
      output: { directory: request.output.directory, filename: request.output.filename },
      brief: briefFile,
      created_at: new Date().toISOString()
    }, context);
  } else if (result.ok && result.artifact_sources?.length > 0) {
    const saveArtifacts = context.saveArtifacts ?? require('./artifacts.cjs').saveArtifacts;
    try {
      result.artifacts = await saveArtifacts(result.artifact_sources, {
        provider: result.provider,
        capability: result.capability,
        task: result.task,
        output: request.output,
        startedAt: result.timing.started_at_ms
      }, context);
    } catch (error) {
      result.ok = false;
      result.error = {
        kind: 'download_failed',
        message: error.message,
        retryable: Boolean(error.retryable)
      };
    }
    delete result.artifact_sources;
  }
  return { brief, result };
}

async function main(argv, context = {}) {
  const [cmd, ...rest] = argv;
  const flag = (name, dflt) => {
    const index = rest.indexOf(name);
    return index >= 0 ? rest[index + 1] : dflt;
  };
  try {
    switch (cmd) {
      case 'submit': {
        const briefFile = rest[0];
        if (!briefFile) throw new ProviderError('invalid_request', 'submit requires <name>.video-brief.md or <name>.image-brief.md');
        const { result } = await submitBrief(briefFile, {
          provider: flag('--provider'),
          directory: flag('--directory')
        }, context);
        console.log(JSON.stringify(result, null, 2));
        if (result.task?.id) {
          console.error(`Recorded task ${result.task.id}; poll with: orchestrator.cjs status ${result.task.id}`);
        }
        return;
      }
      case 'status': {
        const taskId = rest[0];
        if (!taskId) throw new ProviderError('invalid_request', 'status requires <task_id>');
        const entry = findTask(taskId, context);
        const result = await statusMedia({
          provider: entry.provider,
          capability: entry.capability,
          task: { id: entry.task_id }
        }, context);
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      case 'download': {
        const taskId = rest[0];
        if (!taskId) throw new ProviderError('invalid_request', 'download requires <task_id>');
        const entry = findTask(taskId, context);
        const result = await waitMedia({
          provider: entry.provider,
          capability: entry.capability,
          task: { id: entry.task_id },
          output: {
            directory: flag('--out') || entry.output.directory,
            filename: entry.output.filename
          }
        }, context);
        console.log(JSON.stringify(result, null, 2));
        return;
      }
      default:
        console.error('Usage:\n  submit <name>.video-brief.md|<name>.image-brief.md [--provider <id>] [--directory <dir>]\n  status <task_id>\n  download <task_id> [--out <dir>]');
        process.exitCode = 2;
    }
  } catch (error) {
    console.error(`orchestrator: ${error?.message ?? String(error)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  createMedia,
  findTask,
  generateMedia,
  listCapabilities,
  main,
  parseBrief,
  recordTask,
  requestFromBrief,
  statusMedia,
  submitBrief,
  waitMedia
};
