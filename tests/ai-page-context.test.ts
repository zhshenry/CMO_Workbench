import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NAV, workbenchAiContext } from '../src/nav';
import { pageAiContext, type PageAiSelection } from '../src/ai-page-context';

const none: PageAiSelection = { reading: null };
const forbidden = ['工作台助手', '浏览器助手', '当前页面'];

test('工作台页面的助手卡片主标签和对象行来自导航', () => {
  assert.deepEqual(pageAiContext('permission-query', none), {
    scope: { module: 'workbench', viewId: 'permission-query' }, label: '权限管理', object: '权限查询',
  });
  assert.deepEqual(workbenchAiContext('permission-query'), { label: '权限管理', object: '权限查询' });

  for (const workbench of NAV) {
    for (const sub of workbench.subs) {
      if (!sub.view) continue;
      const labels = workbenchAiContext(sub.view);
      assert.equal(labels.label, workbench.title, sub.view);
      assert.equal(labels.object, sub.label, sub.view);
      const page = pageAiContext(sub.view, none);
      assert.equal(page.label, sub.view === 'todo' ? '日程待办' : workbench.title, sub.view);
      assert.equal(forbidden.includes(page.label), false, page.label);
      assert.equal(forbidden.includes(page.object), false, page.object);
    }
    const workspace = workbenchAiContext(`workspace:${workbench.id}`);
    assert.deepEqual(workspace, { label: workbench.title, object: workbench.title });
  }

  assert.deepEqual(pageAiContext('settings-general', none), {
    scope: { module: 'workbench', viewId: 'settings-general' }, label: '设置', object: '通用与外观',
  });
  assert.deepEqual(pageAiContext('settings-ai', none), {
    scope: { module: 'workbench', viewId: 'settings-ai' }, label: '设置', object: '模型配置',
  });
});

test('待办和阅读的专用名称不随工作台文案改动', () => {
  assert.deepEqual(pageAiContext('todo', none), {
    scope: { module: 'todo' }, label: '日程待办', object: 'To-Do-List',
  });
  assert.deepEqual(pageAiContext('reading', { ...none, reading: { id: 'book-1', title: '海边的卡夫卡' } }), {
    scope: { module: 'reading', profileId: 'book-1' }, label: '阅读助手', object: '海边的卡夫卡',
  });
  assert.deepEqual(pageAiContext('reading', none), {
    scope: { module: 'workbench', viewId: 'reading' }, label: '小工具', object: '阅读清单',
  });
});

test('首页看板使用首页上下文，独立待办继续使用原待办助手', () => {
  assert.deepEqual(pageAiContext('home', none), { scope: { module: 'workbench', viewId: 'home' }, label: '首页', object: '我的看板' });
  assert.deepEqual(pageAiContext('todo', none).scope, { module: 'todo' });
  assert.deepEqual(NAV.find(workbench => workbench.id === 'todo')?.subs, [{ label: '日程待办', view: 'todo' }]);
});
