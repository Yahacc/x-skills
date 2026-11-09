const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// 状态机的可测部分不需要 LLM：把 .mjs 原文当函数体，注入假的 agent / parallel。
const SRC = readFileSync(path.join(__dirname, 'sansheng-liubu.mjs'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const REVIEW_PASS = {
  verdicts: [
    { plan: '方案一', verdict: '放行', fatal_flaw: '', conditions: [] },
    { plan: '方案二', verdict: '条件放行', fatal_flaw: '', conditions: ['给出成本上限'] },
  ],
  cross_questions: ['三份都没定验收标准'],
};

const DECISION = (depts = ['工部', '刑部']) => ({
  main_plan: '方案二',
  dropped: ['方案一'],
  rationale: '唯一的成本可控路线',
  assignments: depts.map((dept) => ({ dept, brief: `${dept}的活`, deliverable: `${dept}交付物` })),
});

// handler(label, prompt, opts, nth) → 该角色的返回值；返回 undefined 时用默认文本。
function runWorkflow(args, handler = () => undefined) {
  const calls = [];
  const phases = [];
  const logs = [];
  const agent = async (prompt, opts = {}) => {
    calls.push({ label: opts.label, prompt, schema: opts.schema, provider: opts.provider, model: opts.model });
    const out = handler(opts.label, prompt, opts, calls.length);
    return out === undefined ? `输出：${opts.label}` : out;
  };
  const parallel = (thunks) => Promise.all(thunks.map((t) => t().catch(() => null)));
  const fn = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', SRC);
  return fn(args, agent, parallel, (p) => phases.push(p), (m) => logs.push(m)).then((result) => ({
    result,
    calls,
    phases,
    logs,
    promptOf: (label) => calls.filter((c) => c.label === label).map((c) => c.prompt),
  }));
}

const baseHandler = (over = {}) => (label, prompt) => {
  if (over[label] !== undefined) return typeof over[label] === 'function' ? over[label](prompt) : over[label];
  if (label === '中书令 · 起草' || label === '中书令 · 重拟') return '## 方案一：A\n## 方案二：B';
  if (label === '门下侍中 · 驳议' || label === '门下侍中 · 复审') return REVIEW_PASS;
  if (label === '尚书令 · 裁决派单') return DECISION();
  if (label === '尚书令 · 汇总 PRD') return '# PRD';
  return `交付：${label}`;
};

test('正常路径：五阶段顺序、两部门并行、无降级', async () => {
  const { result, phases, calls } = await runWorkflow({ task: '做一件事' }, baseHandler());

  assert.deepEqual(
    phases,
    ['中书省 · 起草', '门下省 · 驳议', '尚书省 · 裁决', '六部 · 并行执行', '尚书省 · 汇总'],
  );
  assert.equal(result.prd, '# PRD');
  assert.equal(result.meta.rounds, 1);
  assert.equal(result.meta.degraded, false);
  assert.deepEqual(result.departments.map((d) => d.dept), ['工部', '刑部']);
  assert.deepEqual(result.meta.failedDepts, []);

  // 审议与裁决必须走 schema，否则下游拿不到结构
  const bySchema = calls.filter((c) => c.schema).map((c) => c.label);
  assert.deepEqual(bySchema, ['门下侍中 · 驳议', '尚书令 · 裁决派单']);
});

test('缺 task 直接失败，不给下游空旨意', async () => {
  await assert.rejects(() => runWorkflow({}, baseHandler()), /缺少 args\.task/);
  await assert.rejects(() => runWorkflow({ task: '   ' }, baseHandler()), /缺少 args\.task/);
});

test('全数打回：重拟一轮并把驳回意见带回去', async () => {
  const rejected = {
    verdicts: [
      { plan: '方案一', verdict: '打回', fatal_flaw: '把营销假设当需求事实', conditions: [] },
      { plan: '方案二', verdict: '打回', fatal_flaw: '无法证伪的乐观预期', conditions: [] },
    ],
    cross_questions: ['没有验收标准'],
  };
  let reviews = 0;
  const { result, phases, promptOf } = await runWorkflow({ task: '做一件事' }, baseHandler({
    '门下侍中 · 驳议': () => rejected,
    '门下侍中 · 复审': () => (reviews++ === 0 ? REVIEW_PASS : rejected),
  }));

  assert.ok(phases.includes('中书省 · 重拟'));
  assert.equal(result.meta.rounds, 2);
  assert.equal(result.review.verdicts[0].verdict, '放行', '复审结果应覆盖首轮审议');

  const redraft = promptOf('中书令 · 重拟')[0];
  assert.match(redraft, /上一轮门下省的驳回意见/);
  assert.match(redraft, /把营销假设当需求事实/);
});

test('门下省失联：降级但继续，裁决不吃空审计', async () => {
  const { result, logs, promptOf } = await runWorkflow({ task: '做一件事' }, baseHandler({
    '门下侍中 · 驳议': () => null,
  }));

  assert.equal(result.meta.degraded, true);
  assert.deepEqual(result.review.verdicts, []);
  assert.ok(logs.some((l) => l.includes('流程降级')));
  // 裁决仍要被调用，且拿到的审议是空结构而不是 undefined
  const decisionPrompt = promptOf('尚书令 · 裁决派单')[0];
  assert.match(decisionPrompt, /"verdicts": \[\]/);
});

test('裁决失联：中止，不拿半成品当结果', async () => {
  await assert.rejects(
    () => runWorkflow({ task: '做一件事' }, baseHandler({ '尚书令 · 裁决派单': () => null })),
    /尚书省未产出裁决/,
  );
});

test('六部部分失败：记 failedDepts、降级、汇总里标未提交', async () => {
  const { result, promptOf } = await runWorkflow({ task: '做一件事' }, baseHandler({
    '刑部 · 执行': () => null,
  }));

  assert.deepEqual(result.meta.failedDepts, ['刑部']);
  assert.equal(result.meta.degraded, true);
  assert.equal(result.meta.departments, 2);
  assert.match(promptOf('尚书令 · 汇总 PRD')[0], /刑部未提交/);
});

test('派单过滤：不认识的部门丢掉，maxDepartments 夹取到 1–6', async () => {
  const six = DECISION(['吏部', '户部', '礼部', '兵部', '刑部', '工部']);
  const over = { '尚书令 · 裁决派单': () => ({ ...six, assignments: [...six.assignments, { dept: '厂卫', brief: 'x', deliverable: 'y' }] }) };

  const capped = await runWorkflow({ task: 't', maxDepartments: 2 }, baseHandler(over));
  assert.equal(capped.result.meta.departments, 2);

  const clamped = await runWorkflow({ task: 't', maxDepartments: 0 }, baseHandler(over));
  assert.equal(clamped.result.meta.departments, 1);

  const all = await runWorkflow({ task: 't', maxDepartments: 99 }, baseHandler(over));
  assert.equal(all.result.meta.departments, 6, '厂卫不在六部之内，必须被过滤');

  const junk = await runWorkflow({ task: 't', maxDepartments: '随便' }, baseHandler(over));
  assert.equal(junk.result.meta.departments, 6, '非数字退回默认 6');
});

test('默认只读：六部与汇总都被告知不许改仓库', async () => {
  const { promptOf } = await runWorkflow({ task: '做一件事' }, baseHandler());

  for (const label of ['工部 · 执行', '刑部 · 执行', '尚书令 · 汇总 PRD']) {
    assert.match(promptOf(label)[0], /禁止改动仓库/, `${label} 缺少只读约束`);
  }
});

test('allowWrite: true 才放开落盘', async () => {
  const { promptOf } = await runWorkflow({ task: '做一件事', allowWrite: true }, baseHandler());
  const dept = promptOf('工部 · 执行')[0];

  assert.match(dept, /允许为了落地而修改仓库文件/);
  assert.doesNotMatch(dept, /禁止改动仓库/);
});

test('models 覆写按角色生效，缺 provider/model 时静默继承默认路由', async () => {
  const { calls } = await runWorkflow(
    { task: 't', models: { menxia: { provider: 'p2', model: 'm2' }, zhongshu: { model: 'only-model' } } },
    baseHandler(),
  );
  const pick = (label) => calls.find((c) => c.label === label);

  assert.equal(pick('门下侍中 · 驳议').provider, 'p2');
  assert.equal(pick('门下侍中 · 驳议').model, 'm2');
  assert.equal(pick('中书令 · 起草').provider, undefined);
  assert.equal(pick('中书令 · 起草').model, undefined);
});

test('schema 只用 workflow 运行时可接受的字段', async () => {
  const { calls } = await runWorkflow({ task: 't' }, baseHandler());
  const allowed = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const']);

  const walk = (node, at) => {
    if (!node || typeof node !== 'object') return;
    for (const key of Object.keys(node)) {
      assert.ok(allowed.has(key), `schema 出现未支持字段 ${at}.${key}`);
    }
    for (const [k, v] of Object.entries(node.properties || {})) walk(v, `${at}.properties.${k}`);
    if (node.items) walk(node.items, `${at}.items`);
  };

  const schemas = calls.filter((c) => c.schema).map((c) => c.schema);
  assert.equal(schemas.length, 2);
  schemas.forEach((s, i) => walk(s, `schema[${i}]`));
});