import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WelinkMessageReminders, parseWelinkConversations, parseWelinkMessages, welinkMessageCandidates } from '../electron/welink-message-reminders';
import { WelinkReminderSettingsSchema, type WelinkMessage } from '../shared/welink-reminders';

const now = Date.parse('2026-11-17T16:00:00+08:00');
const settings = WelinkReminderSettingsSchema.parse({ enabled: true, keywords: ['验收'] });
const message = (id: string, patch: Partial<WelinkMessage> = {}): WelinkMessage => ({ id, conversation: 'user:other', conversationName: '同事', sender: 'other', group: false, mine: false, atMe: false, at: now - 5 * 3600000, text: '能否确认评审时间？', ...patch });
const recent = JSON.stringify({ conversation_info: [{ recent_conversation_type: 'CHAT_TYPE_P2P_MSG', target_account: 'other', native_name: '同事' }] });
const history = (rows: WelinkMessage[]) => JSON.stringify({ resultCode: 0, respData: { chatInfo: rows.map(row => ({ msgId: row.id, serverSendTime: row.at, sender: row.sender, contentType: 'TEXT', content: { text: row.text } })) } });

function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-welink-reminder-'));
  t.after(() => {
    assert.ok(resolve(dir).startsWith(resolve(join(tmpdir(), 'wb-welink-reminder-'))));
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

test('message parsing preserves large IDs, recognizes empty results and rejects failed/unrecognized responses', () => {
  const conversations = parseWelinkConversations('{"conversation_info":[{"recent_conversation_type":"CHAT_TYPE_GROUP_MSG","group_id":1234567890123456789,"group_name":"项目群"}]}');
  assert.equal(conversations[0].id, '1234567890123456789');
  const parsed = parseWelinkMessages('{"resultCode":0,"respData":{"chatInfo":[{"msgId":9234567890123456789,"serverSendTime":1794902400,"sender":"me","contentType":"IMAGE","content":"image"}]}}', conversations[0], 'me');
  assert.equal(parsed[0].id, '9234567890123456789'); assert.equal(parsed[0].mine, true);
  assert.match(parsed[0].text, /非文字/);
  assert.equal(parseWelinkMessages('{"resultCode":0,"respData":{"chatInfo":[{"msgId":9234567890123456790,"quoteMsgId":9234567890123456789,"serverSendTime":1794902400,"sender":"me","content":"已补好"}]}}', conversations[0], 'me')[0].replyTo, '9234567890123456789');
  assert.deepEqual(parseWelinkMessages('{"resultCode":0,"respData":{"msgTotalCount":0,"maxMsgId":0}}', conversations[0], 'me'), []);
  assert.throws(() => parseWelinkConversations('{"code":401,"conversation_info":[]}'), /未成功/);
  assert.throws(() => parseWelinkMessages('{"unexpected":[]}', conversations[0], 'me'), /无法识别/);
});

test('reply candidates require a real question, enough wait and an unreplied personal or mentioned-group message', () => {
  assert.equal(welinkMessageCandidates([message('1')], settings, now, 'me')[0].kind, 'awaiting');
  for (const rows of [
    [message('1', { text: '收到！' })], [message('1', { at: now - 60000 })],
    [message('1'), message('2', { sender: 'me', mine: true, text: '时间已确认', at: now - 10000, replyTo: '1' })],
    [message('1', { group: true, conversation: 'group:123' })],
    [message('1', { at: now - 37 * 3600000 })],
  ]) assert.equal(welinkMessageCandidates(rows, settings, now, 'me').length, 0);
  const group = message('3', { group: true, conversation: 'group:123', atMe: true });
  assert.equal(welinkMessageCandidates([group], settings, now, 'me').length, 1);
  const unrelated = { ...group, id: '4', sender: 'me', mine: true, at: now - 10000, text: '另一项已经提交', replyTo: '2' };
  assert.match(welinkMessageCandidates([group, unrelated], settings, now, 'me')[0].title, /回复待核对/);
  assert.equal(welinkMessageCandidates([group, { ...unrelated, replyTo: '3' }], settings, now, 'me').length, 0);
});

test('commitments keep date precision and reject negation, uncertain wording, undated and not-yet-due promises', () => {
  const own = (text: string) => message('5', { mine: true, sender: 'me', text, at: now - 24 * 3600000 });
  const candidate = welinkMessageCandidates([own('我明天会给你方案')], settings, now, 'me')[0];
  assert.equal(candidate.kind, 'commitment'); assert.equal(candidate.due, '2026-11-17'); assert.match(candidate.title, /核对承诺/);
  for (const text of ['我明天不会发方案', '我尽量明天完成', '我会给你方案', '我后天给你方案', '我 2月30日 给你方案']) {
    assert.equal(welinkMessageCandidates([own(text)], settings, now, 'me').length, 0, text);
  }
  assert.equal(welinkMessageCandidates([own('我本周二提交方案')], settings, now, 'me')[0].due, '2026-11-17');
  assert.equal(welinkMessageCandidates([message('6', { text: '验收完成', at: now - 1000 })], settings, now, 'me')[0].kind, 'keyword');
  assert.equal(welinkMessageCandidates([message('6', { text: '验收完成', mine: true })], settings, now, 'me').length, 0);
});

test('commitment reminders use the actual promised action and its date', () => {
  const own = (text: string, id = '1') => message(id, { mine: true, sender: 'me', text });
  for (const text of ['我今天突然发现界面好像 WENOTE', '我看到他刚发了一个文件', '我今天已经发给你了',
    '我今天建议让小李整理清单', '如果有空，我今天发清单', '我已经发了一份']) {
    assert.deepEqual(welinkMessageCandidates([own(text)], settings, now, 'me'), [], text);
  }
  const matched = welinkMessageCandidates([own('我发现还差一份材料，我今天发送明天评审的清单')], settings, now, 'me');
  assert.equal(matched[0]?.due, '2026-11-17');
  const promise = own('我今天发清单');
  const after = { ...own('我已经发给你了', '2'), at: promise.at + 1000 };
  assert.equal(welinkMessageCandidates([promise, after], settings, now, 'me')[0]?.kind, 'commitment');
  assert.equal(welinkMessageCandidates([promise, { ...after, replyTo: promise.id, text: '我已经发给你方案了' }], settings, now, 'me')[0]?.kind, 'commitment');
  assert.deepEqual(welinkMessageCandidates([promise, { ...after, replyTo: promise.id }], settings, now, 'me'), []);
});

test('only ambiguous acceptances reach the model and reviews require words in a real source', { timeout: 5000 }, async t => {
  const dir = fixture(t);
  const rows = [
    message('1', { text: '这份清单还差一次整理。' }),
    message('2', { text: '我今天来吧', mine: true, sender: 'me', at: now - 5 * 3600000 + 1000 }),
    message('3', { text: '会议资料还需要处理。', at: now - 5 * 3600000 + 2000 }),
    message('4', { text: '我今天来吧', mine: true, sender: 'me', at: now - 5 * 3600000 + 3000 }),
    message('5', { text: '我今天突然发现界面好像 WENOTE', mine: true, sender: 'me', at: now - 5 * 3600000 + 4000 }),
  ];
  let receive!: (response: string) => void, changed!: () => void;
  const response = new Promise<string>(resolve => { receive = resolve; });
  const updated = new Promise<void>(resolve => { changed = resolve; });
  const service = new WelinkMessageReminders(dir, async args => args[1] === 'query-recent-conversation' ? recent : history(rows), async () => 'me', () => now, {
    model: prompt => {
      const candidates = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1));
      assert.equal(candidates.length, 2);
      assert.ok(candidates.every((item: { evidence: string }) => item.evidence === '我今天来吧'));
      return response.then(() => JSON.stringify([
        { key: candidates[0].key, proof: { sourceId: '1', verb: '整理', object: '清单' } },
        { key: candidates[1].key, proof: { sourceId: '3', verb: '整理', object: '捏造的交付件' } },
      ]));
    },
    changed: () => changed(),
  });
  const initial = await service.refresh(settings, true);
  assert.ok(initial.reminders.every(row => row.kind !== 'commitment'));
  receive('done');
  await updated;
  const snapshot = service.officeSnapshot('me');
  assert.equal(Object.keys(snapshot.commitmentReviews ?? {}).length, 1);
  assert.deepEqual(service.status(settings).reminders.filter(row => row.kind === 'commitment').map(row => row.source.id), ['2']);
  const reopened = new WelinkMessageReminders(dir, async () => recent, async () => 'me', () => now);
  assert.deepEqual(reopened.officeSnapshot('me').commitmentReviews, snapshot.commitmentReviews);
});

