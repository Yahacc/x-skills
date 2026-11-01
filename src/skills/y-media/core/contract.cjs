const CAPABILITIES = Object.freeze([
  'text-to-image',
  'image-to-image',
  'text-to-video',
  'image-to-video',
  'keyframes-to-video'
]);

const CAPABILITY_SET = new Set(CAPABILITIES);
const OUTCOME_STATUSES = new Set(['succeeded', 'queued', 'running', 'failed']);

class ProviderError extends Error {
  constructor(kind, message, options = {}) {
    super(message);
    this.name = 'ProviderError';
    this.kind = kind;
    for (const key of [
      'accepted',
      'retryable',
      'httpStatus',
      'providerCode',
      'details',
      'provider',
      'task',
      'capability'
    ]) {
      if (options[key] !== undefined) this[key] = options[key];
    }
  }
}

function configurationError(message) {
  return new ProviderError('configuration_error', message);
}

const NUMERIC_LIMIT_FIELDS = Object.freeze([
  'maxSingleSegmentDuration',
  'maxFrames',
  'minFrames',
  'defaultFrameRate',
  'minFrameRate',
  'maxFrameRate',
  'minWidth',
  'maxWidth',
  'minHeight',
  'maxHeight',
  'requiresImageInputs'
]);
const STRING_LIMIT_FIELDS = Object.freeze(['frameCountRule']);
const BOOLEAN_LIMIT_FIELDS = Object.freeze(['requiresImageInput']);
const STRING_ARRAY_LIMIT_FIELDS = Object.freeze(['supportedAspectRatios']);

function validateCapabilityLimits(limits, entryCapabilities, providerId) {
  if (limits === undefined) return;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    throw configurationError(`Provider ${providerId} capability_limits must be an object.`);
  }
  for (const [capability, limit] of Object.entries(limits)) {
    if (!entryCapabilities.includes(capability)) {
      throw configurationError(
        `Provider ${providerId} capability_limits.${capability} is not declared in capabilities.`
      );
    }
    if (!limit || typeof limit !== 'object' || Array.isArray(limit)) {
      throw configurationError(
        `Provider ${providerId} capability_limits.${capability} must be an object.`
      );
    }
    for (const [field, value] of Object.entries(limit)) {
      if (NUMERIC_LIMIT_FIELDS.includes(field)) {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw configurationError(
            `Provider ${providerId} capability_limits.${capability}.${field} must be a finite number.`
          );
        }
      } else if (STRING_LIMIT_FIELDS.includes(field)) {
        if (typeof value !== 'string' || value.trim() === '') {
          throw configurationError(
            `Provider ${providerId} capability_limits.${capability}.${field} must be a non-empty string.`
          );
        }
      } else if (BOOLEAN_LIMIT_FIELDS.includes(field)) {
        if (typeof value !== 'boolean') {
          throw configurationError(
            `Provider ${providerId} capability_limits.${capability}.${field} must be boolean.`
          );
        }
      } else if (STRING_ARRAY_LIMIT_FIELDS.includes(field)) {
        if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
          throw configurationError(
            `Provider ${providerId} capability_limits.${capability}.${field} must be an array of non-empty strings.`
          );
        }
      } else {
        throw configurationError(
          `Provider ${providerId} capability_limits.${capability}.${field} is not a known limit field.`
        );
      }
    }
  }
}

function validateManifest(manifest) {
  if (!Array.isArray(manifest) || manifest.length === 0) {
    throw configurationError('Provider manifest must be a non-empty array.');
  }

  const ids = new Set();
  const enabledPriorities = new Set();
  for (const entry of manifest) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw configurationError('Every Provider manifest entry must be an object.');
    }
    if (typeof entry.id !== 'string' || entry.id.trim() === '') {
      throw configurationError('Every Provider manifest entry requires a non-empty id.');
    }
    if (ids.has(entry.id)) {
      throw configurationError(`Provider id must be unique: ${entry.id}.`);
    }
    ids.add(entry.id);
    if (typeof entry.enabled !== 'boolean') {
      throw configurationError(`Provider ${entry.id} enabled must be boolean.`);
    }
    if (!Number.isFinite(entry.priority) || !Number.isInteger(entry.priority)) {
      throw configurationError(`Provider ${entry.id} priority must be a finite integer.`);
    }
    if (entry.enabled && enabledPriorities.has(entry.priority)) {
      throw configurationError(`Enabled Provider priority must be unique: ${entry.priority}.`);
    }
    if (entry.enabled) enabledPriorities.add(entry.priority);

    if (!Array.isArray(entry.capabilities) || entry.capabilities.length === 0) {
      throw configurationError(`Provider ${entry.id} capabilities must be a non-empty array.`);
    }
    const capabilities = new Set();
    for (const capability of entry.capabilities) {
      if (!CAPABILITY_SET.has(capability) || capabilities.has(capability)) {
        throw configurationError(`Provider ${entry.id} capabilities contain an unknown or duplicate value.`);
      }
      capabilities.add(capability);
    }

    validateCapabilityLimits(entry.capability_limits, entry.capabilities, entry.id);

    if (!entry.provider || typeof entry.provider !== 'object') {
      throw configurationError(`Provider ${entry.id} implementation must be an object.`);
    }
    for (const method of ['isConfigured', 'supports', 'create']) {
      if (typeof entry.provider[method] !== 'function') {
        throw configurationError(`Provider ${entry.id} must implement ${method}().`);
      }
    }
    if (entry.provider.status !== undefined && typeof entry.provider.status !== 'function') {
      throw configurationError(`Provider ${entry.id} status must be a function when provided.`);
    }
  }

  return [...manifest].sort((left, right) => left.priority - right.priority);
}

