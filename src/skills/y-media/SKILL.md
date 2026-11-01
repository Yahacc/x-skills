---
name: y-media
description: 生成或编辑图片、生成视频、使用 Agnes AI 或其他已注册媒体 Provider、消耗 Provider 免费配额、查询或恢复已有媒体任务、下载已生成媒体时使用。不适用于:纯文字 brief 无媒体产物 / 离线模型训练或微调场景。
---

# y-media · 媒体工作流

视频走 [C1-flow.md](references/library/C1-flow.md)(视频唯一入口);图片走 [I1-flow.md](references/image/I1-flow.md)(图片唯一入口)。

> **加载规则**:每个 brief 只读路由命中的 1 个 recipe + 共享 library。未命中不读。质量杠杆全在 prompt,不在流程。

---

## §0 路由(第一屏)

- **视频**:打开 [C1-flow.md](references/library/C1-flow.md) —— 视频唯一入口,路由表/铁律 R1-R7/路径判定/8 步流程/建模必读(M1-M5)/质检/交付全部自包含在本文件,不反向引用本 SKILL。
- **图片**:命中下方关键词 → 打开 [I1-flow.md](references/image/I1-flow.md) 处理 —— 图片唯一入口,自包含路由/路径判定/规划/产出/质检/交付及图片版 R1-R5,**不读 C1-flow 视频铁律**。

| brief 关键词 | 路径 | recipe / library |
| --- | --- | --- |
| 海报/广告KV/封面/小红书/公众号/电商主图/品牌VI | 图片 | [I1](references/image/I1-flow.md) |

> **匹配失败**:图片关键词未命中 → 如实报告能力缺口 + 降级为纯 brief 直出;视频未命中 → C1-flow §0 已自动兜底(默认 nature 骨架 B)。

---

## §1 输出与交付(全局)

### 1.1 图片输出文件

`<filename>.image-brief.md`，含图片主要目标 / 提示词(创作内容) / 视觉规范表 / Final Prompt。参考 [I4](references/image/I4-image-example.md)。

### 1.2 交付硬约束(可预览 + 可下载)

每次工作流结束，**所有产出文档与最终产物必须以「可预览 + 可下载」双通道呈现**，禁止只给本地路径或纯文本描述:

| 交付物 | 可预览 | 可下载 |
| --- | --- | --- |
| 视频产物(成片) | 内联播放 `![视频描述](相对路径.mp4)` + 显式预览链接 `[预览](相对路径.mp4)` | 附文件下载链接(相对路径) `[下载](相对路径.mp4)` |
| 图片产物 | 内联嵌入 `![图片](相对路径.png)` + 显式预览链接 `[预览](相对路径.png)` | 附文件下载链接(相对路径) `[下载](相对路径.png)` |
| `<name>.video-brief.md` / `<name>.image-brief.md` | 显式预览链接 `[文档](相对路径.md)` | 附文件下载链接(相对路径) `[下载](相对路径.md)` |
| 字幕 SRT / 配音音轨(中间产物) | 显式预览链接 `[字幕/配音](相对路径.ext)` | 附文件下载链接(相对路径) `[下载](相对路径.ext)` |

> **硬约束**:交付结论中每项都同时给出**可点击的预览链接** + 可下载链接；缺任一通道即为未完成交付。**预览与下载链接一律用相对路径**(相对当前交付文档所在目录),禁止 `file://` 绝对路径或含盘符的全路径——绝对路径无法内联预览且跨环境失效。视频细分规则(质检门/失败引导)见 [C1-flow.md §14-§16](references/library/C1-flow.md)。

---

## §2 图片 reference 体系

只读 I1-I4。

| 编号 | 文件 | 何时读 |
| --- | --- | --- |
| I1 | [I1-flow.md](references/image/I1-flow.md) | 图片总入口(路由+判定+规划+产出+质检+交付) |
| I2 | [I2-quality.md](references/image/I2-quality.md) | 图片质量(颗粒度/反模式/系列一致性) |
| I3 | [I3-prompt.md](references/image/I3-prompt.md) | 图片 prompt 模板(图层/七维度/画幅/约束块) |
| I4 | [I4-image-example.md](references/image/I4-image-example.md) | 图片完整实例 |