test('collection is opt-in, incremental, account scoped and only queries; receipts survive restart and enforce 3 per hour', async t => {
  const dir = fixture(t), calls: string[][] = [];
  const rows = Array.from({ length: 5 }, (_, i) => message(String(i + 1), { text: `验收材料 ${i}`, at: now - i * 10000 }));
  const run = async (args: string[]) => { calls.push(args); return args[1] === 'query-recent-conversation' ? recent : history(rows); };
  const service = new WelinkMessageReminders(dir, run, async () => 'me', () => now);
  await service.refresh({ ...settings, enabled: false }); assert.equal(calls.length, 0);
  const status = await service.refresh(settings);
  assert.equal(status.error, '');
  assert.equal(status.syncing, false); assert.equal(status.messages, 5); assert.equal(status.reminders.length, 5);
  assert.equal(service.available(settings).length, 3);
  service.notified(service.available(settings).map(item => item.id)); assert.equal(service.available(settings).length, 0);
  await service.refresh(settings); assert.equal(calls.length, 2, 'scheduled refresh respects its interval');
  const restored = new WelinkMessageReminders(dir, run, async () => 'me', () => now);
  await restored.refresh(settings);
  assert.ok(calls.at(-1)!.includes('--message-id')); assert.ok(calls.at(-1)!.includes('5'));
  assert.equal(restored.available(settings).length, 0);
  const id = restored.status(settings).reminders[0].id; restored.dismiss(id);
  await restored.refresh(settings, true); assert.equal(restored.status(settings).reminders.some(item => item.id === id), false);
  assert.equal(restored.status(settings, 'another-account').reminders.length, 0);
  assert.ok(calls.every(args => args[0] === 'im' && /^query-/.test(args[1])));
});

