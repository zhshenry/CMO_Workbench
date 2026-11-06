import assert from 'node:assert/strict';
import test from 'node:test';
import { restorableBrowserTabs } from '../modules/browser/ui/restore-tabs';
import type { BrowserSavedTab } from '../shared/browser-automation-contracts';

// restore-tabs.ts 是纯函数模块,只依赖 URL/RegExp/crypto,无 React/.css 副作用,可直接静态导入。
const home = 'https://productinfo.huawei.com/#/main/right_manage?menu_id=3232';

test('空持久化标签回退到 initialUrl 单标签', () => {
  const tabs = restorableBrowserTabs([], home);
  assert.equal(tabs.length, 1);
  assert.equal(tabs[0].url, home);
});

test('首标签同源于 initialUrl 时不补标签,保留用户在主页站点的导航', () => {
  const saved: BrowserSavedTab[] = [
    { id: 'home', url: 'https://productinfo.huawei.com/#/main/right_manage?menu_id=3232' },
    { id: 'det', url: 'https://productinfo.huawei.com/#/detail/42' },
  ];
  assert.deepEqual(restorableBrowserTabs(saved, home), saved);
});

test('首标签与 initialUrl 不同源时在首位补工作台主页,使「首个=主页」重新成立 (DTS2026110418175400)', () => {
  // 复现 DTS:重启后 tabs[0] 可能是被导航到的其他站点或弹窗成为首标签,
  // 此前位置守卫把它误当主页永久保护,真正的工作台主页反从标签条丢失。
  const saved: BrowserSavedTab[] = [
    { id: 'popup', url: 'https://other.test/popup' },
    { id: 'det', url: 'https://detail.test/x' },
  ];
  const tabs = restorableBrowserTabs(saved, home);
  assert.deepEqual(tabs.map(tab => tab.url), [home, 'https://other.test/popup', 'https://detail.test/x']);
  assert.notEqual(tabs[0].id, 'popup');
  assert.equal(tabs[1].id, 'popup');
});

test('补主页后总数仍受 20 上限约束,且补出的主页标签始终在首位', () => {
  const saved: BrowserSavedTab[] = Array.from({ length: 20 }, (_, i) => ({ id: `t${i}`, url: `https://other.test/${i}` }));
  const tabs = restorableBrowserTabs(saved, home);
  assert.equal(tabs.length, 20);
  assert.equal(tabs[0].url, home);
  assert.deepEqual(tabs.slice(1).map(tab => tab.url), Array.from({ length: 19 }, (_, i) => `https://other.test/${i}`));
});

test('single 形态(侧栏单标签)不补主页,首标签照常恢复', () => {
  const saved: BrowserSavedTab[] = [{ id: 'only', url: 'https://other.test/' }];
  assert.deepEqual(restorableBrowserTabs(saved, home, true).map(tab => tab.url), ['https://other.test/']);
});

test('无 initialUrl 时退回原始长度逻辑,不补标签', () => {
  const saved: BrowserSavedTab[] = [{ id: 't1', url: 'https://other.test/' }];
  assert.deepEqual(restorableBrowserTabs(saved, undefined), saved);
});
