import assert from 'node:assert/strict';
import test from 'node:test';
import { Compile } from 'typebox/compile';
import type { WebContents } from 'electron';
import type { BrowserAutomation } from '../electron/browser/tasks';
import type { BrowserTask } from '../shared/browser-automation-contracts';
import { prepareGroup, resolveGroupAnswer, type GroupWorkflowState } from '../shared/permission-group-contracts';
import { buildGroupContribution, useGroupWorkflow } from '../modules/permission/group-tools';
import { GroupWorkflow } from '../modules/permission/group-workflow';

const input = { ownership: 'product', offering: 'PacificEng V600', name: 'HIS-PACIFIC610-DBOX', owner: '00545972', members: ['00514659', '00514659'], administrator: '00545972', applications: ['DBOX群组'] };
test('group preparation lists all missing information without guessing ownership or personnel', () => {
  assert.deepEqual(prepareGroup({ name: input.name }).missing, ['产品或部门归属', '明确的 Offering 名称或编号', 'Owner 工号', '成员工号', '管理员工号', '应用类型']);
});
test('group answers keep accepted fields intact and validate product and department input separately', () => {
  const question = prepareGroup({ name: input.name, owner: input.owner }).groupQuestion!;
  assert.deepEqual(question.fields, ['ownership', 'offering', 'members', 'administrator', 'applications']);
  assert.deepEqual(question.values, { name: input.name, owner: input.owner });
  assert.ok('error' in resolveGroupAnswer(question, {}));
  assert.ok('error' in resolveGroupAnswer(question, { ownership: 'product', owner: '00000000' }));
  assert.ok('error' in resolveGroupAnswer(question, { ownership: 'product', members: [514659] }));
  const answer = resolveGroupAnswer(question, { ownership: input.ownership, offering: input.offering, members: input.members, administrator: input.administrator, applications: input.applications });
  assert.ok('input' in answer);
  assert.equal(answer.input.owner, '00545972');
  assert.deepEqual(prepareGroup(answer.input).draft!.applications, ['DBOX群组', '域群组']);
  assert.deepEqual(resolveGroupAnswer(question, { ownership: 'department' }), { input: { ...question.values, ownership: 'department' } });
  assert.deepEqual(prepareGroup({ ...input, owner: 545972 }).groupQuestion?.fields, ['owner']);
  const options = [input.offering, input.offering + ' 00001234'];
  const offeringQuestion = { fields: ['offering' as const], values: answer.input, offeringOptions: options };
  assert.ok('error' in resolveGroupAnswer(offeringQuestion, {}));
  assert.ok('error' in resolveGroupAnswer(offeringQuestion, { offering: '不在候选中' }));
  assert.deepEqual(resolveGroupAnswer(offeringQuestion, { offering: options[1] }), { input: { ...answer.input, offering: options[1] } });
});
test('group preparation splits prefixes, preserves leading zeros and applies the approved defaults', () => {
  const draft = prepareGroup(input).draft!;
  assert.equal(draft.prefix, 'HIS'); assert.equal(draft.name, 'PACIFIC610-DBOX'); assert.equal(draft.years, 2);
  assert.equal(draft.owner, '00545972'); assert.deepEqual(draft.members, ['00514659']);
  assert.deepEqual(draft.applications, ['DBOX群组', '域群组']);
  assert.deepEqual(prepareGroup({ ...input, applications: ['SVN群组'] }).draft!.applications, ['SVN群组', '域群组']);
  assert.deepEqual(prepareGroup({ ...input, applications: ['海思群组'] }).draft!.applications, ['海思群组']);
  assert.equal(prepareGroup({ ...input, name: '研究_小组' }).draft!.name, '研究_小组');
  assert.equal(prepareGroup({ ...input, name: 'CSI-RESEARCH' }).draft!.prefix, 'CSI');
});
test('group preparation rejects contradictory prefixes, numeric employee IDs and arbitrary applications', () => {
  assert.match(prepareGroup({ ...input, prefix: 'CSI' }).error!, /不一致/);
  assert.match(prepareGroup({ ...input, owner: 545972 }).error!, /owner/);
  assert.match(prepareGroup({ ...input, applications: ['其他用途'] }).error!, /applications/);
  assert.match(prepareGroup({ ...input, ownership: 'department' }).error!, /部门/);
  assert.ok(prepareGroup({ ...input, unexpected: 'script' }).error);
  assert.match(prepareGroup({ ...input, name: 'HIS-' }).error!, /名称/);
});

