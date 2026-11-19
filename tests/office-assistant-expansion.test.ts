import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { OfficeWorkbench } from '../electron/office-workbench';
import { welinkReminderId } from '../electron/welink-message-reminders';
import { officeAutomationSchema, type OfficeBriefReader } from '../shared/office-workbench';
import { newTask, type Task } from '../shared/todo-contracts';
import type { WelinkMessage } from '../shared/welink-reminders';

function fixture(t: TestContext, briefModel?: (prompt: string, read: OfficeBriefReader) => Promise<string | null>) {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-office-jobs-'));
  let now = Date.parse('2026-11-18T08:40:00+08:00'), account = 'tester', mode = 'empty', failModel = false;
  let beforeBrief: (() => Promise<void>) | undefined;
  const calls: string[][] = [], historyReads: (string | undefined)[] = [], dismissed = new Set<string>(), notices: string[] = [], tasks: Task[] = [], links = {} as Record<string, string>;
  const messages: WelinkMessage[] = [
    { id: '7', conversation: 'group:53', conversationName: '星桥验收群', group: true, sender: '同事', mine: false, atMe: true, at: now - 60000, text: '请确认星桥验收的负责人？' },
    { id: '8', conversation: 'group:53', conversationName: '星桥验收群', group: true, sender: 'tester', mine: true, atMe: false, at: now - 30000, text: '今天我会整理星桥验收材料。' },
  ];
  const supplemental: WelinkMessage[] = [];
  const mail = (id: string) => ({ itemId: id, subject: '记录 ' + id, dateTimeReceived: '2026-11-18T08:00:00+08:00', isRead: false });
  const first = Array.from({ length: 100 }, (_, index) => mail(String(index)));
  const office = new OfficeWorkbench(dir, {
    now: () => now, account: async () => account, email: () => '', tasks: () => tasks, todoLinks: async () => links, notify: notice => notices.push(notice.id),
    agenda: () => ({ syncing: false, lastSuccessAt: null, error: '' }), messageSettings: () => ({ enabled: false, keywords: [], waitHours: 4 }),
    messages: {
      officeDismiss: (_account, id) => { dismissed.add(id); },
      officeSnapshot: () => ({ messages: messages.filter(row => row.at >= now - 36 * 3600000), lastReadAt: now, partial: false, dismissed: [...dismissed] }),
      refresh: async () => ({ syncing: false, account, lastSuccessAt: now, conversations: 1, messages: messages.length, partial: false, error: '', reminders: [] }),
      officeHistory: async (_account, query) => {
        historyReads.push(query.conversation);
        if (mode === 'brief-read-failure') throw new Error('mock live read timed out');
        return { messages: [...messages, ...supplemental], conversations: [], checked: 1, incomplete: [] };
      },
    },
    async run(args) {
      calls.push(args);
      if (args.includes('get')) return JSON.stringify({ body: '归档邮件正文' });
      if (!args.includes('--is-read')) return mode === 'archive' ? JSON.stringify([{ ...mail('archived'), isRead: true }]) : 'No messages found.';
      if (mode === 'limited') return JSON.stringify({ code: '429', message: '过于频繁' });
      if (mode === 'brief') return JSON.stringify([{ ...mail('main'), subject: '星桥材料待确认', importance: 'High', bodyPreview: '请核对评审附件' }]);
      if (mode === 'early') return JSON.stringify({ data: { items: [mail('X')], hasMore: true, total: 200 } });
      if (mode === 'repeat') return JSON.stringify(first);
      if (mode === 'overlap') return JSON.stringify(args.at(-1) === '0' ? first : [mail('99'), mail('101')]);
      return 'No messages found.';
    },
    async model(prompt) {
      if (failModel) throw Error('mock model unavailable');
      const data = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
      if (Array.isArray(data)) return JSON.stringify(data.map((item: { id: string }) => ({ id: item.id, verdict: 'reply', reason: '还在等待负责人' })));
      await beforeBrief?.();
      return JSON.stringify({
        meetings: data.meetings.map((row: { source: string }) => ({ source: row.source, preparation: '带上验收材料', title: '模型改写的标题', dateAt: '2031-12-01T15:59:00+08:00' })),
        awaiting: [{ source: 'e'.repeat(32), text: '未知条目' }, ...data.awaiting.slice(0, 1).map((row: { source: string }) => ({ source: row.source, text: '当天必须核对' }))],
        commitments: data.commitments.map((row: { source: string }) => ({ source: row.source, text: '整理后回给项目同事', deadline: '2031-12-01' })),
        groups: data.groups.map((row: { source: string }) => ({ source: row.source, text: '核对群公告的附件', guess: true })),
        mail: [...data.awaiting.slice(0, 1).map((row: { source: string }) => ({ source: row.source, text: '放错栏目的内容' })),
          ...data.mail.map((row: { source: string }) => ({ source: row.source, text: '核对高优先级邮件附件' }))],
      });
    },
    briefModel,
  });
  t.after(() => { office.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); });
  return { office, calls, historyReads, dismissed, notices, tasks, links, messages, supplemental, time: () => now,
    advance: (value: number) => { now += value; }, mode: (value: string) => { mode = value; }, account: (value: string) => { account = value; },
    beforeBrief: (callback: () => Promise<void>) => { beforeBrief = callback; }, failModel: () => { failModel = true; } };
}

