# y-media

`y-media` 是一个轻量媒体工作流 Skill。它通过显式注册的 Provider 支持图片与视频生成，同时保证确定性路由、任务恢复与本地产物处理。

运行时指令见 [SKILL.md](SKILL.md)。共享的请求、结果、错误与 Provider 契约见 [core/provider-contract.md](core/provider-contract.md)。Provider 相关的 API 事实紧邻各自的实现存放，例如 [providers/agnes/api.md](providers/agnes/api.md)。

## 架构

```text
SKILL.md
  意图收集与创意规划
        |
        v
core/orchestrator.cjs
  校验、路由、创建、状态查询、等待、恢复
        |
        +--> providers/manifest.cjs --> providers/<id>/provider.cjs
        |
        +--> core/artifacts.cjs --> 本地文件
        +--> core/post.cjs --> 质检(probe) + 字幕烧录 + 配音 TTS 混入
```

各边界是刻意划分的：

| 区域         | 职责                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Skill        | 收集意图，按 [references/library/C1-flow.md](references/library/C1-flow.md) 编排视频流程并规划分镜，编写创意文档，并构建公共请求 |
| Orchestrator | 选择 Provider、只提交一次、固定任务、轮询、协调保存                                                                              |
| Contract     | 校验 manifest、公共请求、结果与稳定错误分类                                                                                      |
| Artifacts    | 校验公共 URL，并原子保存下载内容、Base64 或字节                                                                                  |
| Post         | 产物级质检(ffprobe 客观校验) + 字幕烧录 + 配音 TTS 混入                                                                          |
| Provider     | 解析凭证、映射参数、调用一个外部 API、规范化结果                                                                                 |

创意 brief 的收集与分镜生成不属于 core。Skill 拥有创意层:[C1-flow.md](references/library/C1-flow.md) 是**视频唯一入口**,自包含写故事/路径判定/骨架/镜头结构等规划方法与 8 步流程;一个视频 brief 会落地为具体的 `<name>.video-brief.md` 文档,其提示词随后通过 core 提交。Provider 专属的模型、端点、凭证与响应兼容性不属于编排层。

## 目录结构

```text
skills/y-media/
|-- SKILL.md                                (路由 §0 + 图片索引;视频铁律与入口在 C1-flow,图片入口在 I1-flow)
|-- README.md                               (本文件:架构 + 设计说明 + 公共 API)
|-- references/
|   |-- library/                            (视频原语:C=core 流程/原则/模板/规则/质检, M=model 建模量化级)
|   |   |-- C1-flow.md                      (core · 视频唯一入口:路由/流程/原则/建模必读 M1-M5/质检/交付)
|   |   |-- M1-character.md                 (建模 · 角色四层+人物-事件一致性)
|   |   |-- M2-scene.md                     (建模 · 场景3+1+动态层+单一光源)
|   |   |-- M3-cinematography.md            (建模 · 景别+机位+运镜+焦段+构图)
|   |   |-- M4-audio.md                     (建模 · 音频三层进prompt)
|   |   |-- M5-subtitle.md                  (建模 · 字幕·SRT 后期烧录为主)
|   |   |-- C2-quality.md                   (core · 质检+规则:非量化质量 + 写作规则 动作/镜头/字幕/音频/质量锁/自检)
|   |   |-- C3-prompt-craft.md              (core · 模板:八要素+拼接顺序+套用模板)
|   |   `-- C4-example.md                   (core · 完整可工作示例:骨架 B 全流程示范)
|   |-- recipes/                            (品类配方,按 brief 关键词只读 1 个)
|   |   |-- nature.md                       (自然/动物/治愈)
|   |   |-- lifestyle.md                    (生活/质感/氛围/节日)
|   |   |-- portrait.md                     (人像/穿搭/时尚,强 i2v)
|   |   |-- food.md                         (美食/ASMR/饮品)
|   |   `-- commerce.md                     (商业带货)
|   `-- image/                              (图片专属,独立于视频)
|       |-- I1-flow.md                       (图片总入口:路由+判定+骨架+规范表+质检+交付)
|       |-- I2-quality.md                    (图片质量:颗粒度/反模式/系列一致性)
|       |-- I3-prompt.md                     (图片 prompt 模板:图层/七维度/画幅/约束块)
|       `-- I4-image-example.md              (图片完整实例)
|-- core/
|   |-- orchestrator.cjs
|   |-- contract.cjs
|   |-- artifacts.cjs
|   |-- post.cjs
|   `-- provider-contract.md
|-- providers/
|   |-- manifest.cjs
|   `-- agnes/
|       |-- provider.cjs
|       `-- api.md
`-- tests/
    |-- media.test.cjs
    |-- orchestrator-cli.test.cjs
    `-- post.test.cjs
