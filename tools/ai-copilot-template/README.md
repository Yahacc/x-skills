# 团队级 AI Copilot 模板

本目录提供一套可复制到不同项目的轻量 AI Copilot 协作模板。

目标不是创建一个复杂平台，而是让每个项目在较低成本下具备稳定的 AI 协作入口、项目上下文、工程规则、验证纪律和基础评审能力。

## 适用场景

- 新项目需要快速建立 AI 协作规则。
- 老项目需要补齐 AI 可读的项目画像、架构上下文和验证口径。
- 团队希望统一 AI 编码、评审、需求审查和风险阻断方式。

## 复制方式

将本目录下的文件复制到目标项目根目录：

```text
AGENTS.md
.agents/
```

## 10 分钟初始化清单

复制后，先完成以下最小初始化：

1. 在 `.agents/projects/profile.md` 填写项目名、技术栈、稳定目录地图、常用命令和禁改目录。
2. 在 `.agents/projects/overview.md` 填写产品定位、用户工作流、模块边界、架构关系和关键数据流。
3. 在 `.agents/projects/notes.md` 填写至少一个历史坑、禁改区或已知基线问题；没有则明确写“暂无”。
4. 在 `.agents/validation.md` 填写项目验证矩阵、测试位置和已知基线问题。
5. 复制 `.agents/template.lock.example.json` 为 `.agents/template.lock.json`，记录模板版本和本地改动说明。
6. 检查 `.agents/mcp/README.md`，确认 MCP/tool 配置由项目用户自行维护。
7. 若个人环境已安装 `component-engineering` skill，组件任务可由它路由到场景提示词；项目目录和产品架构仍只记录在本项目的 `.agents/projects/` 文档中。

复制后，优先填写或调整：

1. `.agents/index.md`：确认按需加载路由是否符合项目需要。
2. `.agents/projects/profile.md`：填写项目事实、技术栈、目录、命令和编码约定。
3. `.agents/projects/overview.md`：填写业务背景、模块边界、架构关系和核心数据流。
4. `.agents/projects/notes.md`：填写历史坑、禁改区、已知基线问题和推荐参考。
5. `.agents/validation.md`：填写项目验证矩阵、测试位置和已知基线问题。

## 分类原则

- 共用规则：跨项目稳定复用，例如工程原则、协作流程、风险分级、验证纪律。
- 项目独有事实：每个项目必须填写，例如技术栈、目录结构、命令、模块边界。
- 项目独有沉淀：持续维护，例如历史坑、禁改区、基线失败、推荐参考实现。

## 文件等级

- 必需文件：`AGENTS.md`、`.agents/index.md`、`.agents/projects/profile.md`、`.agents/projects/overview.md`、`.agents/projects/notes.md`、`.agents/core.md`、`.agents/validation.md`。
- 推荐文件：`.agents/skills/*`、`.agents/mcp/README.md`。
- 治理文件：`.agents/manifest.json`、`.agents/template.lock.example.json`。

## 维护原则

- `AGENTS.md` 保持薄入口，不承载长篇项目细节。
- `.agents/index.md` 负责上下文路由，避免 AI 一次性加载全部文件。
- `.agents/` 是 AI 协作资产目录，不作为临时文档删除。
- `.agents/manifest.json` 描述模板必需文件和必填占位符，用于后续审计。
- `.agents/template.lock.json` 应由项目实例化后生成，用于记录模板来源和本地改动。
- 项目事实优先写入 `.agents/projects/profile.md`。
- 项目架构和业务上下文优先写入 `.agents/projects/overview.md`。
- 产品架构描述用户任务、系统/模块职责、依赖方向和数据流；技术栈与目录地图写入 `.agents/projects/profile.md`。
- 历史坑和注意事项优先写入 `.agents/projects/notes.md`。
- MCP/tool 配置按项目用户填写内容维护，模板不强制环境变量写法。
