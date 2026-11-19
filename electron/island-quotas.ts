import { safeStorage, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { dayStartSec, nowSec, parseNewApiLogs } from '../shared/island-quota';
import type { NewApiAccount } from '../shared/island-contracts';

interface StoredAccount { id: string; label: string; baseUrl: string; username: string; password: string; }
interface AccountRuntime {
  stored: StoredAccount;
  state: NewApiAccount;
  session: string | null;
  accessToken: string | null;
  authMode: 'Bearer' | 'Cookie';
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
    this.runtimes.set(stored.id, { stored, state: blank(stored), session: null, accessToken: null, authMode: 'Cookie', userId: null, refreshing: null });
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
    const data = await response.json() as { success?: boolean; data?: { id?: number; user?: { id?: number }; access_token?: string }; message?: string };
    if (data.success !== true) throw new Error(data.message?.replaceAll(rt.stored.password, '[已隐藏]') || '登录被拒绝');
    const id = data.data?.user?.id ?? data.data?.id;
    rt.userId = id != null ? String(id) : '';
    if (!rt.userId) throw new Error('登录未返回用户 ID');
    rt.session = response.headers.getSetCookie().map(cookie => cookie.split(';', 1)[0]).join('; ') || null;
    rt.accessToken = typeof data.data?.access_token === 'string' && data.data.access_token ? data.data.access_token : null;
    if (!rt.session && !rt.accessToken) throw new Error('登录未返回可用 Cookie 或访问令牌');
    rt.authMode = rt.accessToken ? 'Bearer' : 'Cookie';
  }

  private async request(rt: AccountRuntime, path: string, query: Record<string, string | number> = {}): Promise<unknown> {
    if ((!rt.session && !rt.accessToken) || !rt.userId) await this.login(rt);
    const url = new URL(`${rt.stored.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    let response!: Response;
    for (let attempt = 0; attempt < 2; attempt++) {
      const modes = [rt.authMode, rt.authMode === 'Bearer' ? 'Cookie' : 'Bearer'] as const;
      for (const mode of modes) {
        if (mode === 'Bearer' ? !rt.accessToken : !rt.session) continue;
        const headers: Record<string, string> = { 'New-Api-User': rt.userId! };
        if (mode === 'Bearer') headers.Authorization = `Bearer ${rt.accessToken}`;
        else headers.Cookie = rt.session!;
        response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
        if (response.status !== 401) { rt.authMode = mode; break; }
      }
      if (response.status !== 401 || attempt === 1) break;
      await this.login(rt);
    }
    if (!response.ok) throw Object.assign(new Error(`请求失败（HTTP ${response.status}）`), { status: response.status });
    const body = await response.json() as { success?: boolean };
    if (body.success !== true) throw new Error('New API 接口返回失败，未取得完整用量');
    return body;
  }

  // 按返回页码拉取消费日志，只有去重后的条数与 total 一致才发布读数。
  private async fetchTodayLogs(rt: AccountRuntime, startSec: number, endSec: number): Promise<unknown[]> {
    const all: unknown[] = [], seen = new Set<string>();
    const pageSize = 100;
    const maxPages = 50;
    let firstPage = 0, total: number | null = null;
    for (let index = 0; index < maxPages; index++) {
      let page = index === 0 ? 0 : firstPage + index;
      const read = () => this.request(rt, '/api/log/self', { p: page, page_size: pageSize, type: 2, start_timestamp: startSec, end_timestamp: endSec });
      let raw: unknown;
      try { raw = await read(); } catch (error) {
        if (index !== 0 || (error as { status?: number }).status !== 400) throw error;
        page = 1; raw = await read();
      }
      const data = (raw as { data?: { page: number; page_size: number; total: number; items: Record<string, unknown>[] } }).data;
      if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0 || data.page_size !== pageSize || data.items.length > pageSize
        || (index === 0 ? data.page !== 0 && data.page !== 1 : data.page !== page)) throw new Error('日志分页字段异常，无法确认完整用量');
      if (index === 0) { firstPage = data.page; total = data.total; }
      if (data.total !== total) throw new Error('日志总条数发生变化，请刷新重试');
      let fresh = 0;
      for (const item of data.items) {
        if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.created_at) || Number(item.created_at) < startSec || Number(item.created_at) > endSec
          || item.type !== 2 || !Number.isSafeInteger(item.prompt_tokens) || Number(item.prompt_tokens) < 0 || !Number.isSafeInteger(item.completion_tokens) || Number(item.completion_tokens) < 0) throw new Error('消费日志日期、类型或 Token 字段异常，无法确认完整用量');
        const identity = typeof item.request_id === 'string' && item.request_id ? ['request', item.request_id] : ['id', item.id];
        if (identity[1] == null || identity[1] === '') throw new Error('日志缺少记录标识，无法核对重复记录');
        // id 可能是展示序号；同时核对明细，避免把相同序号的不同日志合并。
        const key = JSON.stringify([identity, Object.keys(item).filter(key => key !== 'id').sort().map(key => [key, item[key]])]);
        if (seen.has(key)) continue;
        seen.add(key); all.push(item); fresh++;
      }
      if (all.length > total!) throw new Error('日志条数超过总数，可能存在重新编号的重复记录，未更新用量');
      if (data.items.length < pageSize) {
        if (all.length !== total) throw new Error('日志条数与总数不符，无法确认完整用量');
        return all;
      }
      // 某些服务端将 p=0 和 p=1 都映射到第一页，只允许这一次整页重叠。
      if (!fresh && !(index === 1 && firstPage === 0)) throw new Error('日志分页重复且未取得新记录，无法确认完整用量');
    }
    throw new Error(`日志超过 ${maxPages} 页读取上限，无法确认完整用量`);
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
      const todayLogs = await this.fetchTodayLogs(rt, todayStart, now);
      // 总量与光谱使用同一份完整消费日志，quota/rpm/tpm 不当作 Token。
      const { todayQuota, models } = parseNewApiLogs(todayLogs, todayStart);
      const checkedAt = Date.now();
      Object.assign(rt.state, {
        status: 'ready', baseUrl: rt.stored.baseUrl, account: rt.stored.username, userId: rt.userId ?? '',
        todayQuota, models, updatedAt: checkedAt, checkedAt, message: '', hasData: true,
      });
      this.changed();
      return this.read();
    } catch (error) {
      // 刷新失败时：若有上次读数则保留原值（仅标 stale），否则才进 error 态
      const checkedAt = Date.now();
      if (hadData) {
        Object.assign(rt.state, { status: 'ready', message: error instanceof Error ? error.message : 'New API 连接失败', checkedAt });
      } else {
        Object.assign(rt.state, { status: 'error', message: error instanceof Error ? error.message : 'New API 连接失败', updatedAt: checkedAt, checkedAt });
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
    rt.session = null; rt.accessToken = null; rt.userId = null;
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
