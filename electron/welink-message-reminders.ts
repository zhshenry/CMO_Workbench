import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { chinaDay, dayMillis, nextDay } from '../shared/welink-agenda';
import { officeConversationKey, type OfficeSearch } from '../shared/office-workbench';
import type { WelinkMessage, WelinkMessageReminder, WelinkMessageStatus, WelinkReminderSettings } from '../shared/welink-reminders';
import { officeModelList } from './office-analysis';
import { welinkCommitments, welinkCommitmentProof, welinkCommitmentReviewSchema, type WelinkCommitmentReviews } from './welink-commitments';

export const WELINK_MESSAGE_WINDOW_MS = 36 * 3600000;
const WINDOW_MS = WELINK_MESSAGE_WINDOW_MS, POLL_MS = 10 * 60000, LIMIT = 20, PAGE_SIZE = 100;
type Conversation = { id: string; group: boolean; name: string };
const conversationSchema = z.object({ id: z.string(), group: z.boolean(), name: z.string() });
const conversationKey = (conversation: Conversation) => `${conversation.group ? 'group' : 'user'}:${conversation.id}`;
const messageId = z.string().regex(/^\d+$/);
export const welinkMessageSchema = z.object({ id: messageId, conversation: z.string().regex(/^(user|group):.+/), conversationName: z.string(), group: z.boolean(), sender: z.string().min(1), mine: z.boolean(), atMe: z.boolean(), at: z.number().finite().positive(), text: z.string().max(4000), replyTo: messageId.optional(), atAll: z.boolean().optional() });
interface Saved { account: string; messages: WelinkMessage[]; conversations?: Conversation[]; cursors: Record<string, string>; dismissed: string[]; notified: Record<string, number>; lastReadAt?: number; lastSuccessAt?: number; partial?: boolean; commitmentReviews?: WelinkCommitmentReviews; }
const savedSchema = z.object({
  account: z.string().min(1),
  messages: z.array(welinkMessageSchema).max(2000), conversations: z.array(conversationSchema).max(150).optional(),
  cursors: z.record(z.string(), z.string().regex(/^\d+$/)), dismissed: z.array(z.string()), notified: z.record(z.string(), z.number().finite().nonnegative()),
  lastReadAt: z.number().finite().positive().optional(), lastSuccessAt: z.number().finite().positive().optional(), partial: z.boolean().optional(),
  commitmentReviews: z.record(z.string().regex(/^[a-f0-9]{64}$/), welinkCommitmentReviewSchema).optional(),
});
const blank = (account: string): Saved => ({ account, messages: [], cursors: {}, dismissed: [], notified: {} });
const safeError = (error: unknown) => String(error instanceof Error ? error.message : error).replace(/((?:token|secret|password|authorization)[\w-]*\s*[:=]\s*)\S+/gi, '$1***').slice(0, 300);

const parseIds = (raw: string) => JSON.parse(raw.replace(/("(?:msgId|msg_id|messageId|message_id|maxMsgId|group_id|replyToMsgId|quoteMsgId)"\s*:\s*)(\d{15,})/g, '$1"$2"'));

function parse(raw: string): any {
  const data = parseIds(raw);
  if (data && !Array.isArray(data)) {
    const code = data.code ?? data.resultCode;
    if (code !== undefined && ![0, 200, '0', '200'].includes(code)) throw new Error('WeLink 消息查询未成功，请检查登录或连接。');
    if (data.success === false || data.ok === false) throw new Error('WeLink 消息查询未成功。');
  }
  return data;
}

function records(raw: any, keys: string[]): any[] | null {
  if (Array.isArray(raw)) return raw.every(row => row && typeof row === 'object' && !Array.isArray(row)) ? raw : null;
  if (!raw || typeof raw !== 'object') return null;
  for (const key of keys) if (Array.isArray(raw[key])) return records(raw[key], keys);
  for (const key of ['data', 'result', 'payload', 'respData']) {
    const rows = records(raw[key], keys); if (rows !== null) return rows;
  }
  return null;
}

