# Project Overview

> 本文件描述产品和系统的职责边界，帮助 AI 理解“系统是什么、模块为何如此划分、关键工作流如何运行”。具体目录和技术命令记录在 `profile.md`。

## 产品定位

- 解决的问题：`<PRODUCT_PROBLEM>`
- 主要用户 / 调用方：`<USERS_OR_CONSUMERS>`
- 在更大业务流程中的位置：`<PRODUCT_ROLE>`

## 产品能力与关键工作流

| 能力 / 用户任务 | 用户或上游输入 | 主要结果 | 所属模块 |
| --- | --- | --- | --- |
| `<CAPABILITY>` | `<INPUT>` | `<OUTCOME>` | `<MODULE>` |

## 系统与模块边界

| 应用 / 服务 / 模块 | 职责 | 明确不负责 | 主要依赖 / 消费方 |
| --- | --- | --- | --- |
| `<MODULE_NAME>` | `<RESPONSIBILITY>` | `<OUT_OF_SCOPE>` | `<DEPENDENCIES>` |

说明关键系统的所有权和依赖方向。标明公共 API、扩展点、运行宿主或外部系统边界；不要只列包名而不解释职责。

## 架构与数据流

描述重要组件/服务如何协作，以及关键数据、请求、事件和状态如何流动。区分同步调用、异步事件和持久化边界。仅在图能降低理解成本时加入 Mermaid 图，并确保与仓库实现一致。

`<CORE_ARCHITECTURE_AND_FLOWS>`

## 核心领域概念与状态

| 概念 / 状态 | 含义 | 关键约束或迁移条件 |
| --- | --- | --- |
| `<DOMAIN_TERM>` | `<MEANING>` | `<CONSTRAINTS>` |

补充关键生命周期、任务流、审批流或不可乱序的操作；无相关状态时写“暂无”。

## 架构约束与演进边界

- `<DEPENDENCY_OR_API_CONSTRAINT>`
- `<RUNTIME_OR_COMPATIBILITY_CONSTRAINT>`
- `<SECURITY_OR_DATA_BOUNDARY>`

## 高频变更区域

- `<HOTSPOT>`：`<常见变化及影响范围>`

## 非目标

- `<本系统明确不负责的能力>`
- `<容易误认为属于本系统、实际由其他系统负责的能力>`
