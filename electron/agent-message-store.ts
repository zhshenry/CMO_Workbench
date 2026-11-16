import { closeSync, existsSync, openSync, readSync, readFileSync, statSync } from 'node:fs';
import { basename, isAbsolute, join, win32 } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { AgentEventSchema, AgentMessageSchema, type AgentMessage, type AgentReadTarget } from '../shared/agent-message-contracts';

const stripControl = (value: string) => value.replace(/[^\P{C}\n]/gu, ' ').replace(/\s+/g, ' ').trim();

// 读取 transcript jsonl 尾部,从后往前找最后一条带 text 的 assistant 消息,截前 200 字。
// 旧版 Stop 未附带回复正文时回查文件;失败/无 text 返回空串(后端降级为"CodeAI 有新回复")。
const SUMMARY_MAX = 200;
const TAIL_BYTES = 65536;
export function readTranscriptSummary(transcriptPath: string): string {
  if (!transcriptPath || !isAbsolute(transcriptPath) && !win32.isAbsolute(transcriptPath)) return '';
  let size = 0;
  try { ({ size } = statSync(transcriptPath)); } catch { return ''; }
  if (!size) return '';
  const length = Math.min(size, TAIL_BYTES);
  let buffer = Buffer.alloc(0);
  try {
    const fd = openSync(transcriptPath, 'r');
    try { buffer = Buffer.alloc(length); readSync(fd, buffer, 0, length, Math.max(0, size - length)); }
    finally { closeSync(fd); }
  } catch { return ''; }
  const text = buffer.toString('utf8');
  // 若读了文件尾部(首行可能被截断),丢弃首段;若读了整个文件(首行完整)则保留。
  const partial = length < size;
  const body = partial && text.includes('\n') ? text.slice(text.indexOf('\n') + 1) : text;
  const lines = body.split('\n').filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    let entry: { type?: string; message?: { content?: Array<{ type: string; text?: string }> } };
    try { entry = JSON.parse(lines[index]); } catch { continue; }
    if (entry?.type !== 'assistant' || !Array.isArray(entry.message?.content)) continue;
    for (const block of entry.message!.content!) {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        return block.text.replace(/\s+/g, ' ').trim().slice(0, SUMMARY_MAX);
      }
    }
  }
  return '';
}

export class AgentMessageStore {
  private messages: AgentMessage[] = [];
  readonly loadError: string = '';
  private file: string;
  constructor(dir: string, private now = Date.now) {
    this.file = join(dir, 'agent-messages.json');
    if (existsSync(this.file)) {
      try { this.messages = z.array(AgentMessageSchema).parse(JSON.parse(readFileSync(this.file, 'utf8'))); }
      catch { this.loadError = 'CodeAI 消息无法读取，原文件已保留'; }
    }
  }
  read(): AgentMessage[] { return structuredClone(this.messages); }
  get(id: string): AgentMessage {
    const message = this.messages.find(value => value.id === id);
    if (!message) throw new Error('这条 CodeAI 消息已不可用');
    return structuredClone(message);
  }
  private commit(messages: AgentMessage[]): void {
    if (this.loadError) throw new Error(this.loadError);
    writeJsonAtomic(this.file, messages); this.messages = messages;
  }
  markRead(id: string): void {
    this.get(id);
    if (this.messages.find(message => message.id === id)!.readAt !== null) return;
    this.commit(this.messages.map(message => message.id === id ? { ...message, readAt: this.now() } : message));
  }
  markReadAll(targets: AgentReadTarget[]): string[] {
    const versions = new Map(targets.map(target => [target.id, target.updatedAt])), marked: string[] = [], now = this.now();
    const messages = this.messages.map(message => {
      if (message.readAt !== null || versions.get(message.id) !== message.updatedAt) return message;
      marked.push(message.id); return { ...message, readAt: now };
    });
    if (marked.length) this.commit(messages);
    return marked;
  }
  ingest(input: unknown): AgentMessage | null {
    const event = AgentEventSchema.parse(input), messages = this.read();
    // 非 approval 事件同 turn 共享一个 id(常量 'response'),使 failed 能覆盖同 turn 的 reply。
    const id = createHash('sha256').update(JSON.stringify([event.provider, event.sessionId, event.turnId, 'response'])).digest('hex').slice(0, 32);
    const previous = messages.find(message => message.id === id);
    // 同 turn:旧事件不覆盖;reply 不覆盖已有(failed 或 reply);只有 failed 才覆盖 reply。不重置已读。
    if (previous && (event.occurredAt <= previous.updatedAt || previous.kind === 'failed' || previous.kind === event.kind)) return null;
    const workspace = (isAbsolute(event.workspace) || win32.isAbsolute(event.workspace)) && !/^[/\\]{2}/.test(event.workspace) ? event.workspace : '';
    const title = stripControl(event.title) || (event.kind === 'failed' ? '运行失败，请回到 CodeAI 查看' : readTranscriptSummary(event.transcriptPath) || '有新回复，回来看看吧。');
    const message: AgentMessage = {
      id, provider: event.provider, sessionId: event.sessionId, turnId: event.turnId, requestKey: event.requestKey,
      workspace, project: stripControl(win32.basename(workspace) || basename(workspace) || '未命名项目'),
      kind: event.kind, title, detail: stripControl(event.detail),
      transcriptPath: event.transcriptPath,
      createdAt: previous?.createdAt ?? event.occurredAt, updatedAt: event.occurredAt,
      readAt: previous?.readAt ?? null, resolvedAt: null,
    };
    this.commit([message, ...messages.filter(value => value.id !== id)].sort((a, b) => b.updatedAt - a.updatedAt));
    return structuredClone(message);
  }
}
