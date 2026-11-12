import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { AgentEventSchema, agentProjectKey, type AgentConnectResult, type AgentMessage } from '../shared/agent-message-contracts';
import { AgentMessageStore } from './agent-message-store';
import { agentHookScript } from './agent-hook-script';
import { projectPathProblem } from './agent-project-path';

// CodeAI(Claude Code)项目级 settings.json 的 hooks.Stop 格式:
// hooks.Stop 是 [{ matcher: "", hooks: [{ type, command, timeout }] }]。我们只追加到 matcher "" 的 hooks 数组,
// 不动其他 matcher(如 "Bash")和其他 Stop 之外的 hook,移除时按 command 精确匹配。
const ConfigSchema = z.object({ hooks: z.record(z.string(), z.array(z.unknown())).optional() }).passthrough();
type Config = { hooks?: Record<string, unknown[]>; [key: string]: unknown };
const PROJECT_FILE = '.claude/settings.json';
const EVENT = 'Stop';

export class AgentHooks {
  readonly messages: AgentMessageStore;
  readonly inbox: string;
  private relay: string;
  private enabledFile: string;
  constructor(private dir: string, private now = Date.now) {
    this.messages = new AgentMessageStore(dir, now);
    this.inbox = join(dir, 'agent-inbox');
    this.relay = join(dir, 'agent-hooks', 'codeai-island.js');
    this.enabledFile = join(dir, 'agent-projects.json');
  }
  private command(): string { return `node "${this.relay}"`; }
  private owns(value: unknown): boolean {
    return typeof value === 'object' && value !== null && 'command' in value && (value as { command?: unknown }).command === this.command();
  }
  listEnabled(): string[] {
    if (!existsSync(this.enabledFile)) return [];
    try { return z.array(z.string()).parse(JSON.parse(readFileSync(this.enabledFile, 'utf8'))); }
    catch { return []; }
  }
  private saveEnabled(projects: string[]): void { writeJsonAtomic(this.enabledFile, projects); }
  private ensureRelay(): void {
    const script = agentHookScript(this.inbox);
    if (existsSync(this.relay) && readFileSync(this.relay, 'utf8') === script) return;
    mkdirSync(join(this.dir, 'agent-hooks'), { recursive: true });
    mkdirSync(this.inbox, { recursive: true });
    writeFileSync(`${this.relay}.tmp`, script, 'utf8');
    renameSync(`${this.relay}.tmp`, this.relay);
  }
  // 操作单个项目的 .claude/settings.json:enabled=true 追加我们的 Stop hook,false 移除。失败抛错(调用方收集)。
  connectOne(projectDir: string, enabled: boolean): void {
    if (enabled) { const problem = projectPathProblem(projectDir); if (problem) throw new Error(problem); }
    const file = join(projectDir, PROJECT_FILE);
    const text = existsSync(file) ? readFileSync(file, 'utf8').replace(/^﻿/, '') : null;
    let config: Config;
    try { config = text === null ? {} : ConfigSchema.parse(JSON.parse(text)) as Config; }
    catch { throw new Error('项目 settings.json 无法读取，未覆盖原配置'); }
    config.hooks ??= {};
    const entries = config.hooks[EVENT] ?? [];
    config.hooks[EVENT] = entries.flatMap(entry => {
      if (!entry || typeof entry !== 'object' || !('hooks' in entry) || !Array.isArray((entry as { hooks: unknown[] }).hooks)) return [entry];
      if (!(entry as { matcher?: string }).matcher) {
        const hooks = (entry as { hooks: unknown[] }).hooks.filter(value => !this.owns(value));
        return hooks.length ? [{ ...entry, hooks }] : [];
      }
      return [entry];
    });
    if (enabled) {
      const directory = join(projectDir, '.claude');
      if (!existsSync(directory)) mkdirSync(directory);
      const entries2 = config.hooks[EVENT] as Array<Record<string, unknown>>;
      let blank = entries2.find(entry => !entry.matcher);
      if (!blank) { blank = { matcher: '', hooks: [] }; entries2.push(blank); }
      (blank.hooks as unknown[]).push({ type: 'command', command: this.command(), timeout: 5 });
      config.hooks[EVENT] = entries2;
    }
    if (!config.hooks[EVENT]!.length) delete config.hooks[EVENT];
    if (text === null && !enabled) return;
    // 写前重读比对:用户在打开设置期间手动改了 settings.json,则拒绝覆盖。
    if (existsSync(file) && readFileSync(file, 'utf8').replace(/^﻿/, '') !== text) throw new Error('项目配置刚刚发生变化，请重试连接');
    if (text !== null) copyFileSync(file, `${file}.cmo-backup-${this.now()}`);
    writeJsonAtomic(file, config);
  }
  // 整批设置已启用项目清单:差量注入/移除。返回成功项与失败项。同时持久化 enabled 清单(仅成功项)。
  setEnabled(projects: string[]): AgentConnectResult {
    const currentPaths = new Map(this.listEnabled().map(path => [agentProjectKey(path), path]));
    const requested = new Map<string, string>();
    for (const path of projects) { const key = agentProjectKey(path); if (!requested.has(key)) requested.set(key, currentPaths.get(key) ?? path.trim()); }
    projects = [...requested.values()];
    const current = new Set(this.listEnabled()), next = new Set(projects), failed: AgentConnectResult['failed'] = [];
    const toAdd = projects.filter(p => !current.has(p)), toRemove = [...current].filter(p => !next.has(p));
    // 同步中继脚本,已有连接的旧脚本也会在轮询时升级。
    if (projects.length) this.ensureRelay();
    for (const p of toAdd) {
      try { this.connectOne(p, true); }
      catch (error) { failed.push({ path: p, error: (error as Error).message }); }
    }
    for (const p of toRemove) {
      try { this.connectOne(p, false); }
      catch (error) { failed.push({ path: p, error: (error as Error).message }); }
    }
    // enabled 清单只记成功项:新增项失败的不记;旧的成功保留(移除失败的也算保留,因 settings.json 未改)。
    const removed = toRemove.filter(p => !failed.some(f => f.path === p));
    const enabled = [...new Set([...projects.filter(p => !failed.some(f => f.path === p)), ...current].filter(p => !removed.includes(p)))];
    this.saveEnabled(enabled);
    return { enabled, failed };
  }
  poll(): { alerts: AgentMessage[]; changed: boolean; error: string } {
    if (this.messages.loadError) return { alerts: [], changed: false, error: this.messages.loadError };
    if (this.listEnabled().length) this.ensureRelay();
    if (!existsSync(this.inbox)) return { alerts: [], changed: false, error: '' };
    const files = readdirSync(this.inbox).filter(name => /^\d+-[a-f0-9]+\.json$/.test(name)).sort().slice(0, 100);
    if (!files.length) return { alerts: [], changed: false, error: '' };
    const before = JSON.stringify(this.messages.read()), alerts: AgentMessage[] = [];
    let error = '';
    for (const filename of files) {
      const file = join(this.inbox, filename);
      let input: unknown;
      try {
        if (statSync(file).size > 32768) throw new Error('事件过大');
        input = AgentEventSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
      } catch { renameSync(file, `${file}.invalid`); error = '收到无法识别的 CodeAI 事件，已保留文件供检查'; continue; }
      const message = this.messages.ingest(input);
      if (message) alerts.push(message);
      unlinkSync(file);
    }
    return { alerts, changed: JSON.stringify(this.messages.read()) !== before, error };
  }
}
