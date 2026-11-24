import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';
import { OfficeWorkbench } from '../electron/office-workbench';
import { OfficeAnalysisStore } from '../electron/office-analysis';
import { welinkReminderId } from '../electron/welink-message-reminders';
import { officeAutomationSchema, type OfficeBriefReader } from '../shared/office-workbench';
import { newTask, type Task } from '../shared/todo-contracts';
import type { WelinkMessage } from '../shared/welink-reminders';

function fixture(t: TestContext, briefModel?: (prompt: string, read: OfficeBriefReader) => Promise<string | null>) {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-office-jobs-'));
  let now = Date.parse('2026-11-18T08:40:00+08:00'), account = 'tester', mode = 'empty', failModel = false;
  let beforeBrief: (() => Promise<void>) | undefined;
  let reviewAnswer: ((rows: { id: string; kind: string; title: string; text: string }[]) => unknown) | undefined;
  const keywords: string[] = [];
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
    agenda: () => ({ syncing: false, lastSuccessAt: null, error: '' }), messageSettings: () => ({ enabled: false, keywords, waitHours: 4 }),
    messages: {
      officeDismiss: (_account, id) => { dismissed.add(id); },
      officeSnapshot: () => ({ messages: messages.filter(row => row.at >= now - 36 * 3600000), lastReadAt: now, partial: false, dismissed: [...dismissed] }),
      refresh: async () => ({ syncing: false, account, lastSuccessAt: now, conversations: 1, messages: messages.length, partial: false, error: '', reminders: [] }),
      officeHistory: async (_account, query) => {
        historyReads.push(query.conversation);
        if (mode === 'brief-read-failure') throw new Error('mock live read timed out');
        return { messages: [...messages, ...supplemental], conversations: [], checked: 1, incomplete: mode === 'targeted-partial' ? ['星桥验收群'] : [] };
      },
    },
    async run(args) {
      calls.push(args);
      if (args.includes('get')) return JSON.stringify({ body: '归档邮件正文' });
      if (mode === 'focus') return JSON.stringify([{ ...mail('action-mail'), subject: '请于明天提交验收单' },
        ...(!args.includes('--is-read') ? [{ ...mail('notice-mail'), subject: '周报已发布', isRead: true }] : [])]);
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
      if (Array.isArray(data)) return JSON.stringify(await reviewAnswer?.(data) ?? data.map((item: { id: string; text: string }) => ({ id: item.id,
        verdict: 'action', nextStep: '核对验收分工', reason: '还在等待负责人', evidence: item.text })));
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
  return { dir, office, calls, historyReads, dismissed, notices, tasks, links, messages, supplemental, keywords, time: () => now,
    advance: (value: number) => { now += value; }, mode: (value: string) => { mode = value; }, account: (value: string) => { account = value; },
    beforeBrief: (callback: () => Promise<void>) => { beforeBrief = callback; }, failModel: () => { failModel = true; },
    reviewAnswer: (callback: NonNullable<typeof reviewAnswer>) => { reviewAnswer = callback; } };
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

test('follow-ups require a current AI decision, dismissals reach reminders, and commitments follow linked todo status', async t => {
  const f = fixture(t);
  const awaiting = (await f.office.state()).items.find(item => item.kind === 'awaiting')!;
  assert.ok(awaiting.needsReplyReview);
  assert.deepEqual((await f.office.state()).followUps.items, []);
  assert.equal(await f.office.reviewFollowUps(), 2);
  assert.equal((await f.office.state()).followUps.items.find(item => item.id === awaiting.id)?.followUp?.nextStep, '核对验收分工');
  f.messages.push({ ...f.messages[1], id: '9', at: f.time(), text: '新的不相关回复。' });
  const updated = await f.office.state();
  assert.equal(updated.followUps.items.some(item => item.id === awaiting.id), false);
  assert.equal(updated.materials.find(row => row.id === awaiting.source.id)?.reviewStatus, 'pending');
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

test('focus keeps exact rule words, joins nearby cache and history, and the same filters work in all-read mode', async t => {
  const f = fixture(t);
  f.keywords.push('专项');
  const direct = { ...f.messages[0], conversation: 'user:li', conversationName: '小李', group: false, atMe: false };
  const row = (id: number, text: string) => ({ ...direct, id: String(id), at: f.time() - (10 - id) * 1000, text });
  f.messages.push(row(3, '收到甲'), row(4, '请提交专项清单？'), row(5, '确认甲已知'), row(6, '收到乙'), row(7, '周会普通闲聊'));
  f.supplemental.push(row(1, '范围之外的上文'), row(2, '资料背景'));

  const query = { range: 'focus', conversation: direct.conversation, keyword: '专项', from: '2026-11-18', to: '2026-11-18' } as const;
  const first = await f.office.conversationMessages(query);
  assert.deepEqual(first.rows.map(row => row.text), ['收到乙', '确认甲已知', '请提交专项清单？', '收到甲']);
  await f.office.search({ ...query, live: true }, true);
  assert.deepEqual(f.historyReads, ['user:li']);
  const page = await f.office.conversationMessages(query);
  assert.deepEqual(page.rows.map(row => row.text), ['收到乙', '确认甲已知', '请提交专项清单？', '收到甲', '资料背景']);
  assert.equal(page.total, 5);
  const matched = page.rows.find(row => !row.surrounding)!;
  assert.deepEqual(matched.focus?.rules, ['direct-request', 'keyword']);
  const words = matched.focus?.text?.map(({ start, end }) => matched.text.slice(start, end));
  assert.deepEqual(new Set(words), new Set(['请', '专项', '？']));
  assert.ok(page.rows.filter(row => row.surrounding).every(row => !row.focus));
  const all = await f.office.conversationMessages({ ...query, range: 'all', keyword: undefined });
  assert.equal(all.total, 7);
  assert.ok(all.rows.some(row => row.text === '周会普通闲聊'));
  assert.equal((await f.office.conversationMessages({ ...query, range: 'all' })).total, 1);
});

test('focus matches and highlights each extra private request word', async t => {
  const f = fixture(t);
  const direct = { ...f.messages[0], conversation: 'user:li', conversationName: '小李', group: false, atMe: false };
  const words = ['新建', '帮忙', '群组', '目录', '删除', '删掉', '新增', '申请', '增加', '发给'];
  f.messages.push(
    ...words.map((word, index) => ({ ...direct, id: String(index + 10), text: `关于${word}的资料` })),
    { ...direct, id: '20', text: '收到！' },
    { ...direct, id: '21', text: '这里有新增的资料', sender: 'tester', mine: true },
    { ...direct, id: '22', conversation: 'group:li', group: true, atMe: true, text: '新建目录' },
  );
  const page = await f.office.conversationMessages({ range: 'focus', conversation: direct.conversation });
  const hits = page.rows.filter(row => !row.surrounding);
  assert.equal(hits.length, words.length);
  for (const word of words) {
    const row = hits.find(row => row.text === `关于${word}的资料`);
    assert.deepEqual(row?.focus?.rules, ['direct-request'], word);
    assert.deepEqual(row?.focus?.text?.map(({ start, end }) => row.text.slice(start, end)), [word]);
  }
  const group = await f.office.conversationMessages({ range: 'focus', conversation: 'group:li' });
  assert.deepEqual(group.rows[0]?.focus, { rules: ['mention'], text: [] });
});

test('private focus skips interjection question marks and keeps independent request matches', async t => {
  const f = fixture(t);
  const direct = { ...f.messages[0], conversation: 'user:li', conversationName: '小李', group: false, atMe: false };
  const interjections = ['哦？', '噢?', '原来是这样哦？', '噢 ？?'];
  const request = '哦？请把清单发给我';
  const question = '噢？清单看过了吗？';
  const texts = [...interjections, request, question];
  f.messages.push(...texts.map((text, index) => ({ ...direct, id: String(index + 10), text })));

  const page = await f.office.conversationMessages({ range: 'focus', conversation: direct.conversation });
  const hits = page.rows.filter(row => !row.surrounding);
  assert.deepEqual(new Set(hits.map(row => row.text)), new Set([request, question]));
  const requestRow = hits.find(row => row.text === request)!;
  assert.deepEqual(requestRow.focus?.text?.map(({ start, end }) => request.slice(start, end)), ['请', '发给']);
  const questionRow = hits.find(row => row.text === question)!;
  assert.deepEqual(questionRow.focus?.text, [{ start: question.length - 1, end: question.length }]);
  const all = await f.office.conversationMessages({ range: 'all', conversation: direct.conversation });
  assert.ok(interjections.every(text => all.rows.some(row => row.text === text && !row.focus)));
});

test('focus marks gaps only when a known message between the visible excerpts is skipped', async t => {
  const f = fixture(t);
  const message = f.messages[0], start = f.time() - 7 * 3600000;
  f.keywords.push('专项');
  const texts = ['上午背景', '上午确认', '专项清单已更新', '上午回复', '上午补充', '中间的闲聊',
    '下午背景', '下午确认', '专项排期已更新', '下午回复', '下午补充'];
  f.messages.splice(0, f.messages.length, ...texts.map((text, index) => ({
    ...message, id: String(index + 1), at: start + index * 60000 + (index > 5 ? 5 * 3600000 : 0), text, atMe: false,
  })));
  const query = { conversation: message.conversation, range: 'focus' } as const;
  const page = await f.office.conversationMessages(query);
  assert.equal(page.total, 10);
  assert.deepEqual(page.rows.filter(row => row.gapBefore).map(row => row.text), ['下午背景']);
  const firstPage = await f.office.conversationMessages({ ...query, limit: 5 });
  assert.equal(firstPage.rows.at(-1)?.gapBefore, true, 'the gap is preserved when its older neighbor is on the next page');
  const full = await f.office.conversationMessages({ ...query, range: 'all' });
  assert.ok(full.rows.some(row => row.text === '中间的闲聊'));
  assert.ok(full.rows.every(row => !row.gapBefore));

  f.messages.splice(5, 1);
  const quiet = await f.office.conversationMessages(query);
  assert.equal(quiet.total, 10);
  assert.ok(quiet.rows.every(row => !row.gapBefore));
});

test('hourly review reports an active batch, shares it with manual review and uses AI task fields', async t => {
  const f = fixture(t);
  await f.office.refresh();
  await f.office.configure({ brief: false, briefTime: '08:30', review: true, archive: false, reminders: false });
  let batches = 0;
  const started = Promise.withResolvers<void>(), finish = Promise.withResolvers<void>();
  f.reviewAnswer(async rows => {
    if (++batches === 1) { started.resolve(); await finish.promise; }
    return rows.map(row => ({ id: row.id, verdict: 'action', title: '核对项目交付', nextStep: '回复确认结果',
      deadline: '2026-11-18T17:00:00+08:00', reason: '确认结果尚未给出', evidence: row.text || row.title }));
  });
  const automatic = f.office.tick();
  try {
    await started.promise;
    const active = (await f.office.state()).followUps;
    assert.ok(active.reviewing && active.reviewing <= 12);
    const manual = f.office.reviewFollowUps();
    finish.resolve();
    await automatic;
    await manual;
    assert.equal(batches, 1);
    const completed = (await f.office.state()).followUps;
    assert.equal(completed.reviewing, undefined);
    assert.ok(completed.items.length);
    assert.ok(completed.items.every(item => item.title === '核对项目交付' && item.deadline === '2026-11-18T17:00:00+08:00'));
    f.advance(59 * 60000);
    f.messages.push({ ...f.messages[0], id: '91', at: f.time(), text: '@tester 请补发周会记录。' });
    await f.office.tick();
    assert.equal(batches, 1);
    f.advance(60000);
    await f.office.tick();
    assert.equal(batches, 2);
    f.advance(60 * 60000);
    const checkedAt = (await f.office.state()).followUps.checkedAt;
    await f.office.tick();
    assert.equal(batches, 2);
    assert.equal((await f.office.state()).followUps.checkedAt, checkedAt);
  } finally { finish.resolve(); await automatic; }
});

test('AI only promotes confirmed, source-backed actions; uncertain material stays searchable', async t => {
  const f = fixture(t);
  f.mode('focus');
  const group = f.messages[0];
  f.messages.push({ ...group, id: '9', at: f.time(), text: '@tester 会议改到会议室 C。' },
    { ...group, id: '10', at: f.time(), text: '@tester 请核对这组数字。' },
    { ...group, id: '11', at: f.time(), atMe: false, text: '本周评审安排。' });
  f.tasks.push({ ...newTask('资料评审'), id: 'meeting-prep', kind: 'meeting', dateAt: '2026-11-18T14:00:00+08:00', note: '请在会前准备评审稿。' },
    { ...newTask('例行会议'), id: 'meeting-routine', kind: 'meeting', dateAt: '2026-11-18T15:00:00+08:00', note: '按既定安排开始。' });
  await f.office.refresh();
  assert.equal((await f.office.state()).followUps.items.length, 0);
  const grouped = { kind: 'group', range: 'focus', limit: 1 } as const;
  assert.equal((await f.office.search(grouped, true)).rows[0].pendingReviewCount, 4);
  assert.equal((await f.office.search({ ...grouped, keyword: '核对这组数字' }, true)).rows[0].pendingReviewCount, 1);
  f.reviewAnswer(rows => {
    assert.equal(rows.length, 6);
    assert.ok(rows.every(row => !/例行会议|周报已发布/.test(row.title)));
    return [...rows.map(row => row.text.includes('改到会议室') ? { id: row.id, verdict: 'no', reason: '普通通知' }
      : row.text.includes('核对这组数字') ? { id: row.id, verdict: 'maybe', reason: '责任人还不明确' }
        : { id: row.id, verdict: 'action', reason: '仍需跟进', nextStep: '完成这项工作',
          evidence: row.kind === 'commitment' ? '这句话没有出现在原文中' : row.text || row.title }),
    { id: 'f'.repeat(32), verdict: 'action', reason: '越界来源', nextStep: '提交', evidence: rows[0].text || rows[0].title }, { id: 'bad' }];
  });
  assert.equal(await f.office.reviewFollowUps(), 5);
  const actions = (await f.office.state()).followUps;
  assert.equal(actions.pending, 1, 'unsupported evidence leaves the original candidate unreviewed');
  assert.deepEqual(new Set(actions.items.map(item => item.kind)), new Set(['awaiting', 'mail', 'meeting']));
  assert.equal(actions.items.length, 3);
  const chat = await f.office.conversationMessages({ conversation: group.conversation, range: 'focus' });
  assert.equal(chat.rows.find(row => row.text.includes('核对这组数字'))?.focus?.needsCheck, true);
  assert.deepEqual(chat.rows.map(row => [row.text, row.reviewStatus]).sort(), [
    ['@tester 会议改到会议室 C。', 'no'], ['@tester 请核对这组数字。', 'maybe'],
    ['今天我会整理星桥验收材料。', 'pending'], ['本周评审安排。', undefined], ['请确认星桥验收的负责人？', 'action'],
  ].sort());
  assert.equal((await f.office.search(grouped, true)).rows[0].pendingReviewCount, 1);
  assert.equal((await f.office.search({ ...grouped, keyword: '核对这组数字' }, true)).rows[0].pendingReviewCount, undefined);
  const mail = (await f.office.search({ kind: 'mail', range: 'focus' })).rows[0];
  assert.deepEqual(mail.focus?.title?.map(({ start, end }) => mail.title.slice(start, end)), ['请', '提交']);
  assert.equal(mail.reviewStatus, 'action');
  assert.equal((await f.office.search({ kind: 'mail', range: 'all' })).total, 2);
  await f.office.material(mail.id);
  assert.equal((await f.office.state()).materials.find(row => row.id === mail.id)?.reviewStatus, 'pending');
  const meetings = await f.office.search({ kind: 'meeting', range: 'focus' }, true);
  assert.equal(meetings.total, 1);
  assert.equal(meetings.rows[0].preview, '请在会前准备评审稿。');
});

test('office commitments keep the promised clause, resolve direct acceptance, and recognize exact completion', async t => {
  const f = fixture(t), base = f.messages[1];
  f.messages.splice(0, f.messages.length,
    { ...base, id: '1', at: f.time() - 60000, text: '我突然发现，XX客户端的侧边栏，和WENOTE好像' },
    { ...base, id: '2', at: f.time() - 50000, text: '我看到他刚发了一个文件' },
    { ...base, id: '3', at: f.time() - 45000, text: '我建议让小李整理清单' },
    { ...base, id: '4', at: f.time() - 40000, text: '我发现清单缺了一项，我周五发修正版' },
    { ...base, id: '5', at: f.time() - 30000, mine: false, sender: '同事', text: '谁来整理这份清单？' },
    { ...base, id: '6', at: f.time() - 20000, text: '我来吧' },
  );
  const pending = (await f.office.workflow()).commitments;
  assert.equal(pending.length, 2);
  const send = pending.find(row => row.title.includes('修正版'))!, sort = pending.find(row => row.title.includes('整理这份清单'))!;
  assert.equal(send.deadline, '2026-11-20');
  assert.equal(send.reason, '承诺原话「我周五发修正版」。');
  assert.equal(sort.deadline, null);
  assert.match(sort.reason, /我来吧.*谁来整理这份清单/);
  f.messages.push({ ...base, id: '7', at: f.time() - 5000, text: '我已经发给你了', replyTo: '4' });
  const checked = await f.office.workflow();
  assert.equal(checked.commitments.find(row => row.id === send.id)?.status, 'handled');
  assert.match(checked.commitments.find(row => row.id === send.id)!.reason, /我已经发给你了/);
  assert.deepEqual((await f.office.state()).items.filter(row => row.kind === 'commitment').map(row => row.id), [sort.id]);
});

test('old unconfirmed commitments are rechecked from their saved quote without changing linked todos', async t => {
  const f = fixture(t), base = f.messages[1], hash = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
  f.messages.splice(0, f.messages.length,
    { ...base, id: '91', at: f.time() - 1000, text: '我突然发现界面有点像 WENOTE' },
    { ...base, id: '92', at: f.time() - 500, text: '我已经发给你了' });
  const prior = (await f.office.state()).materials;
  const analysis = new OfficeAnalysisStore(f.dir);
  const key = hash('tester', '');
  for (const row of prior) {
    const source = await f.office.cite(row.id);
    const id = hash(row.id, 'commitment');
    analysis.update(key, state => {
      state.commitments[id] = { id, kind: 'commitment', title: row.preview!, deadline: null, reason: '旧识别', status: 'open', recordedAt: f.time(), source };
    });
    if (row.preview === '我已经发给你了') {
      const stamp = new Date(f.time()).toISOString();
      f.links[id] = 'confirmed-fixture';
      f.tasks.push({ ...newTask('已确认的本地待办'), id: 'confirmed-fixture', createdAt: stamp, updatedAt: stamp, completedAt: null, deletedAt: null, notifiedFor: null });
    }
  }
  f.advance(48 * 3600000);
  const records = (await f.office.workflow()).commitments;
  assert.equal(records.length, 1);
  assert.equal(records[0].taskId, 'confirmed-fixture');
  assert.equal(records[0].status, 'linked');
  const excluded = Object.values(analysis.read(key).commitments).find(item => item.title.includes('发现'))!;
  assert.equal(excluded.recognized, false);
  assert.equal((await f.office.material(excluded.source.id)).text, '我突然发现界面有点像 WENOTE');
  await assert.rejects(f.office.todo(excluded.id), /已变化/);
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

test('the materials browser pages by conversation and opens individual collected messages', async t => {
  const f = fixture(t);
  const original = '评审背景。'.repeat(25) + '\nWENOTE 侧边栏观察';
  f.messages.push({ ...f.messages[0], id: '9', at: f.time() - 1000, text: original },
    { ...f.messages[0], id: '10', conversation: 'group:54', at: f.time() - 120000, text: '同名的另一个群' },
    { ...f.messages[0], id: '11', conversation: 'user:someone', conversationName: '同事', group: false, at: f.time() - 180000 });

  const sources = await f.office.search({ limit: 2 }, true);
  assert.equal(sources.total, 3);
  assert.deepEqual(sources.rows.map(row => row.conversation), ['group:53', 'group:54']);
  assert.equal(sources.rows[0].title, sources.rows[1].title);
  const moreSources = await f.office.search({ limit: 2, offset: 2 }, true);
  assert.deepEqual(moreSources.rows.map(row => row.conversation), ['user:someone']);
  assert.equal((await f.office.search({ kind: 'group' })).total, 4, 'existing search still returns individual hits');

  const query = { conversation: 'group:53', limit: 1 };
  const page = await f.office.conversationMessages(query);
  assert.equal(page.total, 3);
  assert.equal(page.rows[0].text, original);
  assert.equal(page.rows[0].id, sources.rows[0].id);
  assert.equal((await f.office.conversationMessages({ ...query, offset: 1 })).rows[0].text, f.messages[1].text);
  const keyword = { keyword: 'WENOTE' };
  assert.equal((await f.office.search(keyword, true)).rows[0].id, page.rows[0].id);
  assert.deepEqual((await f.office.conversationMessages({ ...query, ...keyword })).rows, page.rows);
  assert.equal(f.historyReads.length, 0);
  assert.equal(f.calls.length, 0);

  const citation = await f.office.cite(page.rows[0].id);
  await f.office.cite((await f.office.conversationMessages({ ...query, offset: 1 })).rows[0].id);
  const preserved = await f.office.search({ preserved: true }, true);
  assert.equal(preserved.total, 2);
  assert.ok(preserved.rows.every(row => !row.conversation));
  assert.equal((await f.office.material(citation.id)).text, original);

  await f.office.archiveNow();
  f.advance(3 * 86400000);
  const archive = await f.office.search({ archive: true, kind: 'group', limit: 2 }, true);
  assert.deepEqual(archive.rows.map(row => row.conversation), ['group:53', 'group:54']);
  const { reviewStatus, ...originalMessage } = page.rows[0];
  assert.equal(reviewStatus, 'pending');
  assert.deepEqual((await f.office.conversationMessages({ ...query, archive: true })).rows, [originalMessage]);
  f.account('different');
  assert.equal((await f.office.conversationMessages({ ...query, archive: true })).total, 0);
});

test('a chat citation opens its exact message within the normal conversation, even after the cache ages out', async t => {
  const f = fixture(t);
  const [message, context] = f.messages;
  const original = message.text;
  const query = { conversation: message.conversation, range: 'all', limit: 5 } as const;
  const row = (await f.office.search(query)).rows.find(row => row.preview === original)!;
  const citation = await f.office.cite(row.id);
  f.messages.push(...Array.from({ length: 20 }, (_, index) => ({
    ...message, id: String(100 + index), at: f.time() - (index + 1) * 1000, text: '较新的聊天 ' + index,
  })));
  assert.ok((await f.office.conversationMessages(query)).rows.every(entry => entry.id !== row.id));
  const located = await f.office.conversationMessages(query, citation.id);
  assert.ok(located.offset! > 0);
  assert.equal(located.rows.find(entry => entry.id === row.id)?.text, original);
  await assert.rejects(f.office.conversationMessages({ ...query, conversation: 'group:54' }, citation.id), /不属于所选会话/);

  message.text = '后来改写的消息';
  const changed = await f.office.conversationMessages(query, citation.id);
  assert.equal(changed.rows.find(entry => entry.id === row.id)?.text, original);
  assert.equal(changed.rows.find(entry => entry.id === row.id)?.preserved, true);
  f.advance(3 * 86400000);
  const retained = await f.office.conversationMessages(query, citation.id);
  assert.deepEqual(retained.rows.map(entry => entry.text), [context.text, original]);
  assert.ok(retained.rows.every(entry => entry.preserved));
  assert.equal(f.historyReads.length, 0);
  f.account('different');
  await assert.rejects(f.office.conversationMessages(query, citation.id), /当前账号/);
});

test('targeted archive saves only the requested conversation and days with coverage', async t => {
  const f = fixture(t);
  f.mode('targeted-partial');
  f.supplemental.push({ ...f.messages[0], id: '9', conversation: 'user:someone', conversationName: '另一个会话' },
    { ...f.messages[0], id: '10', at: f.time() - 86400000 });
  const selection = { conversation: 'group:53', from: '2026-11-18', to: '2026-11-18' };
  assert.deepEqual(await f.office.archiveSelection(selection), { count: 2, incomplete: ['星桥验收群'] });
  assert.deepEqual(f.historyReads, [selection.conversation]);
  assert.equal(f.calls.length, 0);
  const archive = await f.office.search({ archive: true });
  assert.equal(archive.total, 2);
  assert.match((await f.office.material(archive.rows[0].id, true, true)).scope!, /定向归档.*部分读取/);
  f.account('different');
  assert.equal((await f.office.search({ archive: true })).total, 0);
});

test('office read recovery retries one interrupted brief for the same account', async t => {
  const f = fixture(t);
  await f.office.state();
  f.account('');
  await assert.rejects(f.office.generateBrief(), /登录 WeLink/);
  assert.equal((await f.office.refresh()).connected, false);
  assert.equal(f.calls.length, 0);
  f.account('tester');
  await f.office.recoverReads();
  assert.ok((await f.office.brief())?.generatedAt);
  const calls = f.calls.length;
  assert.ok(calls > 0);
  await f.office.recoverReads();
  assert.equal(f.calls.length, calls);
  f.account('');
  await f.office.refresh();
  f.account('different');
  await f.office.recoverReads();
  assert.equal(f.calls.length, calls);
});

test('recovery of an unread-only poll does not run the recent inbox or brief', async t => {
  const f = fixture(t);
  await f.office.state();
  f.account('');
  assert.equal(await f.office.refreshUnread(), false);
  f.account('tester');
  await f.office.recoverReads();
  assert.ok(f.calls.length > 0);
  assert.ok(f.calls.every(args => args.includes('--is-read')));
  assert.equal(await f.office.brief(), null);
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
