// 三省六部 · 多 Agent 编排（DSH workflow 版）
//
// 制度即 prompt：每个角色只站一个视角，产物只在角色之间按结构传递，不共享对话。
// 调用：workflow({ script: <本文件内容>, args: { task, models?, maxDepartments? } })
//   args.task           必填，要办的"旨意"
//   args.models         可选，按角色覆写模型：{ zhongshu|menxia|shangshu|吏部|户部|礼部|兵部|刑部|工部: {provider, model} }
//   args.maxDepartments 可选，派单部门上限，默认 6
//
// 注意：本文件由 workflow 运行时执行，没有文件系统与网络；不要 require/import，不要读写文件。

const input = args || {};
const task = String(input.task || '').trim();
if (!task) {
  throw new Error('缺少 args.task：把要办的"旨意"放进 args.task');
}

const models = input.models || {};
const DEPTS = ['吏部', '户部', '礼部', '兵部', '刑部', '工部'];
const DEPT_DUTY = {
  吏部: '人力与组织：要几个人、什么角色、怎么分工、多久能到位',
  户部: '财务与成本：成本结构、定价、现金流、盈亏平衡点、要花多少钱',
  礼部: '品牌与传播：命名、对外说法、内容与渠道、用户凭什么主动传播',
  兵部: '竞品与攻防：市场格局、竞品清单与差距、时间窗口、我们的打法',
  刑部: '合规与风险：资质、条款、版权字体、责任边界、哪些做法会出事',
  工部: '技术与实现：架构选型、关键技术点、工期、可维护性、技术风险',
};
// 给了合法数字就夹到 [1,6]；没给或给的不是数才用默认 6（0 不该被当成"没传"）
const rawMax = input.maxDepartments == null || input.maxDepartments === '' ? NaN : Number(input.maxDepartments);
const maxDepts = Number.isFinite(rawMax) ? Math.max(1, Math.min(6, Math.floor(rawMax))) : 6;

// 按角色取模型覆写；没有就继承默认路由
const route = (role) => {
  const m = models[role];
  return m && m.provider && m.model ? { provider: m.provider, model: m.model } : {};
};

// 默认只读：这套编排的产物是文档，不是仓库改动。
// 传 args.allowWrite === true 才允许落盘（用于"真的要交代码"的场景）。
const WRITE_RULE = input.allowWrite === true
  ? '允许为了落地而修改仓库文件：先确认路径再动手；仍禁止 git add/commit/push 与安装依赖。'
  : '只输出文本交付物，直接写在回复里。禁止改动仓库：不创建、不修改、不删除仓库内任何文件，不执行 git 写操作或装依赖。需要在临时目录里验证（跑脚本、造样本）可以，但只动系统临时目录，跑完清理，并在回复里说明验的是哪个副本。要举例的代码、配置、目录结构一律写进回复正文。';

const ROLES = {
  zhongshu: [
    '你是中书令，只做一件事：起草方案。',
    '你只从"这条路能不能走通、怎么走才有解"的角度想。资源、合规、财务不归你管，写了就是越界。',
    '起草 2–3 个方案，必须在一个能体现分歧的维度上真正不同：目标用户 / 商业模式 / 切入角度 / 风险偏好。同一路线的三个变体等于只有一个方案。',
    '每个方案写清：一句话主张、核心假设（哪个假设不成立方案就死）、执行路径、主要风险、需要什么资源。',
    '主动写出自己方案最大的软肋，不要藏——藏起来只会在门下省被撕得更难看。',
    '不写寒暄，不写"综上所述"，不替任何人做裁决。',
  ].join('\n'),
  menxia: [
    '你是门下侍中，只做一件事：驳。',
    '你不提新方案，不给"更好的做法"，只判断交上来的方案能不能放行、为什么。',
    '每个方案给一个判定：放行 / 条件放行 / 打回。',
    '打回只用于两种情况：存在会让方案直接失效的致命缺陷，或核心假设根本没被验证却被当成事实。',
    '条件放行必须写清可检验的放行条件。写"注意把控质量""建议再打磨"这种空话等于没审。',
    '重点找这几类问题：把营销假设当产品事实、自我强化的增长假设、无法证伪的乐观预期、把"我觉得好看/好用"当需求验证、定位与卖点自相矛盾。',
    '每条质疑都要指出"如果它成立会怎样"。不能为了显得严格而挑毛病。',
    '最后给 3 条以内的跨方案共性问题——这些问题比单个方案的漏洞更能说明方案没想清楚。',
  ].join('\n'),
  shangshu: [
    '你是尚书令，只做一件事：决断并派单。',
    '你依据门下省的审议做裁决，不重开辩论、不改写审议结论。旨意（用户目标）是最终依据。',
    '裁决要落到"主线方案 / 降级为备选 / 直接砍掉"，并说明为什么这样取舍。',
    '然后把主线拆成派单，只派真正需要的部门（最多 6 个）。每份派单写清：这件事的边界、要交什么、以及从审议里继承的硬约束（门下的放行条件必须原样变成约束）。',
    '派单必须能被单独执行：那个部门看不到别人的上下文，只看你这一份。',
  ].join('\n'),
  huizong: [
    '你是尚书令，把六部的交付汇总成最终 PRD。',
    '你只做整合与裁剪：合并重复、消解冲突（冲突时以门下省继承的硬约束为准）、删掉没有支撑的乐观表述。',
    '不新增六部没给过的结论。信息不足就写"未覆盖：X"，不要编。',
    '结构固定：一、产品定义（是什么、给谁、凭什么）二、战略路径 三、执行计划（按部门）四、硬约束与合规 五、财务要点 六、里程碑 七、未覆盖与待决。',
    '篇幅 ≤ 1800 字，密度优先，不要复述各部门原文。',
  ].join('\n'),
};

