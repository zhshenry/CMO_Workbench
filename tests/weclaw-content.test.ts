import assert from 'node:assert/strict';
import test from 'node:test';
import { WeclawContentClient } from '../electron/weclaw-content';

const start = '2026-11-17T09:00:00+08:00', end = '2026-11-17T10:00:00+08:00';
const alt = '2026-11-10T09:00:00+08:00';
const enclosing = (answer: unknown) => JSON.stringify({ status: 'success', tool_name: 'fixture', answer: typeof answer === 'string' ? answer : JSON.stringify(answer) });
const subject = '接口方案例会', account = 'z00123456';
const meeting = { subject, meeting_id: '1201', start_time: start, end_time: end };
const expected = { taskId: 'fixture:cal', material: 'transcript' as const };

function fixture() {
  const calls: string[][] = [];
  let owner = account, who = account, transcript: unknown = { ...meeting, segments: [{ speaker: '发言人甲', text: '本周验收通过。', timestamp: '00:20' }] };
  let search: unknown = [meeting];
  let error: string | undefined, switchDuringRead = false;
  const client = new WeclawContentClient({
    account: async () => owner, task: () => ({ account, subject: '【会议通知】' + subject, start, end, meetingId: '1201' }),
    run: async args => {
      calls.push(args);
      if (args[0] === 'whoami') return enclosing({ account: who });
      if (args[1] === 'search-content') return enclosing(search);
      if (args[1] === 'get-asr') {
        if (switchDuringRead) owner = who = 'z00987654';
        return error ?? enclosing(transcript);
      }
      if (args[1] === 'list') return enclosing({ items: [{ title: subject, start_time: start, doc_id: 'note-a', attachment_id: 'audio-a' }] });
      if (args[1] === 'get') return enclosing({ ...meeting, doc_id: 'note-a', attachment_id: 'audio-a', text: '会后个人笔记。' });
      assert.fail(args.join(' '));
    },
  });
  return {
    client, calls,
    search(value: unknown) { search = value; },
    transcript(value: unknown) { transcript = value; },
    error(value: string) { error = value; },
    switchDuringRead() { switchDuringRead = true; },
    wrongAccount() { who = 'z00987654'; },
  };
}

test('WeClaw searches before reading and rejects a previous occurrence even with the requested meeting ID', async () => {
  const f = fixture();
  f.transcript({ ...meeting, start_time: alt, content: '上一场的逐字稿' });
  assert.deepEqual((await f.client.meetingContent(expected)).transcript, { status: 'wrong-session', actualTime: new Date(alt).toISOString() });
  assert.deepEqual(f.calls.filter(args => args[0] !== 'whoami').map(args => args.slice(0, 4)), [
    ['meeting', 'search-content', '--material-type', '会议AI听'], ['meeting', 'get-asr', '--meeting-id', '1201'],
  ]);
  f.transcript({ ...meeting, start_time: undefined, content: '缺少时间的逐字稿' });
  assert.equal((await f.client.meetingContent(expected)).transcript?.status, 'unverified');
  f.search([{ ...meeting, start_time: '2026-11-17T09:04:00+08:00' }]);
  f.transcript({ ...meeting, start_time: '2026-11-17T09:08:00+08:00', content: '在搜索结果容差内，但偏离目标场次' });
  assert.equal((await f.client.meetingContent(expected)).transcript?.status, 'wrong-session');
});

test('minutes, transcript and verified WeNote attachment are independent, and cache refresh respects identity', async () => {
  const f = fixture();
  f.search('【会议主题】接口方案例会\n【会议时间】2026-11-17 09:00-10:00\n【会议纪要】本周验收通过。');
  const result = await f.client.meetingContent({ taskId: expected.taskId });
  for (const key of ['minutes', 'transcript', 'notes'] as const) assert.equal(result[key]?.status, 'ready');
  assert.deepEqual(f.calls.find(args => args[0] === 'wenote' && args[1] === 'get'), ['wenote', 'get', '--doc-id', 'note-a', '--attachment-id', 'audio-a']);
  const count = () => f.calls.filter(args => args[1] === 'get-asr').length;
  await f.client.meetingContent(expected);
  assert.equal(count(), 1);
  await f.client.meetingContent({ ...expected, refresh: true });
  assert.equal(count(), 2);
  f.wrongAccount();
  assert.equal((await f.client.meetingContent(expected)).transcript?.status, 'no-permission');
  assert.equal(count(), 2);
});

test('same-day alternatives require a current candidate selection before reading a transcript', async () => {
  const f = fixture();
  f.search([meeting, { ...meeting, meeting_id: '1202', start_time: '2026-11-17 11:00', end_time: '2026-11-17 12:00' }]);
  const query = { subject, date: '2026-11-17', material: 'transcript' as const };
  const result = (await f.client.meetingContent(query)).transcript;
  assert.ok(result?.status === 'candidates');
  assert.equal(result.candidates.length, 2);
  assert.equal(f.calls.some(args => args[1] === 'get-asr'), false);
  assert.equal((await f.client.meetingContent({ ...query, candidate: 'a'.repeat(32) })).transcript?.status, 'unverified');
  assert.equal((await f.client.meetingContent({ ...query, candidate: result.candidates[0].id })).transcript?.status, 'ready');
});

test('failure states distinguish service availability, generation, recording, permission and unknown errors', async () => {
  for (const [raw, status] of [
    ['connection refused 127.0.0.1:3008', 'not-logged-in'], ['该会议尚在生成中', 'generating'],
    ['未开启 AI听录制', 'no-recording'], ['无权读取', 'no-permission'],
    [JSON.stringify({ status: 'error', message: 'unknown response' }), 'request-failed'],
  ]) {
    const f = fixture();
    f.error(raw);
    assert.equal((await f.client.meetingContent(expected)).transcript?.status, status);
  }
  const f = fixture();
  f.switchDuringRead();
  assert.equal((await f.client.meetingContent(expected)).transcript?.status, 'no-permission');
});
