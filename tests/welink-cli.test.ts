import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAuthStatus } from '../electron/welink-cli';

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