const draftPrompt = (priorReview) => {
  const prior = priorReview
    ? `\n\n【上一轮门下省的驳回意见，必须逐条处理，不要改头换面重交】\n${JSON.stringify(priorReview, null, 2)}`
    : '';
  return `${ROLES.zhongshu}

【旨意】
${task}${prior}

【交付格式】
Markdown，每个方案一节，标题用"方案一：<名字>"。每节 ≤ 200 字，字段用短句，不要长段落。
${WRITE_RULE}`;
};

const reviewPrompt = (drafts) => `${ROLES.menxia}

【旨意】
${task}

【待审草案】
${drafts}

按 schema 输出：verdicts 每个方案一条，plan 填方案名，fatal_flaw 没有致命缺陷就填空字符串，conditions 填放行条件（放行时可为空数组）；cross_questions 是最多 3 条跨方案共性问题。`;

const decisionPrompt = (drafts, review) => `${ROLES.shangshu}

【旨意】
${task}

【中书省草案】
${drafts}

【门下省审议】
${JSON.stringify(review, null, 2)}

按 schema 输出：main_plan 填选定的方案名；dropped 是被砍或降级的方案名；rationale 写清取舍理由（≤ 150 字）；assignments 是派单数组，dept 只能是 ${DEPTS.join('/')}，brief 是这件事要解决什么（≤ 120 字，含边界与硬约束），deliverable 是要交的东西（具体到结构）。`;

const deptPrompt = (a) => {
  const duty = DEPT_DUTY[a.dept] || '';
  return `你是${a.dept}，只交你这一摊的交付物，别的部门的事不碰。

你的职责：${duty}。

【旨意】
${task}

【尚书省派单给你的任务】
${a.brief}

【要交的东西】
${a.deliverable}

【规矩】
- 守住职责边界。发现跨部门的坑，只在最后一行写"跨部门提示：…"，不要自己解决。
- 结论先行，必须落到具体数字、名字、条款、接口、时间。写"需要进一步评估"等于没交。
- 不超过 600 字。结构：结论 → 依据 → 硬约束清单 →（可选）跨部门提示。
- ${WRITE_RULE}`;
};

const finalPrompt = (drafts, review, decision, depts) => `${ROLES.huizong}

【旨意】
${task}

【中书省草案】
${drafts}

【门下省审议】
${JSON.stringify(review, null, 2)}

【尚书省裁决】
${JSON.stringify({ main_plan: decision.main_plan, dropped: decision.dropped, rationale: decision.rationale }, null, 2)}

【六部交付】
${depts.map((d) => `## ${d.dept}\n${d.output || `（${d.dept}未提交：${d.error}）`}`).join('\n\n')}

