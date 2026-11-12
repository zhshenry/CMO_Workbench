import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { discoverCodeaiProjects } from '../electron/agent-projects';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'cmo-proj-'));
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
  return home;
}
const sessionLine = (cwd: string, sessionId: string, extra = '') =>
  `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]},"sessionId":"${sessionId}","cwd":${JSON.stringify(cwd)},"timestamp":"2026-11-01T00:00:00.000Z"${extra}}\n`;

test('discoverCodeaiProjects: 还原真实 cwd,按 lastActive 降序', async () => {
  const home = setup();
  const base = join(home, '.claude', 'projects');
  // 项目1:两条会话,新会话 cwd 指向真实路径
  mkdirSync(join(base, 'D--tool-CMO-WORKBENCH'), { recursive: true });
  writeFileSync(join(base, 'D--tool-CMO-WORKBENCH', 'old.jsonl'), sessionLine('D:\\tool\\CMO_WORKBENCH', 's1'));
  writeFileSync(join(base, 'D--tool-CMO-WORKBENCH', 'new.jsonl'), sessionLine('D:\\tool\\CMO_WORKBENCH', 's2'));
  // 项目2:更晚 mtime
  mkdirSync(join(base, 'D--tool-AI-For-CMO'), { recursive: true });
  const file = join(base, 'D--tool-AI-For-CMO', 'a.jsonl');
  writeFileSync(file, sessionLine('D:\\tool\\AI-For-CMO', 's3'));
  // 调整 mtime:项目2 更晚
  const later = new Date('2026-11-09T00:00:00.000Z');
  const earlier = new Date('2026-11-01T00:00:00.000Z');
  // 用 futimes 不易跨平台,改用文件内容顺序+手动 stat 不便;这里直接断言排序:项目2 文件名虽在前但靠 mtime
  // 为稳定排序,写一个明确更晚的:删掉重写并改 mtime
  // 简化:断言两个都被发现、cwd 正确即可,排序用单测另写
  const projects = await discoverCodeaiProjects(home);
  assert.equal(projects.length, 2);
  const byDir = Object.fromEntries(projects.map(p => [p.dir, p]));
  assert.equal(byDir['D--tool-CMO-WORKBENCH'].cwd, 'D:\\tool\\CMO_WORKBENCH');
  assert.equal(byDir['D--tool-CMO-WORKBENCH'].sessionCount, 2);
  assert.equal(byDir['D--tool-AI-For-CMO'].cwd, 'D:\\tool\\AI-For-CMO');
  assert.equal(byDir['D--tool-AI-For-CMO'].sessionCount, 1);
  // 排序:后写入的 mtime 更大,应排前
  assert.equal(projects[0].dir, 'D--tool-AI-For-CMO');
  void later; void earlier;
});

test('discoverCodeaiProjects: 读不到 cwd 的项目仍列出,cwd 为空', async () => {
  const home = setup();
  const base = join(home, '.claude', 'projects');
  mkdirSync(join(base, 'D--tool-unknown'), { recursive: true });
  writeFileSync(join(base, 'D--tool-unknown', 'x.jsonl'), 'not json\n{also broken');
  const projects = await discoverCodeaiProjects(home);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].cwd, '');
  assert.equal(projects[0].sessionCount, 1);
});

test('discoverCodeaiProjects: 无会话的项目目录列出,lastActive=0', async () => {
  const home = setup();
  const base = join(home, '.claude', 'projects');
  mkdirSync(join(base, 'D--tool-empty'), { recursive: true });
  const projects = await discoverCodeaiProjects(home);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].lastActive, 0);
  assert.equal(projects[0].sessionCount, 0);
});

test('discoverCodeaiProjects: ~/.claude/projects 不存在返回空数组', async () => {
  const home = mkdtempSync(join(tmpdir(), 'cmo-empty-'));
  assert.deepEqual(await discoverCodeaiProjects(home), []);
});

test('discoverCodeaiProjects: 双反斜杠 JSON 转义正确还原为单反斜杠', async () => {
  const home = setup();
  const base = join(home, '.claude', 'projects');
  mkdirSync(join(base, 'D--tool-CMO-WORKBENCH'), { recursive: true });
  // 模拟真实 jsonl:cwd 字段是 "D:\\tool\\CMO_WORKBENCH"(JSON 字符串里双反斜杠)
  writeFileSync(join(base, 'D--tool-CMO-WORKBENCH', 's.jsonl'), sessionLine('D:\\tool\\CMO_WORKBENCH', 's1'));
  const projects = await discoverCodeaiProjects(home);
  assert.equal(projects[0].cwd, 'D:\\tool\\CMO_WORKBENCH');
});

test('discoverCodeaiProjects: finds the top-level cwd after a large first record', async () => {
  const home = setup(), dir = join(home, '.claude', 'projects', 'large');
  mkdirSync(dir);
  const cwd = join(home, '中文项目');
  writeFileSync(join(dir, 's.jsonl'), JSON.stringify({ type: 'file-history-snapshot', snapshot: { cwd: 'wrong nested path', data: '字'.repeat(30000) } }) + '\n' + sessionLine(cwd, 's1'));
  try { assert.equal((await discoverCodeaiProjects(home))[0].cwd, cwd); }
  finally { rmSync(home, { recursive: true, force: true }); }
});