function fixture(phase: GroupWorkflowState['phase'] = 'prepared') {
  const task: BrowserTask = { id: 'group-task', workspace: 'permission-groups', goal: '创建合成群组', tabIds: ['tab1'], origins: ['https://fixture.test'], steps: [], status: 'running', updatedAt: '' };
  task.permissionGroup = { draft: prepareGroup(input).draft!, tabId: 'tab1', phase, completed: [] };
  let operations = 0, confirms = 0, validations = 0;
  const automation = {
    taskFor: () => structuredClone(task), setGroupState: (_owner: unknown, _id: string, state: GroupWorkflowState) => { task.permissionGroup = structuredClone(state); },
    tabs: () => [{ id: 'tab1', active: true }], signal: () => new AbortController().signal,
    observe: async () => { operations++; throw new Error('Unexpected observation'); },
  } as unknown as BrowserAutomation;
  const owner = {} as WebContents;
  let decision: 'confirmed' | 'cancelled' | 'pending' = 'confirmed';
  let changeAfterConfirm = false, failAfterInput = false, beforeApproval: (() => void) | undefined;
  const confirm = async () => { confirms++; beforeApproval?.(); return decision; };
  const workflow = new GroupWorkflow(automation, owner, task, confirm);
  const internals = workflow as unknown as { locateTable(): Promise<void>; offering(): Promise<void>; validate(): Promise<void>; action(): Promise<void>; result(): Promise<unknown> };
  internals.locateTable = async () => {}; internals.offering = async () => {};
  internals.validate = async () => { validations++; if (changeAfterConfirm && confirms) throw new Error('表单已经被手动修改'); };
  internals.action = async () => { operations++; if (failAfterInput) throw new Error('结果读取超时'); };
  internals.result = async () => ({ status: 'unknown' });
  return { task, automation, owner, workflow, confirm, stats: () => ({ operations, confirms, validations }), cancel: () => { decision = 'cancelled'; }, pending: () => { decision = 'pending'; }, approve: () => { decision = 'confirmed'; }, changeAfterConfirm: () => { changeAfterConfirm = true; }, beforeApproval: (fn: () => void) => { beforeApproval = fn; }, failAfterInput: () => { failAfterInput = true; } };
}
test('persistent Bot confirmation keeps a ready PIC form intact until the original approval returns', async () => {
  const f = fixture('ready'); f.pending();
  assert.equal((await f.workflow.submit()).status, 'waiting_confirmation');
  assert.equal(f.task.permissionGroup?.phase, 'ready'); assert.equal(f.stats().operations, 0);
  f.approve(); assert.equal((await f.workflow.submit()).status, 'unknown');
  assert.equal(f.stats().operations, 1);
});
test('group_fill returns missing and invalid parameters before accessing the browser', async () => {
  const f = fixture(); delete f.task.permissionGroup;
  const missing = await f.workflow.fill({ name: input.name });
  assert.equal(missing.status, 'needs-information');
  assert.deepEqual(missing.missing, ['产品或部门归属', '明确的 Offering 名称或编号', 'Owner 工号', '成员工号', '管理员工号', '应用类型']);
  assert.equal((await f.workflow.fill()).status, 'needs-information');
  const invalid = await f.workflow.fill({ ...input, owner: 545972 });
  assert.equal(invalid.status, 'needs-information'); assert.match(invalid.error!, /owner/);
  assert.equal(f.task.permissionGroup, undefined);
  assert.deepEqual(f.stats(), { operations: 0, confirms: 0, validations: 0 });
});

test('inspecting an unfilled draft performs no browser writes and cannot submit it', async () => {
  const f = fixture();
  assert.equal((await f.workflow.inspect()).status, 'prepared');
  assert.equal((await f.workflow.submit()).status, 'blocked');
  assert.deepEqual(f.stats(), { operations: 0, confirms: 0, validations: 0 });
});

