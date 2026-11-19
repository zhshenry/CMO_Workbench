import type { WelinkConnection } from '../shared/welink-agenda';

export type WelinkAuthState = { authenticated: boolean; uid?: string; reason?: string; connection: WelinkConnection };
export class WelinkConnectionError extends Error {
  constructor(readonly connection: Exclude<WelinkConnection, 'ready'>, reason: string) { super(reason); }
}

export function welinkConnectionFailure(error: unknown): WelinkAuthState & { connection: Exclude<WelinkConnection, 'ready'> } {
  const reason = error instanceof Error ? error.message : String(error);
  if (error instanceof WelinkConnectionError) return { authenticated: false, connection: error.connection, reason };
  if (/cannot connect to WeLink PC|未连接 WeLink PC/i.test(reason)) {
    return { authenticated: false, connection: 'client-closed', reason: '无法连接 WeLink PC，请先打开 WeLink 桌面客户端。' };
  }
  if (/\b(?:not authenticated|not logged in|logged out|status\s*:\s*expired|(?:user|refresh) token\s*:\s*(?:expired|invalid|missing)|token (?:has )?expired)\b|(?:登录|凭证)(?:已)?(?:失效|过期)|未登录/i.test(reason)) {
    return { authenticated: false, connection: 'needs-login', reason: 'WeLink 登录已失效，请在 W3和Welink接入中重新扫码。' };
  }
  return { authenticated: false, connection: 'temporary', reason: '暂时无法读取 WeLink 登录状态，请稍后重试。' };
}

export function parseAuthStatus(raw: string): WelinkAuthState {
  if (/cannot connect to WeLink PC/i.test(raw)) return welinkConnectionFailure(raw);
  if (/(?:^|\n)[ \t]*(?:Status:[ \t]*authenticated|(?:User|Refresh) Token:[ \t]*valid)\b/i.test(raw)) {
    // An available refresh token is usable by the bundled CLI without a new QR login.
    const uid = raw.match(/\bUID:[ \t]*([A-Za-z0-9]+)/i)?.[1];
    return { authenticated: true, uid, connection: 'ready' };
  }
  return welinkConnectionFailure(raw);
}