```

## 设计说明(Why this shape)

> 本节回答"为什么这个 skill 长这样"。新成员看 §0 路由表 5 分钟就能跑流程;深入优化或扩展前,先读本节理解设计取舍。

### 路由哲学:文件小 ≠ 加载少

**核心**:skill 是 Agent 按需加载的——**加载量 = token 成本,不是文件体积**。

合并 N 个文件看似体积小,但每次 brief 都会把 N 个文件全读进上下文;**拆 N 个 + 路由 = 每次只读匹配的 1 个**。文件小,加载少,成本低。

### 视频与图片两路独立 library

视频和图片走两套互不重叠的 library:

- **视频核心 library(9 个,C/M 分层)**:C1-flow 视频入口(流程+创意原则)、M1 角色、M2 场景、M3 镜头、M4 音频、M5 字幕、C2-quality 质检+规则、C3-prompt-craft 模板、C4-example 完整示例。命中 recipe 后按需加载,镜头语言只归 M3 一处。
- **图片 library(独立)**:不读视频 9 个原语,只读 I1-flow + I2-quality + I3-prompt + I4-image-example + 必要的 recipe 头。

**为什么分开**:图片无时间轴/分镜/音频,视频的 9 个原语对图片 0 价值;硬塞进图片加载路径 = 平白增加 token 成本。

### C/M 分层(建模量化 vs 创意艺术/模板)

library 用**前缀区分两类文件**:
- **`M` = model(建模量化级)**:M1-M5(角色/场景/镜头/音频/字幕)统一 schema 表,现场建模。后续新维度顺延 M 编号。
- **`C` = core(流程/原则/模板/质检+规则)**:C1-flow 视频唯一入口(流程+创意原则)、C2-quality 非量化质检+写作规则、C3-prompt-craft 模板、C4-example 完整示例。这些不做成 schema 表——它们是"怎么编排/怎么规划/怎么拼/怎么写/怎么验收"的规则,不是"建什么模型"。
- **镜头语言收敛**:景别/机位/运镜/焦段/构图只维护在 M3,C1/C3/recipes 只引用不重复。

### 建模 schema 表(显式建模,不千篇一律)

M1-M5 把"固定卡"升级为**显式建模 schema 表**——统一 5 列(维度/必填/变体轴/示例/反例)。运行时按 brief 现场填维度、在变体轴内取 1,天然带变化,不靠堆卡。`必填`即 MUST-KEEP,`变体轴(CAN-ROTATE)`按 brief 换取值。表只定义"该建什么、怎么填、哪些可变",内容在运行时生成,规则改在 skill、内容不进 IMA。

### C2 独成质检文件(非量化质量集中管理)

前后一致性/常理/防崩坏/负面约束/配音字幕后期这类**不能量化**的因素,跨 M1-M5/C1 出现但无法归任意单一建模块,故独立成 [C2-quality.md](references/library/C2-quality.md) 集中管理——Q1-Q6 各归"源头写对"落点(M1/M2/M3/M4/M5),Q7 收尾主观质检协议。建模块管"该填什么",C2 管"怎么不翻车 + 怎么验证",职责不重叠。

### recipe 共享 1 份 library(不按 recipe 重复列)

**所有 video recipe 共享同一份 9 个原语**;共享 library 只在 [C1-flow.md](references/library/C1-flow.md) §0/§2.1 一处声明(recipe 挂 C1-flow,不重复列 M1-M5),recipe 只写自身独有的规则与模板。这样:

- 路由表只列 1 次 library,简洁
- recipe 不重复声明共享文件
- 跨 recipe 知识自动同步(改一个 library 文件,所有 recipe 受益)

### 镜头语言收敛在 M3 一处

景别/机位/运镜/焦段/构图只维护在 [M3-cinematography.md](references/library/M3-cinematography.md),C1/C2/recipes 只引用不重复。避免同一主题多个说法。

### 套用模板并入 C3-prompt-craft

即用 prompt 模板(人像/风景/i2v/古风)并入 [C3-prompt-craft.md §3](references/library/C3-prompt-craft.md),不单独设 `templates/` 目录。模板是 C3 拼接规则的现成实例,职责不拆分;模板之外的内容(动作/镜头/字幕/音频/质量锁/自检)归 [C2-quality.md](references/library/C2-quality.md)。

### example 只留 1 份(输出格式全局统一)

视频 brief 输出格式全局一致(`.video-brief.md` 四段结构 + Final Prompt 固定最后),故 example 只保留 1 份完整可工作示例 [C4-example.md](references/library/C4-example.md)(骨架 B)。各 recipe 提供规则(§1.5 锚点),AI 读完 recipe 后按同一格式自主生成其余场景,不按 recipe 堆 example。

### R1-R7 铁律(视频专属)内联在 C1-flow,不内联 modeling/recipe 路径

R1-R7 是**视频铁律**,内联在 [C1-flow.md](references/library/C1-flow.md)(视频入口,第一屏即可读),只列**铁律本身**(一句话含义);图片不使用 R1-R7,图片有独立 R1-R5(见 [I1-flow.md §0](references/image/I1-flow.md))。**落点由对应 recipe + M1-M5 library 自行声明**(recipe 通过 C1-flow 一处编排,不重复声明)。这样:

- 铁律是抽象的、可读的、不会过期
- 路径真相由 C1-flow/recipe/library 各自声明,单一来源
- 增删 library 文件,不需要回头改铁律表

### C1 单一入口(视频总入口自包含)

[C1-flow.md](references/library/C1-flow.md) 是**视频唯一入口**:视频路由(§0)/路径判定(§1)/8 步流程(§2)/建模必读 M1-M5(§2.1)/写故事与骨架镜头结构(§3-§9)/输出后期(§10-§13)/质检交付(§14-§16)全部自包含,不反向引用 SKILL 章节。recipe 只需要挂 C1-flow,不需要逐个声明 M1-M5 与创意原则——它们是视频流程的固定必读,由 C1-flow 一处编排,加载路径更短。

### 质量直通桥(锁在拼 prompt 时自动焊入)

五步流程外**不设独立质检闸**:质量锁不是"记得就加"的待办,而是**决策链的必然结果**。[C2-quality.md §5](references/library/C2-quality.md) 提供推导表——路径/镜数/字幕/风格/骨架既定 → 自动决定焊哪些锁(主体锁/跨段锁/关键帧锁/常理锁/稳定锁/负面约束)到 prompt 对应位置。其中**关键帧锁**在分镜阶段锁定连续性与关键姿态:首尾帧由跨段锁(i2v/末帧)保持不变,中间关键姿态帧用详细文字描述焊进 prompt。C2 管"质量有哪些维度、怎么验证"(弹药库),C2 §5 管"这次带哪几把锁"(装填),职责各归一处。

### 字幕/配音后期为主(烧录 + TTS 混入)

字幕/配音默认走后期,为确定性(零错字、音画同步)而后期:
- **后期(默认)**:字幕文案进 SRT 源成片后烧录(`post.cjs burn`);口播文案进 TTS 源合成混入(`post.cjs tts+mux`)
- **直出(特殊)**:仅需求显式要求"AI 直接渲染文字/音画直出"或本机缺 ffmpeg/edge-tts 时,才写进 prompt 直出

质检打回原因按 [C2 §7.5](references/library/C2-quality.md) 回写对应层修锁,形成"建 → 拼 → 验 → 修"闭环;同类原因第二次出现 = 规则缺口,不是运气。

### 交互决策(失败如实呈现 + 可执行引导)

结果不达标时如实报告失败原因 + 给一条可执行修复路径,不静默重试、不伪造成片:生成任务失败报 Provider 原文+任务 id,客观参数不符报实测 vs 目标,主体漂移回 [C2-quality §5](references/library/C2-quality.md) 补锁,字幕/配音翻车按后期为主决策降级,能力缺口(缺 ffmpeg/edge-tts)报告最小前置。

---

## 公共 API

`core/orchestrator.cjs` 导出可复用的工作流函数：

| 函数                              | 职责                                               |
| --------------------------------- | -------------------------------------------------- |
| `listCapabilities(manifest)`      | 不检查凭证，返回已启用注册项与能力                 |
| `generateMedia(request, context)` | 为新工作执行选择、创建、等待与保存                 |
| `createMedia(request, context)`   | 校验并只提交一个新任务，不等待                     |
| `statusMedia(request, context)`   | 在其固定 Provider 上查询一个既有任务               |
| `waitMedia(request, context)`     | 在本地截止时间内轮询一个固定任务，并保存成功的产物 |

`core/post.cjs` 导出质检与后期函数：`probe` / `burn` / `tts` / `mux` / `verify` / `runtimeCapabilities`。

它们精确的请求与结果形状定义在 [core/provider-contract.md](core/provider-contract.md)。

## 视频交付物

一次成功的视频工作流会产出两个同名（相同 basename）的相邻文件：

```text
<name>.mp4
<name>.video-brief.md
```

`.video-brief.md` 伴生文档是 Skill 创意层（Step 3）产出的创意文档：包含 brief、分镜表、最终与负向提示词。交付后追加 `Generation` 节，记录 Provider、模型、固定任务 ID、生效参数与警告，不包含密钥或原始外部响应。Skill 拥有伴生文档，因为 brief 收集与分镜属于创意规划关注点；core 只拥有媒体产物。

恢复的任务复用其原始规划数据。当规划数据不可用时，伴生文档将相关节标记为不可用，而不是重建未经证实的事实。伴生文档写入失败永远不会触发新的生成请求。

## 免费额度 Provider 候选

免费额度是商业条款，不是路由数据。它们因账户、区域、模型与日期而异，因此只有在确认当前 API 条款、并以其权威响应作为额度决策依据后，才注册 Provider。

| Provider                         | 适配能力                           | 免费额度现状                                     | 注册决策                                                  |
| -------------------------------- | ---------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| Agnes                            | 图片与视频                         | 已配置的现有 Provider；仅使用其返回的额度信息    | 保持注册，固定优先级                                      |
| Hugging Face Inference Providers | 主要为图片；视频取决于所选路由模型 | 小额账户额度与 Provider 可用性可能变化           | 在验证当前条款与模型支持后，作为下一个面向 API 的图片候选 |
| Cloudflare Workers AI            | 主要为图片与图像处理模型           | 包含受账户套餐约束的有限免费分配                 | 已有 Workers 账户时可作为图片工作负载的候选               |
| Google AI Studio / Gemini API    | 所选模型提供免费层时的图片生成     | 按模型提供免费层；不要假设视频访问免费           | 仅在确认具体模型与区域资格后作为图片候选                  |
| fal.ai 或 Replicate              | 图片与视频模型                     | 可能提供试用或促销额度，但不是稳定的免费额度契约 | 仅当目标账户已验证额度且有合适模型时添加                  |
| Pollinations                     | 主要为图片                         | 可能有公共访问，但容量、条款与生产保障可能变化   | 仅在条款评审后作为显式选择的、非关键的图片 Provider       |

有免费额度但无稳定文档化 API 契约的浏览器产品不应进入 manifest。特别是 Kling、Pika、Runway、Luma 等产品，在将其视为 Provider 前，需单独核实官方 API 可用性。

## 最终报告数据

Skill 的最终结论报告有证据支撑的生成与产物信息，而不仅是本地路径：

- 生成信息：Provider、能力、规范化状态、固定任务 ID、所选或返回的模型、生效参数、警告与耗时。
- 每个图片/视频产物：绝对路径、媒体类型、检测到的格式或 MIME 类型、字节大小，以及可用的尺寸。
- 视频专属字段：可用的时长、宽高比与帧率。

未知值保持 `unknown` 或被省略；Skill 不得从文件名、默认值或不完整的 Provider 响应中推断这些值。

## 路由规则

- `providers/manifest.cjs` 是唯一的 Provider 注册表。
- 每个启用的 Provider 有一个所有能力共享的唯一整数优先级。
- 数值越小越先执行；manifest 数组顺序没有路由含义。
- 新工作可使用优先级路由。既有工作始终固定在其原始 Provider 与不透明任务 ID 上。
- 只有在拒绝是权威的且 `accepted: false` 时，`create()` 之后才允许回退。
- 未知接受状态、已创建的任务、轮询错误与产物错误会阻止切换 Provider。
- 除非 Provider 返回权威信息，否则额度始终视为未知。不存在投机性的额度抽象。

## 添加 Provider

1. 创建 `providers/<id>/provider.cjs`，并在 `providers/<id>/api.md` 中随附其已验证的 API 说明。
2. 当 Provider 能返回异步工作时，实现 `isConfigured`、`supports`、`create` 与 `status`。
3. 在 `providers/manifest.cjs` 中注册一次，使用唯一 ID、唯一启用优先级与受支持的能力。
4. 不要将模型、格式、尺寸、凭证与端点的细节放入 manifest。
5. 在错误跨入 core 之前，规范化所有响应并脱敏 Provider 持有的凭证。
6. 添加契约、路由、任务身份、回退、响应映射与凭证边界的测试。

不要新增自动发现、Provider 基类、按能力区分的优先级，或 Provider 专属工作流。只有在至少两个真实 Provider 需要相同稳定行为后，才添加共享的 core 行为。

## 开发

测试通过 `core/orchestrator.cjs` 和 `core/contract.cjs` 等内部模块实现。测试不得发起真实生成请求或消耗 Provider 额度。Provider 与产物行为应使用注入的传输层与临时输出目录。