test('a full page advances the boundary but suppresses unsafe reply alerts; failures preserve records without sending stale alerts', async t => {
  const dir = fixture(t); let full = true, failed = false;
  const calls: string[][] = [];
  const rows = Array.from({ length: 100 }, (_, i) => message(String(i + 1), { at: now - 5 * 3600000 + i }));
  const run = async (args: string[]) => {
    calls.push(args); if (failed) throw new Error('offline');
    return args[1] === 'query-recent-conversation' ? recent : history(full ? rows : []);
  };
  const service = new WelinkMessageReminders(dir, run, async () => 'me', () => now);
  assert.equal((await service.refresh(settings)).partial, true); assert.equal(service.available(settings).length, 0);
  full = false; await service.refresh(settings, true);
  assert.equal(service.status(settings).error, '');
  assert.ok(calls.at(-1)!.includes('100')); assert.equal(service.available(settings).length, 1);
  failed = true; await service.refresh(settings, true);
  assert.equal(service.status(settings).messages, 100); assert.equal(service.available(settings).length, 0);
  assert.match(service.status(settings).error, /offline/);
});

test('recent conversation polling rotates beyond the first 20 and remembers empty checks across restart', async t => {
  const dir = fixture(t), checked: string[] = [];
  const ids = Array.from({ length: 50 }, (_, i) => `fixture-${i + 1}`);
  const listing = JSON.stringify({ conversation_info: ids.map(id => ({ recent_conversation_type: 'CHAT_TYPE_P2P_MSG', target_account: id })) });
  let time = now;
  const run = async (args: string[]) => {
    if (args[1] === 'query-recent-conversation') return listing;
    checked.push(args[3]);
    return history(args[3] === 'fixture-28' ? [message('1', { sender: 'me', text: '我今天晚上发你这个材料' })] : []);
  };
  const account = async () => 'me';
  await new WelinkMessageReminders(dir, run, account, () => time).refresh(settings);
  assert.deepEqual(checked, ids.slice(0, 20));
  time += 10 * 60000;
  const reopened = new WelinkMessageReminders(dir, run, account, () => time);
  await reopened.refresh(settings);
  assert.deepEqual(checked.slice(20), ids.slice(20, 40));
  assert.equal(reopened.officeSnapshot('me').messages[0]?.conversation, 'user:fixture-28');
  time += 10 * 60000;
  await reopened.refresh(settings);
  assert.equal(new Set(checked).size, 50);
});

