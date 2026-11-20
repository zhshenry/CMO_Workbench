import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writeJsonAtomic } from '../modules/storage/json-file';
import type { OfficePortalItem, OfficePortalState } from '../shared/office-portal';

export const W3_PORTAL = 'https://w3.huawei.com/';
const accountPath = '/next/service/rest/my/w3account/v1/account/zh?profile=1&version=1&usergroup=1';
const pageSize = 100;
const maxPages = 3;
const maxSystems = 24;
const count = z.union([z.number(), z.string().regex(/^\d+$/).transform(Number)]).pipe(z.number().int().nonnegative());
const systems = z.array(z.object({ appName: z.string().trim().min(1).max(160).refine(name => name !== '.' && name !== '..'), appNum: count }));
const todoIndex = z.object({ todoCount: count, todoData: systems });
const page = z.object({ count, data: z.array(z.record(z.string(), z.unknown())).max(pageSize) });
const account = z.object({ uid: z.string().trim().min(1).max(128), employeeNumber: z.unknown().optional() });
const field = (value: unknown, limit = 180) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const uid = (value: string) => value.trim().toLowerCase();

export function w3PortalLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4000) return;
  try {
    const url = new URL(value, W3_PORTAL);
    if (value.trim() && url.protocol === 'https:' && !url.port && !url.username && !url.password &&
      (url.hostname === 'huawei.com' || url.hostname.endsWith('.huawei.com'))) return url.href;
  } catch { /* Leave invalid links as plain text. */ }
}

