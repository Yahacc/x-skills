# 媒体 Provider 契约

## 公共请求

新的 `generate`（生成并等待）与 `create`（只提交不等待）请求必须包含 `capability`（能力）与 `prompt`（提示词）。`provider` 为可选字段：

```json
{
  "provider": "agnes",
  "capability": "image-to-image",
  "prompt": "Make the object matte black",
  "inputs": [
    {
      "type": "image",
      "source": { "kind": "path", "value": "assets/source.png" }
    }
  ],
  "parameters": { "model": "agnes-image-2.1-flash" },
  "output": {
    "directory": "outputs",
    "filename": "matte-black-product.png"
  },
  "wait": { "timeout_seconds": 1200 }
}
```

能力（capability）枚举：

- `text-to-image`（文生图）
- `image-to-image`（图生图）
- `text-to-video`（文生视频）
- `image-to-video`（图生视频）
- `keyframes-to-video`（关键帧生视频）

Provider 专属的控制参数放在 `parameters` 内。相对输出目录基于工作目录解析。可选的 `output.filename` 是至多 120 字符的单个安全文件名，不是路径。core 保证任务 ID 不进入本地路径、多产物自动加序号、并用真实媒体扩展名替换请求的扩展名。

既有任务的 `status`（查询状态）与 `wait`（等待）请求需要原始 `provider`、`capability` 与 `task.id`：

```json
{
  "provider": "agnes",
  "capability": "text-to-video",
  "task": { "id": "video_xxx" },
  "output": { "directory": "outputs" },
  "wait": { "timeout_seconds": 1200 }
}
```

任务 ID 是不透明的，可能跨 Provider 冲突。永远不要探测 Provider，也不要按优先级路由既有任务。

## 注册清单（Manifest）

在 `providers/manifest.cjs` 中显式注册 Provider：

```js
module.exports = [
  {
    id: 'agnes',
    enabled: true,
    priority: 100,
    capabilities: [
      'text-to-image',
      'image-to-image',
      'text-to-video',
      'image-to-video',
      'keyframes-to-video'
    ],
    capability_limits: {
      'text-to-video': {
        maxSingleSegmentDuration: 18,
        maxFrames: 441,
        defaultFrameRate: 24,
        minFrameRate: 1,
        maxFrameRate: 60,
        supportedAspectRatios: ['16:9', '9:16', '1:1'],
        frameCountRule: '8n+1'
      }
    },
    provider: require('./agnes/provider.cjs')
  }
];
```

优先级数值越小越先执行。启用的 ID 与优先级必须唯一。清单数组顺序与路由无关。

清单是 Provider ID、启用状态、优先级、粗粒度能力列表与**各能力的静态限制**的唯一来源。不要在 Provider 内部重复能力列表。

### `capability_limits`（静态、与请求无关）

`capability_limits` 暴露**静态、与请求无关**的限制，供调用方在规划阶段读取——在任何请求构建与任何 `supports()` 调用之前。这些限制会出现在输出 `providers[].capability_limits` 中。

每个能力可识别的字段：

| 字段 | 类型 | 含义 |
| --- | --- | --- |
| `maxSingleSegmentDuration` | 数字（秒） | 单个生成段的硬上限。Skill 用它决定是否在调用 Provider **之前**询问用户拆分或合并。 |
| `maxFrames` | 数字 | Provider 单段可产出的最大帧数。 |
| `minFrames` | 数字 | Provider 接受的最小帧数。 |
| `defaultFrameRate` | 数字 | 请求省略时的默认帧率。 |
| `minFrameRate`, `maxFrameRate` | 数字 | 帧率范围。 |
| `minWidth`, `maxWidth`, `minHeight`, `maxHeight` | 数字 | 像素边界。 |
| `supportedAspectRatios` | 字符串数组 | Provider 可交付的画幅比。 |
| `frameCountRule` | 字符串 | Provider 强制的帧数规则（如 `8n+1`）。 |
| `requiresImageInput` | 布尔 | 该能力是否至少需要一个图片输入。 |
| `requiresImageInputs` | 数字 | 该能力需要的确切图片输入数量。 |

