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
import { WelinkMessageReminders } from '../electron/welink-message-reminders';
import { Store } from '../modules/todo/store';
import type { BotAction } from '../shared/bot-contracts';
import { aiPlanSchema, newTask, type Task } from '../shared/todo-contracts';
import type { WelinkMessage } from '../shared/welink-reminders';
import { officeCitationText, officeSearchSchema } from '../shared/office-workbench';

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
    { ...base, welinkMeetingNo: '900001', external: { provider: 'meeting', account: uid, id: 'meeting-1' } },
    { ...base, id: 'calendar', external: { provider: 'calendar', account: uid, id: 'event-2', changeKey: 'revision-1' }, welinkLinkedTo: { provider: 'meeting', id: 'meeting-1', meetingNo: '900001', verifiedAt: dateAt, calendarChangeKey: 'revision-1' } },
    { ...base, id: 'foreign', title: '另一个账号的评审', external: { provider: 'calendar', account: 'z00111111', id: 'foreign-event' } },
  ];
  const deps = {
    account: async () => uid || undefined, email: () => 'fixture@example.test', now: () => now,
    messageSettings: () => ({ enabled: false, waitHours: 4, keywords: [] }),
    messages: {
      officeHistory: async () => { throw new Error('This fixture does not query historical messages'); },
      officeSnapshot: (account: string) => ({ messages: account === 'z00009999' ? messages.filter(message => message.at >= now - 36 * 3600000) : [], lastReadAt: account === 'z00009999' ? initialTime : null, partial: false }),
      refresh: async (settings: { enabled: boolean }) => {
        assert.equal(settings.enabled, true, 'the workspace can manually collect with reminders disabled');
        return { synced: true, syncing: false, lastSuccessAt: now, error: '', partial: false, account: uid, conversations: 2, messages: 4, reminders: [] };
      },
    },
    tasks: () => tasks, agenda: () => ({ syncing: false, lastSuccessAt: initialTime, error: '' }),
    run: async (args: string[]) => {
      commands.push(args);
      if (args[1] === 'list' && mailOffline) throw new Error('邮箱暂时不可用');
      if (args.includes('--is-read')) return 'No messages found.';
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
  const viewedBrief = await office.state(true);
  const briefSource = viewedBrief.brief.sources?.[item.source.id];
  assert.ok(briefSource);
  assert.equal((await office.material(briefSource.id)).originalId, item.source.id);
  const meeting = await office.material(item.related!.id);
  assert.equal(meeting.meeting?.taskId, 'calendar');
  assert.equal(meeting.meeting?.providers.length, 2);
  assert.equal(snapshot.brief.meetings[0], meeting.id);

  const mail = snapshot.materials.find(row => row.kind === 'mail')!;
  assert.equal((await office.material(mail.id, false)).text, '');
  assert.equal(commands.length, 2);
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
  messages.push({ ...group('16', '17:30', '设计稿已经同步到目录。'), mine: true, sender: uid, replyTo: '14' });
  assert.equal((await office.state()).items.find(entry => entry.id === item.id)?.needsReplyReview, true);
  assert.equal((await office.dismiss(item.id)).items.some(entry => entry.id === item.id), false);
  assert.equal((await new OfficeWorkbench(dir, deps).state()).items.some(entry => entry.id === item.id), false);

  now += 40 * 3600000;
  await assert.rejects(() => office.material(item.source.id), /读取范围/);
  assert.equal((await office.material(briefSource.id)).text, quote);
  assert.deepEqual((await office.search({ kind: 'group', preserved: true, keyword: '压测' })).rows.map(row => row.id), [briefSource.id]);

  uid = 'z00111111';
  const changed = await office.state();
  assert.deepEqual(changed.materials.filter(row => row.kind === 'mail' || row.kind === 'group'), []);
  await assert.rejects(() => office.material(source.id), /不在当前账号|读取范围/);
  await assert.rejects(() => office.material(mail.id), /不在当前账号|读取范围/);
  await assert.rejects(() => office.material(briefSource.id), /不在当前账号|读取范围/);
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
  assert.deepEqual(parseOfficeMailList(' No messages found.\r\n'), []);
  assert.equal(officeSearchSchema.safeParse({ from: '2026-02-30' }).success, false);
  assert.equal(officeSearchSchema.safeParse({ live: true }).success, false);
});