function itemId(parts: string[]) {
  const hash = digest(JSON.stringify(parts));
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

class PortalReadError extends Error {
  constructor(readonly status: 'login' | 'error', message: string) { super(message); }
}

export class OfficePortal {
  private pending?: { owner: string; result: Promise<OfficePortalState> };
  private failure?: { owner: string; status: 'login' | 'error'; message: string };

  constructor(private readonly directory: string, private readonly deps: {
    account(): string;
    get(owner: string, path: string, signal: AbortSignal): Promise<Response>;
    linkedTasks(): Set<string>;
    now?: () => number;
  }) {}

  owner(): string { return uid(this.deps.account()); }
  private file(owner: string) { return join(this.directory, 'office-portal-' + digest(owner) + '.json'); }
  private saved(owner: string): OfficePortalState {
    const file = this.file(owner);
    if (existsSync(file)) {
      try { return JSON.parse(readFileSync(file, 'utf8')) as OfficePortalState; } catch { /* A fresh read can replace this snapshot. */ }
    }
    return { status: 'idle', items: [] };
  }

  state(): OfficePortalState {
    const owner = this.owner();
    if (!owner) return { status: 'unconfigured', items: [] };
    const saved = this.saved(owner);
    const failure = this.failure?.owner === owner ? this.failure : undefined;
    const tasks = this.deps.linkedTasks();
    return { ...saved, ...(failure && { status: failure.status, message: failure.message }),
      items: saved.items.map(item => ({ ...item, ...(failure && { cached: true }), ...(tasks.has(item.id) && { taskId: item.id }) })) };
  }

  item(id: string): OfficePortalItem {
    const item = this.state().items.find(item => item.id === id);
    if (!item) throw new Error('该事项已不在当前 W3 门户快照中。');
    return item;
  }

  refresh(): Promise<OfficePortalState> {
    const owner = this.owner();
    if (!owner) return Promise.resolve(this.state());
    if (this.pending?.owner === owner) return this.pending.result;
    const result = this.collect(owner).finally(() => { if (this.pending?.result === result) this.pending = undefined; });
    this.pending = { owner, result };
    return result;
  }

  private async json(owner: string, path: string, signal: AbortSignal): Promise<unknown> {
    const response = await this.deps.get(owner, path, signal);
    if (response.status === 401 || response.status === 403 && path === accountPath || response.status >= 300 && response.status < 400) {
      throw new PortalReadError('login', '请在 CMO 的 W3 门户窗口登录后刷新。');
    }
    if (!response.ok) throw new PortalReadError('error', 'W3 门户暂时无法读取。');
    return response.json().catch(() => null);
  }

  private async verifyAccount(owner: string, signal: AbortSignal) {
    const current = account.safeParse(await this.json(owner, accountPath, signal));
    if (!current.success) throw new PortalReadError('login', '请在 CMO 的 W3 门户窗口登录后刷新。');
    if (uid(current.data.uid) !== owner && uid(field(current.data.employeeNumber)) !== owner) {
      throw new PortalReadError('login', '门户登录账号与 CMO 中维护的 W3 账号不一致，请切换后刷新。');
    }
  }

  private async collect(owner: string): Promise<OfficePortalState> {
    const signal = AbortSignal.timeout(30000);
    try {
      await this.verifyAccount(owner, signal);
      const results = await Promise.allSettled([this.readList(owner, 'todo', signal), this.readList(owner, 'apply', signal)]);
      await this.verifyAccount(owner, AbortSignal.timeout(10000));
      if (this.owner() !== owner) return this.state();
      const prior = this.saved(owner), items: OfficePortalItem[] = [];
      let partial = false, read = false;
      for (const [index, kind] of (['todo', 'apply'] as const).entries()) {
        const result = results[index];
        if (result.status === 'rejected' && result.reason instanceof PortalReadError && result.reason.status === 'login') throw result.reason;
        const rows = result.status === 'fulfilled' ? result.value.items : [];
        const incomplete = result.status === 'rejected' || result.value.partial;
        if (result.status === 'fulfilled') read = true;
        items.push(...rows);
        if (incomplete) {
          partial = true;
          const seen = new Set(rows.map(item => item.id));
          items.push(...prior.items.filter(item => item.kind === kind && !seen.has(item.id)).map(item => ({ ...item, cached: true })));
        }
      }
      if (!read) throw new PortalReadError('error', '待办和申请均未读到，请稍后刷新。');
      const readAt = (this.deps.now ?? Date.now)();
      writeJsonAtomic(this.file(owner), { status: partial ? 'partial' : 'ready', readAt, items,
        ...(partial && { message: '部分门户记录未取全，已标出沿用的记录。' }) } satisfies OfficePortalState);
      this.failure = undefined;
    } catch (error) {
      if (this.owner() === owner) this.failure = { owner, status: error instanceof PortalReadError ? error.status : 'error',
        message: error instanceof PortalReadError ? error.message : '暂时无法连接 W3 门户，请确认公司网络后重试。' };
    }
    return this.state();
  }

  private async readList(owner: string, kind: 'todo' | 'apply', signal: AbortSignal) {
    const common = `type=2&lan=cn&timestamp=${Date.now()}`;
    const path = kind === 'todo' ? 'getappinfocount' : 'appinfo';
    const index = await this.json(owner, `/service/rest/task/${path}?${common}`, signal);
    const todo = kind === 'todo' ? todoIndex.parse(index) : undefined;
    const apps = todo?.todoData ?? systems.parse(index);
    const distinctApps = new Map(apps.map(app => [app.appName, app]));
    let partial = distinctApps.size > maxSystems;
    const items = new Map<string, OfficePortalItem>();
    for (const app of [...distinctApps.values()].slice(0, maxSystems)) {
      if (!app.appNum) continue;
      if (signal.aborted) { partial = true; break; }
      const system = app.appName, target = kind === 'todo' ? 'tasklists' : 'applists';
      let received = 0, expected = app.appNum;
      for (let curpage = 1; curpage <= maxPages && received < expected; curpage++) {
        const url = `/service/rest/task/${target}/${encodeURIComponent(encodeURIComponent(system))}?${common}&curpage=${curpage}&num=${pageSize}`;
        let reply: ReturnType<typeof page.safeParse>;
        try { reply = page.safeParse(await this.json(owner, url, signal)); }
        catch (error) {
          if (error instanceof PortalReadError && error.status === 'login') throw error;
          break;
        }
        if (!reply.success) break;
        expected = Math.max(expected, reply.data.count);
        const before = items.size;
        for (const row of reply.data.data) {
          const title = field(row.taskDesc, 300);
          if (!title) { partial = true; continue; }
          const url = w3PortalLink(row.taskURL);
          const time = field(row.time, 40);
          const id = itemId(['w3-portal', owner, kind, system, field(row.taskUUID) || JSON.stringify([url, time, title])]);
          const person = field(kind === 'todo' ? row.applicant : row.handler, 80);
          const progress = field(row.taskStatusName ?? row.statusName, 80);
          items.set(id, { id, kind, system, title, time, ...(url && { url }), ...(person && { person }), ...(progress && { progress }) });
        }
        received += items.size - before;
        if (items.size === before || reply.data.data.length < pageSize) break;
      }
      if (received < expected) partial = true;
    }
    return { items: [...items.values()], partial: partial || !!todo && items.size < todo.todoCount };
  }
}
