import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { agentProjectKey, type DiscoveredProject } from '../shared/agent-message-contracts';
import { isSystemProject, projectPathProblem } from './agent-project-path';

function project(dir: string, cwd: string, lastActive: number, sessionCount: number, source: DiscoveredProject['source']): DiscoveredProject {
  const problem = projectPathProblem(cwd);
  return { dir, cwd, lastActive, sessionCount, source, available: !problem, problem: problem || undefined };
}

function recentProjects(home: string): { path: string; lastOpenedAt?: string }[] {
  const override = (process.env.CODEAI_HOME || process.env.CODEAI_GLOBAL_HOME || '').trim();
  const root = override ? resolve(override) : join(home, '.codeai'), file = join(root, 'database', 'codeai.db');
  try {
    if (existsSync(file)) {
      const db = new DatabaseSync(file, { readOnly: true });
      try {
        if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='history'").get()) {
          const rows = db.prepare('SELECT key, content FROM history WHERE type=? ORDER BY updated_at DESC LIMIT 30').all('project') as { key: string; content: string }[];
          return rows.flatMap(row => {
            try { const value = JSON.parse(row.content); return typeof (value?.path ?? row.key) === 'string' ? [{ path: value?.path ?? row.key, lastOpenedAt: value?.lastOpenedAt }] : []; }
            catch { return []; }
          });
        }
      } finally { db.close(); }
    }
    const legacy = join(root, 'data', 'sessions', 'project-history.json');
    if (!existsSync(legacy)) return [];
    const value = JSON.parse(readFileSync(legacy, 'utf8'));
    return Array.isArray(value?.projects) ? value.projects.filter((item: unknown) => !!item && typeof (item as { path?: unknown }).path === 'string') : [];
  } catch { throw new Error('无法读取 CodeAI 最近项目，请检查 CodeAI 数据目录后重新扫描'); }
}

export async function discoverCodeaiProjects(home: string, enabled: string[] = []): Promise<DiscoveredProject[]> {
  const recent = recentProjects(home), history = await sessionProjects(home), projects = new Map<string, DiscoveredProject>();
  for (const item of history) if (!isSystemProject(item.cwd)) {
    const key = item.cwd ? agentProjectKey(item.cwd) : `history:${item.dir}`, old = projects.get(key);
    projects.set(key, old ? { ...old, sessionCount: old.sessionCount + item.sessionCount } : item);
  }
  for (const item of recent) {
    const cwd = item.path.trim(); if (!cwd || isSystemProject(cwd)) continue;
    const key = agentProjectKey(cwd), old = projects.get(key), opened = Date.parse(item.lastOpenedAt ?? '');
    if (old?.source === 'recent' && old.lastActive >= (Number.isFinite(opened) ? opened : 0)) continue;
    projects.set(key, project(old?.dir ?? cwd, normalize(cwd), Number.isFinite(opened) ? opened : 0, old?.sessionCount ?? 0, 'recent'));
  }
  for (const cwd of enabled) {
    const key = agentProjectKey(cwd), old = projects.get(key);
    if (!old) projects.set(key, project(cwd, cwd, 0, 0, 'manual'));
  }
  const rank = { recent: 0, manual: 1, history: 2 };
  return [...projects.values()].sort((a, b) => rank[a.source] - rank[b.source] || b.lastActive - a.lastActive);
}

async function sessionProjects(home: string): Promise<DiscoveredProject[]> {
  const projectsDir = join(home, '.claude', 'projects');
  if (!existsSync(projectsDir)) return [];
  const result: DiscoveredProject[] = [];
  for (const dir of readdirSync(projectsDir)) {
    const full = join(projectsDir, dir);
    let isDir = false;
    try { isDir = statSync(full).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    let jsonls: string[] = [];
    try { jsonls = readdirSync(full).filter(name => name.endsWith('.jsonl')); } catch { continue; }
    if (!jsonls.length) { result.push(project(dir, '', 0, 0, 'history')); continue; }
    const sessions = jsonls.flatMap(name => {
      try { return [{ name, mtime: statSync(join(full, name)).mtimeMs }]; } catch { return []; }
    }).sort((a, b) => b.mtime - a.mtime);
    let cwd = '';
    for (const session of sessions) {
      cwd = await readCwdFromTranscript(join(full, session.name));
      if (cwd) break;
    }
    result.push(project(dir, cwd, sessions[0]?.mtime ?? 0, jsonls.length, 'history'));
  }
  return result.sort((a, b) => b.lastActive - a.lastActive);
}

async function readCwdFromTranscript(file: string): Promise<string> {
  const stream = createReadStream(file, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      try {
        const entry = JSON.parse(line) as { cwd?: unknown } | null;
        if (typeof entry?.cwd === 'string' && entry.cwd) return entry.cwd;
      } catch { /* 跳过损坏或未写完的记录,继续找项目路径。 */ }
    }
  } catch { /* 会话可能已被清理,调用方继续检查其他会话。 */ }
  finally { lines.close(); stream.destroy(); }
  return '';
}