test('CMO unread paging keeps overlaps, flags early and repeated pages, and persists rate-limit backoff', async t => {
  const f = fixture(t), query = { kind: 'mail', mailbox: 'unread' } as const;
  f.mode('overlap'); await f.office.refreshUnread();
  assert.equal((await f.office.search(query)).total, 101);
  f.mode('early'); await f.office.refreshUnread();
  assert.equal((await f.office.state()).unreadMail.state, 'partial');
  assert.match((await f.office.state()).unreadMail.detail!, /提前结束/);
  assert.equal((await f.office.search(query)).total, 102);
  f.mode('repeat'); await f.office.refreshUnread();
  assert.match((await f.office.state()).unreadMail.detail!, /重复返回/);
  f.mode('limited'); await f.office.refreshUnread();
  assert.equal((await f.office.state()).unreadMail.retryAt, f.time() + 20 * 60000);
  const calls = f.calls.length;
  assert.equal(await f.office.refreshUnread(), false); assert.equal(f.calls.length, calls);
  await f.office.refresh(false); assert.equal(f.calls.length, calls);
  f.advance(20 * 60000);
  await f.office.refreshUnread(); assert.equal((await f.office.state()).unreadMail.retryAt, f.time() + 40 * 60000);
  f.mode('empty'); await f.office.refresh();
  assert.equal((await f.office.state()).unreadMail.retryAt, undefined);
  assert.equal((await f.office.search(query)).total, 0);
});

test('daily brief preserves source facts, offers AI reasons, saves by day and falls back on failure', async t => {
  const f = fixture(t);
  f.mode('brief');
  f.supplemental.push({ ...f.messages[0], id: '9', conversation: 'group:72', conversationName: '补读的公告群', atMe: false, atAll: true, text: '请大家核对群公告的附件。' });
  await f.office.search({ live: true, conversation: 'group:72', from: '2026-11-18', to: '2026-11-18' });
  const stamp = new Date(f.time()).toISOString(), dateAt = '2026-11-18T09:00:00+08:00', endAt = '2026-11-18T10:00:00+08:00';
  f.tasks.push({ ...newTask('星桥验收会'), id: 'brief-meeting', kind: 'meeting', dateAt, endAt,
    createdAt: stamp, updatedAt: stamp, deletedAt: null, completedAt: null, notifiedFor: null });
  let release!: () => void, start!: () => void;
  const entered = new Promise<void>(resolve => { start = resolve; });
  const waiting = new Promise<void>(resolve => { release = resolve; });
  f.beforeBrief(() => { start(); return waiting; });
  await f.office.configure(officeAutomationSchema.parse({ brief: true, briefTime: '08:30' }));
  const scheduled = f.office.tick();
  try {
    await Promise.race([entered, scheduled.then(() => { throw new Error('Model was not called'); })]);
    const rules = await f.office.brief();
    assert.ok(rules?.organizing); assert.equal(rules.model, false); assert.equal(rules.meetings[0].title, '星桥验收会');
    assert.equal(rules.sections?.mail[0].title, '星桥材料待确认');
    assert.match(rules.sections?.groups[0].text ?? '', /@所有人/);
  } finally { release(); await scheduled; }
  const today = await f.office.brief('2026-11-18');
  assert.ok(today?.model); assert.ok(today.items.some(item => item.why === '当天必须核对'));
  assert.equal(today.organizing, false); assert.match(today.note!, /2 条/);
  assert.equal(today.meetings[0].title, '星桥验收会'); assert.equal(today.meetings[0].meeting?.dateAt, dateAt);
  assert.equal(today.meetings[0].meeting?.endAt, endAt); assert.equal(today.meetings[0].preparation, '带上验收材料');
  assert.ok(!JSON.stringify(today).includes('未知条目') && !JSON.stringify(today).includes('放错栏目'));
  assert.equal(today.sections?.commitments[0].deadline, '2026-11-18');
  assert.equal(today.sections?.groups[0].guess, true);
  assert.equal(today.sections?.mail[0].text, '核对高优先级邮件附件');
  assert.equal((await f.office.material(today.sections!.mail[0].source.id)).preview, '请核对评审附件');
  assert.match(today.coverage!.mail.scope, /未读收件箱/);
  assert.match(today.coverage!.messages.scope, /含已补读 1 条/);
  assert.match((await f.office.material(today.sections!.groups[0].source.id)).scope ?? '', /定向补读/);
  assert.match((await f.office.material(today.items[0].source.id)).text, /星桥验收/);
  await f.office.tick(); assert.equal((await f.office.brief())?.generatedAt, today.generatedAt);
  await f.office.dismiss(today.sections!.awaiting[0].itemId!);
  assert.equal((await f.office.brief())!.sections!.awaiting.length, 0);
  f.advance(24 * 3600000); f.failModel();
  const next = await f.office.generateBrief();
  assert.equal(next.model, false); assert.match(next.note!, /保留按规则/);
  assert.deepEqual((await f.office.workflow()).days, ['2026-11-19', '2026-11-18']);
  assert.equal((await f.office.brief('2026-11-18'))?.items[0].source.id, today.items[0].source.id);
  assert.equal((await f.office.brief('2026-11-18'))?.sections?.awaiting.length, 1);
  assert.deepEqual((await f.office.scene({ kind: 'weekly' })).briefs?.map(brief => brief.day).sort(), ['2026-11-18', '2026-11-19']);
});

