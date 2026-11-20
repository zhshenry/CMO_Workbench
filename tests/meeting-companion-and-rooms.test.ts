import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import test, { type TestContext } from 'node:test';
import { MeetingCompanion } from '../electron/meeting-companion';
import { RoomBooking } from '../electron/room-booking';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { encodeSpeechWave } from '../shared/speech-audio';

function temporary(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-meeting-workspace-'));
  t.after(() => { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true }); });
  return dir;
}
async function until(condition: () => boolean) {
  for (let attempt = 0; attempt < 80; ++attempt) { if (condition()) return; await wait(10); }
  assert.fail('condition did not become true');
}

test('meeting records retain WAV and JPEG, recover queued work, and increment minutes with verified sources', async t => {
  const dir = temporary(t);
  let updates: object[] = [], writes = 0, first = true;
  const imageBatches: (string[] | undefined)[] = [];
  const deps = {
    transcribe: async () => { if (first) { first = false; throw new Error('fixture speech interrupted'); } return '改到周五交付验收材料。'; },
    model: async (prompt: string, images?: string[]) => { imageBatches.push(images); return prompt.startsWith('根据') ? '00:00:08 改到周五交付。' : JSON.stringify(updates); },
    createTask: (_title: string) => 'todo-' + ++writes, changed: () => {},
  };
  const meeting = new MeetingCompanion(dir, deps), record = meeting.start({ title: '星桥验收', autoNotes: false, systemAudio: false, useFrames: true });
  const chunk = randomUUID(), shot = randomUUID(), wav = encodeSpeechWave(new Float32Array(200)), jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  meeting.audio(record.id, chunk, 8000, wav);
  assert.equal(meeting.get(record.id).transcript[0].durationMs, 12.5);
  meeting.frame(record.id, shot, 9000, jpg);
  await until(() => meeting.get(record.id).transcript[0].status === 'failed');
  meeting.retry(record.id);
  await until(() => meeting.get(record.id).transcript[0].status === 'ready');
  updates = [{ kind: 'action', text: '周五交付验收材料', sources: [chunk, shot] }, { kind: 'decision', text: '未知记录', sources: [randomUUID()] }];
  const firstNotes = await meeting.organize(record.id);
  assert.equal(firstNotes.minutes.length, 1);
  assert.deepEqual(imageBatches[0], [Buffer.from(jpg).toString('base64')]);
  assert.deepEqual(firstNotes.minutes[0].sources, [chunk, shot]);
  assert.equal(meeting.action(record.id, firstNotes.minutes[0].id), 'todo-1');
  assert.equal(meeting.action(record.id, firstNotes.minutes[0].id), 'todo-1');
  assert.equal(writes, 1);
  const second = randomUUID();
  meeting.audio(record.id, second, 19000, wav);
  await until(() => meeting.get(record.id).transcript[1].status === 'ready');
  updates = [];
  assert.deepEqual((await meeting.organize(record.id)).minutes.map(row => row.id), firstNotes.minutes.map(row => row.id));
  assert.match(await meeting.ask(record.id, '什么时候交付验收材料'), /00:00:08/);
  assert.match(meeting.markdown(record.id), /周五交付验收材料/);
  assert.deepEqual(meeting.media(record.id, shot, 'frame'), jpg);
  assert.deepEqual(meeting.media(record.id, chunk, 'audio'), wav);
  assert.throws(() => meeting.media(record.id, randomUUID(), 'audio'), /该会议/);
  const reopened = new MeetingCompanion(dir, deps);
  assert.equal(reopened.get(record.id).status, 'interrupted');
  assert.equal(reopened.get(record.id).frames.length, 1);
  assert.equal(reopened.get(record.id).minutes[0].taskId, 'todo-1');
});

test('room controls send the verified helper protocol, retain business receipts and never resubmit on timeout', async t => {
  const dir = temporary(t), root = join(dir, 'hub-control'), requests = join(root, 'requests'), replies = join(root, 'replies');
  mkdirSync(requests, { recursive: true }); mkdirSync(replies, { recursive: true });
  const status = { protocol: 1, at: Date.now(), running: false, capabilities: ['advance-days'], history: [{ 日期: '2026-11-22', 时间: '10:00 起 1h0m', 会议室: '星桥 A', 状态: '预约成功', 主题: '验收评审' }] };
  writeJsonAtomic(join(root, 'status.json'), status);
  const booking = new RoomBooking(dir, { timeoutMs: 500 });
  booking.selectDirectory(dir);
  assert.equal(booking.state().connected, true);
  const commands: { id: string; op: string; args: Record<string, unknown> }[] = [];
  const handled = new Set<string>();
  let reply = true;
  const simulator = setInterval(() => {
    for (const file of readdirSync(requests).filter(name => name.endsWith('.json') && !handled.has(name))) {
      handled.add(file);
      const job = JSON.parse(readFileSync(join(requests, file), 'utf8'));
      commands.push(job);
      if (reply || job.op !== 'once') writeFileSync(join(replies, file), JSON.stringify({ requestId: job.id, ok: true }));
    }
  }, 20);
  try {
    await booking.savePlan({ title: '验收评审', start: '10:00', duration: 60, weekdays: [1, 2], rooms: ['星桥 A', '星桥 B'], openTime: '08:10', advanceDays: 3 });
    assert.deepEqual(commands[0].args['优先会议室'], ['星桥 A', '星桥 B']);
    assert.deepEqual(commands[0].args['抢订设置'], { 开放时间: '08:10:00', 提前天数: 3 });
    assert.equal((await booking.command('start')).armed, true);
    assert.equal((await booking.command('pause')).armed, false);
    assert.equal(booking.state().history[0].state, '预约成功');
    reply = false;
    await assert.rejects(booking.command('once'), /尚未确认结果/);
    await booking.recover();
    assert.equal(commands.filter(job => job.op === 'once').length, 1);
    assert.equal(booking.state().history.length, 1);
  } finally { clearInterval(simulator); }
});