test('the office update joins a running poll and covers the remaining discovered WeLink conversations', async t => {
  const dir = temporary(t), checked: string[] = [];
  const ids = Array.from({ length: 50 }, (_, i) => `fixture-${i + 1}`);
  const listing = JSON.stringify({ conversation_info: ids.map(id => ({ recent_conversation_type: 'CHAT_TYPE_P2P_MSG', target_account: id })) });
  const account = async () => 'tester', messageSettings = () => ({ enabled: true, waitHours: 4, keywords: [] });
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const run = async (args: string[]) => {
    if (args[0] !== 'im') return '[]';
    if (args[1] === 'query-recent-conversation') return listing;
    checked.push(args[3]);
    if (checked.length === 1) { started.resolve(); await release.promise; }
    return JSON.stringify({ respData: { chatInfo: args[3] === 'fixture-28'
      ? [{ msgId: '128', serverSendTime: initialTime - 60000, sender: 'tester', content: '我今天晚上发你这个材料' }] : [] } });
  };
  const messages = new WelinkMessageReminders(dir, run, account, () => initialTime);
  let manualJoined = false;
  const office = new OfficeWorkbench(dir, { account, email: () => '', messages: {
    officeSnapshot: messages.officeSnapshot.bind(messages), officeHistory: messages.officeHistory.bind(messages),
    refresh: (...args) => { manualJoined = true; return messages.refresh(...args); },
  }, messageSettings, tasks: () => [], agenda: () => ({ syncing: false, lastSuccessAt: null, error: '' }), run, now: () => initialTime });
  const polling = messages.refresh(messageSettings());
  await started.promise;
  const manual = office.refresh();
  try { await new Promise<void>(resolve => setImmediate(resolve)); assert.equal(manualJoined, true); }
  finally { release.resolve(); }
  await polling;
  const snapshot = await manual;
  assert.deepEqual(checked, ids);
  assert.equal(snapshot.coverage.messages.state, 'fresh');
  const focus = await office.search({ kind: 'direct', range: 'focus' });
  assert.equal(focus.total, 1);
});

test('unread mailbox paginates independently, shares bodies, and keeps the last snapshot on a failed page', async t => {
  const dir = temporary(t), commands: string[][] = [];
  let mode: 'ok' | 'failed' | 'empty' = 'ok', now = initialTime;
  const account = async () => 'tester', settings = () => ({ enabled: false, waitHours: 4, keywords: [] });
  const unread = (id: string, date = '2026-11-10T08:00:00+08:00') => ({ itemId: id, subject: '未读 ' + id, dateTimeReceived: date, isRead: false });
  const recent = unread('same', '2026-11-18T08:00:00+08:00');
  const run = async (args: string[]) => {
    commands.push(args);
    if (args[1] === 'get') return JSON.stringify({ body: '留存的原始邮件正文' });
    if (args[0] === 'im') return '[]';
    if (!args.includes('--is-read')) return JSON.stringify([recent, { ...recent, itemId: 'read', subject: '已读议程', isRead: true }]);
    if (mode === 'empty') return 'No messages found.';
    if (args.at(-1) === '0') return JSON.stringify([recent, ...Array.from({ length: 99 }, (_, i) => unread(String(i)))]);
    if (mode === 'failed') throw new Error('第二页连接失败');
    return JSON.stringify([unread('last')]);
  };
  const messages = new WelinkMessageReminders(dir, run, account, () => now);
  const office = new OfficeWorkbench(dir, { account, email: () => '', messages, messageSettings: settings, tasks: () => [], agenda: () => ({ syncing: false, lastSuccessAt: null, error: '' }), run, now: () => now });
  assert.equal(await office.refreshUnread(), true);
  assert.ok(commands.every(args => args.includes('--is-read')));
  assert.deepEqual(commands.map(args => args.at(-1)), ['0', '100']);
  await office.refresh();
  const inbox = await office.search({ kind: 'mail', mailbox: 'recent' });
  const all = await office.search({ kind: 'mail', mailbox: 'unread' });
  assert.equal(inbox.total, 2); assert.equal(all.total, 101);
  assert.ok(inbox.rows.some(row => row.title === '已读议程'));
  assert.ok(all.rows.every(row => row.title !== '已读议程'));
  const same = inbox.rows.find(row => row.title === '未读 same')!;
  assert.equal(all.rows.find(row => row.title === same.title)?.id, same.id);
  const evidence = await office.cite(same.id, all.scope);
  assert.equal(evidence.text, '留存的原始邮件正文');
  assert.equal((await office.material(same.id)).text, evidence.text);
  assert.equal(commands.filter(args => args[1] === 'get').length, 1);
  mode = 'failed'; now += 60000;
  await office.refreshUnread();
  const failed = await office.state();
  assert.equal(failed.unreadMail.state, 'cached');
  assert.equal(failed.unreadMail.lastSuccessAt, initialTime);
  assert.equal((await office.search({ kind: 'mail', mailbox: 'unread' })).total, 101);
  mode = 'empty';
  await office.refreshUnread();
  assert.equal((await office.state()).unreadMail.state, 'fresh');
  assert.equal((await office.search({ kind: 'mail', mailbox: 'unread' })).total, 0);
  assert.equal((await office.search({ kind: 'mail', mailbox: 'recent' })).total, 2);
  assert.equal((await office.material(evidence.id)).text, evidence.text);
});

