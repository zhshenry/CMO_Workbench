import { execFile, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { app } from 'electron';
import { join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import { parseAuthStatus, welinkConnectionFailure, WelinkAuthMonitor, type WelinkRenewal } from './welink-auth';
import { WelinkEmployeeLookup } from './welink-profile';
export { parseAuthStatus } from './welink-auth';

// welink-cli 本体探测:优先用 CMO 安装包自带的(vendor/welink,打包进 extraResources),
// 其次 WeClaw Desktop 自带的(已知 v1.0.16,本机开发或装了 WeClaw 的机器),最后依赖 PATH。
// 单文件 Rust 程序,无伴生 DLL,拷到任意目录即可独立运行(实测);连 WeLink PC 客户端认证,不依赖 WeClaw。
const BUNDLED_CLI = app.isPackaged ? join(process.resourcesPath, 'welink', 'welink-cli.exe') : join(app.getAppPath(), 'vendor', 'welink', 'welink-cli.exe');
const WECLAW_CLI = String.raw`C:\Program Files\WeClaw Desktop\resources\bundled\opencode\welink-cli.exe`;
export function resolveWelinkCli(): string {
  if (existsSync(BUNDLED_CLI)) return BUNDLED_CLI;
  if (existsSync(WECLAW_CLI)) return WECLAW_CLI;
  return 'welink-cli'; // execFile 在 win 会自动补 .exe;依赖 PATH
}

/** 一次性执行 welink-cli 子命令,返回 stdout。失败/超时抛错(调用方 catch 降级)。 */
export function runWelink(args: string[], timeoutMs = 30000, signal?: AbortSignal): Promise<string> {
  const exe = resolveWelinkCli();
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, ...(signal ? { signal } : {}) }, (error, stdout, stderr) => {
      if (error) {
        if (String(error.code) === '429' || /\b(?:status|HTTP)\s+429\b/i.test(`${stdout}\n${stderr}`)) {
          reject(Object.assign(new Error('WeLink 请求过于频繁，请稍后重试。'), { code: 429 }));
          return;
        }
        const hint = stderr?.trim() ? `: ${stderr.trim().split('\n')[0]}` : '';
        reject(new Error(`${error.message}${hint}`));
        return;
      }
      resolve(stdout);
    });
  });
}

let authRevision = 0;

async function readAuthStatus() {
  const revision = authRevision;
  try {
    const raw = await runWelink(['auth', 'status'], 10000);
    return revision === authRevision ? parseAuthStatus(stripVTControlCharacters(raw)) : welinkConnectionFailure('');
  }
  catch (error) {
    if (revision !== authRevision) return welinkConnectionFailure('');
    const failure = welinkConnectionFailure(error);
    const { renewal, account } = parseAuthStatus(stripVTControlCharacters(String(error)));
    return renewal === 'expired' && failure.connection === 'needs-login' ? { ...failure, renewal, account } : failure;
  }
}

const authMonitor = new WelinkAuthMonitor(readAuthStatus, renewWelink);
const employeeLookup = new WelinkEmployeeLookup(args => runWelink(args, 8000), readAuthStatus);
export const welinkAuthStatus = (retry = false) => authMonitor.read(retry);
export const onWelinkRecovery = (listener: (uid: string) => void) => authMonitor.onRecovery(listener);
export const onWelinkAuthChanged = authMonitor.onChanged.bind(authMonitor);
export const welinkEmployeeNumber = (uid: string) => employeeLookup.read(uid);