${WRITE_RULE}`;

// ── 中兴：中书省起草 ───────────────────────────────────────────
phase('中书省 · 起草');
log(`旨意：${task.slice(0, 60)}${task.length > 60 ? '…' : ''}`);
let drafts = await agent(draftPrompt(null), { label: '中书令 · 起草', phase: '中书省 · 起草', ...route('zhongshu') });
if (!drafts) {
  throw new Error('中书省未产出草案，流程中止（不是降级，是没有可审的东西）');
}

// ── 门下省：驳议 ───────────────────────────────────────────────
phase('门下省 · 驳议');
const reviewSchema = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          plan: { type: 'string' },
          verdict: { type: 'string', enum: ['放行', '条件放行', '打回'] },
          fatal_flaw: { type: 'string' },
          conditions: { type: 'array', items: { type: 'string' } },
        },
        required: ['plan', 'verdict', 'fatal_flaw', 'conditions'],
        additionalProperties: false,
      },
    },
    cross_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['verdicts', 'cross_questions'],
  additionalProperties: false,
};

let review = await agent(reviewPrompt(drafts), {
  label: '门下侍中 · 驳议',
  phase: '门下省 · 驳议',
  schema: reviewSchema,
  ...route('menxia'),
});
let rounds = 1;
let degraded = !review;
if (!review) log('⚠ 门下省未产出审议，流程降级：后续裁决将缺少对抗性审查');

// 全数打回 → 中书令重拟一轮（只重拟一次，避免无限循环）
const allRejected = review && Array.isArray(review.verdicts) && review.verdicts.length > 0
  && review.verdicts.every((v) => v && v.verdict === '打回');
if (allRejected) {
  phase('中书省 · 重拟');
  log('门下省全数打回，中书令按驳回意见重拟一轮');
  const redraft = await agent(draftPrompt(review), { label: '中书令 · 重拟', phase: '中书省 · 重拟', ...route('zhongshu') });
  if (redraft) {
    drafts = redraft;
    const reReview = await agent(reviewPrompt(drafts), {
      label: '门下侍中 · 复审',
      phase: '中书省 · 重拟',
      schema: reviewSchema,
      ...route('menxia'),
    });
    if (reReview) review = reReview;
    rounds = 2;
  }
}

// ── 尚书省：裁决与派单 ─────────────────────────────────────────
phase('尚书省 · 裁决');
const decisionSchema = {
  type: 'object',
  properties: {
    main_plan: { type: 'string' },
    dropped: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
    assignments: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          dept: { type: 'string', enum: DEPTS },
          brief: { type: 'string' },
          deliverable: { type: 'string' },
        },
        required: ['dept', 'brief', 'deliverable'],
        additionalProperties: false,
      },
    },
  },
  required: ['main_plan', 'dropped', 'rationale', 'assignments'],
  additionalProperties: false,
};

const decision = await agent(decisionPrompt(drafts, review || { verdicts: [], cross_questions: [] }), {
  label: '尚书令 · 裁决派单',
  phase: '尚书省 · 裁决',
  schema: decisionSchema,
  ...route('shangshu'),
});
if (!decision) {
  throw new Error('尚书省未产出裁决，流程中止（没有派单就没有六部执行）');
}

const assignments = (Array.isArray(decision.assignments) ? decision.assignments : [])
  .filter((a) => a && DEPTS.includes(a.dept) && String(a.brief || '').trim())
  .slice(0, maxDepts);
if (assignments.length === 0) {
  log('⚠ 尚书省没有派单给任何部门，跳过六部执行');
  degraded = true;
}

// ── 六部：并行执行 ─────────────────────────────────────────────
let depts = [];
if (assignments.length > 0) {
  phase('六部 · 并行执行');
  log(`派单：${assignments.map((a) => a.dept).join(' / ')}`);
  const outputs = await parallel(
    assignments.map((a) => () => agent(deptPrompt(a), {
      label: `${a.dept} · 执行`,
      phase: '六部 · 并行执行',
      ...route(a.dept),
    })),
  );
  depts = assignments.map((a, i) => {
    const output = outputs[i];
    return output
      ? { dept: a.dept, brief: a.brief, deliverable: a.deliverable, output }
      : { dept: a.dept, brief: a.brief, deliverable: a.deliverable, output: '', error: '子 Agent 未返回内容' };
  });
  const failed = depts.filter((d) => !d.output);
  if (failed.length > 0) {
    log(`⚠ 未提交：${failed.map((d) => d.dept).join('、')}`);
    degraded = true;
  }
}

// ── 尚书省：汇总 PRD ───────────────────────────────────────────
phase('尚书省 · 汇总');
const prd = await agent(finalPrompt(drafts, review || { verdicts: [], cross_questions: [] }, decision, depts), {
  label: '尚书令 · 汇总 PRD',
  phase: '尚书省 · 汇总',
  ...route('huizong'),
});
if (!prd) {
  log('⚠ 汇总未产出，返回未整合的中间产物');
  degraded = true;
}

return {
  task,
  drafts,
  review: review || { verdicts: [], cross_questions: [], note: '门下省未产出审议' },
  decision,
  departments: depts,
  prd: prd || '',
  meta: {
    rounds,
    degraded,
    failedDepts: depts.filter((d) => !d.output).map((d) => d.dept),
    departments: depts.length,
  },
};
