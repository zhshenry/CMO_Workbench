import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { BotStore } from '../electron/bot-store';
import { BotHost } from '../electron/bot-host';
import { GroupWorkflow } from '../modules/permission/group-workflow';
import { prepareGroup } from '../shared/permission-group-contracts';
import type { BotAction } from '../shared/bot-contracts';
import type { BrowserTask } from '../shared/browser-automation-contracts';

const electron = `export const app={isPackaged:false,getAppPath:()=>process.cwd()}; export const ipcMain={handle(){},removeHandler(){}}; export const BrowserWindow={getAllWindows:()=>[]};`;
const hooks = registerHooks({ resolve(specifier, context, next) { return specifier === 'electron' ? { url: `data:text/javascript,${encodeURIComponent(electron)}`, shortCircuit: true } : next(specifier, context); } });
const { BotGateway } = await import('../electron/bot-gateway'); hooks.deregister();

function fixture(view = 'permission-groups') {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-browser-')), ai = new AiStore(dir, { recover: false }), store = new BotStore(ai, dir);
  const profile = store.cards().find(item => item.seedKey === 'permission')!;
  const previous = store.draft(profile.mainChatId), text = view === 'permission-groups' ? '创建指定产品的群组' : '整理当前 PBI 页面';
  store.saveDraft(profile.mainChatId, previous.revision, { text, replyToTaskId: null, resources: [] });
  const draft = store.draft(profile.mainChatId);
  const task = store.submit({ botId: profile.id, chatId: profile.mainChatId, text, expectedDraftRevision: draft.revision, clientRequestId: randomUUID(), replyToTaskId: null, resources: [], pageContext: { scope: { module: 'workbench', viewId: view } } }, () => {}).task;
  store.updateTask(task.id, { status: 'running' });
  let gateway: InstanceType<typeof BotGateway>, writes = 0;
  const host = new BotHost(store, { run: async () => ({ reply: '' }), apply: action => (gateway as any).resource('resource:browser:apply', [action.taskId, action.payload, action.id]) });
  const browserTask: BrowserTask = { id: randomUUID(), workspace: 'permission-groups', goal: text, tabIds: ['fixture-tab'], origins: ['https://fixture.test'], status: 'running', steps: [], updatedAt: new Date().toISOString(), permissionGroup: { draft: prepareGroup({ ownership: 'product', offering: 'fixture-product', name: 'HIS-FIXTURE', owner: '00001234', members: ['00005678'], administrator: '00001234', applications: ['DBOX群组'] }).draft!, tabId: 'fixture-tab', phase: 'ready', completed: [] } };
  const started: { workspace: string; tabId?: string; previousId?: string }[] = [];
  const automation = { observeTasks: () => () => {}, forChat: (_owner: unknown, workspace: string, _goal: string, _chat: string, previousId: string | undefined, tabId?: string) => { started.push({ workspace, tabId, ...(previousId ? { previousId } : {}) }); browserTask.workspace = workspace; return browserTask; }, bind() {}, taskFor: () => structuredClone(browserTask), setGroupState: (_owner: unknown, _id: string, state: any) => { browserTask.permissionGroup = structuredClone(state); }, signal: () => new AbortController().signal, tabs: () => [{ id: 'fixture-tab', active: true }], finish() {}, store: { state: (workspace: string) => workspace === 'pbi' ? { activeId: 'pbi-tab', tabs: [{ id: 'pbi-tab', workspace: 'pbi-modules' }] } : { activeId: '', tabs: [] } } };
  const owner = { isDestroyed: () => false, send() {} };
  gateway = new BotGateway(dir, join(dir, 'tasks.db'), () => owner as never, () => undefined, automation as never);
  (gateway as any).peer = { socket: { destroyed: false }, call: async (method: string, args: any[]) => {
    if (method === 'resource-browser-owner') return store.profile(store.task(args[0]).botId).seedKey;
    if (method === 'resource-resume') return;
    if (method === 'resource-approval') return host.waitForAction(args[0], `${args[0]}:browser:${args[1].fingerprint}`, 'external', args[1], args[1]);
    throw new Error(`unexpected ${method}`);
  } };
  const internals = GroupWorkflow.prototype as any, original = { locateTable: internals.locateTable, offering: internals.offering, validate: internals.validate, action: internals.action, result: internals.result };
  internals.locateTable = async () => {}; internals.offering = async () => {}; internals.validate = async () => {};
  internals.action = async () => { writes++; }; internals.result = async () => ({ status: 'submitted', receipt: 'PIC fixture application' });
  const resource = (method: string, args: unknown[]) => (gateway as any).resource(method, args);
  return { ai, store, host, task, browserTask, started, automation, resource, writes: () => writes, action: (): BotAction => store.actions(task.id)[0], close: async () => { Object.assign(internals, original); await host.stop(); ai.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); } };
}