test('discoverCodeaiProjects: falls back to an older session when the newest has no cwd', async () => {
  const home = setup(), dir = join(home, '.claude', 'projects', 'fallback');
  mkdirSync(dir);
  const oldFile = join(dir, 'old.jsonl'), newFile = join(dir, 'new.jsonl');
  writeFileSync(oldFile, sessionLine(home, 'old'));
  writeFileSync(newFile, 'not json\n' + JSON.stringify({ type: 'progress' }) + '\n');
  utimesSync(oldFile, 1000, 1000); utimesSync(newFile, 2000, 2000);
  try {
    const [project] = await discoverCodeaiProjects(home);
    assert.equal(project.cwd, home);
    assert.equal(project.lastActive, 2000000);
    assert.equal(project.sessionCount, 2);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

function recentDatabase(home: string, projects: { path: string; lastOpenedAt: string }[]) {
  const directory = join(home, '.codeai', 'database'); mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(join(directory, 'codeai.db'));
  db.exec('CREATE TABLE history(type TEXT, key TEXT, content TEXT, updated_at INTEGER)');
  for (const [i, project] of projects.entries()) db.prepare('INSERT INTO history VALUES (?, ?, ?, ?)').run('project', project.path, JSON.stringify(project), i);
  return db;
}

test('CodeAI recent projects take priority, merge connected paths and retain history separately', async t => {
  const home = setup(); t.after(() => rmSync(home, { recursive: true, force: true }));
  const recent = join(home, 'recent'), manual = join(home, 'manual'), historical = join(home, 'historical'), deleted = join(home, 'deleted');
  for (const path of [recent, manual, historical]) mkdirSync(path);
  for (const [dir, cwd] of [['recent-session', recent], ['history-session', historical], ['deleted-session', deleted]]) {
    mkdirSync(join(home, '.claude', 'projects', dir));
    writeFileSync(join(home, '.claude', 'projects', dir, 's.jsonl'), sessionLine(cwd, dir));
  }
  const db = recentDatabase(home, [{ path: recent, lastOpenedAt: '2026-11-11T00:00:00Z' }]); db.close();
  const projects = await discoverCodeaiProjects(home, [manual, recent.toUpperCase()]);
  assert.equal(projects.length, 4);
  assert.equal(projects[0].cwd, recent); assert.equal(projects[0].source, 'recent');
  assert.equal(projects[0].sessionCount, 1); assert.equal(projects[0].available, true);
  assert.equal(projects[1].cwd, manual); assert.equal(projects[1].source, 'manual'); assert.equal(projects[1].available, true);
  const old = projects.find(p => p.cwd === historical)!; assert.equal(old.source, 'history'); assert.equal(old.available, true);
  const missing = projects.find(p => p.cwd === deleted)!; assert.equal(missing.available, false); assert.match(missing.problem!, /不存在/);
  const connectedHistory = (await discoverCodeaiProjects(home, [historical])).find(p => p.cwd === historical)!;
  assert.equal(connectedHistory.source, 'history');
});

test('CodeAI history database is read-only and authoritative over the old JSON file', async t => {
  const home = setup(); t.after(() => rmSync(home, { recursive: true, force: true }));
  const directory = join(home, '.codeai', 'data', 'sessions'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'project-history.json'), JSON.stringify({ projects: [{ path: home, lastOpenedAt: '2026-11-11T00:00:00Z' }] }));
  const db = recentDatabase(home, []); db.close();
  const file = join(home, '.codeai', 'database', 'codeai.db'), before = readFileSync(file);
  assert.deepEqual(await discoverCodeaiProjects(home), []);
  assert.deepEqual(readFileSync(file), before);
});

test('old CodeAI JSON works without a database and malformed rows do not become projects', async t => {
  const home = setup(); t.after(() => rmSync(home, { recursive: true, force: true }));
  const directory = join(home, '.codeai', 'data', 'sessions'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'project-history.json'), JSON.stringify({ projects: [null, {}, { path: 2 }, { path: home, lastOpenedAt: '2026-11-11T00:00:00Z' }] }));
  const projects = await discoverCodeaiProjects(home);
  assert.equal(projects.length, 1); assert.equal(projects[0].cwd, home); assert.equal(projects[0].source, 'recent');
  assert.equal(projects[0].available, true);
});

test('system directories are excluded automatically and unresolved history stays disabled', async t => {
  const home = setup(); t.after(() => rmSync(home, { recursive: true, force: true }));
  const system = process.env.SystemRoot || process.env.windir;
  if (system) {
    const db = recentDatabase(home, [{ path: system, lastOpenedAt: '2026-11-11T00:00:00Z' }]); db.close();
    mkdirSync(join(home, '.claude', 'projects', 'system'));
    writeFileSync(join(home, '.claude', 'projects', 'system', 's.jsonl'), sessionLine(system, 'system'));
  }
  mkdirSync(join(home, '.claude', 'projects', 'unknown'));
  writeFileSync(join(home, '.claude', 'projects', 'unknown', 's.jsonl'), JSON.stringify({ type: 'ai-title', aiTitle: 'Hello' }));
  const projects = await discoverCodeaiProjects(home);
  assert.equal(projects.length, 1); assert.equal(projects[0].source, 'history');
  assert.equal(projects[0].available, false); assert.match(projects[0].problem!, /路径未知/);
});

test('an unreadable CodeAI database reports scan failure instead of silently presenting old history as recent', async t => {
  const home = setup(); t.after(() => rmSync(home, { recursive: true, force: true }));
  const directory = join(home, '.codeai', 'database'); mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, 'codeai.db'), 'invalid database');
  await assert.rejects(discoverCodeaiProjects(home), /CodeAI.*最近项目/);
});
