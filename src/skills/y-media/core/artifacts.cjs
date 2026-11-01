const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const { ProviderError } = require('./contract.cjs');

const ARTIFACT_TYPES = new Map([
  ['image/png', { type: 'image', extension: '.png' }],
  ['image/jpeg', { type: 'image', extension: '.jpg' }],
  ['image/webp', { type: 'image', extension: '.webp' }],
  ['video/mp4', { type: 'video', extension: '.mp4' }]
]);

function isNonPublicIpAddress(hostname) {
  const host = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  const version = net.isIP(host);
  if (version === 4) {
    const [first, second] = host.split('.').map(Number);
    return first === 0
      || first === 10
      || first === 127
      || (first === 100 && second >= 64 && second <= 127)
      || (first === 169 && second === 254)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)
      || first >= 224;
  }
  if (version === 6) {
    const normalized = host.toLowerCase();
    const firstGroup = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('::ffff:')
      || (firstGroup & 0xfe00) === 0xfc00
      || (firstGroup & 0xffc0) === 0xfe80
      || (firstGroup & 0xff00) === 0xff00;
  }
  return false;
}

function assertPublicHttpsUrl(value, label = 'Artifact URL', kind = 'download_failed') {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ProviderError(kind, `${label} must be a public HTTPS URL.`);
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || isNonPublicIpAddress(hostname)
  ) {
    throw new ProviderError(kind, `${label} must be a public HTTPS URL without embedded credentials.`);
  }
  return url.toString();
}

async function withTransientRetry(operation, {
  maxAttempts = 4,
  baseDelayMs = 1_000,
  maxDelayMs = 20_000,
  random = Math.random,
  sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  deadlineMs = Number.POSITIVE_INFINITY,
  nowMs = Date.now,
  signal
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted || nowMs() >= deadlineMs) {
      throw new ProviderError('wait_timeout', 'The operation deadline was reached.', { retryable: true });
    }
    try {
      return await operation();
    } catch (error) {
      if (signal?.aborted || nowMs() >= deadlineMs) {
        throw new ProviderError('wait_timeout', 'The operation deadline was reached.', { retryable: true });
      }
      if (!error.retryable || attempt === maxAttempts) throw error;
      const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      const jitter = Math.floor(random() * Math.min(baseDelayMs, exponential));
      await sleep(Math.min(exponential + jitter, deadlineMs - nowMs()));
    }
  }
  throw new ProviderError('invalid_response', 'Retry loop ended unexpectedly.');
}

function artifactType(mimeType) {
  const normalized = String(mimeType ?? '').split(';', 1)[0].trim().toLowerCase();
  const media = ARTIFACT_TYPES.get(normalized);
  if (!media) {
    throw new ProviderError('download_failed', `Unsupported artifact content type: ${normalized || 'missing'}.`);
  }
  return { ...media, mimeType: normalized };
}

async function uniquePath(destinationBase, extension, fsPromises = fs.promises) {
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const candidate = suffix === 1
      ? `${destinationBase}${extension}`
      : `${destinationBase}-${suffix}${extension}`;
    try {
      await fsPromises.access(candidate);
    } catch (error) {
      if (error.code === 'ENOENT') return candidate;
      throw error;
    }
  }
  throw new ProviderError('download_failed', 'Unable to allocate a unique artifact filename.');
}

async function atomicWrite(data, destinationBase, media, fsApi = fs) {
  await fsApi.promises.mkdir(path.dirname(destinationBase), { recursive: true });
  const finalPath = await uniquePath(destinationBase, media.extension, fsApi.promises);
  const partPath = `${finalPath}.part`;
  try {
    await fsApi.promises.writeFile(partPath, data, { flag: 'wx' });
    const stat = await fsApi.promises.stat(partPath);
    if (stat.size === 0) throw new ProviderError('download_failed', 'Artifact data is empty.');
    await fsApi.promises.rename(partPath, finalPath);
    return { finalPath, bytes: stat.size };
  } catch (error) {
    await fsApi.promises.rm(partPath, { force: true }).catch(() => {});
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('download_failed', `Unable to save artifact: ${error.message}`, {
      retryable: true
    });
  }
}

async function downloadArtifact(sourceUrl, destinationBase, {
  fetchImpl = globalThis.fetch,
  fsApi = fs,
  retryOptions = {}
} = {}) {
  const normalizedSource = assertPublicHttpsUrl(sourceUrl);
  const response = await withTransientRetry(async () => {
    let currentUrl = normalizedSource;
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      let candidate;
      try {
        candidate = await fetchImpl(currentUrl, { method: 'GET', redirect: 'manual' });
      } catch {
        throw new ProviderError('download_failed', 'Artifact download failed because of a network error.', {
          retryable: true
        });
      }
      if ([301, 302, 303, 307, 308].includes(candidate.status)) {
        const location = candidate.headers.get('location');
        if (!location) throw new ProviderError('download_failed', 'Artifact redirect has no Location header.');
        if (redirects === 5) throw new ProviderError('download_failed', 'Artifact download exceeded 5 redirects.');
        currentUrl = assertPublicHttpsUrl(
          new URL(location, currentUrl).toString(),
          'Artifact redirect URL'
        );
        continue;
      }
      if (!candidate.ok) {
        throw new ProviderError('download_failed', `Artifact download failed with HTTP ${candidate.status}.`, {
          retryable: candidate.status === 408 || candidate.status === 429 || candidate.status >= 500,
          httpStatus: candidate.status
        });
      }
      if (candidate.url) assertPublicHttpsUrl(candidate.url, 'Final artifact URL');
      return candidate;
    }
    throw new ProviderError('download_failed', 'Artifact redirect handling ended unexpectedly.');
  }, retryOptions);

  const media = artifactType(response.headers.get('content-type'));
  if (!response.body) throw new ProviderError('download_failed', 'Artifact response body is empty.');
  await fsApi.promises.mkdir(path.dirname(destinationBase), { recursive: true });
  const finalPath = await uniquePath(destinationBase, media.extension, fsApi.promises);
  const partPath = `${finalPath}.part`;
  try {
    await pipeline(Readable.fromWeb(response.body), fsApi.createWriteStream(partPath, { flags: 'wx' }));
    const stat = await fsApi.promises.stat(partPath);
    if (stat.size === 0) throw new ProviderError('download_failed', 'Downloaded artifact is empty.');
    await fsApi.promises.rename(partPath, finalPath);
    return {
      type: media.type,
      path: finalPath,
      source_url: normalizedSource,
      mime_type: media.mimeType,
      bytes: stat.size
    };
  } catch (error) {
    await fsApi.promises.rm(partPath, { force: true }).catch(() => {});
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('download_failed', `Unable to save artifact: ${error.message}`, {
      retryable: true
    });
  }
}