test('group_fill validates supplied replacements rather than silently filling the saved draft', async () => {
  const f = fixture();
  assert.equal((await f.workflow.fill({ name: 'HIS-ANOTHER' })).status, 'needs-information');
  assert.equal((await f.workflow.fill({ ...input, script: 'anything' })).status, 'needs-information');
  assert.equal(f.task.permissionGroup!.draft.name, 'PACIFIC610-DBOX');
  assert.deepEqual(f.stats(), { operations: 0, confirms: 0, validations: 0 });
});
test('cancelling the confirmation cannot submit or repeatedly reopen confirmation in the same turn', async () => {
  const f = fixture('ready'); f.cancel();
  assert.equal((await f.workflow.submit()).status, 'cancelled');
  assert.equal((await f.workflow.submit()).status, 'blocked');
  assert.equal(f.stats().confirms, 1); assert.equal(f.stats().operations, 0);
});
test('the form is checked again after confirmation and changed fields prevent submission', async () => {
  const f = fixture('ready'); f.changeAfterConfirm();
  assert.equal((await f.workflow.submit()).status, 'blocked');
  assert.equal(f.stats().validations, 2); assert.equal(f.stats().confirms, 1); assert.equal(f.stats().operations, 0);
});
test('PIC approval cannot be reused after the task draft itself is replaced', async () => {
  const f = fixture('ready');
  f.beforeApproval(() => { f.task.permissionGroup!.draft.owner = '00545973'; });
  const result = await f.workflow.submit();
  assert.equal(result.status, 'blocked');
  assert.match(f.task.permissionGroup!.error ?? '', /表单目标或内容已变化/);
  assert.equal(f.stats().operations, 0);
});
test('uncertain submission remains unknown, cannot be overwritten, and never replays the click', async () => {
  const f = fixture('ready'); f.failAfterInput();
  assert.equal((await f.workflow.submit()).status, 'unknown');
  assert.equal((await f.workflow.submit()).status, 'unknown');
  assert.equal((await f.workflow.fill({ ...input, name: 'HIS-ANOTHER' })).status, 'unknown');
  assert.equal(f.task.permissionGroup!.draft.name, 'PACIFIC610-DBOX');
  assert.equal(f.stats().operations, 1); assert.equal(f.stats().confirms, 1);
});
test('the dedicated tool definitions stay small and reject hidden browser commands', () => {
  const f = fixture(), contribution = buildGroupContribution(f.automation, f.owner, f.task, f.confirm), tools = contribution.buildTools();
  assert.deepEqual(tools.map(tool => tool.name), ['group_fill', 'group_inspect', 'group_submit']);
  assert.ok(JSON.stringify(tools.map(({ name, description, parameters }) => ({ name, description, parameters }))).length < 10000);
  for (const tool of tools) assert.equal(Compile(tool.parameters).Check({ code: 'anything' }), false);
  assert.equal(Compile(tools[0].parameters).Check({}), true);
  assert.equal(Compile(tools[0].parameters).Check(input), true);
  assert.equal(Compile(tools[0].parameters).Check({ ...input, owner: 545972 }), false);
  assert.equal(Compile(tools[0].parameters).Check({ ...input, script: 'anything' }), false);
  assert.doesNotMatch(contribution.systemPrompt(new Date()), /group_prepare/);
  assert.equal(useGroupWorkflow('permission-groups', ['创建产品群组']), true);
  assert.equal(useGroupWorkflow('permission-groups', ['创建部门群组']), false);
  assert.equal(useGroupWorkflow('permission-query', ['创建产品群组']), false);
  assert.equal(useGroupWorkflow('permission-groups', ['查看当前页面']), false);
  assert.equal(useGroupWorkflow('permission-groups', ['继续'], true), true);
  assert.equal(useGroupWorkflow('permission-groups', ['批量导入创建群组']), false);
  assert.equal(useGroupWorkflow('permission-groups', ['创建产品群组', '改用普通浏览器工具继续'], true), false);
});

