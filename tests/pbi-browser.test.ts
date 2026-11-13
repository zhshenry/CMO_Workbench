import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContents } from 'electron';
import type { BrowserGuests } from '../electron/browser-guests';
import { BrowserStore } from '../electron/browser/store';
import { BrowserAutomation } from '../electron/browser/tasks';
import { PBI_BROWSER_TABS, PBI_BROWSER_WORKSPACE, isDefaultBrowserTab } from '../shared/browser-contracts';
import { restoreDefaultBrowserTabs } from '../modules/browser/ui/restore-tabs';
import { pageAiContext } from '../src/ai-page-context';

const [features, modules] = PBI_BROWSER_TABS;

test('PBI starts with two fixed pages using the original independent storage identities', () => {
  assert.deepEqual(restoreDefaultBrowserTabs([], PBI_BROWSER_TABS), PBI_BROWSER_TABS.map(({ id, url, workspace }) => ({ id, url, workspace })));
  assert.deepEqual(PBI_BROWSER_TABS.map(tab => tab.label), ['特性管理', '子系统&模块']);
});

test('same-origin legacy PBI pages merge by workspace without swapping addresses or losing extra tabs', () => {
  const saved = [
    { id: 'old-features', url: features.url + '?draft=42', workspace: features.workspace },
    { id: 'feature-detail', url: 'https://pbi.huawei.com/pbiops#/detail/42', workspace: features.workspace },
    { id: 'old-modules', url: modules.url + '?draft=7', workspace: modules.workspace },
  ];
  const before = structuredClone(saved);
  const restored = restoreDefaultBrowserTabs(saved, PBI_BROWSER_TABS);
  assert.deepEqual(restored.map(tab => tab.id), [features.id, modules.id, 'feature-detail']);
  assert.deepEqual(restored.map(tab => tab.url), [saved[0].url, saved[2].url, saved[1].url]);
  assert.deepEqual(saved, before);
  assert.deepEqual(restoreDefaultBrowserTabs(restored, PBI_BROWSER_TABS), restored);
  const redirected = restoreDefaultBrowserTabs([{ id: modules.id, url: 'https://login.huawei.com/login', workspace: modules.workspace }], PBI_BROWSER_TABS);
  assert.equal(redirected[1].url, 'https://login.huawei.com/login');
  assert.equal(restoreDefaultBrowserTabs([{ id: 'foreign', url: features.url, workspace: 'permission-query' }], PBI_BROWSER_TABS).length, 2);
});

test('PBI restart restores the selected fixed tab while original page histories remain separate', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cmo-pbi-browser-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'browser.json'), store = new BrowserStore(filename);
  for (const tab of PBI_BROWSER_TABS) store.visit(tab.workspace, tab.url, tab.label, 'old-' + tab.workspace);
  const oldStates = PBI_BROWSER_TABS.map(tab => store.state(tab.workspace));
  const tabs = restoreDefaultBrowserTabs(PBI_BROWSER_TABS.flatMap((tab, index) => oldStates[index].tabs.map(saved => ({ ...saved, workspace: tab.workspace }))), PBI_BROWSER_TABS);
  store.saveTabs(PBI_BROWSER_WORKSPACE, tabs, modules.id);
  const restarted = new BrowserStore(filename);
  assert.deepEqual(restarted.state(PBI_BROWSER_WORKSPACE).tabs, tabs);
  assert.equal(restarted.state(PBI_BROWSER_WORKSPACE).activeId, modules.id);
  assert.deepEqual(PBI_BROWSER_TABS.map(tab => restarted.state(tab.workspace)), oldStates);
});

for (const fixed of PBI_BROWSER_TABS) test(`${fixed.label} keeps its AI page context and cannot be closed by AI`, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cmo-pbi-task-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false, send() {} }) as unknown as WebContents;
  let closes = 0;
  const guests = {
    observeNavigation() {}, observePopup() {}, canNavigate: () => true,
    resolve: () => ({ workspace: fixed.workspace, guest: { getURL: () => fixed.url } }),
    tabs: (_owner: WebContents, workspace: string) => workspace === fixed.workspace ? [{ id: fixed.id, workspace, url: fixed.url, ready: true, active: true }] : [],
    closeTab: async () => { closes++; },
  } as unknown as BrowserGuests;
  const automation = new BrowserAutomation(guests, new BrowserStore(join(directory, 'browser.json')));
  const task = automation.forChat(owner, fixed.workspace, '检查当前 PBI 页面', 'chat', undefined, fixed.id);
  automation.bind(owner, task.id, 'chat', new AbortController().signal);
  assert.equal(task.workspace, fixed.workspace);
  await assert.rejects(automation.tab(owner, task.id, 'close', fixed.id), /默认标签页不可关闭/);
  assert.equal(closes, 0);
  assert.equal(isDefaultBrowserTab(fixed.workspace, 'ordinary-extra-tab'), false);
  const context = pageAiContext(fixed.workspace as 'pbi-features' | 'pbi-modules', { reading: null });
  assert.deepEqual(context, { scope: { module: 'workbench', viewId: fixed.workspace }, label: 'PBI管理', object: fixed.label });
});
