# AI Context Index

> 本文件是 `.agents/` 的轻量索引。AI 默认只读 `AGENTS.md` 和本文件，再按任务类型加载必要上下文，避免一次性读取全部文件。

## 目录职责

| 文件 | 作用 | 何时读取 |
| --- | --- | --- |
| `manifest.json` | 模板版本、必需文件、推荐文件、必填占位符 | 初始化、审计或升级模板时 |
| `template.lock.json` | 项目侧模板来源和本地改动记录 | 判断模板版本、升级影响或项目适配历史时 |
| `projects/profile.md` | 项目画像、技术栈、目录结构、命令、编码约定摘要 | 需要理解项目结构、命令、技术栈、路径、命名、样式时 |
| `projects/overview.md` | 业务背景、模块边界、架构关系、核心数据流 | 需要理解业务语义、模块职责、数据流、状态流转时 |
| `projects/notes.md` | 历史坑、禁改区、基线问题、推荐参考、AI 协作复盘 | 需要规避特殊坑、处理验证失败、选择参考实现时 |
| `core.md` | 通用工程原则、复杂性判断、行为红线、高风险动作 | 需要做设计判断、风险判断、阻断或高风险操作时 |
| `validation.md` | 验证原则、验证矩阵、测试位置、验收说明 | 实施前确认验证方式或完成前汇报验证结果时 |
| `skills/requirement-review/SKILL.md` | 需求审查、风险分级、前提校验、阻断错误目标 | 需求不清、目标可能错误、风险不可控、需要方案判断时 |
| `skills/code-review/SKILL.md` | 代码审查、严重度、findings 输出、验证缺口识别 | 用户要求 review、检查 diff、评审 PR/MR 或确认实现质量时 |
| `mcp/README.md` | MCP / 外部工具接入说明 | 需要配置或审查外部工具接入时 |

个人复用的 `component-engineering` skill（若当前环境已安装）负责组件工程场景路由和方法；本索引与 `projects/profile.md`、`projects/overview.md` 负责当前仓库事实。Skill 不替代项目文档。

## 默认加载规则

### 简单问答

只读：

1. `AGENTS.md`
2. `.agents/index.md`

适用：解释项目规则、回答模板结构、讨论协作方式。

### 模板初始化或升级

按需读：

1. `manifest.json`
2. `template.lock.json` 或 `template.lock.example.json`
3. `projects/profile.md`
4. `projects/overview.md`
5. `projects/notes.md`

### 局部代码修改

按需读：

1. `projects/profile.md`
2. `validation.md`
3. 与目标文件直接相关的源码上下文

如果涉及历史坑、禁改区或推荐参考，再读 `projects/notes.md`。

### 组件新增、改造或简化

按需读取：

1. 若 `component-engineering` skill 可用，选择与任务对应的一份场景提示词，不加载所有场景。
2. `projects/profile.md`，确认代码目录、入口和项目约定。
3. `projects/overview.md`，确认组件所属产品模块和依赖边界。
4. `validation.md`，确定测试落点和验证命令。

如果没有可用的个人 skill，直接按本索引和项目事实完成任务，不因缺少 skill 阻断。

### 需求审查或方案判断

按需读：

1. `skills/requirement-review/SKILL.md`
2. `core.md`

如果判断依赖业务边界，再读 `projects/overview.md`。

### 代码审查

按需读：

1. `skills/code-review/SKILL.md`
2. `projects/profile.md`
3. `projects/notes.md`
4. `validation.md`

再读取变更 diff 和直接相关代码。

### 架构、模块边界或数据流问题

按需读：

1. `projects/overview.md`
2. `projects/profile.md`
3. `core.md`

需要记录或修订目录结构和产品架构时：目录地图写入 `projects/profile.md`；产品目标、模块边界和关键数据流写入 `projects/overview.md`。避免把这些项目事实复制进通用 Skill。

### 验证、测试或完成确认

按需读：

1. `validation.md`
2. `projects/profile.md`
3. `projects/notes.md`

## 禁止做法

- 不要因为 `.agents/` 存在就一次性读取全部文件。
- 不要把项目事实写进 `AGENTS.md` 或通用 rules。
- 不要把长期增长的历史坑写进 `projects/profile.md`。
- MCP/tool 配置按项目用户填写内容维护，AI 不主动改写 `env` 字段。
- 不要删除 `.agents/` 或本索引文件，除非用户明确要求治理 AI 协作资产。
