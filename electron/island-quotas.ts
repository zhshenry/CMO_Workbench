import { safeStorage, shell } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { dayStartSec, monthStartSec, nowSec, parseNewApiLogs, parseNewApiSelf, parseNewApiStat, weekStartSec } from '../shared/island-quota';
import type { NewApiState, QuotaUsage } from '../shared/island-contracts';

interface Credentials { baseUrl: string; username: string; password: string; }
interface LogCache { lastFetchedAt: number; items: unknown[]; }

const DEFAULT_BASE = 'http://aiserver.hisi.huawei.com';
const blank = (): NewApiState => ({
  status: 'disconnected', baseUrl: '', account: '', userId: '',
  usage: [], models: [], tpm: 0, rpm: 0, updatedAt: null, message: '未连接',
});

export class NewApiQuotas {
  private state: NewApiState = blank();
  private credentials: Credentials = { baseUrl: '', username: '', password: '' };
  private session: string | null = null;
  private userId: string | null = null;
  private refreshing: Promise<NewApiState | null> | null = null;
  private logCache: LogCache = { lastFetchedAt: 0, items: [] };
  private path: string;
  private cachePath: string;

  constructor(dir: string, private changed: () => void) {
    this.path = join(dir, 'island-connections.json');
    this.cachePath = join(dir, 'island-newapi-log-cache.json');
    this.loadCredentials();
    this.loadCache();
    if (this.credentials.baseUrl && this.credentials.username && this.credentials.password) {
      Object.assign(this.state, { status: 'error', baseUrl: this.credentials.baseUrl, message: '等待更新' });
    }
  }
  read(): NewApiState { return structuredClone(this.state); }

  private loadCredentials(): void {
    if (!existsSync(this.path)) return;
    try {
      const saved = JSON.parse(readFileSync(this.path, 'utf8'));
      this.credentials = {
        baseUrl: typeof saved.baseUrl === 'string' ? saved.baseUrl : '',
        username: typeof saved.username === 'string' ? saved.username : '',
        password: typeof saved.password === 'string' && safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(Buffer.from(saved.password, 'base64')) : '',
      };
    } catch { /* Credentials remain disconnected when unreadable. */ }
  }

  private loadCache(): void {
    if (!existsSync(this.cachePath)) return;
    try {
      const saved = JSON.parse(readFileSync(this.cachePath, 'utf8'));
      if (saved && typeof saved === 'object' && Array.isArray(saved.items)) {
        this.logCache = { lastFetchedAt: Number(saved.lastFetchedAt) || 0, items: saved.items };
      }
    } catch { /* Cache miss is non-fatal. */ }
  }

  private saveCredentials(): void {
    if (!safeStorage.isEncryptionAvailable()) return;
    writeJsonAtomic(this.path, {
      baseUrl: this.credentials.baseUrl,
      username: this.credentials.username,
      password: safeStorage.encryptString(this.credentials.password).toString('base64'),
    });
  }

  private saveCache(): void {
    try { writeJsonAtomic(this.cachePath, this.logCache); } catch { /* Cache write failure is non-fatal. */ }
  }

