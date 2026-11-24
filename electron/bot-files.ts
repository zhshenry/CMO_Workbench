import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, closeSync, constants, copyFileSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, win32 } from 'node:path';
import type { BotArtifact, BotMemory, BotProfile } from '../shared/bot-contracts';
import type { BotDirectory, BotWorkspaceFile } from '../shared/bot-files';
import type { BotStore } from './bot-store';
import { botBindingsSchema, mcpServerSchema } from '../shared/bot-extensions';
import { botFileParts } from './bot-file-paths';

const digest = (text: string | Buffer) => createHash('sha256').update(text).digest('hex');
function fileDigest(path: string): string {
  const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(64 * 1024), file = openSync(path, 'r');
  try { let bytes: number; while ((bytes = readSync(file, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, bytes)); return hash.digest('hex'); }
  finally { closeSync(file); }
}
const validId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/.test(id);
const generated = '> 此文件由应用根据数据库自动生成，仅供查看。请在应用中修改，外部编辑不会生效。\n\n';

/** A file is an export or a scoped workspace resource, never a source of Bot identity or memory. */
export class BotFiles {
  private timer?: ReturnType<typeof setInterval>;
  private debounce?: ReturnType<typeof setTimeout>;
  private watchers: FSWatcher[] = [];
  private readonly failures = new Map<string, string>();
  private readonly root: string;
  constructor(private readonly store: BotStore) {
    this.root = resolve(store.directory);
    store.db.exec(
      "CREATE TABLE IF NOT EXISTS bot_file_dirty(scope TEXT PRIMARY KEY);" +
      "CREATE TABLE IF NOT EXISTS bot_file_exports(path TEXT PRIMARY KEY, hash TEXT NOT NULL);" +
      "CREATE TABLE IF NOT EXISTS bot_workspace_files(id TEXT PRIMARY KEY,bot_id TEXT NOT NULL,path TEXT NOT NULL,UNIQUE(bot_id,path));" +
      "CREATE TRIGGER IF NOT EXISTS bot_files_profile_insert AFTER INSERT ON bots BEGIN INSERT OR IGNORE INTO bot_file_dirty VALUES('bot:'||NEW.id); END;" +
      "CREATE TRIGGER IF NOT EXISTS bot_files_profile_update AFTER UPDATE ON bots BEGIN INSERT OR IGNORE INTO bot_file_dirty VALUES('bot:'||NEW.id); END;" +
      "CREATE TRIGGER IF NOT EXISTS bot_files_memory_insert AFTER INSERT ON bot_memories BEGIN INSERT OR IGNORE INTO bot_file_dirty VALUES('memory:'||COALESCE(NEW.bot_id,'')); END;" +
      "CREATE TRIGGER IF NOT EXISTS bot_files_memory_update AFTER UPDATE ON bot_memories BEGIN INSERT INTO bot_file_dirty SELECT 'memory:'||COALESCE(OLD.bot_id,'') WHERE NOT EXISTS(SELECT 1 FROM bot_file_dirty WHERE scope='memory:'||COALESCE(OLD.bot_id,'')); INSERT INTO bot_file_dirty SELECT 'memory:'||COALESCE(NEW.bot_id,'') WHERE NOT EXISTS(SELECT 1 FROM bot_file_dirty WHERE scope='memory:'||COALESCE(NEW.bot_id,'')); END;" +
      "CREATE TRIGGER IF NOT EXISTS bot_files_memory_delete AFTER DELETE ON bot_memories BEGIN INSERT OR IGNORE INTO bot_file_dirty VALUES('memory:'||COALESCE(OLD.bot_id,'')); END;",
    );
    if (!(store.db.prepare('PRAGMA table_info(bot_workspace_files)').all() as { name: string }[]).some(column => column.name === 'task_id')) store.db.exec('ALTER TABLE bot_workspace_files ADD COLUMN task_id TEXT');
    this.repair();
  }
  private safe(path: string): string {
    const full = resolve(path), rel = relative(this.root, full);
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..' + win32.sep) || rel.startsWith('../')) throw new Error('文件路径超出应用目录');
    let current = this.root;
    for (const part of rel.split(/[/\\]/).filter(Boolean)) {
      current = join(current, part);
      try { if (lstatSync(current).isSymbolicLink()) throw new Error('不能通过符号链接或目录联接访问 Bot 文件'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
    return full;
  }
  private directory(path: string): string {
    const full = this.safe(path); mkdirSync(full, { recursive: true }); return full;
  }
  paths(botId: string): Omit<BotDirectory, 'pending' | 'error'> {
    if (!validId(botId)) throw new Error('Bot 标识无效');
    this.store.profile(botId);
    const root = this.safe(join(this.root, 'bots', botId)), workspace = join(root, 'workspace');
    return { root, workspace, inputs: join(workspace, 'inputs'), outputs: join(workspace, 'outputs'), skills: join(root, 'skills') };
  }
  private ensure(botId: string) {
    const paths = this.paths(botId);
    for (const path of [paths.inputs, paths.outputs, paths.skills]) this.directory(path);
    return paths;
  }
  status(botId: string): BotDirectory {
    const paths = this.ensure(botId);
    const pending = (this.store.db.prepare("SELECT COUNT(*) AS count FROM bot_file_dirty WHERE scope IN (?,?,'memory:','registry:') OR scope IN (SELECT 'artifact:'||id FROM bot_artifacts WHERE json_extract(payload,'$.producerBotId')=?)")
      .get('bot:' + botId, 'memory:' + botId, botId) as { count: number }).count;
    return { ...paths, pending, error: this.failures.get('bot:' + botId) ?? this.failures.get('memory:' + botId) ?? this.failures.get('memory:') ?? this.failures.get('registry:') ?? (pending ? '部分文件待同步，应用会自动重试。' : undefined) };
  }
  private exportFile(path: string, text: string): void {
    path = this.safe(path);
    this.directory(dirname(path));
    const key = relative(this.root, path).replaceAll('\\', '/');
    const prior = this.store.db.prepare('SELECT hash FROM bot_file_exports WHERE path=?').get(key) as { hash: string } | undefined;
    if (existsSync(path) && statSync(path).nlink > 1) throw new Error('只读镜像不能是硬链接，请移除链接后重试');
    const content = existsSync(path) ? fileDigest(path) : undefined;
    const hash = digest(text);
    if (content && content !== hash && (!prior || content !== prior.hash)) {
      const backup = this.safe(join(this.directory(join(this.root, 'bot-file-backups')), digest(key).slice(0, 16) + '-' + content + '-' + basename(path)));
      if (!existsSync(backup)) { copyFileSync(path, backup, constants.COPYFILE_EXCL); chmodSync(backup, 0o600); }
    }
    if (!content || content !== hash) {
      const temporary = this.safe(join(dirname(path), '.' + basename(path) + '-' + randomUUID() + '.tmp'));
      try {
        writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
        if (content) chmodSync(path, 0o600);
        renameSync(temporary, path);
      } finally {
        if (existsSync(temporary)) rmSync(temporary);
        if (existsSync(path)) chmodSync(path, 0o400);
      }
    } else if (statSync(path).mode & 0o222) chmodSync(path, 0o400);
    this.store.db.prepare('INSERT INTO bot_file_exports VALUES(?,?) ON CONFLICT(path) DO UPDATE SET hash=excluded.hash').run(key, hash);
  }
  private memoryFile(botId: string | null): void {
    const rows = this.store.memories(botId ?? '', botId !== null).filter(row => row.botId === botId && row.scope === (botId ? 'private' : 'shared'));
    const owner = botId ? this.store.profile(botId).name + ' · 当前 Bot 私人记忆' : '本应用全局记忆';
    const render = (row: BotMemory) => '## ' + (row.title ?? row.text.slice(0, 32)).replaceAll('\n', ' ') + '\n\n' +
      '- ID: ' + row.id + '\n- 版本: ' + row.revision + '\n- 更新时间: ' + row.updatedAt +
      '\n- 加载: ' + (row.retention === 'on-demand' ? '按需' : '常用') + '\n\n' + row.text + '\n';
    const text = '# ' + owner + '\n\n' + generated + (rows.length ? rows.map(render).join('\n---\n\n') : '暂无记忆。\n');
    this.exportFile(botId ? join(this.ensure(botId).root, 'memory', 'MEMORY.md') : join(this.root, 'memory', 'MEMORY.md'), text);
  }
  private copyLegacy(botId: string): void {
    const key = 'bot.files.legacyCopied.' + botId;
    if (this.store.ai.setting(key, false)) return;
    const source = this.safe(join(this.root, 'bot-runtime', botId));
    if (existsSync(source)) {
      const destination = join(this.ensure(botId).outputs, 'legacy-runtime');
      const copy = (from: string, to: string) => {
        this.safe(from); this.directory(to);
        for (const entry of readdirSync(from, { withFileTypes: true })) {
          botFileParts(entry.name);
          if (entry.isSymbolicLink()) throw new Error('旧工作目录包含链接，已保留原目录，请手工核对');
          const target = this.safe(join(to, entry.name)), original = this.safe(join(from, entry.name));
          if (entry.isDirectory()) copy(original, target);
          else if (entry.isFile() && !existsSync(target)) { if (statSync(original).nlink > 1) throw new Error('旧工作文件包含硬链接，已保留原件'); copyFileSync(original, target, constants.COPYFILE_EXCL); }
        }
      };
      if (readdirSync(source).length) copy(source, destination);
    }
    this.store.ai.setSetting(key, true);
  }
  materializeArtifact(artifact: BotArtifact): void {
    this.store.db.prepare('INSERT OR IGNORE INTO bot_file_dirty VALUES(?)').run('artifact:' + artifact.id);
    this.flush();
  }
  flush(): void {
    const rows = this.store.db.prepare('SELECT scope FROM bot_file_dirty').all() as { scope: string }[];
    for (const { scope } of rows) {
      try {
        for (const name of ['tools', 'mcp', 'skills', 'memory', 'bots']) this.directory(join(this.root, name));
        const [kind, id] = scope.split(':');
        if (kind === 'bot') {
          const bot = this.store.profile(id), paths = this.ensure(id);
          const { instructions, ...profile } = bot;
          const bindings = botBindingsSchema.parse(this.store.ai.setting('bot.bindings.' + id, { revision: 0, mcp: [] }));
          const tools = this.store.ai.setting<{ name: string; label: string }[]>('bot.tools.' + id, []).map(({ name, label }) => ({ name, label }));
          this.exportFile(join(paths.root, 'profile.json'), JSON.stringify({ generated: true, source: 'database', ...profile, bindings, tools }, null, 2) + '\n');
          this.exportFile(join(paths.root, 'INSTRUCTIONS.md'), '# ' + bot.name + ' · 工作说明\n\n' + generated + '<!-- revision: ' + bot.revision + ' -->\n\n' + instructions + '\n');
          this.memoryFile(id);
          this.copyLegacy(id);
        } else if (kind === 'memory') this.memoryFile(id || null);
        else if (kind === 'registry') {
          const servers = this.store.ai.setting<{ definition: unknown; revision: number }[]>('bot.mcp.servers', [])
            .map(server => ({ definition: mcpServerSchema.parse(server.definition), revision: server.revision }));
          const tools = this.store.all<BotProfile>('bots').map(bot => ({ botId: bot.id,
            tools: this.store.ai.setting<{ name: string; label: string }[]>('bot.tools.' + bot.id, []).map(({ name, label }) => ({ name, label })) }));
          this.exportFile(join(this.root, 'mcp', 'servers.json'), JSON.stringify({ generated: true, source: 'database', servers }, null, 2) + '\n');
          this.exportFile(join(this.root, 'tools', 'registry.json'), JSON.stringify({ generated: true, source: 'application', bots: tools }, null, 2) + '\n');
        } else if (kind === 'artifact') {
          const artifact = this.store.get<BotArtifact>('bot_artifacts', id);
          if (artifact.content !== undefined) {
            const path = 'outputs/' + artifact.id + '.md', full = this.workspacePath(artifact.producerBotId, path);
            if (!existsSync(full) || readFileSync(full, 'utf8') !== artifact.content) this.write(artifact.producerBotId, path, artifact.content, true, artifact.taskId);
          }
          this.store.ai.setSetting('bot.files.artifactCopied.' + id, true);
        }
        this.store.db.prepare('DELETE FROM bot_file_dirty WHERE scope=?').run(scope);
        this.failures.delete(scope);
      } catch (error) { this.failures.set(scope, error instanceof Error ? error.message : '文件待同步'); }
    }
  }
  repair(): void {
    for (const bot of this.store.all<BotProfile>('bots')) this.store.db.prepare('INSERT OR IGNORE INTO bot_file_dirty VALUES(?)').run('bot:' + bot.id);
    this.store.db.prepare("INSERT OR IGNORE INTO bot_file_dirty VALUES('memory:')").run();
    this.store.db.prepare("INSERT OR IGNORE INTO bot_file_dirty VALUES('registry:')").run();
    for (const artifact of this.store.all<BotArtifact>('bot_artifacts')) {
      if (!this.store.ai.setting('bot.files.artifactCopied.' + artifact.id, false)) {
        this.store.db.prepare('INSERT OR IGNORE INTO bot_file_dirty VALUES(?)').run('artifact:' + artifact.id);
      }
    }
    this.flush();
  }
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.repair(), 30_000);
    this.timer.unref();
    for (const folder of ['bots', 'memory', 'tools', 'mcp']) {
      try {
        const watcher = watch(join(this.root, folder), { recursive: true, persistent: false }, (_event, filename) => {
          if (!filename || !/(^|[/\\])(profile\.json|INSTRUCTIONS\.md|MEMORY\.md|registry\.json|servers\.json)$/.test(String(filename))) return;
          clearTimeout(this.debounce); this.debounce = setTimeout(() => this.repair(), 180); this.debounce.unref();
        });
        watcher.on('error', () => {}); this.watchers.push(watcher);
      } catch { /* Periodic repair also covers unavailable directory watchers. */ }
    }
  }
  close(): void { clearInterval(this.timer); clearTimeout(this.debounce); this.watchers.forEach(watcher => watcher.close()); this.watchers = []; this.timer = undefined; }
  private workspacePath(botId: string, input: string, write = false): string {
    const paths = this.ensure(botId), parts = botFileParts(input);
    if (!['inputs', 'outputs'].includes(parts[0]) || write && parts[0] !== 'outputs') throw new Error('只能读取 inputs/outputs，生成文件只能写入 outputs');
    return this.safe(join(paths.workspace, ...parts));
  }
  private record(botId: string, path: string): BotWorkspaceFile {
    path = path.replaceAll('\\', '/');
    const full = this.workspacePath(botId, path), info = statSync(full);
    if (!info.isFile()) throw new Error('请选择文件');
    if (info.nlink > 1) throw new Error('不能通过硬链接访问 Bot 文件');
    this.store.db.prepare('INSERT OR IGNORE INTO bot_workspace_files(id,bot_id,path) VALUES(?,?,?)').run(randomUUID(), botId, path);
    const row = this.store.db.prepare('SELECT id FROM bot_workspace_files WHERE bot_id=? AND path=?').get(botId, path) as { id: string };
    return { id: row.id, botId, path, name: basename(full), bytes: info.size, updatedAt: info.mtime.toISOString() };
  }
  list(botId: string): BotWorkspaceFile[] {
    const paths = this.ensure(botId), result: BotWorkspaceFile[] = [];
    const visit = (path: string, depth: number) => {
      if (depth > 8 || result.length >= 1000) return;
      for (const entry of readdirSync(this.safe(path), { withFileTypes: true })) {
        botFileParts(entry.name);
        if (entry.isSymbolicLink()) continue;
        const full = join(path, entry.name);
        if (entry.isDirectory()) visit(full, depth + 1);
        else if (entry.isFile()) result.push(this.record(botId, relative(paths.workspace, full).replaceAll('\\', '/')));
        if (result.length >= 1000) break;
      }
    };
    visit(paths.inputs, 0); visit(paths.outputs, 0); return result;
  }
  read(botId: string, path: string) {
    const full = this.workspacePath(botId, path), file = this.record(botId, path);
    if (file.bytes > 2_000_000) throw new Error('文件超过 2 MB，请读取拆分后的文本或使用对应文档工作台');
    const bytes = readFileSync(full);
    if (bytes.includes(0) || !/\.(md|txt|json|csv|tsv|xml|html|css|js|ts|py|yaml|yml|log)$/i.test(path)) return { file, text: null, note: '原件已保存，请使用相应文档工具读取此格式' };
    return { file, text: bytes.toString('utf8') };
  }
  readShared(id: string) {
    const row = this.store.db.prepare('SELECT bot_id,path FROM bot_workspace_files WHERE id=?').get(id) as { bot_id: string; path: string } | undefined;
    if (!row) throw new Error('引用文件不存在');
    return this.read(row.bot_id, row.path);
  }
  owns(botId: string, id: string): boolean { return !!this.store.db.prepare('SELECT id FROM bot_workspace_files WHERE id=? AND bot_id=?').get(id, botId); }
  producedBy(id: string, taskId: string): boolean { return !!this.store.db.prepare('SELECT id FROM bot_workspace_files WHERE id=? AND task_id=?').get(id, taskId); }
  write(botId: string, path: string, text: string, overwrite = false, taskId?: string): BotWorkspaceFile {
    const full = this.workspacePath(botId, path, true);
    if (Buffer.byteLength(text) > 2_000_000) throw new Error('每个文本文件最多 2 MB');
    if (existsSync(full) && statSync(full).nlink > 1) throw new Error('不能通过硬链接修改 Bot 文件');
    this.directory(dirname(full));
    if (existsSync(full) && !overwrite) throw new Error('同名文件已存在，请使用新文件名，或明确选择覆盖');
    if (existsSync(full)) {
      const backup = join(this.directory(join(this.root, 'bot-file-backups')), digest(full).slice(0, 16) + '-' + fileDigest(full) + '-' + basename(full));
      if (!existsSync(backup)) copyFileSync(full, backup, constants.COPYFILE_EXCL);
    }
    writeFileSync(full, text, { flag: overwrite ? 'w' : 'wx', mode: 0o600 });
    const file = this.record(botId, path);
    this.store.db.prepare('UPDATE bot_workspace_files SET task_id=? WHERE id=?').run(taskId ?? null, file.id);
    return file;
  }
  import(botId: string, sources: string[]): BotWorkspaceFile[] {
    const paths = this.ensure(botId);
    return sources.map(source => {
      const info = lstatSync(source);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('只能导入普通文件');
      const name = basename(source), destination = this.workspacePath(botId, 'inputs/' + name);
      if (!existsSync(destination)) copyFileSync(source, destination, constants.COPYFILE_EXCL);
      else if (fileDigest(source) !== fileDigest(destination)) throw new Error('输入目录已有不同内容的同名文件，请先重命名后再导入');
      return this.record(botId, relative(paths.workspace, destination).replaceAll('\\', '/'));
    });
  }
}