test('one search resolves old groups with paginated read-only history and keeps scoped evidence across cache changes', async t => {
  const dir = temporary(t), commands: string[][] = [];
  const groups = Array.from({ length: 21 }, (_, index) => ({ group_id: String(index + 33), group_name: `项目群 ${index + 1}`, recent_conversation_type: 'CHAT_TYPE_GROUP_MSG' }));
  const request = '请确认历史项目的验收时间？';
  const oldAt = Date.parse('2026-11-12T00:00:00+08:00');
  const full = Array.from({ length: 100 }, (_, i) => ({ msgId: String(1000 - i), serverSendTime: initialTime - i * 60000, sender: '林同事', content: '近期记录' }));
  let accountId = 'tester', text = request, now = initialTime;
  const account = async () => accountId;
  const run = async (args: string[]) => {
    commands.push(args);
    if (args[0] === 'mail') return 'No messages found.';
    if (args[1] === 'query-recent-conversation') return JSON.stringify({ conversation_info: groups });
    if (args.includes('34')) throw new Error('这个群暂时无法读取');
    if (!args.includes('53')) return '[]';
    const rows = args.includes('--message-id') ? [{ ...full.at(-1) }, { msgId: '900', serverSendTime: oldAt, sender: '林同事', content: text }] : full;
    return JSON.stringify({ resultCode: 0, respData: { chatInfo: rows } });
  };
  const deps = { account, email: () => '', messages: new WelinkMessageReminders(dir, run, account, () => now), messageSettings: () => ({ enabled: false, waitHours: 4, keywords: [] }),
    tasks: () => [], agenda: () => ({ syncing: false, lastSuccessAt: null, error: '' }), run, now: () => now };
  const office = new OfficeWorkbench(dir, deps);
  await office.refresh();
  const query = { from: '2026-11-12', to: '2026-11-12', keyword: '历史项目' };
  const cached = await office.search(query);
  assert.equal(cached.total, 0);
  assert.ok(cached.conversations.some(entry => entry.key === 'group:53' && entry.name === '项目群 21'));
  commands.length = 0;
  const read = await office.search({ ...query, conversation: 'group:53', live: true });
  assert.equal(read.total, 1); assert.equal(read.live?.partial, false);
  assert.ok(commands.every(args => args.includes('--group-id') && args.includes('53')));
  assert.deepEqual(commands.map(args => args.includes('--message-id') ? args.at(-1) : ''), ['', '901']);
  assert.match(read.scope, /定向补读.*2026-11-12.*项目群 21/);
  const original = await office.cite(read.rows[0].id, read.scope);
  assert.equal(original.text, request);
  assert.equal(original.scope, read.scope);
  assert.ok(original.preserved); assert.notEqual(original.id, read.rows[0].id);
  text = '历史项目的验收时间已改'; now += 1000;
  await office.search({ ...query, conversation: 'group:53', live: true });
  assert.equal((await office.material(read.rows[0].id)).text, text);
  const reopened = new OfficeWorkbench(dir, deps);
  assert.equal((await reopened.material(original.id)).text, request);
  assert.equal((await reopened.search({ ...query, person: '林同事', group: '项目群 21' })).total, 1);
  const broad = await office.search({ ...query, live: true });
  assert.ok(broad.live?.partial && broad.live.incomplete.some(name => name === '项目群 2'));
  assert.match(broad.scope, /跨会话补查.*部分未取全/);
  assert.equal(broad.total, 1, 'a cached known result remains accessible when a live run is incomplete');
  assert.equal((await office.state()).items.length, 0, 'historical search never adds an old message to the operational inbox');
  accountId = 'other';
  await assert.rejects(office.material(original.id), /不在当前账号/);
  assert.equal((await office.search(query)).total, 0);
  const refs: { id: string; label: string }[] = [];
  assert.equal(officeCitationText(`可查出处【资料:${original.id}】，无效出处【资料:${'e'.repeat(32)}】`, new Map([[original.id, original]]), refs), '可查出处[1]，无效出处');
  assert.deepEqual(refs.map(ref => ref.id), [original.id]);
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
