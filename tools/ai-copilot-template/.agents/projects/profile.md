# Project Profile

> 本文件描述当前项目的结构化事实和编码约定。复制模板到项目后，必须优先填写本文件。

## 项目身份

- 项目名称：`<PROJECT_NAME>`，例如：`order-center-web`
- 业务领域：`<BUSINESS_DOMAIN>`，例如：`订单管理 / 设备运维 / 数据分析`
- 主要用户：`<PRIMARY_USERS>`，例如：`运营人员、管理员、终端用户`
- 主要应用 / 模块：
  - `<APP_OR_MODULE_1>`：
  - `<APP_OR_MODULE_2>`：
- 运行 / 部署模型：`<RUNTIME_OR_DEPLOYMENT_MODEL>`，例如：`单体前端应用 / 多应用 monorepo / 后端服务`

## 技术栈

- 主要语言：`<LANGUAGE>`，例如：`TypeScript 5.x`
- 前端 / 后端框架：`<FRAMEWORK>`，例如：`React 18 + UmiJS 4`
- UI / 组件库：`<UI_LIBRARY>`，例如：`Ant Design 5`
- 状态管理 / 数据获取：`<STATE_OR_DATA_FETCHING>`，例如：`useModel + request`
- 构建工具：`<BUILD_TOOL>`，例如：`Umi / Vite / Webpack`
- 包管理器：`<PACKAGE_MANAGER>`，例如：`pnpm`
- 测试框架：`<TEST_FRAMEWORK>`，例如：`Vitest / Jest / Playwright`
- 代码格式化 / Lint：`<FORMAT_AND_LINT_TOOLS>`，例如：`Prettier + ESLint`

## 仓库结构

- 源码根目录：`<SOURCE_ROOTS>`，例如：`apps/*/src`
- 应用入口：`<APP_ENTRY>`，例如：`src/app.tsx`
- 页面 / 路由约定：`<ROUTE_OR_PAGE_CONVENTION>`，例如：`src/pages/**/index.tsx`
- 共享组件目录：`<SHARED_COMPONENTS>`，例如：`src/components`
- API / 外部请求目录：`<API_CLIENTS>`，例如：`src/services`
- 类型定义目录：`<TYPE_DEFINITIONS>`，例如：`src/typings.d.ts`
- 自动生成目录：`<GENERATED_PATHS>`，例如：`src/.umi`
- 禁止手工修改目录：`<DO_NOT_EDIT_PATHS>`，例如：`dist、coverage、generated、.umi`

### 稳定目录地图

只记录能帮助定位代码和判断边界的稳定目录，不复制完整文件树。标出主要目录的职责、重要入口，以及它属于应用、共享包、测试、构建配置还是生成物。

| 路径 | 职责 | 关键入口/边界 |
| --- | --- | --- |
| `<STABLE_PATH>` | `<RESPONSIBILITY>` | `<ENTRY_OR_BOUNDARY>` |

目录较少时，可以直接在上方结构字段补充；避免维护很快过期的逐文件清单。

## 编码约定

- 命名规则：`<NAMING_CONVENTIONS>`
- 组件 / 模块组织：`<COMPONENT_OR_MODULE_STRUCTURE>`
- 请求与数据流：`<REQUEST_AND_DATA_FLOW>`
- 错误处理：`<ERROR_HANDLING>`
- 样式规则：`<STYLING_RULES>`
- 注释规则：`<COMMENT_RULES>`
- Import / 路径规则：`<IMPORT_RULES>`

## 常用命令

- 安装依赖：`<INSTALL_COMMAND>`，例如：`pnpm install`
- 本地启动：`<DEV_COMMAND>`，例如：`pnpm dev`
- 格式化检查：`<FORMAT_COMMAND>`，例如：`pnpm prettier --check <files>`
- Lint：`<LINT_COMMAND>`，例如：`pnpm lint`
- 类型检查：`<TYPECHECK_COMMAND>`，例如：`pnpm tsc --noEmit`
- 单元测试：`<TEST_COMMAND>`，例如：`pnpm test`
- 构建：`<BUILD_COMMAND>`，例如：`pnpm build`

## 风险边界

- 权限 / 鉴权相关区域：`<AUTH_AREAS>`，例如：`auth、permission、role、menu`
- 数据一致性敏感区域：`<DATA_CONSISTENCY_AREAS>`，例如：`金额、库存、审批状态、任务状态`
- 对外接口 / 第三方依赖：`<EXTERNAL_INTEGRATIONS>`，例如：`支付、消息、SSO、外部 OpenAPI`
- 生产 / 发布敏感文件：`<DEPLOYMENT_SENSITIVE_FILES>`，例如：`Dockerfile、CI 配置、部署脚本`
- 高风险业务状态：`<HIGH_RISK_DOMAIN_STATES>`，例如：`已提交、已审批、已发布、已支付`

## 推荐参考

- 推荐参考页面 / 模块：`<PREFERRED_REFERENCES>`
- 推荐实现范式：`<PREFERRED_PATTERNS>`
- 不推荐参考或反例：`<ANTI_EXAMPLES>`
