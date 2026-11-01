# Agnes AI 图片与视频 API

本参考记录了 2026-07-30 从 `https://agnes-ai.cn/en/docs/` 验证的 `.cn` API 契约。优先于使用 `.com` 主机的旧示例。

## 凭证与主机

```text
API 根: https://api.agnes-ai.cn
认证: Authorization: Bearer <AGNES_API_KEY>
Content-Type: application/json
```

优先解析 `AGNES_API_KEY`，其次读取 `~/.config/agnes/api_key`。POSIX 下该文件要求 `0600` 权限。永远不要把 Bearer 头发送给返回的产物 URL。

POSIX 配置：

```bash
umask 077
mkdir -p ~/.config/agnes
printf '%s' 'YOUR_API_KEY' > ~/.config/agnes/api_key
chmod 600 ~/.config/agnes/api_key
```

避免在 shell 历史中保留明文密钥。Windows 上优先使用密钥管理器或会话环境变量；将配置文件 ACL 限制为当前账户。

## 图片（Images）

```text
POST https://api.agnes-ai.cn/v1/images/generations
```

| 模型 | 用途 |
| --- | --- |
| `agnes-image-2.1-flash` | 默认；支持档位尺寸与比例 |
| `agnes-image-2.0-flash` | 更快的模型，文档化精确尺寸 |

图片编辑使用 `extra_body.image`，输出格式使用 `extra_body.response_format` 的 `url`/`b64_json`。不要发送过时的 `tags: ["img2img"]`。

```json
{
  "model": "agnes-image-2.1-flash",
  "prompt": "Make the object matte black",
  "size": "1K",
  "ratio": "1:1",
  "extra_body": {
    "image": ["data:image/png;base64,..."],
    "response_format": "url"
  }
}
```

每个 `data[]` 条目按 `url` 或 `b64_json` 处理。图片输入可以是公网 HTTPS URL 或本地 PNG/JPEG/WEBP 文件；Provider 将本地文件转换为 Data URI。

**图片端不支持 `negative_prompt`。** `/v1/images/generations` 请求模式没有 `negative_prompt` 字段；传入该字段会依模型被忽略或拒绝。因此 Skill 侧图片路径不维护独立的 `negative_prompt` 字段——所有负面约束必须以正向写法（`no X, no Y, no Z`）写进主 prompt。图片侧约定见 [I3-prompt.md §3.2](../../references/image/I3-prompt.md) 与 [I4-image-example.md](../../references/image/I4-image-example.md)；视频侧对应方法是 [C3-prompt-craft.md §11](../../references/library/C3-prompt-craft.md)。

## 视频（Videos）

```text
POST https://api.agnes-ai.cn/v1/videos
Model: agnes-video-v2.0
```

默认为 `1152x768`、`121` 帧、`24` fps。`num_frames` 必须至多 `441` 且满足 `8n + 1`；`frame_rate` 必须在 `1-60`。

`image-to-video` 时发送一个公网 HTTPS URL 作为 `image`。`keyframes-to-video` 时发送至少两个公网 HTTPS URL 作为 `extra_body.image`，并把 `extra_body.mode` 设为 `keyframes`。Agnes 视频输入不支持本地路径或 Data URI。

```json
{
  "model": "agnes-video-v2.0",
  "prompt": "A cinematic product reveal",
  "width": 1152,
  "height": 768,
  "num_frames": 121,
  "frame_rate": 24
}
```

使用 `video_id`（而非 `task_id`）作为规范化任务 ID。

官方参数表含 `negative_prompt` 独立字段；y-media 刻意不使用它——负面约束作为 `Negative constraints:` 段并入 `prompt`，与正向指令构成同一条提交指令（见 [C3-prompt-craft.md §11](../../references/library/C3-prompt-craft.md)）。宽高超范围时 API 就近归一化到 480p/720p/1080p 三档，官方画幅为 16:9 / 9:16 / 1:1 / 4:3 / 3:4（见 `capability_limits[<capability>].supportedAspectRatios`）；归一化会通过 `metadata.size_mapping.adjusted` 报告警告。

## 视频状态（Video Status）

```text
GET https://api.agnes-ai.cn/agnesapi?video_id=<VIDEO_ID>
```

| Agnes | 规范化 |
| --- | --- |
| `queued` | `queued` |
| `in_progress` | `running` |
| `completed` | `succeeded` |
| `failed` | `failed` |

从当前官方 `metadata.url` 字段读取完成的产物。对于旧版 Agnes 路由的响应，在 `metadata.url` 之后也依次接受 `video_url`、`url`、`output_url` 与 `data[].url`；每个候选都校验为公网 HTTPS URL。使用旧版字段时报告警告。

保持创建时返回的 `video_id` 为规范化任务 ID。后续状态响应可能返回不同的 `video_id`、`task_id` 或 `id`；保留这些值作为 Provider 诊断，但绝不让它们替换固定的任务 ID。如果完成的响应没有任何受支持的产物 URL，返回 `invalid_response`，附带响应键、metadata 键与标识符变化的脱敏摘要，而不是原始响应。

## 错误边界（Error Boundaries）

| HTTP | 类型 | 生成回退 |
| ---: | --- | --- |
| `400`, `404`, `405`, `409`, `413`, `415`, `422` | `invalid_request` | 仅 `accepted: false` 时允许 |
| `401` | `authentication` | 仅 `accepted: false` 时允许 |
| `402` | `quota_exhausted` | 仅 `accepted: false` 时允许 |
| `403` | `permission` | 仅 `accepted: false` 时允许 |
| `429` | `rate_limited` | 仅当拒绝是权威的时允许 |
| `408`, 歧义 `5xx` | `network` / `provider_unavailable` | 禁止；接受状态未知 |

绝不重试生成 POST。幂等的状态 GET 与公网产物下载可以使用有界瞬时重试。本地超时或下载失败时保留 `video_id`。

URL 校验拒绝内嵌凭证、localhost 名称与私有/链路本地 IP 字面量，并校验每个重定向。fetch 之前不解析 DNS 名称，因此可信主机名对于抵御 DNS 重绑定仍是必需的。