test('today brief pages candidates, reads a changed deadline and keeps both sources in history', async t => {
  const f = fixture(t, async (prompt, read) => {
    const initial = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
    const original = initial.awaiting[0].source;
    const page = await read({ kind: 'messages', source: original, live: true }) as { rows: { source: string; sender: string }[] };
    const updated = page.rows.find(row => row.sender === '项目负责人');
    assert.ok(updated);
    const proof = await read({ kind: 'original', source: updated.source }) as { source: string; text: string };
    assert.match(proof.text, /今天 17:00 前提交/);
    const emails = await read({ kind: 'page', section: 'mail', offset: 16 }) as { rows: { source: string }[]; nextOffset: number };
    assert.equal(emails.rows.length, 8);
    assert.equal(emails.nextOffset, 24);
    return JSON.stringify({ awaiting: [{ source: original, evidence: [proof.source], deadlineSource: proof.source, text: '在今天 17:00 前提交星桥材料' }],
      mail: [{ source: emails.rows[0].source, evidence: [proof.source], text: '不属于邮件的群消息' }, { source: emails.rows[0].source, text: '补读后纳入的邮件' }] });
  });
  f.mode('overlap');
  f.messages[0].text = '请明天 16:00 前提交星桥验收材料，可以吗？';
  f.supplemental.push({ ...f.messages[0], id: '10', sender: '项目负责人', at: f.time() - 10000, atMe: false, text: '星桥材料改为今天 17:00 前提交。' });
  const result = await f.office.generateBrief();
  const entry = result.sections?.awaiting[0];
  assert.ok(entry);
  assert.equal(entry.text, '在今天 17:00 前提交星桥材料');
  assert.equal(entry.deadline, '2026-11-18T09:00:00.000Z');
  assert.equal(entry.evidence?.length, 1);
  assert.equal(result.sections?.mail[0].text, '补读后纳入的邮件');
  assert.match(result.note ?? '', /1 条/);
  assert.deepEqual(f.historyReads, ['group:53']);
  f.advance(24 * 3600000);
  const saved = (await f.office.brief('2026-11-18'))?.sections?.awaiting[0];
  assert.deepEqual(saved?.evidence, entry.evidence);
  assert.match((await f.office.material(saved!.source.id)).text, /明天 16:00/);
  const material = await f.office.material(saved!.evidence![0].id);
  assert.match(material.text, /今天 17:00 前提交/);
  assert.match(material.scope ?? '', /定向补读/);
});

test('failed live brief reads leave the rule brief and a visible incomplete note', async t => {
  const f = fixture(t, async (prompt, read) => {
    const initial = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
    await read({ kind: 'messages', source: initial.awaiting[0].source, live: true });
    return null;
  });
  f.mode('brief-read-failure');
  const result = await f.office.generateBrief();
  assert.equal(result.model, false);
  assert.equal(result.organizing, false);
  assert.ok(result.sections?.awaiting.length);
  assert.match(result.note ?? '', /按规则排的简报.*补读未完成/);
  assert.deepEqual(f.historyReads, ['group:53']);
});

