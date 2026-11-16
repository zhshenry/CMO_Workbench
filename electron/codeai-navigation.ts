import { execFile } from 'node:child_process';
import { z } from 'zod';
import { agentProjectKey, type AgentMessage } from '../shared/agent-message-contracts';

type Target = Pick<AgentMessage, 'sessionId' | 'workspace'>;
export interface CodeaiOpenResult { opened: boolean; hint: string; }
const Session = z.object({ id: z.string(), name: z.string().nullish(), summary: z.string().nullish(), projectPath: z.string().nullish().transform(path => path ?? ''), projectPathValid: z.boolean().optional() });
const normalize = (value: string) => value.replace(/\s+/g, ' ').trim();

// 会话 ID 和完整项目路径共同确定目标；标题只用于驱动 UI，重名不猜测。
export function resolveCodeaiSession(input: unknown, target: Target) {
  const sessions = z.array(Session).parse(input);
  if (!target.workspace.trim()) throw new Error('通知缺少项目路径，请在 CodeAI 中手动选择会话');
  const matches = sessions.filter(session => session.id === target.sessionId && agentProjectKey(session.projectPath) === agentProjectKey(target.workspace) && session.projectPathValid !== false);
  if (matches.length !== 1) throw new Error('这台电脑的 CodeAI 中未找到对应会话');
  const session = matches[0], title = session.summary || session.name || '';
  if (!title.trim()) throw new Error('会话尚无可定位的标题');
  if (sessions.filter(item => item.projectPath && item.projectPathValid !== false && normalize(item.summary || item.name || '') === normalize(title)).length !== 1) {
    throw new Error(`存在同名会话，请在 CodeAI 中选择「${normalize(title)}」`);
  }
  return { title, query: title.split(/[\r\n]/).find(line => line.trim())!.trim().slice(0, 100) };
}

// 只访问原生助手从 CodeAI 窗口或进程监听端口发现的本机地址，不跟随重定向。
export function codeaiLocalUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || url.username || url.password) throw new Error('无法读取 CodeAI 本机服务');
  return new URL(url.origin);
}

export function codeaiMessageEvidence(input: unknown) {
  const value = z.object({ success: z.literal(true), messages: z.array(z.object({ timestamp: z.number().int().positive().optional(), role: z.string(), content: z.string().optional() })).max(50) }).parse(input);
  const markers = value.messages.flatMap((message, index) => message.timestamp && ['user', 'assistant'].includes(message.role) ? [`msg-hist_${message.timestamp}_${message.role}_${index}`] : []);
  // 正在使用的标签保留实时消息 ID；此时在消息列表内核对用户原文，不把侧栏标题当作正文证据。
  const fingerprints = value.messages.filter(message => message.role === 'user').slice(-3).flatMap(message => {
    const line = message.content?.split(/[\r\n]/).map(normalize).find(text => text.length >= 8 && !/^[#>`\[{}]/.test(text));
    return line ? [line.slice(0, 80)] : [];
  });
  if (!markers.length && !fingerprints.length) throw new Error('无法核对会话内容，请在 CodeAI 中手动打开');
  return { markers, fingerprints };
}

function native(helper: string, input: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = execFile(helper, [], { windowsHide: true, timeout: 20000, maxBuffer: 128 * 1024, encoding: 'utf8' }, (error, stdout) => {
      if (error) { reject(new Error('CodeAI 暂时无法响应，请手动切换到 CodeAI')); return; }
      try { resolve(JSON.parse(stdout.replace(/^\uFEFF/, '').trim())); } catch { reject(new Error('无法读取 CodeAI 窗口状态')); }
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(JSON.stringify(input), 'utf8');
  });
}

async function readLocal(url: URL) {
  const response = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: 'error' });
  if (!response.ok) throw new Error('无法读取 CodeAI 会话，请在 CodeAI 中确认连接状态');
  return response.json() as Promise<unknown>;
}

let opening = false;
export async function openCodeaiSession(target: Target, helper: string): Promise<CodeaiOpenResult> {
  if (process.platform !== 'win32') return { opened: false, hint: '当前系统暂不支持自动定位，请在 CodeAI 中打开对应项目' };
  if (opening) return { opened: false, hint: '正在定位另一条 CodeAI 会话，请稍后重试' };
  opening = true;
  let windows: { handle: string; url: string }[] = [];
  let matchedWindow = '';
  let hint = '未找到 CodeAI，请先安装或打开 CodeAI 后重试';
  try {
    const state = z.object({ windows: z.array(z.object({ handle: z.string().regex(/^\d+$/), url: z.string() })) }).parse(await native(helper, { action: 'windows' }));
    windows = state.windows;
    if (windows.length) hint = 'CodeAI 已打开，暂时无法定位会话，请在历史会话中手动选择';
    for (const window of windows) {
      let hasSessionList = false;
      try {
        const base = codeaiLocalUrl(window.url);
        const listUrl = new URL('/api/sessions', base);
        listUrl.searchParams.set('project', target.workspace);
        const list = z.object({ success: z.literal(true), sessions: z.array(z.unknown()) }).parse(await readLocal(listUrl));
        hasSessionList = true;
        const session = resolveCodeaiSession(list.sessions, target);
        matchedWindow ||= window.handle;
        const messagesUrl = new URL(`/api/sessions/${encodeURIComponent(target.sessionId)}/messages`, base);
        messagesUrl.search = new URLSearchParams({ project: target.workspace, offset: '0', limit: '50' }).toString();
        const evidence = codeaiMessageEvidence(await readLocal(messagesUrl));
        const result = z.object({ opened: z.boolean() }).parse(await native(helper, { action: 'open', handle: window.handle, ...session, ...evidence }));
        if (result.opened) return { opened: true, hint: '已在 CodeAI 中打开对应会话' };
        hint = `未能自动定位，请在 CodeAI 历史会话中搜索「${normalize(session.title)}」`;
      } catch (error) { if (hasSessionList) hint = error instanceof z.ZodError ? '无法识别当前 CodeAI 的会话信息，请在 CodeAI 中手动打开' : (error as Error).message; }
    }
    if (windows.length) await native(helper, { action: 'focus', handle: matchedWindow || windows[0].handle }).catch(() => undefined);
    return { opened: false, hint };
  } catch (error) {
    return { opened: false, hint: error instanceof z.ZodError ? '无法读取 CodeAI 窗口，请打开 CodeAI 后重试' : (error as Error).message };
  } finally { opening = false; }
}
