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
import { PERMISSION_BROWSER_TABS, PERMISSION_BROWSER_WORKSPACE } from '../shared/browser-contracts';
import { restoreDefaultBrowserTabs } from '../modules/browser/ui/restore-tabs';

const [query, groups] = PERMISSION_BROWSER_TABS;

test('permission browser starts with both fixed tabs in their original storage identities', () => {
  const tabs = restoreDefaultBrowserTabs([], PERMISSION_BROWSER_TABS);
  assert.deepEqual(tabs, PERMISSION_BROWSER_TABS.map(({ id, url, workspace }) => ({ id, url, workspace })));
  assert.deepEqual(PERMISSION_BROWSER_TABS.map(tab => tab.label), ['权限查询', '群组创建']);
});

test('old independent browser tabs merge without losing page addresses or source partitions', () => {
  const original = [
    { id: 'old-query', url: query.url + '&selected=42', workspace: query.workspace },
    { id: 'query-detail', url: 'https://group.iright.huawei.com/detail/42', workspace: query.workspace },
    { id: 'old-groups', url: groups.url, workspace: groups.workspace },
    { id: 'groups-detail', url: 'https://productinfo.huawei.com/detail/7', workspace: groups.workspace },
  ];
  const before = structuredClone(original);
  const tabs = restoreDefaultBrowserTabs(original, PERMISSION_BROWSER_TABS);
  assert.deepEqual(tabs.map(tab => tab.id), [query.id, groups.id, 'query-detail', 'groups-detail']);
  assert.deepEqual(tabs.map(tab => tab.workspace), [query.workspace, groups.workspace, query.workspace, groups.workspace]);
  assert.equal(tabs[0].url, original[0].url);
  assert.deepEqual(original, before);
  assert.deepEqual(restoreDefaultBrowserTabs(tabs, PERMISSION_BROWSER_TABS), tabs);
});

test('fixed tab identities survive SSO redirects, reordered records and missing defaults', () => {
  const saved = [{ id: groups.id, url: 'https://login.huawei.com/login', workspace: groups.workspace }];
  const tabs = restoreDefaultBrowserTabs(saved, PERMISSION_BROWSER_TABS);
  assert.deepEqual(tabs.map(tab => tab.id), [query.id, groups.id]);
  assert.equal(tabs[1].url, saved[0].url);
  assert.equal(tabs[0].url, query.url);
  const full = restoreDefaultBrowserTabs([...tabs, ...Array.from({ length: 24 }, (_, i) => ({ id: `extra-${i}`, url: `https://productinfo.huawei.com/${i}`, workspace: groups.workspace }))], PERMISSION_BROWSER_TABS);
  assert.equal(full.length, 20);
  assert.deepEqual(full.slice(0, 2), tabs);
});

test('merged records reject foreign workspaces and preserve per-tab identity through restart', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cmo-permission-browser-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'browser.json'), store = new BrowserStore(filename);
  const tabs = restoreDefaultBrowserTabs([], PERMISSION_BROWSER_TABS);
  store.saveTabs(PERMISSION_BROWSER_WORKSPACE, tabs, groups.id);
  const restarted = new BrowserStore(filename).state(PERMISSION_BROWSER_WORKSPACE);
  assert.deepEqual(restarted.tabs, tabs);
  assert.equal(restarted.activeId, groups.id);
  assert.throws(() => store.saveTabs(PERMISSION_BROWSER_WORKSPACE, [{ id: 'bad', url: query.url, workspace: 'unrelated' }], 'bad'));
  assert.deepEqual(store.state(PERMISSION_BROWSER_WORKSPACE).tabs, tabs);
  assert.equal(restoreDefaultBrowserTabs([{ id: 'foreign', url: query.url, workspace: 'default' }], PERMISSION_BROWSER_TABS).length, 2);
});

for (const fixed of PERMISSION_BROWSER_TABS) test(`${fixed.label} cannot be closed by AI and keeps its original task workspace`, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cmo-permission-task-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false, send() {} }) as unknown as WebContents;
  let closes = 0;
  const guests = {
    observeNavigation() {}, observePopup() {}, canNavigate: () => true,
    resolve: (_owner: WebContents, id: string) => { assert.equal(id, fixed.id); return { workspace: fixed.workspace, guest: { getURL: () => fixed.url } }; },
    tabs: (_owner: WebContents, workspace: string) => workspace === fixed.workspace ? [{ id: fixed.id, workspace, url: fixed.url, ready: true, active: true }] : [],
    closeTab: async () => { closes++; },
  } as unknown as BrowserGuests;
  const automation = new BrowserAutomation(guests, new BrowserStore(join(directory, 'browser.json')));
  const task = automation.forChat(owner, fixed.workspace, '创建群组', 'chat', undefined, fixed.id);
  automation.bind(owner, task.id, 'chat', new AbortController().signal);
  assert.equal(task.workspace, fixed.workspace);
  await assert.rejects(automation.tab(owner, task.id, 'close', fixed.id), /默认标签页不可关闭/);
  assert.equal(closes, 0);
  assert.deepEqual(automation.taskFor(owner, task.id).tabIds, [fixed.id]);
  assert.throws(() => automation.forChat(owner, fixed.workspace === groups.workspace ? query.workspace : groups.workspace, '操作', 'other', undefined, fixed.id), /关联的网页/);
});
