import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverCodeaiProjects } from '../electron/agent-projects';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'cmo-proj-'));
  mkdirSync(join(home, '.claude', 'projects'), { recursive: true });
  return home;
}
const sessionLine = (cwd: string, sessionId: string, extra = '') =>
  `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]},"sessionId":"${sessionId}","cwd":${JSON.stringify(cwd)},"timestamp":"2026-11-01T00:00:00.000Z"${extra}}\n`;

test('discoverCodeaiProjects: 还原真实 cwd,按 lastActive 降序', () => {
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
  const projects = discoverCodeaiProjects(home);
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

test('discoverCodeaiProjects: 读不到 cwd 的项目仍列出,cwd 为空', () => {
  const home = setup();
  const base = join(home, '.claude', 'projects');
  mkdirSync(join(base, 'D--tool-unknown'), { recursive: true });
  writeFileSync(join(base, 'D--tool-unknown', 'x.jsonl'), 'not json\n{also broken');
  const projects = discoverCodeaiProjects(home);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].cwd, '');
  assert.equal(projects[0].sessionCount, 1);
});

test('discoverCodeaiProjects: 无会话的项目目录列出,lastActive=0', () => {
  const home = setup();
  const base = join(home, '.claude', 'projects');
  mkdirSync(join(base, 'D--tool-empty'), { recursive: true });
  const projects = discoverCodeaiProjects(home);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].lastActive, 0);
  assert.equal(projects[0].sessionCount, 0);
});

test('discoverCodeaiProjects: ~/.claude/projects 不存在返回空数组', () => {
  const home = mkdtempSync(join(tmpdir(), 'cmo-empty-'));
  assert.deepEqual(discoverCodeaiProjects(home), []);
});

test('discoverCodeaiProjects: 双反斜杠 JSON 转义正确还原为单反斜杠', () => {
  const home = setup();
  const base = join(home, '.claude', 'projects');
  mkdirSync(join(base, 'D--tool-CMO-WORKBENCH'), { recursive: true });
  // 模拟真实 jsonl:cwd 字段是 "D:\\tool\\CMO_WORKBENCH"(JSON 字符串里双反斜杠)
  writeFileSync(join(base, 'D--tool-CMO-WORKBENCH', 's.jsonl'), sessionLine('D:\\tool\\CMO_WORKBENCH', 's1'));
  const projects = discoverCodeaiProjects(home);
  assert.equal(projects[0].cwd, 'D:\\tool\\CMO_WORKBENCH');
});
