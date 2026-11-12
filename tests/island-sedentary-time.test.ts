import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { IslandStore } from '../electron/island-store';
import { initialIslandData } from '../shared/island-contracts';

const time = (day: number, hour: number, minute = 0) => new Date(2026, 10, day, hour, minute).getTime();
function fixture(t: TestContext, start = time(11, 9)) {
  const dir = mkdtempSync(join(tmpdir(), 'cmo-sedentary-time-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let now = start;
  return { dir, store: new IslandStore(dir, () => now), setTime: (value: number) => { now = value; } };
}

test('older settings gain reminder hours without losing the configured interval or switches', t => {
  const { dir } = fixture(t), saved = initialIslandData(time(11, 9));
  saved.settings.sedentaryEnabled = true;
  saved.settings.sedentaryMinutes = 75;
  const settings = saved.settings as Record<string, unknown>;
  delete settings.sedentaryStart; delete settings.sedentaryEnd;
  writeFileSync(join(dir, 'desktop-island.json'), JSON.stringify(saved));
  const store = new IslandStore(dir, () => time(11, 9));
  assert.equal(store.loadError, '');
  assert.equal(store.read().settings.sedentaryStart, '09:00');
  assert.equal(store.read().settings.sedentaryEnd, '18:00');
  assert.equal(store.read().settings.sedentaryMinutes, 75);
  assert.equal(store.read().settings.sedentaryEnabled, true);
});

test('reminder hours persist and invalid times leave memory and disk unchanged', t => {
  const { store, dir } = fixture(t), path = join(dir, 'desktop-island.json');
  store.patch({ sedentaryStart: '10:15', sedentaryEnd: '19:30' });
  const before = store.read(), file = readFileSync(path, 'utf8');
  assert.equal(new IslandStore(dir).read().settings.sedentaryStart, '10:15');
  assert.equal(new IslandStore(dir).read().settings.sedentaryEnd, '19:30');
  assert.throws(() => store.patch({ sedentaryStart: '24:00' }));
  assert.deepEqual(store.read(), before);
  assert.equal(readFileSync(path, 'utf8'), file);
});

test('daytime reminders start a full interval on entry and clear pending reminders on exit', t => {
  const { store, setTime } = fixture(t, time(11, 8));
  store.patch({ sedentaryEnabled: true });
  assert.equal(store.read().sedentary.nextAt, null);
  setTime(time(11, 9));
  assert.deepEqual(store.tick(), []);
  assert.equal(store.read().sedentary.nextAt, time(11, 10));
  setTime(time(11, 10));
  assert.equal(store.tick()[0]?.kind, 'sedentary');
  setTime(time(11, 18));
  assert.deepEqual(store.tick(), []);
  assert.equal(store.read().sedentary.nextAt, null);
  assert.equal(store.read().reminders.length, 0);
  setTime(time(12, 9));
  assert.deepEqual(store.tick(), []);
  assert.equal(store.read().sedentary.nextAt, time(12, 10));
});

test('a reminder at or beyond the closing time is not scheduled', t => {
  const { store, setTime } = fixture(t, time(11, 17));
  store.patch({ sedentaryEnabled: true });
  assert.equal(store.read().sedentary.nextAt, null);
  setTime(time(11, 17, 30));
  assert.deepEqual(store.tick(), []);
  assert.equal(store.read().sedentary.nextAt, null);
});

test('overnight hours cross midnight and equal endpoints allow all-day reminders', t => {
  const { store, setTime } = fixture(t, time(11, 23));
  store.patch({ sedentaryEnabled: true, sedentaryStart: '22:00', sedentaryEnd: '06:00' });
  assert.equal(store.read().sedentary.nextAt, time(12, 0));
  setTime(time(12, 0));
  assert.equal(store.tick()[0]?.kind, 'sedentary');
  setTime(time(12, 6));
  assert.deepEqual(store.tick(), []);
  assert.equal(store.read().sedentary.nextAt, null);
  store.patch({ sedentaryStart: '00:00', sedentaryEnd: '00:00' });
  assert.equal(store.read().sedentary.nextAt, time(12, 7));
});

test('reset, snooze and app restart respect the hours and daily pause', t => {
  const { store, setTime } = fixture(t);
  store.patch({ sedentaryEnabled: true });
  setTime(time(11, 17, 55));
  assert.equal(store.sedentary('reset').sedentary.nextAt, null);
  assert.equal(store.sedentary('snooze').sedentary.nextAt, null);
  store.restartSedentary();
  assert.equal(store.read().sedentary.nextAt, null);
  setTime(time(11, 10));
  assert.equal(store.sedentary('reset').sedentary.nextAt, time(11, 11));
  assert.equal(store.sedentary('snooze').sedentary.nextAt, time(11, 10, 10));
  store.sedentary('pause'); store.restartSedentary();
  assert.equal(store.read().sedentary.nextAt, null);
  assert.deepEqual(store.tick(), []);
  setTime(time(12, 9));
  store.tick();
  assert.equal(store.read().sedentary.nextAt, time(12, 10));
});

test('quiet mode restarts the interval and changing hours clears an obsolete reminder', t => {
  const { store, setTime } = fixture(t);
  store.patch({ sedentaryEnabled: true });
  setTime(time(11, 9, 30));
  store.tick(true);
  assert.equal(store.read().sedentary.nextAt, null);
  setTime(time(11, 10));
  assert.deepEqual(store.tick(), []);
  assert.equal(store.read().sedentary.nextAt, time(11, 11));
  setTime(time(11, 11));
  assert.equal(store.tick()[0]?.kind, 'sedentary');
  store.patch({ sedentaryStart: '12:00', sedentaryEnd: '17:00' });
  assert.equal(store.read().sedentary.nextAt, null);
  assert.equal(store.read().reminders.length, 0);
  setTime(time(11, 12));
  store.tick();
  assert.equal(store.read().sedentary.nextAt, time(11, 13));
});