  private async login(): Promise<void> {
    if (!this.credentials.baseUrl || !this.credentials.username || !this.credentials.password) {
      throw new Error('未配置 New API 凭据');
    }
    const response = await fetch(`${this.credentials.baseUrl}/api/user/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: this.credentials.username, password: this.credentials.password }),
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new Error(`登录失败（HTTP ${response.status}）`);
    const setCookie = response.headers.get('set-cookie') ?? '';
    const sessionMatch = setCookie.match(/session=([^;]+)/);
    if (!sessionMatch) throw new Error('登录未返回 session');
    const data = await response.json() as { success?: boolean; data?: { id?: number }; message?: string };
    if (data.success === false) throw new Error(data.message || '登录被拒绝');
    this.session = sessionMatch[1];
    this.userId = data.data?.id != null ? String(data.data.id) : '';
    if (!this.userId) throw new Error('登录未返回用户 ID');
  }

  private async request(path: string, query: Record<string, string | number> = {}): Promise<unknown> {
    if (!this.session || !this.userId) await this.login();
    const url = new URL(`${this.credentials.baseUrl}${path}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const doRequest = () => fetch(url, {
      headers: { Cookie: `session=${this.session}`, 'New-Api-User': this.userId ?? '' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    let response = await doRequest();
    if (response.status === 401) {
      // Session expired — re-login once and retry.
      this.session = null; this.userId = null;
      await this.login();
      response = await doRequest();
    }
    if (!response.ok) throw new Error(`请求失败（HTTP ${response.status}）`);
    return response.json();
  }

  private async fetchLogs(startSec: number, endSec: number, maxPages = 50): Promise<unknown[]> {
    const all: unknown[] = [];
    const pageSize = 100;
    for (let page = 0; page < maxPages; page += 4) {
      const batch = await Promise.all([0, 1, 2, 3].map(offset => {
        const p = page + offset;
        if (p >= maxPages) return Promise.resolve(null);
        return this.request('/api/log/self', { p, page_size: pageSize, type: 0, start_timestamp: startSec, end_timestamp: endSec }).catch(() => null);
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

  async refresh(): Promise<NewApiState | null> {
    if (this.refreshing) return this.refreshing;
    if (!this.credentials.baseUrl || !this.credentials.username || !this.credentials.password) return null;
    this.refreshing = this.doRefresh().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async doRefresh(): Promise<NewApiState | null> {
    Object.assign(this.state, { status: 'connecting', message: '正在连接 New API…' });
    this.changed();
    try {
      const todayStart = dayStartSec();
      const weekStart = weekStartSec();
      const monthStart = monthStartSec();
      const now = nowSec();

      // 并发：self（累计+剩余+账号）+ stat（tpm/rpm）+ 今日日志
      const [selfRaw, statRaw, todayLogs] = await Promise.all([
        this.request('/api/user/self').catch(e => { throw new Error(`读取用户信息失败：${e instanceof Error ? e.message : e}`); }),
        this.request('/api/log/self/stat', { start_timestamp: 0, end_timestamp: 0 }).catch(() => null),
        this.fetchLogs(todayStart, now, 30).catch(() => []),
      ]);
      const self = parseNewApiSelf(selfRaw);
      const stat = parseNewApiStat(statRaw);

      // 合并缓存：今日日志是实拉，本周/本月用缓存+今日日志合并（增量靠缓存最大时间戳）
      const mergedItems = this.mergeCache(todayLogs, todayStart, monthStart);
      const { usage, models } = parseNewApiLogs(mergedItems, todayStart, weekStart, monthStart);
      const usageFull: QuotaUsage[] = [
        ...usage,
        { period: 'total', quota: self.usedQuota, tokens: 0 },
        { period: 'remaining', quota: self.quota, tokens: 0 },
      ];

      Object.assign(this.state, {
        status: 'ready',
        baseUrl: this.credentials.baseUrl,
        account: self.account,
        userId: this.userId ?? '',
        usage: usageFull,
        models,
        tpm: stat.tpm,
        rpm: stat.rpm,
        updatedAt: Date.now(),
        message: '',
      });
      this.changed();

      // 后台异步拉本月日志补全 week/month（不阻塞本次返回）
      void this.fetchMonthBackground(monthStart, now, todayStart, weekStart, monthStart, self).catch(() => undefined);
      return this.read();
    } catch (error) {
      Object.assign(this.state, { status: 'error', message: error instanceof Error ? error.message : 'New API 连接失败', updatedAt: Date.now() });
      this.changed();
      return this.read();
    }
  }

  private mergeCache(todayLogs: unknown[], todayStart: number, monthStart: number): unknown[] {
    // 缓存里保留本月今日之前的日志 + 今日实拉，去重
    const cacheBeforeToday = this.logCache.items.filter((raw): raw is Record<string, unknown> => {
      const item = raw as { created_at?: number };
      return typeof item.created_at === 'number' && item.created_at < todayStart && item.created_at >= monthStart;
    });
    const seen = new Set(todayLogs.map((r: unknown) => (r as { id?: number }).id));
    const merged = [...todayLogs, ...cacheBeforeToday.filter(r => !seen.has((r as { id?: number }).id))];
    this.logCache = { lastFetchedAt: Date.now(), items: merged };
    this.saveCache();
    return merged;
  }

  private async fetchMonthBackground(monthStart: number, now: number, todayStart: number, weekStart: number, monthStart2: number, self: { usedQuota: number; quota: number; account: string }): Promise<void> {
    // 拉本月全部日志，更新缓存，重新聚合后 publish
    const monthLogs = await this.fetchLogs(monthStart, now, 200);
    this.logCache = { lastFetchedAt: Date.now(), items: monthLogs };
    this.saveCache();
    const { usage, models } = parseNewApiLogs(monthLogs, todayStart, weekStart, monthStart2);
    const usageFull: QuotaUsage[] = [
      ...usage,
      { period: 'total', quota: self.usedQuota, tokens: 0 },
      { period: 'remaining', quota: self.quota, tokens: 0 },
    ];
    Object.assign(this.state, { usage: usageFull, models, updatedAt: Date.now() });
    this.changed();
  }

  async connect(baseUrl: string, username: string, password: string): Promise<NewApiState | null> {
    if (!baseUrl.trim() || !username.trim() || !password) throw new Error('请填写 New API 地址、用户名和密码');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('本机凭据加密不可用，未保存凭据');
    this.credentials = { baseUrl: baseUrl.trim().replace(/\/+$/, ''), username: username.trim(), password };
    this.session = null; this.userId = null;
    this.saveCredentials();
    Object.assign(this.state, { baseUrl: this.credentials.baseUrl, status: 'connecting', message: '正在连接…' });
    this.changed();
    return this.refresh();
  }

  async disconnect(): Promise<NewApiState | null> {
    this.credentials = { baseUrl: '', username: '', password: '' };
    this.session = null; this.userId = null;
    this.state = blank();
    this.logCache = { lastFetchedAt: 0, items: [] };
    try { writeJsonAtomic(this.path, {}); } catch { /* ignore */ }
    try { writeJsonAtomic(this.cachePath, { lastFetchedAt: 0, items: [] }); } catch { /* ignore */ }
    this.changed();
    return this.read();
  }

  openOfficial(): void {
    void shell.openExternal(this.credentials.baseUrl || DEFAULT_BASE);
  }

  stop(): void { /* No long-running children like the old codex CLI; sessions are per-request. */ }
}
