import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { isAbsolute, join, parse, relative, resolve } from 'node:path';
import { loadSkillsFromDir } from '@earendil-works/pi-coding-agent';
import { botFileParts } from './bot-file-paths';

export interface BotSkillSnapshot { name: string; description: string; root: string; content: string; }
function contained(base: string, path: string): string {
  const full = resolve(path), rel = relative(resolve(base), full);
  if (isAbsolute(rel) || rel.split(/[/\\]/).includes('..')) throw new Error('技能文件超出已加载技能目录');
  let current = parse(full).root;
  for (const part of full.slice(current.length).split(/[/\\]/).filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current).isSymbolicLink()) throw new Error('技能目录不能包含符号链接或目录联接');
  }
  if (statSync(full).isFile() && statSync(full).nlink > 1) throw new Error('不能通过硬链接读取技能');
  return full;
}
/** Only the catalog and an immutable SKILL.md snapshot are loaded per turn. */
export function loadBotSkills(roots: string[]): { skills: BotSkillSnapshot[]; errors: string[] } {
  const named = new Map<string, BotSkillSnapshot>(), errors: string[] = [];
  for (const base of roots) {
    if (!existsSync(base)) continue;
    try {
      contained(base, base);
      for (const entry of readdirSync(base, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
        const root = contained(base, join(base, ...botFileParts(entry.name))), file = join(root, 'SKILL.md');
        if (!existsSync(file)) continue;
        try {
          contained(root, file);
          if (statSync(file).size > 100_000) throw new Error('SKILL.md 超过 100 KB');
          const result = loadSkillsFromDir({ dir: root, source: 'path' });
          if (result.diagnostics.length) throw new Error('技能格式未通过校验：' + result.diagnostics.map(item => item.message).join('；'));
          const skill = result.skills[0];
          if (!skill || skill.disableModelInvocation) continue;
          named.set(skill.name, { name: skill.name, description: skill.description, root, content: readFileSync(file, 'utf8') });
        } catch (error) { errors.push(entry.name + '：' + (error instanceof Error ? error.message : '技能读取失败')); }
      }
    } catch (error) { errors.push(error instanceof Error ? error.message : '技能目录无法读取'); }
  }
  return { skills: [...named.values()], errors };
}
export function loadBotSkillCatalog(shared: string, own: string) {
  const common = loadBotSkills([shared]), privateSkills = loadBotSkills([own]);
  const names = new Set(privateSkills.skills.map(skill => skill.name));
  return {
    skills: [...common.skills.map(skill => ({ ...skill, source: 'shared' as const, overridden: names.has(skill.name) })),
      ...privateSkills.skills.map(skill => ({ ...skill, source: 'private' as const, overridden: false }))],
    errors: [...common.errors.map(message => '公共技能：' + message), ...privateSkills.errors.map(message => '当前 Bot：' + message)],
  };
}
export function readSkillFile(skill: BotSkillSnapshot, path?: string): string {
  if (!path || path === 'SKILL.md') return skill.content;
  const full = contained(skill.root, join(skill.root, ...botFileParts(path)));
  if (!statSync(full).isFile() || statSync(full).size > 500_000) throw new Error('技能子文件须为不超过 500 KB 的普通文本文件');
  return readFileSync(full, 'utf8');
}