export function parseWelinkConversations(raw: string): Conversation[] {
  const rows = records(parse(raw), ['conversation_info', 'conversations', 'data']);
  if (!rows) throw new Error('无法识别 WeLink 会话列表，未将查询结果当作空列表。');
  return rows.map(row => {
    const group = row.recent_conversation_type === 'CHAT_TYPE_GROUP_MSG' || row.recent_conversation_type !== 'CHAT_TYPE_P2P_MSG' && row.group_id && String(row.group_id) !== '0' && !row.target_account;
    const id = String(group ? row.group_id ?? '' : row.target_account ?? '');
    if (!id || id === '0') throw new Error('WeLink 会话缺少有效标识。');
    return { id, group: Boolean(group), name: String(group ? row.group_name || row.native_name || id : row.native_name || row.staff_name || id) };
  });
}

export function compareWelinkMessages(a: WelinkMessage, b: WelinkMessage): number {
  return a.at - b.at || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0);
}

function messagePage(raw: string, conversation: Conversation, account: string) {
  const data = parse(raw);
  const empty = [0, '0'].includes(data?.resultCode) && data.respData?.msgTotalCount === 0 && data.respData?.maxMsgId === 0;
  const rows = empty ? [] : records(data, ['chatInfo', 'messages', 'message_list', 'msgList', 'history', 'msgs', 'data']);
  if (!rows) throw new Error('无法识别 WeLink 历史消息，已保留原记录。');
  let oldestId: string | undefined, earliest = Infinity;
  const messages = rows.flatMap(row => {
    const id = String(row.msgId ?? row.msg_id ?? row.messageId ?? row.message_id ?? '');
    const time = Number(row.serverSendTime ?? row.server_send_time ?? row.sendTime ?? row.send_time);
    const at = time < 1e11 ? time * 1000 : time, sender = String(row.sender ?? row.sender_account ?? row.senderAccount ?? '');
    if (!/^\d+$/.test(id) || !Number.isFinite(at) || at <= 0 || !sender) throw new Error('WeLink 消息标识、发送人或时间不完整。');
    if (!oldestId || BigInt(id) < BigInt(oldestId)) oldestId = id;
    earliest = Math.min(earliest, at);
    const nonText = row.contentType && !/TEXT/i.test(String(row.contentType));
    let content = row.content ?? row.msgContent ?? row.text ?? '';
    if (typeof content === 'string' && /^\s*\{/.test(content)) { try { content = parseIds(content); } catch { /* Plain text is retained. */ } }
    const text = nonText ? '【非文字消息，未分析内容】' : String(typeof content === 'object' && content ? content.text ?? content.content ?? '' : content).trim().slice(0, 4000);
    if (!text) return [];
    const replyTo = String(row.replyToMsgId ?? row.quoteMsgId ?? content?.replyToMsgId ?? content?.quoteMsgId ?? '');
    const mentions = Array.isArray(row.atAccountList) ? row.atAccountList.map(String) : undefined;
    const atAll = conversation.group && sender !== account && ([true, 1, '1', 'true'].includes(row.atAll ?? row.atall ?? row.at_all)
      || mentions?.length === 0 && [true, 1, '1', 'true'].includes(row.at));
    return [{ id, conversation: conversationKey(conversation), conversationName: conversation.name, group: conversation.group,
      sender, mine: sender === account, atMe: !!mentions?.includes(account), at, text, ...(atAll && { atAll: true }),
      ...(/^\d+$/.test(replyTo) && { replyTo }) }];
  }).sort(compareWelinkMessages);
  return { messages, count: rows.length, oldestId, earliest };
}

export function parseWelinkMessages(raw: string, conversation: Conversation, account: string): WelinkMessage[] {
  return messagePage(raw, conversation, account).messages;
}

export function welinkWorkDate(text: string, sentAt: number): string | undefined {
  const day = chinaDay(sentAt);
  if (/后天/.test(text)) return nextDay(day, 2);
  if (/明天/.test(text)) return nextDay(day);
  if (/今天|今晚/.test(text)) return day;
  const weekday = text.match(/(下周|本周|这周|周|星期)([一二三四五六日天])/);
  if (weekday) {
    const current = (new Date(dayMillis(day) + 8 * 3600000).getUTCDay() + 6) % 7, wanted = '一二三四五六日'.indexOf(weekday[2].replace('天', '日'));
    const offset = weekday[1] === '下周' ? 7 - current + wanted : wanted - current;
    return nextDay(day, offset < 0 ? offset + 7 : offset);
  }
  const date = text.match(/(?:(20\d{2})[年/-])?(\d{1,2})[月/-](\d{1,2})日?/);
  if (!date) return;
  const value = `${date[1] || day.slice(0, 4)}-${date[2].padStart(2, '0')}-${date[3].padStart(2, '0')}`;
  return Number.isFinite(dayMillis(value)) && chinaDay(dayMillis(value)) === value ? value : undefined;
}

export function welinkDeadlineDay(text: string, sentAt: number): string | undefined {
  const labels = text.matchAll(/今天|今晚|明天|后天|(?:下周|本周|这周|周|星期)[一二三四五六日天]|(?:(?:20\d{2})[年/-])?\d{1,2}[月/-]\d{1,2}日?/g);
  const days = new Set([...labels].map(([label]) => welinkWorkDate(label, sentAt)).filter(Boolean));
  return days.size === 1 ? days.values().next().value : undefined;
}

export function isWelinkWorkRequest(text: string): boolean {
  return /[?？]|请|麻烦|能否|是否|什么时候|帮我|给我|方便吗/.test(text)
    && !/^(好的|收到|谢谢|明白|已完成|已发送)[。！!\s]*$/.test(text);
}

export function welinkUnanswered(messages: WelinkMessage[]) {
  const pending: { message: WelinkMessage; needsReplyReview: boolean }[] = [];
  const replied = new Set<string>();
  let hasLaterOwn = false;
  for (const message of [...messages].sort(compareWelinkMessages).reverse()) {
    if (message.mine) {
      if (message.replyTo) replied.add(message.replyTo);
      hasLaterOwn = true;
    } else if ((!message.group || message.atMe) && isWelinkWorkRequest(message.text) && !replied.has(message.id)) {
      pending.push({ message, needsReplyReview: hasLaterOwn });
    }
  }
  return pending;
}

export function welinkReminderId(account: string, conversation: string, id: string, kind: WelinkMessageReminder['kind']): string {
  return `welink-message:${createHash('sha256').update(`${account}:${conversation}:${id}:${kind}`).digest('hex').slice(0, 24)}`;
}

export function welinkMessageCandidates(messages: WelinkMessage[], settings: WelinkReminderSettings, now: number, account: string, reviews?: WelinkCommitmentReviews): WelinkMessageReminder[] {
  const out: WelinkMessageReminder[] = [], byConversation = new Map<string, WelinkMessage[]>();
  const add = (kind: WelinkMessageReminder['kind'], source: WelinkMessage, title: string, due?: string) => out.push({ id: welinkReminderId(account, source.conversation, source.id, kind), kind, source, title, ...(due ? { due } : {}) });
  for (const message of messages) {
    if (message.at < now - WINDOW_MS || message.at > now + 60000) continue;
    const list = byConversation.get(message.conversation) ?? []; list.push(message); byConversation.set(message.conversation, list);
    const keyword = !message.mine && settings.keywords.find(word => message.text.includes(word));
    if (keyword) add('keyword', message, `关注词“${keyword}” · ${message.conversationName}`);
  }
  for (const list of byConversation.values()) {
    for (const { message, timing, completedBy } of welinkCommitments(list.sort(compareWelinkMessages), reviews).commitments) {
      const due = welinkDeadlineDay(timing, message.at);
      if (!completedBy && due && due <= chinaDay(now)) add('commitment', message, `核对承诺 · 约定 ${due} · ${message.conversationName}`, due);
    }
    const pending = welinkUnanswered(list).find(item => now - item.message.at >= settings.waitHours * 3600000);
    if (!pending) continue;
    const { message: target, needsReplyReview } = pending;
    add('awaiting', target, `${needsReplyReview ? '回复待核对' : '可能待回复'} · ${target.conversationName} · 已等 ${Math.floor((now - target.at) / 3600000)} 小时`);
  }
  const priority = { commitment: 0, awaiting: 1, keyword: 2 };
  return out.sort((a, b) => priority[a.kind] - priority[b.kind] || b.source.at - a.source.at);
}

/** Read-only collection, bounded local cache and persistent reminder receipts. No model or send command is called. */
export class WelinkMessageReminders {
  private data: Saved | null = null;
  private state: WelinkMessageStatus = { syncing: false, lastSuccessAt: null, error: '', partial: false, account: '', conversations: 0, messages: 0, reminders: [] };
  private pending: Promise<WelinkMessageStatus> | null = null;
  private lastAttempt = 0;
  private controller: AbortController | null = null;
  private collectedConversations = new Set<string>();
  private completeConversations = new Set<string>();
  private commitmentReviewsRunning = new Set<string>();
  constructor(private dir: string, private run: (args: string[], signal?: AbortSignal) => Promise<string>, private account: () => Promise<string>, private now = Date.now,
    private commitmentReview?: { model(prompt: string): Promise<string | null>; changed(): void }) {}
  private file(account: string) { return join(this.dir, `welink-messages-${createHash('sha256').update(account).digest('hex').slice(0, 16)}.json`); }
  private saved(account: string): Saved {
    const file = this.file(account);
    const saved = existsSync(file) ? savedSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) : blank(account);
    if (saved.account !== account) throw new Error('消息缓存账号不符，原文件已保留。');
    return saved;
  }
  private save() { if (this.data) writeJsonAtomic(this.file(this.data.account), this.data); }
  officeSnapshot(account: string) {
    const saved = this.data?.account === account ? this.data : this.saved(account);
    const now = this.now();
    return {
      messages: saved.messages.filter(message => message.at >= now - WINDOW_MS && message.at <= now + 60000),
      lastReadAt: saved.lastReadAt ?? null, partial: saved.partial === true,
      dismissed: [...saved.dismissed],
      conversations: (saved.conversations ?? []).map(conversation => ({ key: conversationKey(conversation), name: conversation.name })),
      commitmentReviews: saved.commitmentReviews,
    };
  }

  async officeHistory(account: string, query: OfficeSearch) {
    const signal = AbortSignal.timeout(24000), from = dayMillis(query.from!), through = dayMillis(nextDay(query.to!));
    const saved = this.data?.account === account ? this.data : this.saved(account);
    const known = new Map((saved.conversations ?? []).map(conversation => [conversationKey(conversation), conversation]));
    for (const message of saved.messages) {
      if (!known.has(message.conversation)) known.set(message.conversation, { id: message.conversation.split(':')[1], group: message.group, name: message.conversationName });
    }
    const messages: WelinkMessage[] = [], incomplete: string[] = [];
    let targets: Conversation[];
    if (query.conversation) {
      const key = officeConversationKey.parse(query.conversation);
      targets = [known.get(key) ?? { id: key.split(':')[1], group: key.startsWith('group:'), name: key.split(':')[1] }];
    } else {
      try {
        const recent = parseWelinkConversations(await this.run(['im', 'query-recent-conversation', '--count', '50'], signal));
        for (const entry of recent) known.set(conversationKey(entry), entry);
        targets = [...new Map([...recent, ...known.values()].map(entry => [conversationKey(entry), entry])).values()];
        if (recent.length >= 50) incomplete.push('最近会话达到发现上限');
      } catch {
        targets = [...known.values()];
        incomplete.push('最新会话列表未能读取');
      }
      targets = targets.filter(entry => (query.kind === 'group' ? entry.group : query.kind === 'direct' ? !entry.group : true)
        && (!query.group || entry.group && entry.name.toLowerCase().includes(query.group.toLowerCase())));
      if (targets.length > LIMIT) incomplete.push(`本轮读取 ${LIMIT} 个会话，另有 ${targets.length - LIMIT} 个未查`);
      targets = targets.slice(0, LIMIT);
    }
    let checked = 0;
    for (const conversation of targets) {
      if (signal.aborted) { incomplete.push('已到本轮查询时限，部分会话未查'); break; }
      const args = ['im', 'query-history-message', conversation.group ? '--group-id' : '--user-account', conversation.id, '--query-count', String(PAGE_SIZE), '--query-direction', '0'];
      let cursor: string | undefined, complete = false;
      try {
        for (let page = 0; page < (query.conversation ? 5 : 2); page++) {
          const next = messagePage(await this.run(cursor ? [...args, '--message-id', cursor] : args, signal), conversation, account);
          if (page === 0) checked++;
          messages.push(...next.messages.filter(message => message.at >= from && message.at < through));
          if (next.count < PAGE_SIZE || next.earliest < from) { complete = true; break; }
          if (!next.oldestId || cursor && BigInt(next.oldestId) >= BigInt(cursor)) break;
          cursor = next.oldestId;
        }
      } catch { /* Results from completed pages remain available. */ }
      if (!complete) incomplete.push(conversation.name);
    }
    return { messages, checked, incomplete, conversations: targets.map(entry => ({ key: conversationKey(entry), name: entry.name })) };
  }
  status(settings: WelinkReminderSettings, account = this.state.account): WelinkMessageStatus {
    if (!settings.enabled || account !== this.state.account) return { syncing: false, lastSuccessAt: null, error: '', partial: false, account, conversations: 0, messages: 0, reminders: [] };
    const reminders = this.data ? welinkMessageCandidates(this.data.messages, settings, this.now(), this.data.account, this.data.commitmentReviews).filter(item => !this.data!.dismissed.includes(item.id)) : [];
    return { ...this.state, reminders };
  }
  stop() { this.controller?.abort(); this.data = null; this.lastAttempt = 0; this.collectedConversations.clear(); this.completeConversations.clear(); this.state = { ...this.state, account: '', syncing: false, reminders: [] }; }
  refresh(settings: WelinkReminderSettings, force = false): Promise<WelinkMessageStatus> {
    if (!settings.enabled) { this.stop(); return Promise.resolve(this.status(settings)); }
    if (this.pending) return this.pending;
    if (!force && this.now() - this.lastAttempt < POLL_MS) return Promise.resolve(this.status(settings));
    this.lastAttempt = this.now(); this.state.syncing = true; this.collectedConversations.clear(); this.completeConversations.clear();
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 120000); this.controller = controller;
    this.pending = this.collect(settings, controller.signal).catch(error => {
      this.state.partial = true;
      this.state.error = controller.signal.aborted ? '消息同步已停止或超时，已保留原记录。' : safeError(error);
      return this.status(settings);
    }).finally(() => { clearTimeout(timeout); this.state.syncing = false; this.pending = null; if (this.controller === controller) this.controller = null; });
    return this.pending.then(() => this.status(settings));
  }
  private async collect(settings: WelinkReminderSettings, signal: AbortSignal) {
    const account = await this.account();
    if (!account) throw new Error('请先登录 WeLink 并确认账号。');
    if (this.data?.account !== account) {
      this.data = null; this.state = { ...this.state, account, lastSuccessAt: null, conversations: 0, messages: 0 };
      let saved: Saved;
      try { saved = this.saved(account); }
      catch { throw new Error('消息缓存无法读取，原文件已保留。'); }
      this.data = saved;
      this.state.lastSuccessAt = saved.lastSuccessAt ?? null;
    }
    const saved = structuredClone(this.data), all = parseWelinkConversations(await this.run(['im', 'query-recent-conversation', '--count', '50'], signal));
    const recentKeys = new Set(all.map(conversationKey));
    saved.conversations = [...all, ...(saved.conversations ?? []).filter(row => !recentKeys.has(conversationKey(row)))].slice(0, 150);
    const conversations = all.slice(0, LIMIT), failed: string[] = [], collected = new Map(saved.messages.filter(message => message.at >= this.now() - WINDOW_MS).map(message => [`${message.conversation}:${message.id}`, message]));
    let partial = all.length > LIMIT;
    const collectedConversations = new Set<string>(), completeConversations = new Set<string>();
    for (const conversation of conversations) {
      if (signal.aborted) throw new Error('已停止');
      const key = `${conversation.group ? 'group' : 'user'}:${conversation.id}`, cursor = saved.cursors[key];
      const args = ['im', 'query-history-message', conversation.group ? '--group-id' : '--user-account', conversation.id, '--query-count', String(PAGE_SIZE)];
      if (cursor) args.push('--message-id', cursor, '--query-direction', '1');
      try {
        const { messages, count } = messagePage(await this.run(args, signal), conversation, account);
        collectedConversations.add(key);
        if (count >= PAGE_SIZE) partial = true; else completeConversations.add(key);
        for (const message of messages) if (message.at >= this.now() - WINDOW_MS && message.at <= this.now() + 60000) collected.set(`${message.conversation}:${message.id}`, message);
        // Persist the consumed page boundary; a full page is partial and cannot trigger reply/commitment alerts.
        if (messages.length) saved.cursors[key] = messages.reduce((max, message) => BigInt(message.id) > BigInt(max) ? message.id : max, cursor || '0');
      } catch (error) { failed.push(`${conversation.name}：${safeError(error)}`); partial = true; }
    }
    if (signal.aborted || await this.account() !== account) throw new Error('同步期间账号变化或采集停止，本轮未写入。');
    saved.messages = [...collected.values()].sort((a, b) => a.at - b.at).slice(-2000);
    const valid = new Set(welinkMessageCandidates(saved.messages, settings, this.now(), account, saved.commitmentReviews).map(item => item.id));
    saved.dismissed = [...new Set([...saved.dismissed, ...(this.data?.account === account ? this.data.dismissed : [])])].slice(-2000);
    saved.notified = Object.fromEntries(Object.entries(saved.notified).filter(([id, at]) => valid.has(id) || at >= this.now() - 3600000));
    if (!failed.length || collectedConversations.size) saved.lastReadAt = this.now();
    if (!failed.length) saved.lastSuccessAt = this.now();
    saved.partial = partial;
    this.data = saved; this.save();
    this.collectedConversations = collectedConversations; this.completeConversations = completeConversations;
    this.state = { syncing: true, account, lastSuccessAt: failed.length ? this.state.lastSuccessAt : this.now(), partial, conversations: conversations.length, messages: saved.messages.length,
      error: failed.length ? `部分消息未同步：${failed.slice(0, 3).join('；')}` : partial ? '仅覆盖最近 20 个会话，每个会话本次最多 100 条；部分历史可能未取全。' : '', reminders: [] };
    void this.reviewCommitments(saved).catch(() => {});
    return this.status(settings);
  }

  private async reviewCommitments(saved: Saved) {
    if (!this.commitmentReview || this.commitmentReviewsRunning.has(saved.account)) return;
    const threads = new Map<string, WelinkMessage[]>();
    for (const row of saved.messages) {
      const thread = threads.get(row.conversation) ?? [];
      thread.push(row); threads.set(row.conversation, thread);
    }
    const unclear = [...threads.values()].flatMap(thread => welinkCommitments(thread, saved.commitmentReviews).unclear).slice(-8);
    if (!unclear.length) return;
    this.commitmentReviewsRunning.add(saved.account);
    try {
      const input = unclear.map(({ key, evidence, context }) => ({ key, evidence, context: context.map(row => ({ id: row.id, text: row.text.slice(0, 500) })) }));
      const response = await this.commitmentReview.model('复核这些简短回复是否由我明确接下同一件待办。只在前文能唯一确定未完成的动作和对象时，逐字引用同一句里的动词和对象。观察、转述、建议他人、已完成、仍有多种理解均返回 null。只返回 JSON 数组 [{"key":"本轮编号","proof":{"sourceId":"前文消息编号","verb":"原文动词","object":"原文对象"}}]，缺少证据时 proof 为 null。\n' + JSON.stringify(input));
      const results = officeModelList(response ?? '', z.object({ key: z.string(), proof: welinkCommitmentReviewSchema }).strict());
      if (!results.length || this.data?.account !== saved.account || await this.account() !== saved.account || this.data?.account !== saved.account) return;
      const offered = new Map(input.map(row => [row.key, row.context]));
      const checked = results.filter(row => offered.has(row.key) && (!row.proof || welinkCommitmentProof(row.proof, offered.get(row.key)!)));
      if (!checked.length) return;
      const reviews = { ...this.data.commitmentReviews, ...Object.fromEntries(checked.map(row => [row.key, row.proof])) };
      this.data.commitmentReviews = Object.fromEntries(Object.entries(reviews).slice(-2000));
      this.save();
      this.commitmentReview.changed();
    } finally { this.commitmentReviewsRunning.delete(saved.account); }
  }

  available(settings: WelinkReminderSettings): WelinkMessageReminder[] {
    if (!settings.enabled || !this.data || this.state.syncing || this.now() - this.lastAttempt > POLL_MS * 2) return [];
    const remaining = Math.max(0, 3 - Object.values(this.data.notified).filter(at => this.now() - at < 3600000).length);
    return this.status(settings).reminders.filter(item => !this.data!.notified[item.id] && this.collectedConversations.has(item.source.conversation) && (item.kind === 'keyword' || this.completeConversations.has(item.source.conversation))).slice(0, remaining);
  }
  notified(ids: string[]) { if (!this.data) return; for (const id of ids) this.data.notified[id] = this.now(); this.save(); }
  dismiss(id: string) { if (this.data) this.officeDismiss(this.data.account, id); }
  officeDismiss(account: string, id: string) {
    const saved = this.data?.account === account ? this.data : this.saved(account);
    if (!saved.dismissed.includes(id)) {
      const updated = { ...saved, dismissed: [...saved.dismissed, id].slice(-2000) };
      writeJsonAtomic(this.file(account), updated);
      if (this.data === saved) this.data = updated;
    }
  }
}
