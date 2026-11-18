import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AiStore } from '../electron/ai-store';
import { BotHost } from '../electron/bot-host';
import { botService } from '../electron/bot-service';
import { BotStore } from '../electron/bot-store';
import { officeDeadline, OfficeWorkbench, parseOfficeMailList } from '../electron/office-workbench';
import { Store } from '../modules/todo/store';
import type { BotAction } from '../shared/bot-contracts';
import { aiPlanSchema, newTask, type Task } from '../shared/todo-contracts';
import type { WelinkMessage } from '../shared/welink-reminders';

function temporary(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-office-test-'));
  t.after(() => {
    assert.equal(dirname(resolve(dir)), resolve(tmpdir()));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const initialTime = Date.parse('2026-11-18T09:35:00+08:00');
const quote = '明天 10:00 方案评审，09:55 前能补一下压测结果吗？';

test('one source connects the inbox, brief and original context; failed mail keeps the authorized snapshot', async t => {
  const dir = temporary(t);
  let uid = 'z00009999', now = initialTime, mailOffline = false;
  const commands: string[][] = [];
  const group = (id: string, time: string, text: string, atMe = false): WelinkMessage => ({
    id, conversation: 'group:53', conversationName: '项目讨论群', sender: '林同事',
    mine: false, atMe, group: true, at: Date.parse('2026-11-17T' + time + ':00+08:00'), text,
  });
  const messages = [group('12', '17:18', '文件已放群里。'), group('13', '17:20', quote, true), group('14', '17:22', '议程以日历为准。'),
    { ...group('15', '18:00', '我周五把本周进展发你。'), conversation: 'user:17', conversationName: '陈同事', sender: uid, mine: true, group: false }];
  const dateAt = '2026-11-18T10:00:00+08:00', endAt = '2026-11-18T11:00:00+08:00';
  const base: Task = { ...newTask('方案评审'), id: 'meeting', createdAt: dateAt, updatedAt: dateAt,
    dateAt, endAt, kind: 'meeting', source: 'welink', deletedAt: null, completedAt: null, notifiedFor: null };
  const tasks: Task[] = [
    { ...base, external: { provider: 'meeting', account: uid, id: 'meeting-1' } },
    { ...base, id: 'calendar', external: { provider: 'calendar', account: uid, id: 'event-2' } },
    { ...base, id: 'foreign', title: '另一个账号的评审', external: { provider: 'calendar', account: 'z00111111', id: 'foreign-event' } },
  ];
  const deps = {
    account: async () => uid || undefined, email: () => 'fixture@example.test', now: () => now,
    messageSettings: () => ({ enabled: false, waitHours: 4, keywords: [] }),
    messages: {
      officeSnapshot: (account: string) => ({ messages: account === 'z00009999' ? messages : [], lastReadAt: account === 'z00009999' ? initialTime : null, partial: false }),
      refresh: async (settings: { enabled: boolean }) => {
        assert.equal(settings.enabled, true, 'the workspace can manually collect with reminders disabled');
        return { synced: true, syncing: false, lastSuccessAt: now, error: '', partial: false, account: uid, conversations: 2, messages: 4, reminders: [] };
      },
    },
    tasks: () => tasks, agenda: () => ({ syncing: false, lastSuccessAt: initialTime, error: '' }),
    run: async (args: string[]) => {
      commands.push(args);
      if (args[1] === 'list' && mailOffline) throw new Error('邮箱暂时不可用');
      if (args[1] === 'list') return JSON.stringify([{ itemId: 'mail-1', subject: '方案评审议程', from: { name: '林同事' }, dateTimeReceived: '2026-11-17T16:40:00+08:00', isRead: true }]);
      assert.deepEqual(args, ['mail', 'get', '--item-id', 'mail-1', '--body-type', 'Text']);
      return JSON.stringify({ body: '方案评审确认议程。' });
    },
  };

  const office = new OfficeWorkbench(dir, deps);
  const snapshot = await office.refresh();
  assert.equal(snapshot.connected, true);
  assert.deepEqual(snapshot.items.map(item => item.kind), ['awaiting', 'commitment']);
  const [item, commitment] = snapshot.items;
  assert.equal(item.title, '补压测结果');
  assert.equal(item.deadline, '2026-11-18T01:55:00.000Z');
  assert.equal(commitment.deadline, '2026-11-20');
  assert.deepEqual(snapshot.brief.priorities, [item.id]);
  assert.equal(snapshot.brief.meetings.length, 1);
  assert.equal(snapshot.materials.some(material => material.title === '另一个账号的评审'), false);
  const source = await office.material(item.source.id);
  assert.equal(source.text, quote);
  assert.deepEqual(source.context?.map(line => line.text), ['文件已放群里。', '议程以日历为准。']);
  const meeting = await office.material(item.related!.id);
  assert.equal(meeting.meeting?.taskId, 'calendar');
  assert.equal(meeting.meeting?.providers.length, 2);
  assert.equal(snapshot.brief.meetings[0], meeting.id);

  const mail = snapshot.materials.find(row => row.kind === 'mail')!;
  assert.equal((await office.material(mail.id, false)).text, '');
  assert.equal(commands.length, 1);
  assert.equal((await office.material(mail.id)).text, '方案评审确认议程。');
  const proposed = await office.todo(item.id);
  assert.deepEqual(proposed, { itemId: item.id, title: item.title, dateAt: item.deadline, source: item.source });

  mailOffline = true; now += 60000;
  const degraded = await office.refresh();
  assert.equal(degraded.coverage.mail.state, 'cached');
  assert.equal(degraded.coverage.mail.lastSuccessAt, initialTime);
  assert.equal((await office.material(mail.id)).text, '方案评审确认议程。');
  assert.equal(commands.filter(args => args[1] === 'get').length, 1);
  assert.ok(degraded.items.some(entry => entry.id === item.id));
  assert.equal((await office.dismiss(item.id)).items.some(entry => entry.id === item.id), false);
  assert.equal((await new OfficeWorkbench(dir, deps).state()).items.some(entry => entry.id === item.id), false);

  uid = 'z00111111';
  const changed = await office.state();
  assert.deepEqual(changed.materials.filter(row => row.kind === 'mail' || row.kind === 'group'), []);
  await assert.rejects(() => office.material(source.id), /不在当前账号|读取范围/);
  await assert.rejects(() => office.material(mail.id), /不在当前账号|读取范围/);
  uid = '';
  assert.equal((await office.state()).connected, false);
});

test('unknown or conflicting dates remain unconfirmed and mail parsers retain source identity', () => {
  assert.equal(officeDeadline('09:55 前交一下结果', initialTime), null);
  assert.equal(officeDeadline('今天 09:55 前或明天提交结果', initialTime), null);
  assert.equal(officeDeadline('明天 25:70 前交结果', initialTime), null);
  assert.equal(officeDeadline('今天下午 3:15 前交结果', initialTime), '2026-11-18T07:15:00.000Z');
  assert.equal(parseOfficeMailList('ItemId | Read | From | Subject | Date\nid-2 | N | sam | 请核对结果 | 2026-11-18 08:00')[0].unread, true);
  assert.throws(() => parseOfficeMailList('无效返回'), /保留原记录/);
});

test('workspace suggestions use the existing Bot chat confirmation and keep draft and writes idempotent', async t => {
  const dir = temporary(t), ai = new AiStore(dir, { recover: false }), todo = new Store(join(dir, 'test-todo.db'));
  const bots = new BotStore(ai, dir);
  let writes = 0;
  const host = new BotHost(bots, {
    run: async () => { throw new Error('A prepared office suggestion must never start a model run.'); },
    apply: async action => {
      writes++;
      return { appliedCount: 1, ...todo.applyPlan(aiPlanSchema.parse(action.payload.plan), new Map()) };
    },
  });
  try {
    const office = bots.cards().find(bot => bot.seedKey === 'office')!;
    const draft = bots.saveDraft(office.mainChatId, 0, { text: '未发送的原草稿', replyToTaskId: null, resources: [] });
    const item = { itemId: '1'.repeat(32), title: '补压测结果', dateAt: '2026-11-18T01:55:00.000Z',
      source: { id: 'a'.repeat(32), label: '查看群消息' } };
    const load = async () => item;
    const forbidden = { id: 'island:fixture', kind: 'island' };
    assert.throws(() => botService(host, 'prepareOfficeTodo', [item.itemId], forbidden, load), /主窗口/);
    const surface = { id: 'main:fixture', kind: 'main' };
    const prepare = () => botService(host, 'prepareOfficeTodo', [item.itemId], surface, load) as Promise<BotAction>;
    const [a, b] = await Promise.all([prepare(), prepare()]);
    assert.equal(a.id, b.id);
    assert.equal(bots.task(a.taskId).chatId, office.mainChatId);
    assert.equal(bots.task(a.taskId).status, 'waiting_user');
    assert.deepEqual(bots.draft(office.mainChatId), draft);
    assert.deepEqual(ai.chat(office.mainChatId).entries[1].officeSource, item.source);
    assert.equal(ai.chat(office.mainChatId).entries.length, 2);
    assert.equal(todo.all().length, 0);
    const receipt = await host.answerAction(a.id, a.revision, { approved: true, indices: [0] });
    assert.equal(receipt.status, 'applied');
    await host.answerAction(a.id, a.revision, { approved: true, indices: [0] });
    assert.equal((await prepare()).id, a.id);
    assert.equal(writes, 1);
    assert.deepEqual(todo.all().map(task => [task.title, task.dateAt]), [['补压测结果', item.dateAt]]);
  } finally {
    await host.stop();
    todo.close();
    ai.close();
  }
});

test('upgrading an existing six-Bot database adds the office Bot without replacing existing chats', t => {
  const dir = temporary(t), ai = new AiStore(dir, { recover: false });
  try {
    const bots = new BotStore(ai, dir), office = bots.cards().find(bot => bot.seedKey === 'office')!;
    ai.db.prepare('DELETE FROM bot_chat_links WHERE bot_id=?').run(office.id);
    ai.db.prepare('DELETE FROM bots WHERE id=?').run(office.id);
    const existing = bots.cards().map(bot => [bot.id, bot.mainChatId]);
    const upgraded = new BotStore(ai, dir);
    assert.deepEqual(upgraded.cards().filter(bot => bot.seedKey !== 'office').map(bot => [bot.id, bot.mainChatId]), existing);
    const added = upgraded.cards().find(bot => bot.seedKey === 'office')!;
    assert.equal(ai.chat(added.mainChatId).viewId, 'workspace:office');
    assert.equal(new BotStore(ai, dir).cards().find(bot => bot.seedKey === 'office')?.id, added.id);
  } finally { ai.close(); }
});
