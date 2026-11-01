# M3. cinematography · 镜头语言建模 schema(景别/机位/运镜/构图)

> 摄影指导的职责:把"拍什么"落成"怎么拍"。C1-flow §5 管"镜头结构怎么写(1:1 镜号/时间锚点)"，本文件管"每个镜头用什么镜头语言"——C1-flow §6 分镜表的"景别/视角"与"运镜"两列,本文件是这两列的取值词典。

---

## §0 三条镜头铁律(先读)

| # | 铁律 | 含义 |
| --- | --- | --- |
| **L1** | **单段 ≤2 个组合运镜** | 超过 2 个模型会"运动不接戏"；多运镜用连接词分开 |
| **L2** | **治愈/温情/广告禁用手持** | 治愈系/广告 = 平滑稳定；手持抖动只在动作/纪实用 |
| **L3** | **数字分级写 prompt** | 技术参数(焦段/色温 K/角度)→ 仅展示层，执行层语义化；**剧情爆点数字(金额/名称/年龄)→ 必须写进 prompt**(模型需直出) |

---

## §1 单镜镜头语言建模 schema(核心表)

> **每镜选一组**，各维度取值见下文词典(§2-§6)。`变体轴` = 该镜可按需换的取值。

| 维度 | 必填 | 变体轴(取值见词典) | 示例 | 反例 |
| --- | --- | --- | --- | --- |
| **景别** | 必填 | 5 级(见 §2) | `close-up` | 骨架 A 全用远景(节奏错) |
| **机位** | 必填 | 8 向(见 §3) | `three-quarter angle` | 仰角 >30° 变形 |
| **运镜** | 必填(≤2 组合) | 8 种(见 §4) | `slow dolly-in` | 治愈系用手持(L2) |
| **焦段/景深** | 可选 | 广角/标准/长焦/微距(见 §5) | `85mm with shallow depth of field` | 人像用广角(脸变形) |
| **构图** | 可选 | 5 法(见 §6) | `rule of thirds` | 公文包式居中(无信息) |

> **组装规则**:`★ 镜头组` 段按分镜镜号 1:1 展开，每镜一个时间锚点(见 [C1-flow.md §5](C1-flow.md))。

---

## §2 景别 5 级(往主体多近)

| 景别 | 取景 | prompt 写法 | AI 视频适用 |
| --- | --- | --- | --- |
| 远景(Wide) | 全身+大量环境 | `wide shot` / `establishing wide` | 氛围开场、揭示环境、收尾全景 |
| 全景(Full) | 全身，环境为背景 | `full shot` | 人物登场、形体展示 |
| 中景(Medium) | 膝盖以上/腰部以上 | `medium shot` | 对话、动作主体、产品使用 |
| 近景(Close) | 胸部以上 | `close-up` / `medium close-up` | 表情、情绪、产品细节 |
| 特写(Extreme close-up) | 局部填满画面 | `macro` / `extreme close-up` | 眼睛/手/材质/纹理，专注点 |

> **节奏口诀**:骨架 A(快)用 近景↔特写 快速切换；骨架 B(慢)用 远景↔中景 缓慢推进。

---

## §3 机位 8 向(从哪个角度拍)

| 机位 | prompt 写法 | 效果 | 注意 |
| --- | --- | --- | --- |
| 正面 | `frontal` | 直面观众、代入 | 慎用，易呆板 |
| 45° 侧 | `three-quarter angle` | 立体、自然 | 人像万金油 |
| 正侧 | `side profile` | 轮廓、剪影 | 突出侧颜/线条 |
| 后侧 | `three-quarter back` | 神秘、引导视线 | 转身/离场 |
| 背面 | `from behind` | 悬念、带入 | 开场转身常用 |
| 俯拍 | `overhead` / `top-down` | 食物/桌面/构图感 | 食物、ASMR、产品俯视 |
| 仰拍 | `low-angle hero shot` | 高大、威猛、气势 | 仰角 >30° 易变形 |
| 过肩 | `over-the-shoulder (OTS)` | 对话关系、对话感 | 多角色对峙 |

---

## §4 运镜 8 种(镜头怎么动)

| # | 运镜 | prompt 写法 | 适用 | 警告 |
| --- | --- | --- | --- | --- |
| 1 | 推 | `push in to close-up` / `slow dolly-in` | 聚焦细节、情绪递进 | 速度过快=跳变 |
| 2 | 拉 | `pull out to wide` / `slow dolly-out` | 揭示环境、收尾 | 与推同段速度要一致 |
| 3 | 横移 | `lateral tracking` | 人物登场、跟拍 | 幅度大=易跳 |
| 4 | 环绕 | `orbit around` / `slowly orbiting to face` | 人物登场、产品展示 | 限 45-90° 弧 |
| 5 | 升降 | `crane up` / `crane down` | 宏大开场、揭示 | 太快=玩具感 |
| 6 | 手持 | `handheld, slight shake` | 动作追逐、街头纪实 | **治愈系禁用** |
| 7 | 主观 POV | `first-person POV` | 代入感 | 慎用，易动晕 |
| 8 | 推拉结合 | `push in, then pull out` | 先聚焦后揭示 | 速度不一致=割裂 |

