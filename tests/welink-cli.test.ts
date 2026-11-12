import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

// welink-cli.ts 顶部 import { app } from 'electron',node:test 直接跑会因 electron 无 ESM export 失败。
// 仿 ai-reference-ipc.test.ts:先注册 hooks 把 electron mock 成 data: URL,再动态导入 welink-cli。
// 静态 import 只留 node 内置模块,确保 registerHooks 在 welink-cli 加载前生效。
const source = `export const app = { isPackaged: false, getAppPath: () => '' };`;
const mockUrl = `data:text/javascript,${encodeURIComponent(source)}`;
const hooks = registerHooks({ resolve(specifier, _context, nextResolve) {
  return specifier === 'electron' ? { url: mockUrl, shortCircuit: true } : nextResolve(specifier, _context);
} });
const { parseAuthStatus, welinkLogin } = await import('../electron/welink-cli');
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
