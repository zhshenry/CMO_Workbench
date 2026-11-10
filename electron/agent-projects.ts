import { existsSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join } from 'node:path';

export interface DiscoveredProject {
  dir: string;
  cwd: string;
  lastActive: number;
  sessionCount: number;
}

export function discoverCodeaiProjects(home: string): DiscoveredProject[] {
  const projectsDir = join(home, '.claude', 'projects');
  if (!existsSync(projectsDir)) return [];
  const result: DiscoveredProject[] = [];
  for (const dir of readdirSync(projectsDir)) {
    const full = join(projectsDir, dir);
    let isDir = false;
    try { isDir = statSyncSafe(full).isDirectory(); } catch { continue; }
    if (!isDir) continue;
    let jsonls: string[] = [];
    try { jsonls = readdirSync(full).filter(name => name.endsWith('.jsonl')); } catch { continue; }
    if (!jsonls.length) { result.push({ dir, cwd: '', lastActive: 0, sessionCount: 0 }); continue; }
    let latest = { name: jsonls[0], mtime: 0 };
    for (const name of jsonls) {
      let mtime = 0;
      try { mtime = statSyncSafe(join(full, name)).mtimeMs; } catch { continue; }
      if (mtime > latest.mtime) latest = { name, mtime };
    }
    result.push({ dir, cwd: readCwdFromTranscript(join(full, latest.name)), lastActive: latest.mtime, sessionCount: jsonls.length });
  }
  return result.sort((a, b) => b.lastActive - a.lastActive);
}

function readCwdFromTranscript(file: string): string {
  let text = '';
  try {
    const size = statSyncSafe(file).size;
    const fd = openSyncSafe(file);
    if (fd === null) return '';
    const length = Math.min(size, 4096);
    const buffer = Buffer.alloc(length);
    readSyncSafe(fd, buffer, 0, length, 0);
    closeSyncSafe(fd);
    text = buffer.toString('utf8');
  } catch { return ''; }
  const match = text.match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match) return '';
  try { return JSON.parse(`"${match[1]}"`); } catch { return ''; }
}

const statSyncSafe = (file: string) => statSync(file);
const openSyncSafe = (file: string): number | null => { try { return openSync(file, 'r'); } catch { return null; } };
const readSyncSafe = (fd: number, buf: Buffer, off: number, len: number, pos: number) => { try { readSync(fd, buf, off, len, pos); } catch { /* ignore */ } };
const closeSyncSafe = (fd: number) => { try { closeSync(fd); } catch { /* ignore */ } };
