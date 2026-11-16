import { test } from 'node:test';
import assert from 'node:assert/strict';
import { codeaiLocalUrl, codeaiMessageEvidence, resolveCodeaiSession } from '../electron/codeai-navigation';

const target = { sessionId: 'session-1', workspace: 'D:\\Projects\\My Project' };
const session = { id: target.sessionId, projectPath: 'd:/projects/my project/', name: '修复查询结果', summary: null, projectPathValid: true };

test('CodeAI navigation matches session ID and complete project path, using the current renamed title', () => {
  assert.deepEqual(resolveCodeaiSession([{ ...session, summary: '重新命名后的会话' }], target), { title: '重新命名后的会话', query: '重新命名后的会话' });
  assert.throws(() => resolveCodeaiSession([{ ...session, projectPath: 'D:/Other/My Project' }], target), /未找到/);
  assert.throws(() => resolveCodeaiSession([{ ...session, id: 'other-session' }], target), /未找到/);
  assert.throws(() => resolveCodeaiSession([{ ...session, projectPathValid: false }], target), /未找到/);
  assert.deepEqual(resolveCodeaiSession([session, { ...session, id: 'orphan', projectPath: null }], target), { title: session.name, query: session.name });
  assert.throws(() => resolveCodeaiSession([session], { ...target, workspace: '' }), /缺少项目路径/);
});

test('CodeAI navigation refuses ambiguous titles even across projects instead of clicking the first result', () => {
  assert.throws(() => resolveCodeaiSession([session, { ...session, id: 'session-2', projectPath: 'D:/Other', summary: '修复查询结果' }], target), /同名/);
  assert.throws(() => resolveCodeaiSession([{ ...session, name: '' }], target), /无可定位/);
  assert.throws(() => resolveCodeaiSession([session, session], target), /未找到/);
});

test('CodeAI navigation searches a single line and preserves the full title for exact row matching', () => {
  assert.deepEqual(resolveCodeaiSession([{ ...session, name: '完整会话标题\n第二行内容' }], target), { title: '完整会话标题\n第二行内容', query: '完整会话标题' });
});

test('CodeAI navigation only permits loopback HTTP services without credentials', () => {
  assert.equal(codeaiLocalUrl('http://127.0.0.1:43210/?project=old').href, 'http://127.0.0.1:43210/');
  assert.equal(codeaiLocalUrl('http://[::1]:43210/').hostname, '[::1]');
  for (const url of ['https://example.com', 'http://localhost.example.com', 'http://user:secret@localhost:3001', 'file:///C:/CodeAI/index.html']) {
    assert.throws(() => codeaiLocalUrl(url));
  }
});

test('CodeAI navigation verifies actual rendered history markers when the API has no message ID', () => {
  assert.deepEqual(codeaiMessageEvidence({ success: true, messages: [{ role: 'user', timestamp: 1000 }, { role: 'assistant', timestamp: 2000 }] }), { markers: ['msg-hist_1000_user_0', 'msg-hist_2000_assistant_1'], fingerprints: [] });
  assert.throws(() => codeaiMessageEvidence({ success: true, messages: [{ role: 'assistant' }] }), /无法核对/);
  assert.throws(() => codeaiMessageEvidence({ success: false, messages: [] }));
});

test('CodeAI navigation can verify live message text without assuming historical UI IDs or using short generic replies', () => {
  assert.deepEqual(codeaiMessageEvidence({ success: true, messages: [{ role: 'user', content: '请检查这个查询返回的内容' }, { role: 'assistant', content: '请检查这个查询返回的内容' }] }), { markers: [], fingerprints: ['请检查这个查询返回的内容'] });
  assert.throws(() => codeaiMessageEvidence({ success: true, messages: [{ role: 'user', content: '好的' }] }), /无法核对/);
});
