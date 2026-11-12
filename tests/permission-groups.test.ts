import assert from 'node:assert/strict';
import test from 'node:test';
import { Compile } from 'typebox/compile';
import type { WebContents } from 'electron';
import type { BrowserAutomation } from '../electron/browser/tasks';
import type { BrowserTask } from '../shared/browser-automation-contracts';
import { prepareGroup, type GroupWorkflowState } from '../shared/permission-group-contracts';
import { buildGroupContribution, useGroupWorkflow } from '../modules/permission/group-tools';
import { GroupWorkflow } from '../modules/permission/group-workflow';

const input = { ownership: 'product', offering: 'PacificEng V600', name: 'HIS-PACIFIC610-DBOX', owner: '00545972', members: ['00514659', '00514659'], administrator: '00545972', applications: ['DBOX群组'] };
test('group preparation lists all missing information without guessing ownership or personnel', () => {
  assert.deepEqual(prepareGroup({ name: input.name }).missing, ['产品或部门归属', '明确的 Offering 名称或编号', 'Owner 工号', '成员工号', '管理员工号', '应用类型']);
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
  let decision: 'confirmed' | 'cancelled' = 'confirmed';
  let changeAfterConfirm = false, failAfterInput = false;
  const confirm = async () => { confirms++; return decision; };
  const workflow = new GroupWorkflow(automation, owner, task, confirm);
  const internals = workflow as unknown as { locateTable(): Promise<void>; offering(): Promise<void>; validate(): Promise<void>; action(): Promise<void>; result(): Promise<unknown> };
  internals.locateTable = async () => {}; internals.offering = async () => {};
  internals.validate = async () => { validations++; if (changeAfterConfirm && confirms) throw new Error('表单已经被手动修改'); };
  internals.action = async () => { operations++; if (failAfterInput) throw new Error('结果读取超时'); };
  internals.result = async () => ({ status: 'unknown' });
  return { task, automation, owner, workflow, confirm, stats: () => ({ operations, confirms, validations }), cancel: () => { decision = 'cancelled'; }, changeAfterConfirm: () => { changeAfterConfirm = true; }, failAfterInput: () => { failAfterInput = true; } };
}
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
