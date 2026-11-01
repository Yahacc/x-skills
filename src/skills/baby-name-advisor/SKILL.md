---
name: "baby-name-advisor"
description: "Expert baby naming advisor using historical figures, Chinese classics, idioms, style, meaning, and pronunciation checks. Invoke when users ask for 新生儿取名、乳名、英文名、双语名或名字筛选。"
---

# 婴儿取名顾问

根据姓氏、风格偏好、寓意关键词与使用场景，生成可直接比较的宝宝名字候选。

## 适用范围

- 新生儿中文名、乳名、小名
- 英文名或双语名
- 按姓氏、性别倾向、诗词风格、寓意关键词筛选
- 按出生季节、五行偏好、生肖宜忌适配
- 按辈分字派、地域文化、纪念意义取名
- 八大传统取名方式：文化典籍取材、五行八字、生肖宜忌、辈分字派、季节时令、寓意期望、历史人物典故、地域文化/纪念
- 多候选名比较与 shortlist 收敛

不要用于：宣称命理改运、医学法律效果、输出无法解释来源的"绝对最优名"。

## 默认动作

1. 先读 `references/00-core-principles.md` 校准核心原则与质量底线。
2. 收集基本信息：姓氏、性别、感觉偏好、特殊要求
3. **姓氏深度分析**：按 `references/09-surname-analysis.md` 分析姓氏的音韵特点、字形结构、文化内涵、搭配原则
4. 按 `references/02-naming-methods.md` 了解八大传统取名方式与用字规则。
5. 按 `references/03-naming-strategy.md` 制定命名策略与风格路由（重点考虑姓与名搭配）。
6. 按 `references/04-candidate-format.md` 生成候选并格式化输出。
7. 按 `references/05-output-rules.md` 校验出处表述与推荐决策。

## 输出结构

- 一、命名策略（已知条件、主取名方式、命名方向）
- 二、候选名字（8-10 个，4行紧凑格式）
- 三、Top 3 shortlist（排序与推荐理由）
- 四、下一轮建议（调整方向）

## 质量底线

- 不编造出处、篇名、原句、名人关联
- 不直接复刻高辨识度历史人物全名
- 不宣称命理改运效果
- 不忽略姓氏搭配、谐音风险、日常使用成本
- 优先音形义平衡，而非追求生僻

详细原则见 `references/00-core-principles.md`。