test('WeLink message limit stops requests, saves completed work and resumes unchecked conversations after cooldown', async t => {
  const dir = fixture(t), checked: string[] = [];
  const ids = ['first', 'second', 'limited', 'remaining'];
  const listing = JSON.stringify({ conversation_info: ids.map(id => ({ recent_conversation_type: 'CHAT_TYPE_P2P_MSG', target_account: id })) });
  let time = now, discoveries = 0, limited = true;
  const run = async (args: string[]) => {
    if (args[1] === 'query-recent-conversation') { discoveries++; return listing; }
    checked.push(args[3]);
    if (limited && args[3] === 'limited') return JSON.stringify({ resultCode: 429 });
    return history([message('1')]);
  };
  const account = async () => 'me';
  const initial = new WelinkMessageReminders(dir, run, account, () => time);
  const status = await initial.refresh(settings);
  assert.deepEqual(checked, ids.slice(0, 3));
  assert.equal(status.partial, true);
  assert.match(status.error, /限流/);
  assert.deepEqual(initial.officeSnapshot('me').messages.map(row => row.conversation), ['user:first', 'user:second']);
  const restored = new WelinkMessageReminders(dir, run, account, () => time);
  checked.length = 0;
  await restored.refresh(settings, true);
  assert.equal(checked.length, 0);
  assert.equal(discoveries, 1);
  limited = false;
  time += 10 * 60000;
  await restored.refresh(settings);
  assert.deepEqual(checked.slice(0, 2), ['limited', 'remaining']);
});

test('a longer manual refresh preserves completed reads at the collection deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const dir = fixture(t), started = Promise.withResolvers<void>();
  const listing = JSON.stringify({ conversation_info: ['first', 'slow'].map(id => ({ recent_conversation_type: 'CHAT_TYPE_P2P_MSG', target_account: id })) });
  const service = new WelinkMessageReminders(dir, async (args, signal) => {
    if (args[1] === 'query-recent-conversation') return listing;
    if (args[3] === 'first') return history([message('1')]);
    return new Promise<string>((_resolve, reject) => {
      signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
      started.resolve();
    });
  }, async () => 'me', () => now);
  const pending = service.refresh(settings, true, 'all');
  await started.promise;
  t.mock.timers.tick(120000);
  const result = await pending;
  assert.equal(result.partial, true);
  assert.match(result.error, /读取时限/);
  assert.deepEqual(service.officeSnapshot('me').messages.map(row => row.conversation), ['user:first']);
});

test('account changes and stopping during collection do not save or expose a partial result', async t => {
  const dir = fixture(t); let owner = 'me';
  const service = new WelinkMessageReminders(dir, async args => {
    if (args[1] === 'query-recent-conversation') return recent;
    owner = 'someone-else'; return history([message('1')]);
  }, async () => owner, () => now);
  await service.refresh(settings); assert.equal(readdirSync(dir).length, 0);
  assert.equal(service.available(settings).length, 0); assert.equal(service.status(settings, owner).reminders.length, 0);
  owner = 'me';
  const stopped = new WelinkMessageReminders(dir, async args => {
    if (args[1] === 'query-recent-conversation') return recent;
    stopped.stop(); return history([message('1')]);
  }, async () => owner, () => now);
  await stopped.refresh(settings); assert.equal(readdirSync(dir).length, 0); assert.equal(stopped.available(settings).length, 0);
});

test('corrupt persisted message data stays intact instead of being overwritten or analyzed', async t => {
  const dir = fixture(t);
  const run = async (args: string[]) => args[1] === 'query-recent-conversation' ? recent : history([message('1')]);
  const initial = await new WelinkMessageReminders(dir, run, async () => 'me', () => now).refresh(settings);
  assert.equal(initial.error, '');
  const file = join(dir, readdirSync(dir)[0]), corrupt = '{"account":"me","messages":[{"id":"bad"}],"cursors":{},"dismissed":[],"notified":{}}';
  writeFileSync(file, corrupt);
  const restored = new WelinkMessageReminders(dir, run, async () => 'me', () => now);
  await restored.refresh(settings); assert.match(restored.status(settings).error, /缓存无法读取/);
  assert.equal(readFileSync(file, 'utf8'), corrupt); assert.equal(restored.available(settings).length, 0);
});
