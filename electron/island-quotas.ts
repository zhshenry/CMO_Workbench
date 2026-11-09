import { safeStorage, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { dayStartSec, nowSec, parseNewApiLogs, parseNewApiStat } from '../shared/island-quota';
import type { NewApiAccount } from '../shared/island-contracts';

interface StoredAccount { id: string; label: string; baseUrl: string; username: string; password: string; }
interface AccountRuntime {
  stored: StoredAccount;
  state: NewApiAccount;
  session: string | null;
  userId: string | null;
  refreshing: Promise<NewApiAccount[] | null> | null;
}

const DEFAULT_BASE = 'http://aiserver.hisi.huawei.com';
const blank = (stored: StoredAccount): NewApiAccount => ({
  id: stored.id, label: stored.label,
  status: 'disconnected', baseUrl: stored.baseUrl, account: stored.username, userId: '',
  todayQuota: 0, models: [], updatedAt: null, message: '未连接',
});

export class NewApiQuotas {
  private runtimes = new Map<string, AccountRuntime>();
  private activeId: string | null = null;
  private order: string[] = [];
  private path: string;
  private changed: () => void;

  constructor(dir: string, changed: () => void) {
    this.changed = changed;
    this.path = join(dir, 'island-connections.json');
    this.load();
    if (this.order.length) this.refresh().catch(() => undefined);
  }
  read(): NewApiAccount[] { return this.snapshot(); }

  private snapshot(): NewApiAccount[] {
    return this.order.map(id => structuredClone(this.runtimes.get(id)!.state));
  }

  private load(): void {
    if (!existsSync(this.path)) return;
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8'));
      if (!saved || typeof saved !== 'object') return;
      const decrypt = (v: unknown): string => typeof v === 'string' && v && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(v, 'base64')) : '';
      // 迁移旧单账号格式 {baseUrl,username,password}
      if (Array.isArray((saved as { accounts?: unknown }).accounts)) {
        const accounts = (saved as { accounts: StoredAccount[] }).accounts;
        this.activeId = typeof (saved as { activeId?: unknown }).activeId === 'string' ? (saved as { activeId: string }).activeId : null;
        for (const a of accounts) this.upsertRuntime({ ...a, password: decrypt(a.password) });
      } else if (typeof (saved as { baseUrl?: unknown }).baseUrl === 'string') {
        const old = saved as { baseUrl?: string; username?: string; password?: string };
        this.upsertRuntime({
          id: randomUUID(),
          label: old.username || 'New API',
          baseUrl: old.baseUrl || '',
          username: old.username || '',
          password: decrypt(old.password),
        });
      }
      if (this.activeId && !this.runtimes.has(this.activeId)) this.activeId = this.order[0] ?? null;
    } catch { /* Unreadable credentials stay empty. */ }
  }

  private upsertRuntime(stored: StoredAccount): void {
    if (!this.runtimes.has(stored.id)) this.order.push(stored.id);
    this.runtimes.set(stored.id, { stored, state: blank(stored), session: null, userId: null, refreshing: null });
  }

  private save(): void {
    if (!safeStorage.isEncryptionAvailable()) return;
    writeJsonAtomic(this.path, {
      activeId: this.activeId,
      accounts: this.order.map(id => {
        const s = this.runtimes.get(id)!.stored;
        return { ...s, password: s.password ? safeStorage.encryptString(s.password).toString('base64') : '' };
      }),
    });
  }

  private async login(rt: AccountRuntime): Promise<void> {
    if (!rt.stored.baseUrl || !rt.stored.username || !rt.stored.password) throw new Error('未配置 New API 凭据');
    const response = await fetch(`${rt.stored.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: rt.stored.username, password: rt.stored.password }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`登录失败（HTTP ${response.status}）`);
    const setCookie = response.headers.get('set-cookie') ?? '';
    const sessionMatch = setCookie.match(/session=([^;]+)/);
    if (!sessionMatch) throw new Error('登录未返回 session');
    const data = await response.json() as { success?: boolean; data?: { id?: number }; message?: string };
    if (data.success === false) throw new Error(data.message || '登录被拒绝');
    rt.session = sessionMatch[1];
    rt.userId = data.data?.id != null ? String(data.data.id) : '';
    if (!rt.userId) throw new Error('登录未返回用户 ID');
  }

  private async request(rt: AccountRuntime, path: string, query: Record<string, string | number> = {}): Promise<unknown> {
    if (!rt.session || !rt.userId) await this.login(rt);
    const url = new URL(`${rt.stored.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const doRequest = () => fetch(url, {
      headers: { Cookie: `session=${rt.session}`, 'New-Api-User': rt.userId ?? '' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    let response = await doRequest();
    if (response.status === 401) {
      rt.session = null; rt.userId = null;
      await this.login(rt);
      response = await doRequest();
    }
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
    return response.json();
  }

  // 分页拉今日日志明细（4 页并发，单页 100）
  private async fetchTodayLogs(rt: AccountRuntime, startSec: number, endSec: number): Promise<unknown[]> {
    const all: unknown[] = [];
    const pageSize = 100;
    const maxPages = 50;
    for (let page = 0; page < maxPages; page += 4) {
      const batch = await Promise.all([0, 1, 2, 3].map(offset => {
        const p = page + offset;
        if (p >= maxPages) return Promise.resolve(null);
        return this.request(rt, '/api/log/self', { p, page_size: pageSize, type: 0, start_timestamp: startSec, end_timestamp: endSec }).catch(() => null);
      }));
      let done = false;
      for (const raw of batch) {
        if (!raw) continue;
        const data = (raw as { data?: { items?: unknown[] } }).data;
        const items = Array.isArray(data?.items) ? data!.items! : [];
        all.push(...items);
        if (items.length < pageSize) { done = true; }
      }
      if (done) break;
    }
    return all;
  }

  async refresh(): Promise<NewApiAccount[]> {
    const runtimes = [...this.runtimes.values()];
    await Promise.all(runtimes.map(rt => this.refreshOne(rt)));
    return this.read();
  }

  private async refreshOne(rt: AccountRuntime): Promise<NewApiAccount[] | null> {
    if (rt.refreshing) return rt.refreshing;
    rt.refreshing = this.doRefreshOne(rt).finally(() => { rt.refreshing = null; });
    return rt.refreshing;
  }

  private async doRefreshOne(rt: AccountRuntime): Promise<NewApiAccount[] | null> {
    const hadData = rt.state.hasData === true;
    // 有上次读数时，刷新期间保留原值，只把状态切到 connecting（UI 据此显示"正在更新"而非清空）
    Object.assign(rt.state, { status: 'connecting', message: hadData ? '' : '正在连接…' });
    this.changed();
    try {
      const todayStart = dayStartSec();
      const now = nowSec();
      // 今日 token：优先用服务器聚合 stat，失败则回退日志明细聚合
      let todayQuota = 0;
      try {
        const statRaw = await this.request(rt, '/api/log/self/stat', { start_timestamp: todayStart, end_timestamp: now });
        todayQuota = parseNewApiStat(statRaw);
      } catch { /* stat 不可用时回退 */ }
      const todayLogs = await this.fetchTodayLogs(rt, todayStart, now);
      const parsed = parseNewApiLogs(todayLogs, todayStart);
      if (!todayQuota) todayQuota = parsed.todayQuota;
      const models = parsed.models;
      Object.assign(rt.state, {
        status: 'ready', baseUrl: rt.stored.baseUrl, account: rt.stored.username, userId: rt.userId ?? '',
        todayQuota, models, updatedAt: Date.now(), message: '', hasData: true,
      });
      this.changed();
      return this.read();
    } catch (error) {
      // 刷新失败时：若有上次读数则保留原值（仅标 stale），否则才进 error 态
      if (hadData) {
        Object.assign(rt.state, { status: 'ready', message: error instanceof Error ? error.message : 'New API 连接失败', updatedAt: rt.state.updatedAt });
      } else {
        Object.assign(rt.state, { status: 'error', message: error instanceof Error ? error.message : 'New API 连接失败', updatedAt: Date.now() });
      }
      this.changed();
      return this.read();
    }
  }

  async connect(label: string, baseUrl: string, username: string, password: string): Promise<NewApiAccount[]> {
    if (!label.trim() || !baseUrl.trim() || !username.trim() || !password) throw new Error('请填写名称、New API 地址、用户名和密码');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('本机凭据加密不可用，未保存凭据');
    const stored: StoredAccount = { id: randomUUID(), label: label.trim(), baseUrl: baseUrl.trim().replace(/\/+$/, ''), username: username.trim(), password };
    this.upsertRuntime(stored);
    if (!this.activeId) this.activeId = stored.id;
    this.save();
    void this.refreshOne(this.runtimes.get(stored.id)!);
    return this.read();
  }

  async update(id: string, label: string, baseUrl: string, username: string, password: string): Promise<NewApiAccount[]> {
    const rt = this.runtimes.get(id);
    if (!rt) throw new Error('账号不存在');
    if (!label.trim() || !baseUrl.trim() || !username.trim()) throw new Error('名称、地址、用户名不能为空');
    rt.stored = { id, label: label.trim(), baseUrl: baseUrl.trim().replace(/\/+$/, ''), username: username.trim(), password: password || rt.stored.password };
    rt.session = null; rt.userId = null;
    rt.state = blank(rt.stored);
    this.save();
    void this.refreshOne(rt);
    return this.read();
  }

  async remove(id: string): Promise<NewApiAccount[]> {
    this.runtimes.delete(id);
    this.order = this.order.filter(x => x !== id);
    if (this.activeId === id) this.activeId = this.order[0] ?? null;
    this.save();
    this.changed();
    return this.read();
  }

  async select(id: string): Promise<void> {
    if (!this.runtimes.has(id)) return;
    this.activeId = id;
    this.save();
    this.changed();
  }

  openOfficial(id: string): void {
    const rt = this.runtimes.get(id);
    void shell.openExternal(rt?.stored.baseUrl || DEFAULT_BASE);
  }

  stop(): void { /* Sessions are per-request; nothing to stop. */ }
}
