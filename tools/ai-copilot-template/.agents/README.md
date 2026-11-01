# .agents

`.agents/` 是项目级 AI 协作资产目录，用于帮助 AI 正确理解、修改、评审和验证当前项目。

本目录不是临时文档目录，不应在整理文档、清理工程或迁移目录时被误删。

## 文件分类

- `manifest.json`：模板文件清单、版本、必填占位符和基础审计规则。
- `template.lock.example.json`：项目实例化后的模板来源记录示例。
- `index.md`：轻量上下文索引，说明不同任务应按需读取哪些文件。
- `projects/profile.md`：项目独有的结构化事实和约定摘要。
- `projects/overview.md`：项目产品架构、模块边界、产品流程和关键数据流。
- `projects/notes.md`：项目独有的历史坑、注意点、禁改区和基线问题。
- `core.md`：跨项目可复用的通用工程底线。
- `validation.md`：验证原则、验证矩阵、测试位置和验收说明。
- `skills/`：可执行的 AI 能力。
- `mcp/`：外部工具和 MCP 接入说明，不存放真实密钥。

可复用的个人 Skill（例如组件工程场景路由）存放在个人 Skill 库；这里的 `.agents/skills/` 只放项目自身需要、且复制仓库后仍可独立工作的能力。两类 Skill 协作时，Skill 提供方法，项目文档提供事实。

## 维护要求

- AI 默认应先读 `AGENTS.md` 和 `index.md`，再按任务路由读取具体文件。
- 新项目接入时，应复制 `template.lock.example.json` 为 `template.lock.json` 并填写模板来源。
- 项目事实变化时，优先更新 `projects/profile.md`。
- 业务边界或架构变化时，优先更新 `projects/overview.md`。
- 目录职责、关键入口或开发命令变化时，优先更新 `projects/profile.md`。
- 发现 AI 或人类反复踩坑时，沉淀到 `projects/notes.md`。
- 通用规则变化时，评估是否应同步回团队模板。
