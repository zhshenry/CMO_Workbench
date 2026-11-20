import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { OfficePortal, W3_PORTAL, w3PortalLink } from '../electron/office-portal';

test('W3 reads the two lists, keeps incomplete pages, and verifies the current account before replacing a snapshot', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-w3-portal-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let configured = 'fixture1', loggedIn = 'fixture1', mode = 'ready', now = 1;
  const paths: string[] = [], linked = new Set<string>();
  const todo = { taskUUID: 'one', taskDesc: '核对验收材料', taskURL: 'https://approval.huawei.com/form/1', applicant: '测试用户' };
  const other = { taskUUID: 'two', taskDesc: '核对另一条材料', taskURL: 'https://huawei.com.example.test/form/2' };
  const apply = { ...todo, taskDesc: '申请进度', handler: '测试处理人', taskStatusName: '等待核对' };
  const portal = new OfficePortal(dir, { account: () => configured, now: () => now, linkedTasks: () => linked,
    async get(owner, path) {
      paths.push(path);
      const url = new URL(path, W3_PORTAL);
      assert.equal(owner, configured);
      if (url.pathname.includes('/w3account/')) {
        if (mode === 'logged-out') return new Response(null, { status: 302 });
        return Response.json({ uid: loggedIn });
      }
      if (url.pathname.endsWith('/getappinfocount')) return Response.json({ todoCount: 2, todoData: [{ appName: '验收系统', appNum: '2' }] });
      if (url.pathname.endsWith('/appinfo')) return Response.json(mode === 'partial' ? [] : [{ appName: '验收系统', appNum: 1 }]);
      if (url.pathname.includes('/tasklists/')) {
        assert.equal(decodeURIComponent(decodeURIComponent(url.pathname.split('/').at(-1)!)), '验收系统');
        return Response.json({ count: 2, data: mode === 'partial' ? [todo] : [todo, todo, other] });
      }
      if (url.pathname.includes('/applists/')) return Response.json({ count: 1, data: [apply] });
      assert.fail('Unexpected W3 read ' + url.pathname);
    },
  });
  assert.equal(portal.state().status, 'idle');
  const pending = portal.refresh();
  assert.equal(portal.refresh(), pending);
  const initial = await pending;
  assert.equal(initial.status, 'ready');
  assert.equal(initial.items.length, 3);
  assert.ok(initial.items.find(item => item.title === other.taskDesc && !item.url));
  assert.equal(initial.items.find(item => item.kind === 'apply')?.progress, apply.taskStatusName);
  assert.equal(initial.items.find(item => item.kind === 'apply')?.person, apply.handler);
  const id = initial.items.find(item => item.title === todo.taskDesc)!.id;
  linked.add(id);
  assert.equal(portal.item(id).taskId, id);
  mode = 'partial'; now++;
  const partial = await portal.refresh();
  assert.equal(partial.status, 'partial');
  assert.equal(partial.items.length, 2);
  assert.equal(partial.items.find(item => item.title === other.taskDesc)?.cached, true);
  assert.equal(portal.item(id).cached, undefined);
  mode = 'logged-out'; now++;
  const offline = await portal.refresh();
  assert.equal(offline.status, 'login');
  assert.equal(offline.readAt, partial.readAt);
  assert.ok(offline.items.every(item => item.cached));
  mode = 'ready'; configured = 'fixture2';
  assert.equal(portal.state().items.length, 0);
  const before = paths.length;
  assert.match((await portal.refresh()).message!, /账号不一致/);
  assert.equal(paths.length, before + 1);
  assert.throws(() => portal.item(id), /当前 W3/);
  assert.equal(w3PortalLink('http://approval.huawei.com/form/1'), undefined);
  assert.equal(w3PortalLink('https://other.example.test/form/1'), undefined);
});
