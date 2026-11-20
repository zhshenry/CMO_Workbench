import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { WelinkAuthMonitor, type WelinkAuthState, type WelinkRenewal } from '../electron/welink-auth';
import { WelinkEmployeeLookup } from '../electron/welink-profile';

// welink-cli.ts 顶部 import { app } from 'electron',node:test 直接跑会因 electron 无 ESM export 失败。
// 仿 ai-reference-ipc.test.ts:先注册 hooks 把 electron mock 成 data: URL,再动态导入 welink-cli。
// 静态 import 只留 node 内置模块,确保 registerHooks 在 welink-cli 加载前生效。
const source = `export const app = { isPackaged: false, getAppPath: () => '' };`;
const mockUrl = `data:text/javascript,${encodeURIComponent(source)}`;
const hooks = registerHooks({ resolve(specifier, _context, nextResolve) {
  return specifier === 'electron' ? { url: mockUrl, shortCircuit: true } : nextResolve(specifier, _context);
} });
const { enableWelinkRenewal, parseAuthStatus, welinkAuthStatus, welinkLogin, welinkLogout } = await import('../electron/welink-cli');
hooks.deregister();

test('parseAuthStatus: authenticated 样本解析出 uid', () => {
  const out = `Configuration:\n  Environment:  pro\n\nCredentials:\n  User Token:   valid (expires in 29m51s)\n  UID:          z00545972`;
  const state = parseAuthStatus(out);
  assert.equal(state.authenticated, true);
  assert.equal(state.uid, 'z00545972');
});

test('parseAuthStatus: not authenticated 样本', () => {
  const out = `Configuration:\n  Environment:  pro\n\nCredentials:\n  Status:       not authenticated\n  Hint:         Run 'welink-cli auth login' to authenticate.`;
  const state = parseAuthStatus(out);
  assert.equal(state.authenticated, false);
  assert.equal(state.uid, undefined);
});

test('parseAuthStatus: Cannot connect to WeLink PC 给出引导原因', () => {
  const out = `Connecting to WeLink PC...\nError: Cannot connect to WeLink PC.`;
  const state = parseAuthStatus(out);
  assert.equal(state.authenticated, false);
  assert.match(state.reason ?? '', /WeLink 桌面客户端/);
});

test('parseAuthStatus: 已登录但无 UID 行也判为 authenticated', () => {
  const out = `Configuration:\n  Environment:  pro\n\nCredentials:\n  Status:       authenticated`;
  const state = parseAuthStatus(out);
  assert.equal(state.authenticated, true);
  assert.equal(state.uid, undefined);
});

test('concurrent WeLink status reads share a check and a recovered account is announced once', async () => {
  let state: WelinkAuthState = { authenticated: false, connection: 'needs-login' }, calls = 0;
  const monitor = new WelinkAuthMonitor(async () => { calls++; return state; });
  const accounts: string[] = [];
  const unsubscribe = monitor.onRecovery(id => accounts.push(id));
  const pending = monitor.read();
  assert.equal(monitor.read(), pending);
  assert.equal((await pending).connection, 'needs-login');
  assert.equal(calls, 1);
  state = { authenticated: true, uid: 'fixture', connection: 'ready' };
  await monitor.read();
  await monitor.read();
  assert.deepEqual(accounts, ['fixture']);
  unsubscribe();
});

test('a near-expiry token stays usable, and an expired token only requests a scan when the CLI asks', async () => {
  let raw = 'User Token: valid (expires in 2m37s)\nRefresh Token: expired\nUID: z00001234';
  let renewals = 0;
  let finishEarly: (outcome: WelinkRenewal) => void = () => {};
  const monitor = new WelinkAuthMonitor(async () => parseAuthStatus(raw), () => {
    if (++renewals === 1) return new Promise(resolve => { finishEarly = resolve; });
    return Promise.resolve('needs-login');
  });
  assert.equal((await monitor.read()).authenticated, true);
  assert.equal(renewals, 1);
  finishEarly('needs-login');
  assert.equal((await monitor.read()).connection, 'ready');
  raw = 'User Token: expired\nRefresh Token: valid\nUID: z00001234';
  assert.equal((await monitor.read()).connection, 'needs-login');
  assert.equal((await monitor.read()).connection, 'needs-login');
  raw = 'Status: not authenticated';
  assert.equal((await monitor.read()).connection, 'needs-login');
  assert.equal(renewals, 2);
});

test('expiry recovery rechecks the session, backs off on transient failures, and announces recovery once', async () => {
  let raw = 'User Token: expired\nUID: z00001234', renewals = 0, checks = 0;
  const monitor = new WelinkAuthMonitor(async () => { checks++; return parseAuthStatus(raw); }, async () => {
    if (++renewals === 1) return 'temporary';
    raw = 'User Token: valid (expires in 29m51s)\nUID: z00001234';
    return 'finished';
  });
  const recovered: string[] = [];
  monitor.onRecovery(uid => recovered.push(uid));
  assert.equal((await monitor.read()).connection, 'temporary');
  assert.equal((await monitor.read()).connection, 'temporary');
  assert.equal(renewals, 1);
  assert.equal((await monitor.read(true)).uid, 'z00001234');
  assert.equal(checks, 4);
  raw = 'Cannot connect to WeLink PC.';
  assert.equal((await monitor.read()).connection, 'client-closed');
  assert.deepEqual(recovered, ['z00001234']);
  assert.equal(renewals, 2);
});