function outputRoot(request, context = {}) {
  const directory = request?.output?.directory ?? 'outputs';
  if (typeof directory !== 'string' || directory.trim() === '' || directory.includes('\0')) {
    throw new ProviderError('invalid_request', 'output.directory must be a non-empty valid path string.');
  }
  return path.resolve(context.cwd ?? process.cwd(), directory);
}

async function preflightOutput(request, context = {}) {
  const root = outputRoot(request, context);
  const provider = context.provider ?? request.provider;
  const target = provider ? path.join(root, provider) : root;
  const fsApi = context.fsApi ?? fs;
  try {
    await fsApi.promises.mkdir(target, { recursive: true });
    const stat = await fsApi.promises.stat(target);
    if (!stat.isDirectory()) throw new Error('not a directory');
    await fsApi.promises.access(target, fsApi.constants?.W_OK ?? fs.constants.W_OK);
  } catch {
    throw new ProviderError('invalid_request', `Output directory is not writable: ${root}.`);
  }
  return root;
}

function safeIdentifier(value) {
  const safe = String(value ?? 'result').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
  return safe || 'result';
}

function timestamp(value) {
  return new Date(value ?? Date.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

async function uniqueDirectory(root, base, fsApi) {
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const directory = path.join(root, suffix === 1 ? base : `${base}-${suffix}`);
    try {
      await fsApi.promises.mkdir(directory);
      return directory;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  throw new ProviderError('download_failed', 'Unable to allocate an artifact output directory.');
}

function decodeBase64(value) {
  const normalized = String(value ?? '').replace(/\s/g, '');
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(normalized) || normalized.length % 4 !== 0) {
    throw new ProviderError('download_failed', 'Artifact source contains invalid Base64 data.');
  }
  const data = Buffer.from(normalized, 'base64');
  if (data.length === 0) throw new ProviderError('download_failed', 'Artifact source contains empty Base64 data.');
  return data;
}

function decodeBytes(value) {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  throw new ProviderError('download_failed', 'Artifact bytes source must contain bytes.');
}

async function saveArtifacts(sources, options = {}, context = {}) {
  if (!Array.isArray(sources)) {
    throw new ProviderError('invalid_response', 'Artifact Sources must be an array.');
  }
  const fsApi = context.fsApi ?? fs;
  const root = await preflightOutput(
    { output: options.output, provider: options.provider },
    { ...context, provider: options.provider }
  );
  const providerRoot = path.join(root, safeIdentifier(options.provider));
  const directory = await uniqueDirectory(
    providerRoot,
    timestamp(options.startedAt),
    fsApi
  );
  const requestedFilename = options.output?.filename;
  const requestedExtension = requestedFilename ? path.extname(requestedFilename) : '';
  const requestedStem = requestedFilename
    ? requestedFilename.slice(0, requestedFilename.length - requestedExtension.length)
    : undefined;
  const artifacts = [];
  try {
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      if (!source || typeof source !== 'object') {
        throw new ProviderError('invalid_response', 'Every Artifact Source must be an object.');
      }
      const sequence = String(index + 1).padStart(2, '0');
      const destinationName = requestedStem
        ? `${requestedStem}${sources.length > 1 ? `-${sequence}` : ''}`
        : `result-${sequence}`;
      const destination = path.join(directory, destinationName);
      if (source.kind === 'url') {
        artifacts.push(await downloadArtifact(source.value, destination, {
          fetchImpl: context.fetchImpl,
          fsApi,
          retryOptions: context.retryOptions
        }));
        continue;
      }
      if (source.kind !== 'base64' && source.kind !== 'bytes') {
        throw new ProviderError('invalid_response', `Unsupported Artifact Source kind: ${String(source.kind)}.`);
      }
      const media = artifactType(source.mime_type);
      const data = source.kind === 'base64' ? decodeBase64(source.value) : decodeBytes(source.value);
      const written = await atomicWrite(data, destination, media, fsApi);
      artifacts.push({
        type: media.type,
        path: written.finalPath,
        source_url: null,
        mime_type: media.mimeType,
        bytes: written.bytes
      });
    }
    return artifacts;
  } catch (error) {
    if (error instanceof ProviderError) {
      error.details = { ...(error.details ?? {}), artifacts };
      throw error;
    }
    throw new ProviderError('download_failed', `Unable to save artifacts: ${error.message}`, {
      details: { artifacts }
    });
  }
}

module.exports = {
  assertPublicHttpsUrl,
  downloadArtifact,
  preflightOutput,
  saveArtifacts,
  withTransientRetry
};