function assertPlainObject(value, label, { optional = false, kind = 'invalid_request' } = {}) {
  if (value === undefined && optional) return;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProviderError(kind, `${label} must be an object.`);
  }
}

function assertOptionalString(value, label) {
  if (value !== undefined && (typeof value !== 'string' || value.trim() === '')) {
    throw new ProviderError('invalid_request', `${label} must be a non-empty string.`);
  }
}

function validateOutputFilename(filename) {
  assertOptionalString(filename, 'output.filename');
  if (filename === undefined) return;
  const stem = filename.replace(/\.[^.]+$/, '');
  const deviceName = filename.split('.', 1)[0];
  if (
    filename.length > 120
    || /[<>:"/\\|?*\x00-\x1F]/.test(filename)
    || /[. ]$/.test(filename)
    || stem === ''
    || stem === '.'
    || stem === '..'
    || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(deviceName)
  ) {
    throw new ProviderError(
      'invalid_request',
      'output.filename must be a safe file name of at most 120 characters.'
    );
  }
}

function validateRequest(command, request) {
  assertPlainObject(request, 'Request');
  if (!CAPABILITY_SET.has(request.capability)) {
    throw new ProviderError('invalid_request', `Unsupported capability: ${String(request.capability)}.`);
  }
  assertOptionalString(request.provider, 'provider');
  assertPlainObject(request.output, 'output', { optional: true });
  assertPlainObject(request.wait, 'wait', { optional: true });

  if (request.output?.directory !== undefined) {
    assertOptionalString(request.output.directory, 'output.directory');
    if (request.output.directory.includes('\0')) {
      throw new ProviderError('invalid_request', 'output.directory must be a valid path string.');
    }
  }
  validateOutputFilename(request.output?.filename);
  if (request.wait?.timeout_seconds !== undefined && (
    !Number.isFinite(request.wait.timeout_seconds)
    || request.wait.timeout_seconds <= 0
  )) {
    throw new ProviderError('invalid_request', 'wait.timeout_seconds must be a positive number.');
  }

  if (command === 'status' || command === 'wait') {
    if (request.provider === undefined) {
      throw new ProviderError('invalid_request', `${command} requires provider.`);
    }
    assertPlainObject(request.task, 'task');
    assertOptionalString(request.task.id, 'task.id');
    if (request.task.id === undefined) {
      throw new ProviderError('invalid_request', `${command} requires task.id.`);
    }
    return request;
  }

  if (command !== 'create' && command !== 'generate') {
    throw new ProviderError('invalid_request', `Unsupported media command: ${String(command)}.`);
  }
  if (typeof request.prompt !== 'string' || request.prompt.trim() === '') {
    throw new ProviderError('invalid_request', 'A non-empty prompt is required.');
  }
  if (request.inputs !== undefined && !Array.isArray(request.inputs)) {
    throw new ProviderError('invalid_request', 'inputs must be an array.');
  }
  assertPlainObject(request.parameters, 'parameters', { optional: true });
  return request;
}

function normalizeOutcome(outcome) {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
    throw new ProviderError('invalid_response', 'Provider outcome must be an object.');
  }
  if (!OUTCOME_STATUSES.has(outcome.status)) {
    throw new ProviderError('invalid_response', `Unknown Provider outcome status: ${String(outcome.status)}.`);
  }
  if (outcome.task !== undefined) {
    assertPlainObject(outcome.task, 'Provider outcome task', { kind: 'invalid_response' });
  }
  if (outcome.artifact_sources !== undefined && !Array.isArray(outcome.artifact_sources)) {
    throw new ProviderError('invalid_response', 'Provider artifact_sources must be an array.');
  }
  if (outcome.effective_parameters !== undefined) {
    assertPlainObject(outcome.effective_parameters, 'Provider effective_parameters', {
      kind: 'invalid_response'
    });
  }
  if (outcome.warnings !== undefined && !Array.isArray(outcome.warnings)) {
    throw new ProviderError('invalid_response', 'Provider warnings must be an array.');
  }

  const normalized = {
    status: outcome.status,
    artifact_sources: outcome.artifact_sources ?? [],
    effective_parameters: outcome.effective_parameters ?? {},
    warnings: outcome.warnings ?? []
  };
  if (outcome.task !== undefined) normalized.task = outcome.task;
  if (outcome.poll_after_ms !== undefined) normalized.poll_after_ms = outcome.poll_after_ms;
  return normalized;
}

module.exports = {
  CAPABILITIES,
  ProviderError,
  normalizeOutcome,
  validateManifest,
  validateRequest
};