test('reply review follows the request context, dismissals reach reminders, and commitments follow linked todo status', async t => {
  const f = fixture(t);
  let awaiting = (await f.office.state()).items.find(item => item.kind === 'awaiting')!;
  assert.ok(awaiting.needsReplyReview);
  assert.equal(await f.office.reviewReplies(), 1);
  assert.equal((await f.office.state()).items.find(item => item.id === awaiting.id)?.review?.verdict, 'reply');
  f.messages.push({ ...f.messages[1], id: '9', at: f.time(), text: '新的不相关回复。' });
  awaiting = (await f.office.state()).items.find(item => item.kind === 'awaiting')!;
  assert.equal(awaiting.review, undefined);
  await f.office.dismiss(awaiting.id);
  assert.ok(f.dismissed.has(welinkReminderId('tester', 'group:53', '7', 'awaiting')));
  const item = (await f.office.workflow()).commitments[0];
  f.dismissed.add(welinkReminderId('tester', 'group:53', '8', 'commitment'));
  assert.equal((await f.office.workflow()).commitments[0].status, 'handled');
  const dateAt = '2026-11-20', stamp = new Date(f.time()).toISOString();
  f.tasks.push({ ...newTask(item.title), id: 'todo-fixture', dateAt, createdAt: stamp, updatedAt: stamp, deletedAt: null, completedAt: null, notifiedFor: null });
  f.links[item.id] = 'todo-fixture'; f.advance(48 * 3600000);
  assert.equal((await f.office.workflow()).commitments[0].deadline, dateAt);
  f.tasks[0].status = 'done';
  assert.equal((await f.office.workflow()).commitments[0].status, 'done');
  assert.equal((await f.office.todo(item.id)).source.id, item.source.id);
});

test('office scenes choose relevant meeting, conversation, draft source and unread mailbox', async t => {
  const f = fixture(t), now = new Date(f.time()).toISOString();
  f.tasks.push({ ...newTask('星桥验收评审'), id: 'meeting-review', kind: 'meeting', dateAt: '2026-11-18T09:00:00+08:00',
    createdAt: now, updatedAt: now, deletedAt: null, completedAt: null, notifiedFor: null });
  const draft = (await f.office.state()).items.find(item => item.kind === 'awaiting')!;
  assert.equal((await f.office.scene({ kind: 'draft', sourceId: draft.source.id })).rows[0].id, draft.source.id);
  const prep = await f.office.scene({ kind: 'prep', sourceId: await f.office.meetingSource('meeting-review') });
  assert.equal(prep.rows[0].kind, 'meeting');
  assert.ok(prep.rows.slice(1).some(row => row.kind === 'group'));
  const group = await f.office.scene({ kind: 'group', conversation: 'group:53' });
  assert.equal(group.rows.length, 2); assert.match(group.scope, /定向补读/);
  f.mode('early'); await f.office.refreshUnread();
  const mail = await f.office.scene({ kind: 'mail' });
  assert.equal(mail.rows.length, 1); assert.equal(mail.rows[0].kind, 'mail');
});

test('nightly archive persists data beyond recent cache and scopes retrieval to the signed-in account', async t => {
  const f = fixture(t);
  f.mode('archive');
  await f.office.archiveNow(); f.advance(5 * 86400000);
  assert.equal((await f.office.search({ keyword: '负责人' })).total, 0);
  const archive = await f.office.search({ archive: true, keyword: '负责人', group: '星桥' });
  assert.equal(archive.total, 1); assert.match((await f.office.material(archive.rows[0].id)).text, /负责人/);
  const mail = await f.office.search({ archive: true, kind: 'mail' });
  assert.equal(mail.total, 1);
  assert.equal((await f.office.material(mail.rows[0].id)).text, '归档邮件正文');
  const calls = f.calls.length;
  assert.equal((await f.office.material(mail.rows[0].id)).text, '归档邮件正文');
  assert.equal(f.calls.length, calls);
  f.account('different');
  assert.equal((await f.office.search({ archive: true, keyword: '负责人' })).total, 0);
  await assert.rejects(() => f.office.material(archive.rows[0].id), /当前账号/);
});

test('office reminders publish once per matching meeting or day', async t => {
  const f = fixture(t), stamp = new Date(f.time()).toISOString();
  for (const [index, hour] of ['09:00', '09:30', '10:10'].entries()) {
    const dateAt = '2026-11-18T' + hour + ':00+08:00';
    f.tasks.push({ ...newTask('星桥验收 ' + index), id: 'meeting-' + index, kind: 'meeting', dateAt,
      endAt: new Date(Date.parse(dateAt) + 25 * 60000).toISOString(), createdAt: stamp, updatedAt: stamp, deletedAt: null, completedAt: null, notifiedFor: null });
  }
  await f.office.configure(officeAutomationSchema.parse({ reminders: true }));
  await f.office.tick(); await f.office.tick();
  assert.equal(f.notices.filter(id => id.startsWith('prep:')).length, 1);
  assert.equal(f.notices.filter(id => id.startsWith('crowded:')).length, 1);
  f.advance(10 * 3600000);
  await f.office.tick(); await f.office.tick();
  assert.equal(f.notices.filter(id => id.startsWith('summary:')).length, 1);
});