test('offering opens the dialog without a product radio and searches when the lazy list shows no match', async () => {
  const task: BrowserTask = { id: 'group-task', workspace: 'permission-groups', goal: '创建合成群组', tabIds: ['tab1'], origins: ['https://fixture.test'], steps: [], status: 'running', updatedAt: '' };
  task.permissionGroup = { draft: prepareGroup(input).draft!, tabId: 'tab1', phase: 'prepared', completed: [] };
  const fills: { type: string; ref: string; text?: string }[] = [];
  const element = (ref: string, name: string, extra: Record<string, unknown> = {}) => ({ ref, name, ...extra });
  let searched = false, dialogOpen = false, chosen = false;
  const automation = {
    taskFor: () => structuredClone(task), setGroupState: (_owner: unknown, _id: string, state: GroupWorkflowState) => { task.permissionGroup = structuredClone(state); },
    tabs: () => [{ id: 'tab1', active: true }], signal: () => new AbortController().signal,
    observe: async (_owner: unknown, _taskId: string, _tabId: string, _all: boolean, _deep: boolean, query: { selector: { value: string; by: string }; within?: { value?: string }[] }) => {
      const key = query.selector.value, inDialog = query.within?.[0]?.value === '.el-dialog,[role="dialog"]';
      if (key === 'input,[role="combobox"]' && !inDialog) return { text: '', elements: [element('1', '请选择Offering信息', { attributes: { placeholder: '请选择Offering信息' }, value: chosen ? '[Offering R] PacificEng V600 266756442' : '' })], frames: [], truncated: false };
      if (query.selector.by === 'placeholder') return { text: '', elements: [element('5', '请输入至少三个关键字', { attributes: { placeholder: '请输入至少三个关键字' } })], frames: [], truncated: false };
      if (key === 'radio') return { text: '', elements: [], frames: [], truncated: false };
      if (key === '.el-dialog,[role="dialog"]') return { text: '', elements: dialogOpen ? [element('2', '请选择Offering信息', { cells: [{ text: '请选择Offering信息' }] })] : [], frames: [], truncated: false };
      if (key === 'button') return { text: '', elements: [element('6', '确定')], frames: [], truncated: false };
      if (key.startsWith('tr,') && inDialog) {
        // 弹窗懒加载首读只有根节点；搜索完成后出现目标行。
        return { text: '', elements: searched
          ? [element('4', '[Offering R] PacificEng V600 266756442', { cells: [{ text: '[Offering R] PacificEng V600 266756442' }] })]
          : [element('3', '[IRB] 重量级团队 11111111')], frames: [], truncated: false };
      }
      return { text: '', elements: [], frames: [], truncated: false };
    },
    act: async (_owner: unknown, _taskId: string, _tabId: string, action: { type: string; ref: string; text?: string }) => { fills.push(action); if (action.type === 'fill') searched = true; if (action.type === 'click' && action.ref === '1') dialogOpen = true; if (action.type === 'click' && action.ref === '6') chosen = true; return { text: '', elements: [], frames: [], truncated: false }; },
  } as unknown as BrowserAutomation;
  const workflow = new GroupWorkflow(automation, {} as WebContents, task);
  const internals = workflow as unknown as { offering(): Promise<void> };
  await internals.offering();
  // 无 radio 页面：直接点击 Offering 选择器打开弹窗，不再抛「产品归属应唯一匹配，实际 0 项」。
  assert.ok(fills.some(action => action.type === 'click' && action.ref === '1'));
  // 懒加载列表 0 匹配时：在弹窗搜索框里填入名称触发查询，再从结果中选中目标行。
  assert.ok(fills.some(action => action.type === 'fill' && action.ref === '5' && action.text === 'PacificEng V600'));
  assert.equal(task.permissionGroup!.offeringLabel, '[Offering R] PacificEng V600 266756442');
});

test('offering still clicks the product radio on the legacy page when exactly one is present', async () => {
  const task: BrowserTask = { id: 'group-task', workspace: 'permission-groups', goal: '创建合成群组', tabIds: ['tab1'], origins: ['https://fixture.test'], steps: [], status: 'running', updatedAt: '' };
  task.permissionGroup = { draft: prepareGroup(input).draft!, tabId: 'tab1', phase: 'prepared', completed: [] };
  const clicks: string[] = [];
  const element = (ref: string, name: string, extra: Record<string, unknown> = {}) => ({ ref, name, ...extra });
  let radioClicked = false, dialogOpen = false, chosen = false;
  const automation = {
    taskFor: () => structuredClone(task), setGroupState: (_owner: unknown, _id: string, state: GroupWorkflowState) => { task.permissionGroup = structuredClone(state); },
    tabs: () => [{ id: 'tab1', active: true }], signal: () => new AbortController().signal,
    observe: async (_owner: unknown, _taskId: string, _tabId: string, _all: boolean, _deep: boolean, query: { selector: { value: string; by: string; name?: string }; within?: { value?: string }[] }) => {
      const key = query.selector.value, inDialog = query.within?.[0]?.value === '.el-dialog,[role="dialog"]';
      if (key === 'radio') return { text: '', elements: [element('1', '产品', { checked: radioClicked })], frames: [], truncated: false };
      if (key === 'input,[role="combobox"]' && !inDialog) return { text: '', elements: [element('2', '请选择Offering信息', { attributes: { placeholder: '请选择Offering信息' }, value: chosen ? '[Offering R] PacificEng V600 266756442' : '' })], frames: [], truncated: false };
      if (query.selector.by === 'placeholder') return { text: '', elements: [element('6', '请输入至少三个关键字', { attributes: { placeholder: '请输入至少三个关键字' } })], frames: [], truncated: false };
      if (key === '.el-dialog,[role="dialog"]') return { text: '', elements: dialogOpen ? [element('3', '请选择Offering信息', { cells: [{ text: '请选择Offering信息' }] })] : [], frames: [], truncated: false };
      if (key === 'button') return { text: '', elements: [element('5', '确定')], frames: [], truncated: false };
      if (key.startsWith('tr,') && inDialog) return { text: '', elements: [element('4', '[Offering R] PacificEng V600 266756442', { cells: [{ text: '[Offering R] PacificEng V600 266756442' }] })], frames: [], truncated: false };
      return { text: '', elements: [], frames: [], truncated: false };
    },
    act: async (_owner: unknown, _taskId: string, _tabId: string, action: { type: string; ref: string }) => { if (action.type === 'click') { clicks.push(action.ref); if (action.ref === '1') { radioClicked = true; dialogOpen = true; } if (action.ref === '4') chosen = true; } return { text: '', elements: [], frames: [], truncated: false }; },
  } as unknown as BrowserAutomation;
  const workflow = new GroupWorkflow(automation, {} as WebContents, task);
  const internals = workflow as unknown as { offering(): Promise<void> };
  await internals.offering();
  assert.ok(clicks.includes('1'), '旧版页面仍应点击唯一的「产品」radio');
  assert.equal(task.permissionGroup!.offeringLabel, '[Offering R] PacificEng V600 266756442');
});