test('PIC approval remains bound to the original browser form and produces one actual receipt', async () => {
  const f = fixture();
  try {
    const description = await f.resource('resource:browser:start', [f.store.task(f.task.id)]);
    assert.ok(description.tools.some((tool: any) => tool.name === 'group_submit'));
    const result = await f.resource('resource:browser:execute', [f.task.id, 'group_submit', 'submit', {}]);
    assert.match(result.content[0].text, /waiting_confirmation/); assert.equal(f.writes(), 0);
    await f.resource('resource:browser:finish', [f.task.id]);
    const action = f.action(); const applied = await f.host.answerAction(action.id, action.revision, { approved: true });
    assert.equal(applied.status, 'applied'); assert.equal((applied.receipt as any).status, 'submitted');
    await f.host.answerAction(action.id, action.revision, { approved: true }); assert.equal(f.writes(), 1);
  } finally { await f.close(); }
});

test('changed PIC parameters require a fresh confirmation and cannot consume the old approval', async () => {
  const f = fixture();
  try {
    await f.resource('resource:browser:start', [f.store.task(f.task.id)]);
    await f.resource('resource:browser:execute', [f.task.id, 'group_submit', 'submit', {}]);
    const old = f.action(); f.browserTask.permissionGroup!.draft.owner = '00009999';
    assert.equal((await f.host.answerAction(old.id, old.revision, { approved: true })).status, 'failed');
    assert.equal(f.writes(), 0); assert.equal(f.store.actions(f.task.id).filter(action => action.status === 'pending').length, 1);
  } finally { await f.close(); }
});

test('a lost browser lease fails before writing and leaves a recoverable resource wait', async () => {
  const f = fixture();
  try {
    await f.resource('resource:browser:start', [f.store.task(f.task.id)]);
    await f.resource('resource:browser:execute', [f.task.id, 'group_submit', 'submit', {}]);
    const action = f.action(); await f.resource('resource:browser:finish', [f.task.id, 'fixture window closed', true]);
    assert.equal((await f.host.answerAction(action.id, action.revision, { approved: true })).status, 'failed');
    assert.equal(f.store.task(f.task.id).status, 'waiting_resource'); assert.equal(f.writes(), 0);
  } finally { await f.close(); }
});

test('configuration Bot uses the actual PBI browser tab and rejects unassociated browser pages', async () => {
  const f = fixture('workspace:pbi');
  try {
    await f.resource('resource:browser:start', [f.store.task(f.task.id)]);
    assert.deepEqual(f.started, [{ workspace: 'pbi-modules', tabId: 'pbi-tab' }]);
    await f.resource('resource:browser:finish', [f.task.id, undefined, true]);
    const wrong = { ...f.store.task(f.task.id), context: { scope: { module: 'workbench', viewId: 'browser' } } };
    await assert.rejects(f.resource('resource:browser:start', [wrong]), /不属于当前负责人/);
    assert.equal(f.started.length, 1);
  } finally { await f.close(); }
});

test('human PIC follow-up reuses the original local form workflow', async () => {
  const f = fixture();
  try {
    f.automation.store.state = () => ({ activeId: '', tabs: [], tasks: [{ ...f.browserTask, id: 'previous-form', chatId: f.task.chatId, status: 'unverified' }] });
    await f.resource('resource:browser:start', [f.store.task(f.task.id)]);
    assert.equal(f.started[0].previousId, 'previous-form');
  } finally { await f.close(); }
});

test('group question answers persist the task and route an explicit department choice', async () => {
  const f = fixture();
  try {
    const groupQuestion = { ...prepareGroup({ name: 'HIS-FIXTURE', owner: '00001234' }).groupQuestion!, tabId: 'fixture-tab', browserTaskId: f.browserTask.id };
    const action = f.host.waitForAction(f.task.id, 'group-fixture', 'question', { question: '补全建群信息', groupQuestion });
    await assert.rejects(f.host.answerAction(action.id, action.revision, { text: '跳过' }), /核对建群字段/);
    await assert.rejects(f.host.answerAction(action.id, action.revision, { group: { ownership: 'product' } }), /请补齐/);
    assert.equal(f.store.action(action.id).status, 'pending');
    assert.equal(f.store.task(f.task.id).status, 'waiting_user');
    assert.equal(f.writes(), 0);
    const applied = await f.host.answerAction(action.id, action.revision, { group: { ownership: 'department' } });
    assert.equal(applied.taskId, f.task.id);
    await f.host.answerAction(action.id, action.revision, { group: { ownership: 'product' } });
    const resumed = f.store.task(f.task.id);
    assert.equal(resumed.groupFollowup?.input.ownership, 'department');
    assert.equal(resumed.context.browserTabId, 'fixture-tab');
    const description = await f.resource('resource:browser:start', [resumed]);
    assert.ok(description.tools.some((tool: any) => tool.name === 'browser_observe'));
    assert.ok(!description.tools.some((tool: any) => tool.name === 'group_fill'));
    assert.deepEqual(f.started, [{ workspace: 'permission-groups', tabId: 'fixture-tab', previousId: f.browserTask.id }]);
    assert.equal(f.writes(), 0);
  } finally { await f.close(); }
});
