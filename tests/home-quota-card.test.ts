import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { act, createElement } from 'react';
import type { IslandNavigation, NewApiAccount } from '../shared/island-contracts';

test('首页额度卡使用共享读数，区分空数据、真实零值、缓存和刷新失败', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
  const globals = ['window', 'document', 'HTMLElement', 'Node', 'navigator'] as const;
  const previous = globals.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  globals.forEach(name => Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom.window : dom.window[name] }));
  const previousAct = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, value: true });
  const clock = new Date(2026, 10, 11, 10, 30);
  const account = (patch: Partial<NewApiAccount> = {}): NewApiAccount => ({
    id: 'account', label: '合成账号', status: 'ready', baseUrl: 'https://synthetic.invalid', account: 'synthetic', userId: '1',
    todayQuota: 500, models: [], updatedAt: clock.getTime(), message: '', hasData: true, ...patch,
  });
  let data: NewApiAccount[] = [];
  let readAction = () => Promise.resolve(data);
  let refreshAction = () => Promise.resolve(data);
  let changed: (() => void) | undefined;
  let refreshCalls = 0;
  const navigation: IslandNavigation[] = [];
  Object.defineProperty(dom.window, 'workbench', { value: { island: {
    quotas: () => readAction(),
    quotaRefresh: () => { refreshCalls++; return refreshAction(); },
    onChanged: (callback: () => void) => { changed = callback; return () => { changed = undefined; }; },
    navigate: async (target: IslandNavigation) => { navigation.push(target); },
  } } });
  const { createRoot } = await import('react-dom/client');
  const { HomeQuotaCard } = await import('../src/views/HomeQuotaCard');
  const root = createRoot(dom.window.document.getElementById('root')!);
  const render = async (date = clock) => act(async () => root.render(createElement(HomeQuotaCard, { clock: date })));
  const publish = async (next: NewApiAccount[]) => { data = next; await act(async () => changed?.()); };
  const text = () => dom.window.document.body.textContent ?? '';
  const values = () => [...dom.window.document.querySelectorAll('.home-quota-amount strong')].map(element => element.textContent);
  const refresh = () => dom.window.document.querySelector<HTMLButtonElement>('[aria-label="刷新 AI 额度"]')!;
  t.after(async () => {
    await act(async () => root.unmount());
    assert.equal(changed, undefined);
    dom.window.close();
    globals.forEach((name, index) => { if (previous[index]) Object.defineProperty(globalThis, name, previous[index]!); else Reflect.deleteProperty(globalThis, name); });
    if (previousAct) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousAct); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT');
  });

  await t.test('首次读取显示加载态，未连接可进入现有 AI 连接页签', async () => {
    let resolve!: (value: NewApiAccount[]) => void;
    readAction = () => new Promise<NewApiAccount[]>(done => { resolve = done; });
    await render();
    assert.match(text(), /正在读取额度消耗/);
    assert.equal(refresh().disabled, true);
    await act(async () => resolve([]));
    assert.match(text(), /尚未连接 New API 账号/);
    const connect = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '去连接')!;
    await act(async () => connect.click());
    assert.deepEqual(navigation.at(-1), { view: 'settings-island', section: 'quota' });
    readAction = () => Promise.resolve(data);
  });

  await t.test('按账号展示 Token，500 不显示为 500K，真实零值与读取失败分开', async () => {
    await publish([account(), account({ id: 'zero', todayQuota: 0 }), account({ id: 'failed', status: 'error', hasData: false, todayQuota: 0, message: '连接失败' })]);
    assert.deepEqual(values(), ['500', '0', '—']);
    assert.match(text(), /读取失败/);
    assert.equal(dom.window.document.querySelector('.home-quota-amount')?.getAttribute('aria-label'), '今日消耗 500 Tokens');
    await publish([account({ todayQuota: 1500 })]);
    assert.deepEqual(values(), ['1.5K']);
  });

  await t.test('后台更新中和同日缓存保留原值，错误标记与服务消息可见', async () => {
    await publish([account({ status: 'connecting' })]);
    assert.deepEqual(values(), ['500']); assert.match(text(), /正在更新/);
    await publish([account({ message: '合成网络错误' })]);
    assert.deepEqual(values(), ['500']); assert.match(text(), /缓存数据/);
    assert.match(text(), /合成网络错误/);
    assert.ok(dom.window.document.querySelector('[data-stale="true"]'));
  });

  await t.test('跨日不把昨天的读数显示成今日消耗', async () => {
    await publish([account()]);
    await render(new Date(2026, 10, 12, 0, 1));
    assert.deepEqual(values(), ['—']); assert.match(text(), /暂无今日数据/);
    await render();
    assert.deepEqual(values(), ['500']);
  });

  await t.test('手动刷新防重复，失败保留当日读数，重试恢复', async () => {
    let reject!: (error: Error) => void;
    refreshAction = () => new Promise<NewApiAccount[]>((_resolve, fail) => { reject = fail; });
    const previousCalls = refreshCalls;
    await act(async () => { refresh().click(); refresh().click(); });
    assert.equal(refreshCalls, previousCalls + 1); assert.equal(refresh().disabled, true);
    assert.deepEqual(values(), ['500']);
    await act(async () => reject(new Error('合成刷新失败')));
    assert.match(text(), /合成刷新失败/); assert.equal(refresh().disabled, false);
    assert.deepEqual(values(), ['500']);
    refreshAction = () => Promise.resolve([account({ todayQuota: 3000 })]);
    await act(async () => refresh().click());
    assert.deepEqual(values(), ['3.0K']);
    assert.equal(dom.window.document.querySelector('[role="alert"]'), null);
  });

  await t.test('较早的异步读取不能覆盖更新通知带来的新读数', async () => {
    let resolve!: (value: NewApiAccount[]) => void;
    readAction = () => new Promise<NewApiAccount[]>(done => { resolve = done; });
    await act(async () => changed?.());
    readAction = () => Promise.resolve([account({ todayQuota: 5000 })]);
    await act(async () => changed?.());
    assert.deepEqual(values(), ['5.0K']);
    await act(async () => resolve([account({ todayQuota: 1 })]));
    assert.deepEqual(values(), ['5.0K']);
  });
});