const QR_ASCII = /(\+-{4,}\+\s*\n[\s\S]*?\n\+-{4,}\+)/;
const QR_REQUESTED = /obtaining qr code|waiting for scan|please scan|open this URL to scan|请.{0,12}扫码|正在获取二维码/i;
const spawnLogin = () => spawn(resolveWelinkCli(), ['auth', 'login', '--env', 'pro'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let autoRenew = false;
let interactive = false;
let renewal: { controller: AbortController; done: Promise<WelinkRenewal> } | undefined;

function cancelRenewal() {
  renewal?.controller.abort();
  return renewal?.done;
}

export function enableWelinkRenewal() {
  autoRenew = true;
  return () => { autoRenew = false; cancelRenewal(); };
}

function renewWelink(): Promise<WelinkRenewal> | undefined {
  if (!autoRenew || interactive) return undefined;
  if (renewal) return renewal.done;
  const controller = new AbortController();
  const done = new Promise<WelinkRenewal>(resolve => {
    const child = spawnLogin();
    let output = '', stopped: WelinkRenewal | undefined;
    const stop = (result: WelinkRenewal) => { if (!stopped) { stopped = result; child.kill(); } };
    const cancel = () => stop('temporary');
    const timer = setTimeout(cancel, 15_000);
    controller.signal.addEventListener('abort', cancel, { once: true });
    const watch = (chunk: string) => {
      output = (output + stripVTControlCharacters(chunk)).slice(-4096);
      if (QR_REQUESTED.test(output) || QR_ASCII.test(output)) stop('needs-login');
    };
    child.stdout.setEncoding('utf8').on('data', watch);
    child.stderr.setEncoding('utf8').on('data', watch);
    child.once('error', cancel);
    child.once('close', code => {
      clearTimeout(timer);
      controller.signal.removeEventListener('abort', cancel);
      resolve(stopped ?? (code === 0 ? 'finished' : welinkConnectionFailure(output).connection === 'client-closed' ? 'client-closed' : 'temporary'));
    });
  }).catch((): WelinkRenewal => 'temporary').finally(() => { renewal = undefined; });
  renewal = { controller, done };
  return done;
}

export async function welinkLogout(): Promise<void> {
  authRevision++;
  interactive = true;
  try { await cancelRenewal(); await runWelink(['auth', 'logout'], 10000); }
  finally { authRevision++; interactive = false; }
}

// weclaw-cli 本体探测:优先用 CMO 安装包自带的(vendor/weclaw,打包进 extraResources),
// 其次 UniAssistant(员工助手桌面版)自带的(本机实测位置),最后依赖 PATH。
// 与 welink-cli 不同,weclaw-cli 调用员工助手的本地服务(localhost:3008,悬浮球展开后才启动),
// 探测失败不阻塞日程同步主链路,仅在调用时降级提示。详见 docs/meeting-closure.md。
const BUNDLED_WECLAW_CLI = app.isPackaged ? join(process.resourcesPath, 'weclaw', 'weclaw-cli.exe') : join(app.getAppPath(), 'vendor', 'weclaw', 'weclaw-cli.exe');
const UNIASSISTANT_WECLAW_CLI = String.raw`C:\Program Files (x86)\UniAssistant\resources\bundled\opencode\weclaw-cli.exe`;
const LEGACY_WECLAW_CLI = String.raw`C:\Program Files\WeClaw Desktop\resources\bundled\opencode\weclaw-cli.exe`;
export function resolveWeclawCli(): string {
  if (existsSync(BUNDLED_WECLAW_CLI)) return BUNDLED_WECLAW_CLI;
  if (existsSync(UNIASSISTANT_WECLAW_CLI)) return UNIASSISTANT_WECLAW_CLI;
  if (existsSync(LEGACY_WECLAW_CLI)) return LEGACY_WECLAW_CLI;
  return 'weclaw-cli'; // execFile 在 win 会自动补 .exe;依赖 PATH
}

/** 一次性执行 weclaw-cli 子命令,返回 stdout。失败/超时抛错(调用方 catch 降级)。 */
export function runWeclaw(args: string[], timeoutMs = 30000, signal?: AbortSignal): Promise<string> {
  const exe = resolveWeclawCli();
  return new Promise((resolve, reject) => {
    execFile(exe, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, signal }, (error, stdout, stderr) => {
      if (error) {
        const reason = stripVTControlCharacters([stderr, stdout].filter(Boolean).join('\n')).trim();
        reject(Object.assign(new Error(reason.slice(-2000) || error.message), { code: error.code, killed: error.killed }));
        return;
      }
      resolve(stdout);
    });
  });
}

export interface WelinkLoginEvent { qrImageUrl?: string; qrAscii?: string; done: boolean; error?: string; }

/** 扫码登录:spawn `auth login --env pro`,从 stdout 提取 ASCII 二维码块 + 图片 URL 推给前端;成功/失败/超时回调。
 * 返回 cancel 函数(用户取消时 kill 子进程)。
 * ASCII 二维码是 CLI 直接打印的方块字符(两个 +----+ 边框之间),不依赖网络可达性,
 * 任何机器都能用 <pre> 等宽渲染;图片 URL 是华为内网域名(api.inner.welink.huawei.com),
 * 非内网机器 <img> 加载失败,所以前端以 ASCII 为主、图片为可选增强。 */
export function welinkLogin(onEvent: (event: WelinkLoginEvent) => void): () => void {
  authRevision++;
  interactive = true;
  let queued = true;
  const notify = (event: WelinkLoginEvent) => { if (event.done) { authRevision++; interactive = false; } onEvent(event); };
  let cancel = () => { if (queued) { queued = false; notify({ done: true, error: '已取消' }); } };
  const start = () => { if (queued) cancel = startWelinkLogin(notify); };
  const pending = cancelRenewal();
  if (pending) void pending.then(start);
  else start();
  return () => cancel();
}

function startWelinkLogin(onEvent: (event: WelinkLoginEvent) => void): () => void {
  let child;
  try {
    child = spawnLogin();
  } catch (error) {
    onEvent({ done: true, error: error instanceof Error ? error.message : String(error) });
    return () => undefined;
  }
  let buffer = '';
  let settled = false;
  let pushedQr = false;
  const finish = (error?: string) => {
    if (settled) return;
    settled = true;
    onEvent({ done: true, error });
  };
  // ASCII 二维码块:CLI 打印 "+----...----+\n| ... |\n+----...----+",抓两个边框行之间的内容(含边框)。
  // 用 [\s\S] 跨行,非贪婪到第二个 +----+ 行。
  // 二维码图片 URL: "If QR code is not displayed correctly, open this URL to scan:\nhttps://.../img/xxxx"
  const QR_URL = /open this URL to scan:\s*(https:\/\/[^\s]+)/i;
  // 登录成功标记:只认最终的 "Login successful" / "Credentials cached"。
  // 不能用 "successfully" —— 会误命中 "Connected successfully" / "Token refreshed successfully",
  // 导致 token 还没 cache 就提前 finish,前端读 status 读到 EXPIRED 误判未登录(表现为点了没反应)。
  const SUCCESS = /(login\s+success|credentials\s+cached)/i;
  const timer = setTimeout(() => { child.kill(); finish('扫码超时,请重试'); }, 120000);
  const handleChunk = (chunk: string) => {
    buffer += chunk;
    if (!settled) {
      // ASCII 二维码块出现就推一次(只推一次,避免每次 chunk 重复推)
      if (!pushedQr) {
        const asciiMatch = buffer.match(QR_ASCII);
        if (asciiMatch) {
          pushedQr = true;
          const qrAscii = asciiMatch[1];
          const urlMatch = buffer.match(QR_URL);
          onEvent({ done: false, qrAscii, qrImageUrl: urlMatch?.[1] });
        }
      }
      if (SUCCESS.test(buffer)) { clearTimeout(timer); finish(); }
    }
  };
  child.stdout.setEncoding('utf8').on('data', handleChunk);
  child.stderr.setEncoding('utf8').on('data', handleChunk);
  child.on('error', (error: NodeJS.ErrnoException) => { clearTimeout(timer); finish(error.code === 'ENOENT' ? '未找到 WeLink 登录程序，请检查安装是否完整。' : error.message); });
  child.on('close', code => {
    clearTimeout(timer);
    if (settled) return;
    if (code === 0) { finish(); return; }
    const output = stripVTControlCharacters(buffer).replace(QR_ASCII, '')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
      .replace(/((?:access[_-]?token|refresh[_-]?token|user[_-]?token|token|password|cookie|authorization)\s*[:=]\s*)(?:Bearer\s+)?(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[已隐藏]')
      .replace(/https?:\/\/\S+/gi, '[链接已隐藏]');
    const detail = output.split(/[\r\n]+/).map(line => line.trim()).filter(line => /\b(error|failed|failure|cannot|unable|timeout|denied|refused|invalid|expired)\b|timed?\s*out|caused by:|失败|错误|超时|拒绝|无法|未连接/i.test(line))
      .slice(-3).map(line => line.replace(/^Error:\s*/i, '')).join('\n').slice(0, 600);
    const reason = /Cannot connect to WeLink PC/i.test(detail) ? '无法连接 WeLink PC，请先打开 WeLink 桌面客户端后重试。' : detail;
    const exitReason = code === null ? '登录进程中断' : `退出码 ${code}`;
    finish(reason ? `登录失败：${reason}\n（${exitReason}）` : `登录失败（${exitReason}），登录程序未提供详细原因。`);
  });
  return () => { clearTimeout(timer); try { child.kill(); } catch { /* already exited */ } finish('已取消'); };
}
