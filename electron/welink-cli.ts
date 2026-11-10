import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

// welink-cli 本体探测:优先用 WeClaw Desktop 自带的(已知 v1.0.16),否则依赖 PATH 里的 welink-cli。
// 用户需先 `welink-cli auth login --env pro` 扫码登录,登录态存 ~/.welink-cli/credentials/。
const WECLAW_CLI = String.raw`C:\Program Files\WeClaw Desktop\resources\bundled\opencode\welink-cli.exe`;
export function resolveWelinkCli(): string {
  if (existsSync(WECLAW_CLI)) return WECLAW_CLI;
  return 'welink-cli'; // execFile 在 win 会自动补 .exe;依赖 PATH
}

/** 一次性执行 welink-cli 子命令,返回 stdout。失败/超时抛错(调用方 catch 降级)。 */
export function runWelink(args: string[], timeoutMs = 30000): Promise<string> {
  const exe = resolveWelinkCli();
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const hint = stderr?.trim() ? `: ${stderr.trim().split('\n')[0]}` : '';
        reject(new Error(`${error.message}${hint}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export interface WelinkAuthState { authenticated: boolean; uid?: string; reason?: string; }

/** 解析 `welink-cli auth status` 文本,返回登录态。 */
export function parseAuthStatus(text: string): WelinkAuthState {
  // 已登录样本: "Credentials:\n  User Token:   valid (expires in 29m51s)\n  UID:          z00545972"
  //   (新版 CLI 登录后不打印 "Status: authenticated" 行,改用 "User Token: valid" 表示)
  // 未登录样本: "Credentials:\n  Status:       not authenticated"
  // 连不上 PC: "Error: Cannot connect to WeLink PC."
  if (/Cannot connect to WeLink PC/i.test(text)) return { authenticated: false, reason: '未连接 WeLink PC,请先打开 WeLink 桌面客户端' };
  const authenticated = /Status:\s*authenticated/i.test(text) || /User Token:\s*valid/i.test(text);
  if (!authenticated) return { authenticated: false };
  const uid = text.match(/UID:\s*([A-Za-z0-9]+)/)?.[1];
  return { authenticated: true, uid };
}

export async function welinkAuthStatus(): Promise<WelinkAuthState> {
  try {
    const out = await runWelink(['auth', 'status'], 10000);
    return parseAuthStatus(out);
  } catch (error) {
    return { authenticated: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

export interface WelinkLoginEvent { qrImageUrl?: string; done: boolean; error?: string; }

/** 扫码登录:spawn `auth login --env pro`,从 stdout 提取二维码图片 URL 推给前端;成功/失败/超时回调。
 * 返回 cancel 函数(用户取消时 kill 子进程)。 */
export function welinkLogin(onEvent: (event: WelinkLoginEvent) => void): () => void {
  const exe = resolveWelinkCli();
  let child;
  try {
    child = spawn(exe, ['auth', 'login', '--env', 'pro'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) {
    onEvent({ done: true, error: error instanceof Error ? error.message : String(error) });
    return () => undefined;
  }
  let buffer = '';
  let settled = false;
  const finish = (error?: string) => {
    if (settled) return;
    settled = true;
    onEvent({ done: true, error });
  };
  // 二维码图片 URL: "If QR code is not displayed correctly, open this URL to scan:\nhttps://.../img/xxxx"
  const QR_URL = /open this URL to scan:\s*(https:\/\/[^\s]+)/i;
  // 登录成功标记:只认最终的 "Login successful" / "Credentials cached"。
  // 不能用 "successfully" —— 会误命中 "Connected successfully" / "Token refreshed successfully",
  // 导致 token 还没 cache 就提前 finish,前端读 status 读到 EXPIRED 误判未登录(表现为点了没反应)。
  const SUCCESS = /(login\s+success|credentials\s+cached)/i;
  const timer = setTimeout(() => finish('扫码超时,请重试'), 120000);
  const handleChunk = (chunk: Buffer) => {
    buffer += chunk.toString('utf8');
    if (!settled) {
      const match = buffer.match(QR_URL);
      if (match) onEvent({ done: false, qrImageUrl: match[1] });
      if (SUCCESS.test(buffer)) { clearTimeout(timer); finish(); }
    }
  };
  child.stdout.on('data', handleChunk);
  child.stderr.on('data', handleChunk);
  child.on('error', error => { clearTimeout(timer); finish(error.message); });
  child.on('exit', code => {
    clearTimeout(timer);
    // 进程正常退出且未匹配到成功标记时,按 exit code 判定
    if (!settled) finish(code === 0 ? undefined : `登录失败(退出码 ${code})`);
  });
  return () => { clearTimeout(timer); try { child.kill(); } catch { /* already exited */ } finish('已取消'); };
}
