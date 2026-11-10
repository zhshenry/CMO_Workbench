import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

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
