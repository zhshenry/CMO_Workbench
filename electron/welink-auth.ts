import type { WelinkConnection } from '../shared/welink-agenda';

export type WelinkAuthState = { authenticated: boolean; uid?: string; reason?: string; connection: WelinkConnection };
type AuthCheck = WelinkAuthState & { renewal?: 'near-expiry' | 'expired'; account?: string };
export type WelinkRenewal = 'finished' | 'needs-login' | 'client-closed' | 'temporary';

const renewalDelay = 5 * 60_000;

export class WelinkAuthMonitor {
  private pending?: Promise<WelinkAuthState>;
  private interrupted = false;
  private listeners = new Set<(uid: string) => void>();
  private changes = new Set<(state: WelinkAuthState) => void>();
  private previous?: WelinkAuthState;
  private attempt?: { account?: string; renewal: NonNullable<AuthCheck['renewal']>; until: number; result: WelinkAuthState };

  constructor(private readonly check: () => Promise<AuthCheck>, private readonly renew?: () => Promise<WelinkRenewal> | undefined,
    private readonly now = Date.now) {}

  read(retry = false): Promise<WelinkAuthState> {
    if (retry && !this.pending) this.attempt = undefined;
    return this.pending ??= this.readConnection().then(({ state, recovered }) => {
      if (!state.authenticated || !state.uid) this.interrupted = true;
      else if (this.interrupted || recovered) {
        this.interrupted = false;
        for (const listener of this.listeners) listener(state.uid);
      }
      const before = this.previous;
      this.previous = state;
      if (!before || before.connection !== state.connection || before.uid !== state.uid || before.reason !== state.reason) {
        for (const listener of this.changes) listener(state);
      }
      return state;
    }).finally(() => { this.pending = undefined; });
  }

  private async readConnection() {
    const { renewal, account, ...state } = await this.check();
    if (!renewal || !this.renew) { this.attempt = undefined; return { state }; }
    const previous = this.attempt;
    if (previous && previous.account === account && previous.renewal === renewal && previous.until > this.now()) {
      return { state: renewal === 'near-expiry' ? state : previous.result };
    }
    const pending = this.renew();
    if (!pending) return { state };
    if (renewal === 'near-expiry') {
      this.attempt = { account, renewal, until: this.now() + renewalDelay, result: renewalFailure('temporary') };
      // A usable login stays available while the background process runs.
      void pending.then(async result => {
        if (result !== 'finished') return;
        await this.pending;
        await this.read();
      }).catch(() => {});
      return { state };
    }
    const result = await pending;
    if (result === 'finished') {
      const { renewal: remaining, account: confirmedAccount, ...confirmed } = await this.check();
      if (confirmed.authenticated && confirmed.uid && remaining !== 'expired') {
        this.attempt = remaining ? { account: confirmedAccount, renewal: remaining, until: this.now() + renewalDelay,
          result: renewalFailure('temporary') } : undefined;
        return { state: confirmed, recovered: true };
      }
      if (confirmed.connection === 'client-closed') {
        this.attempt = { account, renewal, until: this.now() + 60_000, result: confirmed };
        return { state: confirmed };
      }
    }
    const failed = renewalFailure(result);
    this.attempt = { account, renewal, until: this.now() + (failed.connection === 'client-closed' ? 60_000 : renewalDelay), result: failed };
    return { state: failed };
  }

  onRecovery(listener: (uid: string) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  onChanged(listener: (state: WelinkAuthState) => void) {
    this.changes.add(listener);
    return () => { this.changes.delete(listener); };
  }
}

export class WelinkConnectionError extends Error {
  constructor(readonly connection: Exclude<WelinkConnection, 'ready'>, reason: string) { super(reason); }
}

export function welinkConnectionFailure(error: unknown): WelinkAuthState & { connection: Exclude<WelinkConnection, 'ready'> } {
  const reason = error instanceof Error ? error.message : String(error);
  if (error instanceof WelinkConnectionError) return { authenticated: false, connection: error.connection, reason };
  if (/cannot connect to WeLink PC|未连接 WeLink PC/i.test(reason)) {
    return { authenticated: false, connection: 'client-closed', reason: '无法连接 WeLink PC，请先打开 WeLink 桌面客户端。' };
  }
  if (/\b(?:not authenticated|not logged in|logged out)\b|未登录/i.test(reason)) {
    return { authenticated: false, connection: 'needs-login', reason: '请在 W3和Welink接入中扫码登录。' };
  }
  if (/\b(?:status\s*:\s*expired|(?:user|refresh) token\s*:\s*(?:expired|invalid|revoked|missing)|token (?:has )?expired)\b|(?:登录|凭证)(?:已)?(?:失效|过期)/i.test(reason)) {
    return { authenticated: false, connection: 'needs-login', reason: 'WeLink 登录已失效，请在 W3和Welink接入中重新扫码。' };
  }
  return { authenticated: false, connection: 'temporary', reason: '暂时无法读取 WeLink 登录状态，请稍后重试。' };
}

function renewalFailure(result: WelinkRenewal): WelinkAuthState {
  if (result === 'needs-login') return welinkConnectionFailure('User Token: expired');
  if (result === 'client-closed') return welinkConnectionFailure('Cannot connect to WeLink PC');
  return { authenticated: false, connection: 'temporary', reason: 'WeLink 自动续期暂未完成，稍后会重试。' };
}

export function parseAuthStatus(raw: string): AuthCheck {
  if (/cannot connect to WeLink PC/i.test(raw)) return welinkConnectionFailure(raw);
  const uid = raw.match(/^[ \t]*UID:[ \t]*([A-Za-z0-9]+)[ \t]*\r?$/im)?.[1];
  const account = uid?.toLowerCase();
  const token = raw.match(/^[ \t]*User Token:[ \t]*([^\r\n]+)/im)?.[1];
  const valid = /^valid\b/i.test(token ?? '');
  const refreshable = /^[ \t]*Refresh Token:[ \t]*valid\b/im.test(raw);
  if (valid || !token && /^[ \t]*Status:[ \t]*authenticated\b/im.test(raw)) {
    const remaining = token?.match(/expires in[ \t]+(?:(\d+)h[ \t]*)?(?:(\d+)m[ \t]*)?(?:(\d+)s)?/i);
    const seconds = Number(remaining?.[1] ?? 0) * 3600 + Number(remaining?.[2] ?? 0) * 60 + Number(remaining?.[3] ?? 0);
    return { authenticated: true, uid, connection: 'ready',
      ...(remaining?.slice(1).some(Boolean) && seconds * 1000 <= renewalDelay && { renewal: 'near-expiry', account }) };
  }
  const failure = welinkConnectionFailure(raw);
  const expired = /^(?:expired|invalid|revoked)\b/i.test(token ?? '') ||
    /^[ \t]*(?:Status|Refresh Token):[ \t]*(?:expired|invalid)\b/im.test(raw) || /\btoken (?:has )?expired\b/i.test(raw);
  // Read-only callers can still let the CLI use a valid refresh token itself.
  return { ...(refreshable ? { authenticated: true, uid, connection: 'ready' as const } : failure),
    ...(expired || refreshable ? { renewal: 'expired', account } : {}) };
}