**保持 `capability_limits` 静态。** 依赖具体请求的内容（模型选择、输出尺寸、精确的 `num_frames` 合法性）属于 `supports()` 与 Provider 自身的请求校验，不属于清单。凭证、端点、模型 ID 与请求相关的约束不进入清单。

## Provider API

导出一个对象：

```js
module.exports = {
  isConfigured,
  supports,
  create,
  status
};
```

`isConfigured(context)` 返回布尔值，不返回也不记录密钥。

在构造 `ProviderError` 之前，从每个外部错误消息、代码与详情中脱敏 Provider 凭证。core 无法知道 Provider 自有文件中加载的密钥。

`supports(request)` 是同步且无副作用的。返回：

```js
{ supported: true }
```

或：

```js
{ supported: false, reason: 'Provider requires a public HTTPS image URL' }
```

用于模型、格式、尺寸、输入数量与 Provider 专属约束的细粒度检查。不要发起网络或消耗额度的调用。

`create(request, context)` 只提交一次新工作，返回：

```js
{
  status: 'succeeded' | 'queued' | 'running' | 'failed',
  task: {
    id: 'provider-task-id',
    provider_status: 'queued',
    progress: 0
  },
  artifact_sources: [],
  effective_parameters: {},
  warnings: []
}
```

同步 Provider 可以省略 `task`。`create()` 从不保存本地文件。

`status(task, context)` 执行一次幂等的状态查询并返回同样的结果结构。可以返回正的 `poll_after_ms` 提示。仅当 Provider 永远不会返回异步工作时才省略 `status`。

## 产物来源（Artifact Sources）

只返回这些来源类型：

```js
{ kind: 'url', mime_type: 'image/png', value: 'https://cdn.example/result.png' }
{ kind: 'base64', mime_type: 'image/png', value: '...' }
{ kind: 'bytes', mime_type: 'video/mp4', value: buffer }
```

URL 来源必须是免凭证的公网 HTTPS URL。共享产物层永远不接收 Provider 凭证。私有带鉴权的产物应在 Provider 内部转换为字节。

## 选择与回退

自动新工作时，core 过滤启用的能力注册项，按优先级升序排序，跳过未配置/不支持的 Provider，并只调用第一个合格 Provider 一次。

`create()` 之后仅当 `ProviderError` 显式携带 `accepted: false` 时才允许回退。缺失、为 `true` 或未知的接受状态都会阻止回退。传输失败、HTTP 408、歧义的 5xx、格式错误的接受响应、已创建的任务、状态/等待失败与产物失败都会阻止回退。

显式指定 Provider 的请求永不回退。自动候选耗尽时返回 `no_provider_available`，附带脱敏后的跳过原因。

## 公共结果

结果包含 `ok`、`provider`、`capability`、规范化的 `status`、可选固定的 `task`、本地 `artifacts`、`effective_parameters`、`warnings`、`timing` 与可选的 `error`。

规范化状态为 `queued`、`running`、`succeeded` 与 `failed`。稳定错误类型包括：

| 类型 | 含义 |
| --- | --- |
| `configuration`, `configuration_error` | 凭证或清单配置失败 |
| `invalid_request` | 公共或 Provider 专属请求无效 |
| `no_provider_available` | 自动选择耗尽安全候选 |
| `authentication`, `permission` | Provider 拒绝凭证或访问 |
| `quota_exhausted`, `rate_limited` | Provider 额度/限流边界 |
| `provider_unavailable`, `network` | Provider 或传输失败 |
| `task_failed`, `wait_timeout` | 远端失败或本地有界等待结束 |
| `download_failed` | 远端成功但无法本地物化 |
| `invalid_response` | Provider 违反规范化契约 |

本地超时从不取消或重提远端任务。远端完成后下载失败会保留 `status: "succeeded"`、Provider 与任务。