> **高级电影术语**(偶尔锦上添花):`dolly zoom`(希区柯克变焦·心理冲击)、`match cut`(匹配剪辑·转场)、`slow motion`(升格·仪式感)、`Dutch angle`(荷兰角·不安)。

---

## §5 焦段与景深(光学气质)

| 焦段 | 效果 | prompt 写法 | 适用 |
| --- | --- | --- | --- |
| 广角(~16-24mm) | 透视夸张、空间感强 | `ultra-wide angle` | 宏大环境、城市、空间 |
| 标准(~35-50mm) | 自然、贴近人眼 | `35mm` | 生活流、中景叙事 |
| 长焦(~85-135mm) | 压缩空间、浅景深 | `85mm with shallow depth of field` | 人像、特写、杂志感 |
| 微距 | 1:1 细节 | `macro, 1:1 close-up` | 材质、纹理、食物细节 |

> **景深控制**:浅景深(`shallow depth of field`)放大主体、虚化背景；深景深(`deep focus`)前后景都清晰，适合环境展示。人像/产品默认浅，环境/氛围可深。

---

## §6 构图 5 法(画面怎么摆)

| 构图 | prompt 写法 | 效果 | 注意 |
| --- | --- | --- | --- |
| 三分法 | `rule of thirds` | 平衡、自然 | 主体放交点 |
| 对称 | `symmetric composition` | 仪式、稳定 | 建筑/仪式感 |
| 引导线 | `leading lines` | 纵深、指向主体 | 道路/铁轨/光束 |
| 框景 | `framing through window/door` | 窥视、层次 | 框不能抢主体 |
| 负空间 | `negative space` | 留白、高级感 | 治愈/极简多用 |

---

## §7 镜头选择决策表

| 场景意图 | 首选 | 次选 | 禁用 |
| --- | --- | --- | --- |
| 人物登场亮相 | 低角度仰拍 | 跟拍+环绕 | 手持抖动 |
| 自然/治愈 | 横移跟拍 + 缓推 | 推拉结合 | 手持抖动 |
| 产品展示 | 环绕小角度 | 固定+微推 | 推拉快速 |
| 食物/ASMR | 俯拍 + 微距 | 固定+微推 | 运镜 >1 个组合 |
| 城市夜景 | 横移+霓虹 | 低角度仰拍 | 慢动作 |
| 时尚人像 | 缓推/横移 + 长焦浅景深 | 固定特写 | 俯拍 |
| 访谈/口播 | 固定 + 过肩 | 正面近景 | 环绕 |

---

## §8 高频镜头组合(Q3 风格一致)

> 从 5 个 example 的 `★ 镜头组` 段提炼的真实用法，可直接照抄结构，保证全片运镜风格统一。

| 用法 | 出现于 | 写法(示例) |
| --- | --- | --- |
| 缓推聚焦 | 咖啡/人像/食物 | `slow dolly-in from medium to medium-close` |
| 固定微距 | 咖啡/人像 | `static macro close-up on the cup rim / eyes` |
| 俯拍特写 | 咖啡 | `static overhead close-up` |
| 横移跟拍 | 人像/氛围 | `lateral tracking right-to-left, slow motion` |
| 缓拉收尾 | 咖啡/人像 | `slow pull-out from medium-close to medium` 或 `wide shot` |
| 固定+跟焦 | 咖啡 | `static medium shot, gentle rack focus between hands and steam` |
| 末镜定场 | 咖啡 | `static wide shot`(揭示全环境收尾) |

> **高频组合套路**:① 开场 缓推/定场 → ② 中段 固定特写/微距交替 → ③ 收尾 缓拉/定场全景。治愈系全程 `No whip pans, no shaky-cam`。

---

## §9 写进 prompt 的规则

- **逐镜 1:1**:`★ 镜头组` 段按分镜表镜号 1:1 展开，每镜一个时间锚点(见 [C1-flow.md §5](C1-flow.md))。
- **≤2 运镜**:单段组合运镜 ≤2 个(L1)。
- **语义化**:只写 `slow dolly-in`，不写 `0.15m/s`；焦段只在开头总述用 `35mm` / `85mm`(L3)。
- **多运镜用连接词**:`slowly tracking, then orbiting to face`。
- **收尾禁运镜**:末镜常 `static wide shot` 定场，给情绪余韵。

---

→ 视频路由与编号索引见 [C1-flow.md](C1-flow.md)