import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { loadBotSkillCatalog, loadBotSkills, readSkillFile } from '../electron/bot-skills';

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'bot-skills-test-'));
  const shared = join(dir, 'skills'), own = join(dir, 'bot', 'skills');
  mkdirSync(shared, { recursive: true }); mkdirSync(own, { recursive: true });
  return { dir, shared, own, close() { assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(dir.includes('bot-skills-test-')); rmSync(dir, { recursive: true, force: true }); } };
}
function skill(root: string, name: string, body: string) {
  const folder = join(root, name); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'SKILL.md'), '---\nname: ' + name + '\ndescription: 按公司模板处理周报。\n---\n\n' + body, 'utf8');
  return folder;
}
test('valid skills load per turn, private names override shared, running snapshots remain stable', () => {
  const f = fixture();
  try {
    skill(f.shared, 'weekly-report', '公共模板'); const own = skill(f.own, 'weekly-report', '当前 Bot 模板');
    const first = loadBotSkills([f.shared, f.own]);
    assert.deepEqual(first.errors, []); assert.equal(first.skills.length, 1);
    assert.match(readSkillFile(first.skills[0]), /当前 Bot 模板/);
    writeFileSync(join(own, 'SKILL.md'), '---\nname: weekly-report\ndescription: 新说明。\n---\n\n第二轮模板', 'utf8');
    assert.match(readSkillFile(first.skills[0]), /当前 Bot 模板/);
    const second = loadBotSkills([f.shared, f.own]);
    assert.match(readSkillFile(second.skills[0]), /第二轮模板/);
  } finally { f.close(); }
});
test('invalid and disabled skills are excluded rather than granting capabilities', () => {
  const f = fixture();
  try {
    const bad = skill(f.own, 'bad', '正文');
    writeFileSync(join(bad, 'SKILL.md'), '---\nname: Bad Name\n---\n无有效说明', 'utf8');
    const disabled = skill(f.own, 'manual-only', '正文');
    writeFileSync(join(disabled, 'SKILL.md'), '---\nname: manual-only\ndescription: 暂停使用。\ndisable-model-invocation: true\n---\n正文', 'utf8');
    const loaded = loadBotSkills([f.shared, f.own]);
    assert.equal(loaded.skills.length, 0); assert.equal(loaded.errors.length, 1);
  } finally { f.close(); }
});

test('settings catalog retains both skill sources and identifies the effective override', () => {
  const f = fixture();
  try {
    skill(f.shared, 'weekly-report', '公共模板'); skill(f.own, 'weekly-report', '专属模板');
    skill(f.shared, 'document-format', '公共排版');
    const catalog = loadBotSkillCatalog(f.shared, f.own);
    assert.equal(catalog.skills.length, 3);
    assert.equal(catalog.skills.find(item => item.source === 'shared' && item.name === 'weekly-report')?.overridden, true);
    assert.equal(catalog.skills.find(item => item.source === 'shared' && item.name === 'document-format')?.overridden, false);
    assert.match(catalog.skills.find(item => item.source === 'private')!.content, /专属模板/);
    assert.deepEqual(catalog.errors, []);
    assert.equal(loadBotSkills([f.shared, f.own]).skills.length, 2);
  } finally { f.close(); }
});
test('skill reference reads reject traversal and junction escapes', () => {
  const f = fixture();
  try {
    const folder = skill(f.own, 'weekly-report', '模板');
    mkdirSync(join(folder, 'references')); writeFileSync(join(folder, 'references', 'format.md'), '周报格式', 'utf8');
    const loaded = loadBotSkills([f.own]).skills[0];
    assert.equal(readSkillFile(loaded, 'references/format.md'), '周报格式');
    assert.throws(() => readSkillFile(loaded, '../MEMORY.md'), /相对路径/);
    for (const path of ['references/.. /.. /MEMORY.md', 'references/CON', 'references/data.md:secret', 'references/format.md.']) assert.throws(() => readSkillFile(loaded, path), /相对路径/);
    const other = join(f.dir, 'private'); mkdirSync(other); writeFileSync(join(other, 'secret.md'), '其他 Bot 的私人内容', 'utf8');
    symlinkSync(other, join(folder, 'references', 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => readSkillFile(loaded, 'references/outside/secret.md'), /链接|联接/);
  } finally { f.close(); }
});