test('successful early renewal is verified even if the renewal process returns immediately', async () => {
  let raw = 'User Token: valid (expires in 1m30s)\nUID: z00001234', checks = 0;
  const monitor = new WelinkAuthMonitor(async () => { checks++; return parseAuthStatus(raw); }, async () => {
    raw = 'User Token: valid (expires in 31m1s)\nUID: z00001234';
    return 'finished';
  });
  assert.equal((await monitor.read()).connection, 'ready');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checks, 2);
});

test('background renewal stops at a split QR prompt and yields to explicit logout', async t => {
  let raw = 'User Token: expired\nUID: z00001234';
  let holdStatus = false;
  let completeStatus: (output: string) => void = () => {};
  let child: { stdout: PassThrough; stderr: PassThrough; kill(): void };
  const commands: string[] = [];
  t.mock.method(childProcess, 'execFile', (_exe, args: string[], _options, callback) => {
    const command = args.join(' ');
    commands.push(command);
    if (command === 'auth status' && holdStatus) {
      completeStatus = output => callback(null, output, '');
      return;
    }
    if (command === 'auth logout') raw = 'Status: not authenticated';
    queueMicrotask(() => callback(null, raw, ''));
  });
  t.mock.method(childProcess, 'spawn', (_exe, args: string[]) => {
    commands.push(args.join(' '));
    const process = new EventEmitter();
    child = Object.assign(process, { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => {
      commands.push('stop');
      queueMicrotask(() => process.emit('close', null));
    } });
    return child;
  });
  syncBuiltinESMExports();
  const stop = enableWelinkRenewal();
  t.after(() => { stop(); t.mock.restoreAll(); syncBuiltinESMExports(); });
  const pending = welinkAuthStatus();
  await new Promise(resolve => setImmediate(resolve));
  child!.stdout.write('Obtaining QR ');
  child!.stderr.write('code...\n');
  assert.equal((await pending).connection, 'needs-login');
  assert.deepEqual(commands, ['auth status', 'auth login --env pro', 'stop']);

  const next = welinkAuthStatus(true);
  await new Promise(resolve => setImmediate(resolve));
  await welinkLogout();
  await next;
  assert.deepEqual(commands.slice(-4), ['auth status', 'auth login --env pro', 'stop', 'auth logout']);
  assert.equal((await welinkAuthStatus()).connection, 'needs-login');
  holdStatus = true;
  const staleStatus = welinkAuthStatus();
  await welinkLogout();
  completeStatus('User Token: expired\nUID: z00001234');
  assert.equal((await staleStatus).connection, 'temporary');
  assert.equal(commands.filter(command => command.startsWith('auth login')).length, 2);
});

test('employee lookup selects the authenticated directory record and rejects stale or unrelated results', async () => {
  const auth = (uid: string): WelinkAuthState => ({ authenticated: true, uid, connection: 'ready' });
  let current = 'z00001234';
  let result = [{ welinkId: 'z00005678', employeeNumber: '00005678' }, { welinkId: 'Z00001234', employeeNumber: '00001234' }];
  const commands: string[][] = [];
  const lookup = new WelinkEmployeeLookup(async args => {
    commands.push(args);
    if (args[0] === 'onebox') return 'Connected\n' + JSON.stringify({ data: { loginName: 'z00001234' } });
    if (args[0] === 'search') return JSON.stringify({ search_cli_person: { data: result } });
    return JSON.stringify({ users: result });
  }, async () => auth(current));
  const first = lookup.read('Z00001234');
  assert.equal(lookup.read('z00001234'), first);
  assert.equal(await first, '00001234');
  assert.deepEqual(commands, [['onebox', 'user-info'], ['search', 'person', '--text', 'z00001234']]);
  assert.equal(await lookup.read('z00002222'), undefined, 'account changed while the directory request was in flight');
  current = 'z00003333';
  assert.equal(await lookup.read(current), undefined, 'only the current account may supply a suggestion even if OneBox retained an old profile');
  current = 'z00001234';
  result = [{ welinkId: 'z00005678', employeeNumber: '00005678' }];
  assert.equal(await lookup.read(current), undefined, 'a lone unrelated directory result must not be used');
});