test('multiple product radios still stop the workflow instead of guessing', async () => {
  const task: BrowserTask = { id: 'group-task', workspace: 'permission-groups', goal: '创建合成群组', tabIds: ['tab1'], origins: ['https://fixture.test'], steps: [], status: 'running', updatedAt: '' };
  task.permissionGroup = { draft: prepareGroup(input).draft!, tabId: 'tab1', phase: 'prepared', completed: [] };
  const element = (ref: string, name: string, extra: Record<string, unknown> = {}) => ({ ref, name, ...extra });
  const automation = {
    taskFor: () => structuredClone(task), setGroupState: (_owner: unknown, _id: string, state: GroupWorkflowState) => { task.permissionGroup = structuredClone(state); },
    tabs: () => [{ id: 'tab1', active: true }], signal: () => new AbortController().signal,
    observe: async (_owner: unknown, _taskId: string, _tabId: string, _all: boolean, _deep: boolean, query: { selector: { value: string } }) => {
      if (query.selector.value === 'radio') return { text: '', elements: [element('1', '产品'), element('2', '产品')], frames: [], truncated: false };
      if (query.selector.value === 'input,[role="combobox"]') return { text: '', elements: [element('3', '请选择Offering信息', { attributes: { placeholder: '请选择Offering信息' } })], frames: [], truncated: false };
      return { text: '', elements: [], frames: [], truncated: false };
    },
    act: async () => ({ text: '', elements: [], frames: [], truncated: false }),
  } as unknown as BrowserAutomation;
  const workflow = new GroupWorkflow(automation, {} as WebContents, task);
  const internals = workflow as unknown as { offering(): Promise<void> };
  await assert.rejects(internals.offering(), /产品归属应唯一匹配，实际 2 项/);
});

test('submission receipts must name this exact group and express an affirmative success', async () => {
  for (const [text, status] of [
    ['提交成功：HIS-PACIFIC610-DBOX-OTHER', 'unknown'],
    ['未提交成功：HIS-PACIFIC610-DBOX', 'unknown'],
    ['HIS-PACIFIC610-DBOX 申请已提交失败', 'unknown'],
    ['保存失败！[HIS-PACIFIC610-DBOX]以上组名已存在iright', 'blocked'],
    ['提交成功：HIS-PACIFIC610-DBOX，申请单号 PIC-001', 'submitted'],
  ] as const) {
    const f = fixture('unknown');
    const automation = {
      taskFor: () => structuredClone(f.task), setGroupState: (_owner: unknown, _id: string, state: GroupWorkflowState) => { f.task.permissionGroup = state; },
      tabs: () => [{ id: 'tab1', active: true }],
      signal: () => new AbortController().signal,
      observe: async () => ({ text, elements: [{ name: text }], frames: [], truncated: false }),
      plan: () => {}, verify: async () => ({ passed: true }),
    } as unknown as BrowserAutomation;
    const workflow = new GroupWorkflow(automation, f.owner, f.task, f.confirm);
    assert.equal((await workflow.inspect()).status, status, text);
    if (status === 'blocked') {
      assert.equal((await workflow.fill(input)).status, 'needs-information');
      assert.equal((await workflow.fill()).status, 'needs-information');
      assert.equal((await workflow.fill({ ...input, name: 'HIS-NEW-NAME' })).status, 'blocked');
      assert.equal(f.task.permissionGroup!.draft.name, 'NEW-NAME');
    }
  }
});
