import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { officeTodoSchema, type OfficeItem, type OfficeMaterial, type OfficeMaterialRow, type OfficeSnapshot } from '../shared/office-workbench';
import type { WelinkSyncStatus } from '../shared/island-contracts';
import type { Task } from '../shared/todo-contracts';
import { chinaDay, dayMillis, nextDay, welinkAccount, welinkSourceName } from '../shared/welink-agenda';
import { welinkDisplayTasks } from '../shared/welink-display';
import type { WelinkMessage, WelinkMessageStatus, WelinkReminderSettings } from '../shared/welink-reminders';
import { isWelinkWorkCommitment, isWelinkWorkRequest, welinkWorkDate, WELINK_MESSAGE_WINDOW_MS, type WelinkMessageReminders } from './welink-message-reminders';
import { welinkError } from './welink-agenda';

const mailLimit = 50;
const messageScope = '近 36 小时 · 最近 20 个会话 · 每会话每轮最多 100 条';
const mailScope = '收件箱 · 近 36 小时 · 最多 50 封';
const agendaScope = '日程待办 · 昨天至未来 7 天';
const hash = (...parts: string[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32);
const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const mailSchema = z.object({
  id: z.string().min(1).max(4096), title: z.string().max(500), sender: z.string().max(300), receivedAt: z.number().nullable(),
  unread: z.boolean(), text: z.string().max(12000).optional(), capturedAt: z.number().optional(),
});
type Mail = z.infer<typeof mailSchema>;
const savedSchema = z.object({
  key: z.string(), lastMailAt: z.number().nullable(), mailRangeStart: z.number().optional(), mailPartial: z.boolean(),
  mailError: z.string(), mails: z.array(mailSchema).max(mailLimit), dismissed: z.record(z.string(), z.number()),
});
type Saved = z.infer<typeof savedSchema>;
type Identity = { uid: string; key: string };
type Board = { snapshot: OfficeSnapshot; details: Map<string, OfficeMaterial>; mailIds: Map<string, Mail> };

function receivedTime(value: unknown): number | null {
  const date = string(value);
  if (!date) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/.test(date) ? date.replace(' ', 'T') + '+08:00' : date;
  const at = Date.parse(normalized);
  return Number.isFinite(at) ? at : null;
}

function mailRows(raw: string): unknown[] {
  try {
    const value: unknown = JSON.parse(raw);
    const outer = record(value), inner = record(outer.data);
    if (outer.error || outer.success === false || typeof outer.code === 'number' && ![0, 200].includes(outer.code)) throw new Error('邮箱查询返回失败。');
    const rows = [value, outer.items, outer.messages, outer.data, inner.items, inner.messages].find(Array.isArray);
    if (Array.isArray(rows)) return rows;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  // Some bundled CLI versions render mail list as a headered text table.
  const lines = raw.split(/\r?\n/).filter(line => line.trim());
  const split = (line: string) => line.includes('|') ? line.trim().replace(/^\||\|$/g, '').split(/\s*\|\s*/).map(value => value.trim()) : line.trim().split(/\t+| {2,}/);
  const header = lines.findIndex(line => /ItemId/i.test(line) && /Subject/i.test(line));
  if (header < 0) throw new Error('邮箱列表格式无法识别，已保留原记录。');
  const keys = split(lines[header]);
  const rows = lines.slice(header + 1).filter(line => !/^[-+| =\t]+$/.test(line) && !/^(Total|Showing)\b/i.test(line.trim()));
  return rows.map(line => {
    const values = split(line);
    if (keys.length !== values.length) throw new Error('邮箱列表未能完整读取，已保留原记录。');
    return Object.fromEntries(keys.map((key, index) => [key, values[index]]));
  });
}

export function parseOfficeMailList(raw: string): Mail[] {
  return mailRows(raw).map(value => {
    const fields = Object.fromEntries(Object.entries(record(value)).map(([key, field]) => [key.toLowerCase(), field]));
    const from = fields.from ?? fields.sender;
    const sender = record(record(from).emailAddress);
    const id = string(fields.itemid ?? fields.id);
    return mailSchema.parse({
      id, title: string(fields.subject).slice(0, 500) || '无主题',
      sender: (string(from) || string(record(from).name) || string(sender.name) || string(record(from).email ?? record(from).address ?? sender.address) || '发件人未提供').slice(0, 300),
      receivedAt: receivedTime(fields.datetimereceived ?? fields.receiveddatetime ?? fields.receivedtime ?? fields.receivedat ?? fields.received ?? fields.date),
      unread: fields.isread === false || fields.isread === 0 || /^n|^false$|^0$|未读/i.test(string(fields.isread ?? fields.read)),
    });
  });
}

function mailBody(raw: string): string {
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    const text = raw.match(/(?:^|\r?\n)(?:Body|正文)\s*[:：]\s*([\s\S]*)$/i);
    if (!text) throw new Error('未取得邮件正文。');
    return text[1].trim().slice(0, 12000);
  }
  const outer = record(value), item = record(outer.data ?? outer.item ?? outer);
  const body = item.body ?? item.textBody;
  if (outer.error || outer.success === false || typeof body !== 'string' && typeof record(body).content !== 'string' && typeof record(body).text !== 'string') {
    throw new Error('未取得邮件正文。');
  }
  return string(typeof body === 'string' ? body : record(body).content ?? record(body).text).slice(0, 12000);
}

export function officeDeadline(text: string, at: number): string | null {
  const labels = text.matchAll(/今天|今晚|明天|后天|(?:下周|本周|这周|周|星期)[一二三四五六日天]|(?:(?:20\d{2})[年/-])?\d{1,2}[月/-]\d{1,2}日?/g);
  const dates = new Set([...labels].map(match => welinkWorkDate(match[0], at)).filter((date): date is string => !!date));
  if (dates.size !== 1) return null;
  const day = dates.values().next().value!;
  const cutoffs = [...text.matchAll(/(?:^|[^\d])(?:(上午|下午|晚上|今晚|凌晨|中午)\s*)?(\d{1,2})[:：](\d{2})\s*(?:之前|以前|前|截止)/g)];
  if (!cutoffs.length) return day;
  const times = new Set(cutoffs.map(([, period, hours, minutes]) => {
    const hour = Number(hours);
    if (hour === 12 && (period === '今晚' || period === '晚上' || period === '凌晨')) return '';
    const offset = hour < 12 && ['下午', '晚上', '今晚', '中午'].includes(period) ? 12 : 0;
    return String(hour + offset).padStart(2, '0') + ':' + minutes;
  }));
  const time = times.values().next().value!;
  if (times.size !== 1 || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return new Date(day + 'T' + time + ':00+08:00').toISOString();
}

const normalizeTitle = (text: string) => text.normalize('NFKC').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
const actionWord = /补|提交|发(?:送|给)?|确认|更新|整理|提供|交付|完成|回复|看一下|核对|安排|负责|同步|处理|给我/;
function actionTitle(text: string) {
  const clauses = text.split(/[，,。！？!?\n；;]/).map(value => value.trim()).filter(Boolean);
  const first = clauses[0];
  return (clauses.reverse().find(clause => actionWord.test(clause)) ?? first ?? '核对工作事项')
    .replace(/^(?:@\S+\s+)?(?:\d{1,2}[:：]\d{2}\s*(?:之前|以前|前)\s*)?(?:请|麻烦|能否|能不能|能|方便)?\s*/, '')
    .replace(/一下/g, '').replace(/[吗么吧]$/, '').trim().slice(0, 100) || '核对工作事项';
}

export function officeItems(threads: Iterable<WelinkMessage[]>, messageRows: Map<string, OfficeMaterialRow>, mails: { mail: Mail; source: OfficeMaterialRow }[], meetings: OfficeMaterial[], dismissed: Readonly<Record<string, number>>, now: number): OfficeItem[] {
  const items: OfficeItem[] = [];
  const relatedMeeting = (text: string, deadline: string | null) => {
    const content = normalizeTitle(text);
    const matches = meetings.filter(meeting => { const title = normalizeTitle(meeting.title); return title.length >= 3 && content.includes(title); });
    const day = deadline?.slice(0, 10);
    const dated = day && matches.filter(item => item.at !== null && chinaDay(item.at) === (deadline!.includes('T') ? chinaDay(Date.parse(deadline!)) : day));
    return dated && dated.length === 1 ? dated[0] : matches.length === 1 ? matches[0] : undefined;
  };
  const add = (kind: OfficeItem['kind'], source: OfficeMaterialRow, text: string, reason: string) => {
    const id = hash(source.id, kind);
    if (dismissed[id]) return;
    const deadline = source.at === null ? null : officeDeadline(text, source.at);
    const related = relatedMeeting(text, deadline);
    items.push({ id, kind, title: actionTitle(text), deadline, reason, source: { id: source.id, label: source.label },
      ...(related && { related: { id: related.id, label: related.label, title: related.title, at: related.at } }) });
  };
  for (const messages of threads) {
    const last = messages.at(-1)!;
    let unanswered: WelinkMessage | undefined = last.group ? undefined : last;
    if (last.group) {
      for (let index = messages.length - 1; index >= 0; index--) {
        const message = messages[index];
        if (message.mine) break;
        if (message.atMe && isWelinkWorkRequest(message.text)) { unanswered = message; break; }
      }
    }
    if (unanswered && !unanswered.mine && isWelinkWorkRequest(unanswered.text)) {
      add('awaiting', messageRows.get(unanswered.conversation + ':' + unanswered.id)!, unanswered.text, '近期材料里有向你提出的问题或请求，暂未看到你在这个会话里的后续回复。');
    }
    for (const message of messages) {
      if (!message.mine || !isWelinkWorkCommitment(message.text) || !actionWord.test(message.text)) continue;
      if (messages.some(later => later.mine && later.at > message.at && /已发|已经发|已提交|已经提交|已完成/.test(later.text) && normalizeTitle(later.text).includes(normalizeTitle(actionTitle(message.text)).slice(-4)))) continue;
      add('commitment', messageRows.get(message.conversation + ':' + message.id)!, message.text, '原话识别到你承担的事项，交付状态需要核对。');
    }
  }
  for (const { mail, source } of mails) {
    if (!mail.unread) continue;
    const text = [mail.title, mail.text?.slice(0, 800)].filter(Boolean).join('。');
    if (/(?:请|麻烦|务必|需要您|需要你).{0,32}(?:回复|确认|提交|发|补|提供|完成|处理)/.test(text)) {
      add('mail', source, text, '收件箱里的未读邮件有明确请求，回复和处理状态需要核对。');
    }
  }
  const today = chinaDay(now);
  const priorityAt = (item: OfficeItem) => item.deadline
    ? item.deadline.includes('T') ? Date.parse(item.deadline) : dayMillis(nextDay(item.deadline))
    : item.related?.at ?? Number.MAX_SAFE_INTEGER;
  const beforeTodayMeeting = (item: OfficeItem) => item.related?.at != null && chinaDay(item.related.at) === today;
  return items.sort((a, b) => priorityAt(a) - priorityAt(b) || Number(beforeTodayMeeting(b)) - Number(beforeTodayMeeting(a)));
}

export class OfficeWorkbench {
  private pending: { key: string; result: Promise<OfficeSnapshot> } | undefined;
  private readonly mailReads = new Map<string, Promise<Mail>>();
  private messageResult: { key: string; attemptAt: number; status: WelinkMessageStatus } | undefined;
  constructor(private readonly dir: string, private readonly deps: {
    account(): Promise<string | undefined>;
    email(): string;
    messages: Pick<WelinkMessageReminders, 'officeSnapshot' | 'refresh'>;
    messageSettings(): WelinkReminderSettings;
    tasks(): Task[];
    agenda(uid: string): WelinkSyncStatus;
    run(args: string[]): Promise<string>;
    now?: () => number;
  }) {}

  private now() { return (this.deps.now ?? Date.now)(); }
  private async identity(): Promise<Identity> {
    const uid = await this.deps.account().catch(() => undefined) ?? '';
    return { uid, key: hash(uid.toLowerCase(), this.deps.email().trim().toLowerCase()) };
  }
  private path(key: string) { return join(this.dir, 'office-workbench-' + key + '.json'); }
  private load(key: string): Saved {
    const path = this.path(key);
    if (!existsSync(path)) return { key, lastMailAt: null, mailPartial: false, mailError: '', mails: [], dismissed: {} };
    const saved = savedSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (saved.key !== key) throw new Error('办公资料缓存账号不符。');
    return saved;
  }
  private save(saved: Saved) { writeJsonAtomic(this.path(saved.key), saved); }

  private board(identity: Identity): Board {
    const now = this.now(), day = chinaDay(now), since = now - WELINK_MESSAGE_WINDOW_MS;
    const details = new Map<string, OfficeMaterial>(), threads = new Map<string, WelinkMessage[]>(), mailIds = new Map<string, Mail>();
    const coverage: OfficeSnapshot['coverage'] = {
      messages: { state: identity.uid ? 'unread' : 'unavailable', lastSuccessAt: null, scope: messageScope },
      mail: { state: identity.uid ? 'unread' : 'unavailable', lastSuccessAt: null, scope: mailScope },
      agenda: { state: 'fresh', lastSuccessAt: null, scope: agendaScope },
    };
    let saved: Saved | null = null;
    if (identity.uid) try { saved = this.load(identity.key); }
    catch (error) { coverage.mail = { state: 'unavailable', lastSuccessAt: null, scope: mailScope, detail: welinkError(error) }; }
    const messageRows = new Map<string, OfficeMaterialRow>();
    if (identity.uid) {
      try {
        const cache = this.deps.messages.officeSnapshot(identity.uid), attempt = this.messageResult?.key === identity.key ? this.messageResult : undefined;
        const recent = attempt?.status;
        coverage.messages = { scope: messageScope, lastSuccessAt: cache.lastReadAt,
          state: !cache.lastReadAt && !cache.messages.length ? recent?.error ? 'unavailable' : 'unread'
            : recent?.error && (cache.lastReadAt ?? 0) < attempt!.attemptAt ? 'cached' : cache.partial ? 'partial' : cache.lastReadAt ? 'fresh' : 'cached',
          ...(recent?.error && { detail: recent.error }),
        };
        for (const message of cache.messages) {
          const thread = threads.get(message.conversation) ?? [];
          thread.push(message); threads.set(message.conversation, thread);
        }
        for (const messages of threads.values()) {
          messages.sort((a, b) => a.at - b.at || (BigInt(a.id) < BigInt(b.id) ? -1 : BigInt(a.id) > BigInt(b.id) ? 1 : 0));
          for (const [index, message] of messages.entries()) {
            const material: OfficeMaterial = {
              id: hash(identity.uid.toLowerCase(), message.conversation, message.id), kind: message.group ? 'group' : 'direct',
              label: message.group ? '查看群消息' : '查看私聊原话', title: message.conversationName,
              byline: message.mine ? '我' : message.sender, at: message.at, text: message.text, preview: message.text.slice(0, 100), capturedAt: cache.lastReadAt,
              context: messages.slice(Math.max(0, index - 2), index + 3).filter(other => other !== message)
                .map(other => ({ at: other.at, sender: other.mine ? '我' : other.sender, text: other.text })),
            };
            details.set(material.id, material);
            messageRows.set(message.conversation + ':' + message.id, material);
          }
        }
      } catch (error) { coverage.messages = { state: 'unavailable', scope: messageScope, lastSuccessAt: null, detail: welinkError(error) }; }
    }
    const mails = (saved?.mails ?? []).filter(mail => mail.receivedAt === null || mail.receivedAt >= (saved?.mailError ? saved.mailRangeStart ?? since : since)).map(mail => {
      const id = hash(identity.key, 'mail', mail.id);
      const material: OfficeMaterial = { id, kind: 'mail', label: '查看邮件原文', title: mail.title, byline: mail.sender, at: mail.receivedAt, text: mail.text ?? '', capturedAt: mail.capturedAt ?? saved!.lastMailAt,
        ...(mail.text === undefined && { note: '当前已保存邮件列表，展开时读取正文。' }) };
      details.set(id, material); mailIds.set(id, mail);
      return { mail, source: material };
    });
    if (saved) coverage.mail = { scope: mailScope, lastSuccessAt: saved.lastMailAt,
      state: saved.mailError ? saved.lastMailAt ? 'cached' : 'unavailable' : !saved.lastMailAt ? 'unread' : saved.mailPartial ? 'partial' : 'fresh',
      ...(saved.mailError && { detail: saved.mailError }),
      ...(saved.mailError && saved.lastMailAt && { scope: '上次成功读取的收件箱快照 · 最多 50 封' }) };

    const agenda = this.deps.agenda(identity.uid), from = dayMillis(nextDay(day, -1)), through = dayMillis(nextDay(day, 8));
    const meetings: OfficeMaterial[] = [];
    const starts = new Map<string, number>();
    const relevant = this.deps.tasks().filter(task => {
      if (task.kind !== 'meeting' || task.deletedAt || !task.dateAt) return false;
      if (task.source === 'welink' && (!identity.uid || !task.external || welinkAccount(task.external) !== identity.uid.toLowerCase())) return false;
      const start = task.dateAt.includes('T') ? Date.parse(task.dateAt) : dayMillis(task.dateAt);
      const end = task.endAt ? Date.parse(task.endAt) : start + 1;
      if (!Number.isFinite(start) || start >= through || end <= from) return false;
      starts.set(task.id, start);
      return true;
    });
    for (const task of welinkDisplayTasks(relevant)) {
      const providers = task.displaySources?.map(source => welinkSourceName(source.external.provider)) ?? [task.external ? welinkSourceName(task.external.provider) : '本地日程'];
      const id = hash('meeting', task.id);
      const material: OfficeMaterial = { id, kind: 'meeting', label: '查看会议来源', title: task.title, byline: providers.join(' + '), at: starts.get(task.id) ?? null,
        text: task.note, capturedAt: task.source === 'welink' ? agenda.lastSuccessAt : null, meeting: { taskId: task.id, dateAt: task.dateAt!, endAt: task.endAt ?? null, providers } };
      meetings.push(material); details.set(id, material);
    }
    coverage.agenda = { scope: agendaScope, lastSuccessAt: agenda.lastSuccessAt, state: agenda.error ? agenda.lastSuccessAt ? 'cached' : 'partial' : 'fresh',
      ...(agenda.error && { detail: '外部日程有来源未更新，已显示当前可用日程。' }) };
    const items = officeItems(threads.values(), messageRows, mails.filter(({ mail }) => mail.receivedAt !== null && mail.receivedAt >= since), meetings, saved?.dismissed ?? {}, now);
    const endOfDay = dayMillis(nextDay(day));
    const priorities = items.filter(item => !item.deadline || (item.deadline.includes('T') ? Date.parse(item.deadline) < endOfDay : item.deadline <= day)
      || (item.related?.at ?? Infinity) < endOfDay).slice(0, 5).map(item => item.id);
    const schedule = meetings.filter(item => (item.at ?? 0) < endOfDay && (item.meeting!.endAt ? Date.parse(item.meeting!.endAt) : (item.at ?? 0) + 1) > dayMillis(day))
      .sort((a, b) => a.at! - b.at!).map(item => item.id);
    const materials = [...details.values()].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).map(({ id, label, kind, title, byline, at, preview }) => ({ id, label, kind, title, byline, at, preview }));
    return { snapshot: { day, connected: !!identity.uid, coverage, materials, items, brief: { priorities, meetings: schedule } }, details, mailIds };
  }

  async state(): Promise<OfficeSnapshot> { return this.board(await this.identity()).snapshot; }
  async refresh(): Promise<OfficeSnapshot> {
    const identity = await this.identity();
    if (!identity.uid) return this.board(identity).snapshot;
    if (this.pending?.key === identity.key) return this.pending.result;
    const result = this.refreshIdentity(identity);
    this.pending = { key: identity.key, result };
    try { return await result; } finally { if (this.pending?.result === result) this.pending = undefined; }
  }

  private async refreshIdentity(identity: Identity): Promise<OfficeSnapshot> {
    const attemptAt = this.now(), until = nextDay(chinaDay(attemptAt)), since = attemptAt - WELINK_MESSAGE_WINDOW_MS;
    const [messages, mailbox] = await Promise.allSettled([
      this.deps.messages.refresh({ ...this.deps.messageSettings(), enabled: true }, true),
      this.deps.run(['mail', 'list', '--folder-id', 'inbox', '--start', chinaDay(since), '--end', until, '--max', String(mailLimit)]).then(parseOfficeMailList),
    ]);
    const current = await this.identity();
    if (current.key !== identity.key) return this.board(current).snapshot;
    if (messages.status === 'fulfilled') this.messageResult = { key: identity.key, attemptAt, status: messages.value };
    const saved = this.load(identity.key);
    if (mailbox.status === 'fulfilled') {
      const prior = new Map(saved.mails.map(mail => [mail.id, mail]));
      saved.mails = [...new Map(mailbox.value.filter(mail => mail.receivedAt === null || mail.receivedAt >= since).map(mail => [mail.id, { ...prior.get(mail.id), ...mail }])).values()].slice(0, mailLimit);
      saved.lastMailAt = this.now();
      saved.mailRangeStart = since;
      saved.mailPartial = mailbox.value.length >= mailLimit;
      saved.mailError = '';
    } else saved.mailError = welinkError(mailbox.reason);
    saved.dismissed = Object.fromEntries(Object.entries(saved.dismissed).filter(([, at]) => at >= since));
    this.save(saved);
    return this.board(current).snapshot;
  }

  async material(id: string, fetchMail = true): Promise<OfficeMaterial> {
    const identity = await this.identity(), board = this.board(identity), material = board.details.get(id), mail = board.mailIds.get(id);
    if (!material) throw new Error('这条资料不在当前账号或当前读取范围内。');
    if (!mail || mail.text !== undefined || !fetchMail) return material;
    try {
      const key = identity.key + ':' + id;
      let pending = this.mailReads.get(key);
      if (!pending) {
        pending = this.readMail(identity, mail.id).finally(() => this.mailReads.delete(key));
        this.mailReads.set(key, pending);
      }
      const loaded = await pending;
      return { ...material, text: loaded.text ?? '', capturedAt: loaded.capturedAt ?? null, note: undefined };
    } catch (error) {
      if ((await this.identity()).key !== identity.key) throw new Error('当前账号已变化，请重新打开资料。');
      return { ...material, note: '邮件正文读取失败 · ' + welinkError(error) };
    }
  }
  private async readMail(identity: Identity, id: string): Promise<Mail> {
    const text = mailBody(await this.deps.run(['mail', 'get', '--item-id', id, '--body-type', 'Text']));
    if ((await this.identity()).key !== identity.key) throw new Error('邮箱账号已变化。');
    const saved = this.load(identity.key), index = saved.mails.findIndex(mail => mail.id === id);
    if (index < 0) throw new Error('邮件已不在当前快照范围内。');
    const mail = { ...saved.mails[index], text, capturedAt: this.now() };
    saved.mails[index] = mail;
    this.save(saved);
    return mail;
  }

  async dismiss(id: string): Promise<OfficeSnapshot> {
    const identity = await this.identity(), board = this.board(identity);
    if (!identity.uid || !board.snapshot.items.some(item => item.id === id)) throw new Error('待处理事项已变化，请刷新后重试。');
    const saved = this.load(identity.key);
    saved.dismissed[id] = this.now();
    this.save(saved);
    return this.board(identity).snapshot;
  }

  async todo(id: string) {
    const board = this.board(await this.identity()), item = board.snapshot.items.find(item => item.id === id);
    if (!item) throw new Error('待处理事项已变化，请刷新后重试。');
    return officeTodoSchema.parse({ itemId: id, title: item.title, dateAt: item.deadline, source: item.source });
  }
}