// CLI auth login 无 token 时输出 ASCII 二维码块(两个 +----+ 边框之间)+ 图片 URL + Waiting for scan。
// welinkLogin 应抓到 ASCII 块(qrAscii)和图片 URL(qrImageUrl),且 done=false(等扫码)。
// 不实际 spawn 真实 CLI,只静态验证正则能否从真实样本抓到(与 welinkLogin 实现里的正则一致)。
test('welinkLogin 正则: ASCII 二维码块 + 图片 URL 从真实 CLI 样本命中', () => {
  const sample = `Connecting to WeLink PC...\n  Connected successfully\nObtaining QR code...\n\n+--------------------------------------+\n|   █▀▀▀▀▀█ █▀▀ █ ▄█▀▀█▀  █▀▀▀▀▀█   |\n|   █ ███ █ ▄██▀▀▀▀▀▄▄▀█▀ █ ███ █   |\n+--------------------------------------+\n\nIf QR code is not displayed correctly, open this URL to scan:\nhttps://api.inner.welink.huawei.com/qrcodeg/service/internal/public/v1/qrcodes/img/AzCVAw-gfPO\nWaiting for scan...`;
  const QR_ASCII = /(\+-{4,}\+\s*\n[\s\S]*?\n\+-{4,}\+)/;
  const QR_URL = /open this URL to scan:\s*(https:\/\/[^\s]+)/i;
  assert.match(sample, QR_ASCII, 'ASCII 二维码块正则应命中');
  assert.match(sample, QR_URL, '图片 URL 正则应命中');
  const ascii = sample.match(QR_ASCII)![1];
  const url = sample.match(QR_URL)![1];
  assert.ok(ascii.includes('█▀▀▀▀▀█'), 'ASCII 块应含二维码字符');
  assert.equal(url, 'https://api.inner.welink.huawei.com/qrcodeg/service/internal/public/v1/qrcodes/img/AzCVAw-gfPO');
  assert.equal(typeof welinkLogin, 'function', 'welinkLogin 应可导入');
});

test('welinkLogin forwards useful failure reasons after both output streams close', async t => {
  let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill(): boolean };
  const cancels: Array<() => void> = [];
  t.mock.method(childProcess, 'spawn', () => {
    child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), kill: () => true });
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { cancels.forEach(cancel => cancel()); t.mock.restoreAll(); syncBuiltinESMExports(); });
  const start = () => {
    const events: Array<{ done: boolean; error?: string; qrAscii?: string }> = [];
    const cancel = welinkLogin(event => events.push(event));
    cancels.push(cancel);
    return { events, cancel };
  };

  await t.test('trailing stderr explains a failed desktop connection in Chinese', () => {
    const { events } = start();
    child.stdout.write('Connecting to WeLink PC...\n');
    child.emit('exit', 1);
    child.stderr.write('\u001b[31mError: Cannot connect to WeLink PC.\u001b[0m\n');
    child.emit('close', 1);
    assert.equal(events.length, 1);
    assert.match(events[0].error!, /无法连接 WeLink PC/);
    assert.match(events[0].error!, /打开.*WeLink.*桌面客户端/);
    assert.doesNotMatch(events[0].error!, /\u001b/);
  });

  await t.test('QR acquisition failure keeps the concrete server reason without the QR or secrets', () => {
    const { events } = start();
    child.stdout.write('+--------+\n| QR DATA |\n+--------+\n');
    child.stdout.write('https://example.invalid/qrcode/img/secret-qr\nWaiting for scan...\n');
    child.stderr.write('Error: Failed to obtain QR code: HTTP 403 Forbidden\n');
    child.stderr.write('Error: request denied; access_token=secret-access; password=secret-password; Authorization: Bearer secret-bearer\n');
    child.emit('close', 1);
    const failure = events.find(event => event.done)!;
    assert.match(failure.error!, /HTTP 403 Forbidden/);
    assert.match(failure.error!, /request denied/);
    assert.doesNotMatch(failure.error!, /secret-access|secret-password|secret-bearer|secret-qr|QR DATA/);
  });

  await t.test('failure without diagnostic output says the reason was not provided', () => {
    const { events } = start();
    child.stdout.write('Connecting to WeLink PC...\n');
    child.emit('close', 1);
    assert.match(events[0].error!, /退出码 1/);
    assert.match(events[0].error!, /未提供详细原因/);
  });

  await t.test('Chinese error text survives split UTF-8 output chunks', () => {
    const { events } = start(), output = Buffer.from('错误：认证服务拒绝登录，请稍后重试\n');
    child.stderr.write(output.subarray(0, 5)); child.stderr.write(output.subarray(5)); child.emit('close', 1);
    assert.match(events[0].error!, /认证服务拒绝登录/);
    assert.doesNotMatch(events[0].error!, /�/);
  });

  await t.test('a missing executable has an actionable reason and only one terminal event', () => {
    const { events } = start();
    child.emit('error', Object.assign(new Error('spawn welink-cli ENOENT'), { code: 'ENOENT' }));
    child.emit('close', -4058);
    assert.equal(events.length, 1);
    assert.match(events[0].error!, /未找到.*登录程序/);
  });

  await t.test('success and intentional cancellation keep their existing result', () => {
    const success = start(); child.stdout.write('Login successful\nCredentials cached\n'); child.emit('close', 0);
    assert.equal(success.events.length, 1); assert.equal(success.events[0].error, undefined);
    const cancelled = start(); cancelled.cancel(); child.emit('close', null);
    assert.equal(cancelled.events.length, 1); assert.equal(cancelled.events[0].error, '已取消');
  });
});
