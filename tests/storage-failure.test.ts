import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import test from 'node:test';
import { AppSettingsStore } from '../electron/app-settings';
import { ReadingStore } from '../modules/reading/store';

const cases = [
  { name: '应用设置', file: 'app-settings.json', setup(dir: string) {
    const store = new AppSettingsStore(dir);
    store.patch({ uiTheme: 'cool' });
    return { read: () => store.read(), changes: [() => store.patch({ uiTheme: 'warm' })] };
  } },
  { name: '阅读清单', file: 'reading-books.json', setup(dir: string) {
    const store = new ReadingStore(dir);
    const book = store.save({ title: '原书目' }).books[0];
    return { read: () => store.all(), changes: [
      () => store.setVaultPath('C:/synthetic-vault'),
      () => store.save({ title: '新书目' }),
      () => store.save({ id: book.id, title: '修改书名' }),
      () => store.remove(book.id),
    ] };
  } },
];

for (const scenario of cases) {
  test(`${scenario.name}：保存失败不改变内存，修复写入位置后可重试`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'ono-storage-failure-'));
    assert.ok(resolve(dir).startsWith(resolve(tmpdir()) + sep));
    const file = join(dir, scenario.file);
    const backup = `${file}.original`;
    try {
      const store = scenario.setup(dir);
      const before = structuredClone(store.read());
      const original = readFileSync(file);
      renameSync(file, backup);
      mkdirSync(file); // A directory at the destination rejects writes on Windows and POSIX.
      for (const change of store.changes) {
        assert.throws(change);
        assert.deepEqual(store.read(), before);
        assert.deepEqual(readFileSync(backup), original);
        assert.equal(existsSync(`${file}.tmp`), false);
      }
      rmdirSync(file);
      renameSync(backup, file);
      store.changes[0]();
      assert.notDeepEqual(store.read(), before);
      assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), store.read());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
