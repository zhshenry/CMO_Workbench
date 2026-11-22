import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { DEFAULT_APP_SETTINGS, type AppSettingsPatch, type UiTheme, type ViewId } from '../shared/contracts';
import { initialIslandData, type IslandSettingsPatch } from '../shared/island-contracts';

test('通用与个性化分区独立，切换保留外观选择与原设置保存', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const names = ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLDialogElement', 'Node', 'navigator', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  names.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] }));
  let settings = { ...structuredClone(DEFAULT_APP_SETTINGS), launchAtLogin: true, remindersEnabled: false, uiTheme: 'warm' as UiTheme };
  const island = initialIslandData();
  settings.reminderRange = 'off';
  let failWrite = false;
  Object.defineProperty(dom.window, 'workbench', { value: { island: {
    state: async () => structuredClone(island),
    patch: async (patch: IslandSettingsPatch) => { Object.assign(island.settings, patch); return structuredClone(island); },
    onChanged: () => () => {}, onError: () => () => {},
  }, settings: {
    get: async () => structuredClone(settings),
    patch: async (patch: AppSettingsPatch) => {
      if (failWrite) throw new Error('设置保存失败');
      settings = { ...settings, ...patch, profile: { ...settings.profile, ...patch.profile } };
      return structuredClone(settings);
    },
  }, bot: {
    getHostState: async () => ({ connected: true, independent: true, supervised: false }),
    setBackground: async () => { throw new Error('未调用后台托管'); },
  } } });
  const { createRoot } = await import('react-dom/client');
  const { SettingsView } = await import('../src/views/SettingsView');
  const { useAppearanceSettings } = await import('../src/appearance');
  function Harness({ view }: { view: ViewId }) {
    const appearance = useAppearanceSettings();
    return createElement(SettingsView, { view, appearance, onAvatarColorChange: () => {} });
  }
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = async (view: ViewId = 'settings-general') => act(async () => root.render(createElement(Harness, { view })));
  const row = (key: string) => dom.window.document.querySelector<HTMLElement>(`[data-setting-key="${key}"]`)!;
  const reminder = () => row('reminderRange').querySelector<HTMLButtonElement>('[role="combobox"]')!;
  const chooseRange = async (label: string) => {
    await act(async () => reminder().click());
    const options = [...dom.window.document.querySelectorAll<HTMLElement>('[role="option"]')];
    assert.deepEqual(options.map(option => option.textContent), ['日程和待办', '仅日程', '仅待办', '关闭']);
    await act(async () => options.find(option => option.textContent === label)!.click());
  };
  const keys = () => [...dom.window.document.querySelectorAll<HTMLElement>('[data-setting-key]')].map(el => el.dataset.settingKey);
  t.after(async () => {
    await act(async () => root.unmount()); dom.window.close();
    names.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
  });
  await render();
  const generalKeys = ['launchAtLogin', 'closeAction', 'language', 'sound', 'dnd'];
  const appearanceKeys = ['navigationStyle', 'glassIntensity', 'uiTheme'];
  assert.deepEqual(keys(), generalKeys);
  assert.equal(dom.window.document.querySelector('.set-search'), null);
  assert.equal(dom.window.document.querySelector('h1')!.textContent, '通用');
  assert.equal(row('launchAtLogin').querySelector('button')!.getAttribute('aria-checked'), 'true');
  assert.equal(row('dndTime'), null);
  await act(async () => row('sound').querySelector('button')!.click());
  await act(async () => row('dnd').querySelector('button')!.click());
  assert.equal(island.settings.sound, true);
  assert.equal(island.settings.dnd, true);
  assert.ok(row('dndTime').querySelector('fieldset'));
  await act(async () => row('dnd').querySelector('button')!.click());
  assert.equal(row('dndTime'), null);
  await render('settings-data');
  assert.equal(dom.window.document.querySelector('h1')!.textContent, '日程待办');
  assert.deepEqual(keys(), ['reminderRange']);
  assert.equal(reminder().getAttribute('aria-label'), '提醒范围');
  assert.equal(reminder().textContent, '关闭');
  await render('settings-appearance');
  assert.deepEqual(keys(), appearanceKeys);
  assert.equal(dom.window.document.querySelector('h1')!.textContent, '个性化');
  const choice = (key: string, label: string) => [...row(key).querySelectorAll('label')].find(el => el.querySelector('b')?.textContent === label)!.querySelector<HTMLInputElement>('input')!;
  await act(async () => choice('uiTheme', '青瓷').click());
  await render('settings-appearance');
  assert.equal(settings.reminderRange, 'off');
  assert.equal(settings.uiTheme, 'celadon');
  assert.equal(choice('uiTheme', '青瓷').checked, true);
  await act(async () => choice('navigationStyle', '悬浮').click());
  await act(async () => choice('glassIntensity', '纯色').click());
  await render('settings-appearance');
  assert.equal(settings.glassIntensity, 'solid');
  assert.equal(choice('glassIntensity', '纯色').checked, true);
  assert.equal(dom.window.document.documentElement.dataset.glass, 'solid');
  assert.equal(settings.uiTheme, 'celadon');
  assert.equal(settings.navigationStyle, 'floating');
  await act(async () => choice('glassIntensity', '强玻璃').click());
  assert.equal(settings.navigationStyle, 'floating');
  assert.equal(settings.glassIntensity, 'strong');
  await act(async () => choice('uiTheme', '窗影').click());
  assert.equal(row('windowLight'), null);
  assert.equal(row('uiTheme').querySelector('[data-theme="windowlight"]')!.getAttribute('data-window-light'), dom.window.document.documentElement.dataset.windowLight);
  await act(async () => choice('uiTheme', '青瓷').click());
  await render('settings-general');
  assert.deepEqual(keys(), generalKeys);
  failWrite = true;
  await act(async () => row('launchAtLogin').querySelector<HTMLButtonElement>('button')!.click());
  assert.equal(row('launchAtLogin').querySelector('button')!.getAttribute('aria-checked'), 'true');
  assert.equal(settings.uiTheme, 'celadon');
  assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /设置保存失败/);
  assert.deepEqual(keys(), generalKeys);
  await render('settings-appearance');
  assert.deepEqual(keys(), appearanceKeys);
  assert.equal(dom.window.document.querySelector('h1')!.textContent, '个性化');
  assert.equal(choice('uiTheme', '青瓷').checked, true);
  assert.equal(choice('navigationStyle', '悬浮').checked, true);
  assert.equal(choice('glassIntensity', '强玻璃').checked, true);
  assert.equal(dom.window.document.querySelector('[role="alert"]'), null);

  await render('settings-notifications');
  assert.equal(dom.window.document.querySelector('h1')!.textContent, '日程待办');
  failWrite = false;
  await chooseRange('仅待办');
  assert.equal(settings.reminderRange, 'todo');
  assert.equal(reminder().textContent, '仅待办');
  failWrite = true;
  await chooseRange('仅日程');
  assert.equal(settings.reminderRange, 'todo');
  assert.equal(reminder().textContent, '仅待办');
  assert.match(dom.window.document.querySelector('[role="alert"]')!.textContent!, /设置保存失败/);
});
