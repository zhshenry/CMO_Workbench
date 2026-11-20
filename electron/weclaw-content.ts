import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { stripVTControlCharacters } from 'node:util';
import { chinaDay, dayMillis, nextDay, WELINK_OCCURRENCE_TOLERANCE as tolerance } from '../shared/welink-agenda';
import {
  normalizeMeetingTitle, type MeetingContent, type MeetingContentApi, type MeetingContentCandidate,
  type MeetingContentError, type MeetingContentQuery, type MeetingMaterial, type MeetingMaterialResult,
  type MeetingTranscriptQuery, type MeetingTranscriptSegment,
} from '../shared/weclaw-content';

const materials = ['minutes', 'transcript', 'notes'] as const;
const failureMessages: Record<MeetingContentError, string> = {
  generating: '会议内容正在生成。',
  'no-recording': '该场次暂无可读取的资料。',
  'no-permission': '当前账号无权读取这份会议内容。',
  'not-logged-in': '请登录员工助手并展开悬浮球后重试。',
  'request-failed': '暂时无法读取会议内容，请稍后重试。',
  unverified: '返回缺少可核对的场次信息。',
  unlinked: '该日程暂无已核验的会议系统记录。',
};

class ContentFailure extends Error {
  constructor(readonly status: MeetingContentError, message = failureMessages[status]) { super(message); }
}
const fail = (status: MeetingContentError, message?: string): MeetingMaterialResult => ({
  status, message: message ?? failureMessages[status],
});
const asFailure = (error: unknown): MeetingMaterialResult => error instanceof ContentFailure ? fail(error.status, error.message) : fail('request-failed');
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const id = (value: unknown) => typeof value === 'string' ? value.trim() : Number.isSafeInteger(value) ? String(value) : '';
const meetingId = (value: unknown) => /^[1-9]\d{0,19}$/.test(id(value)) ? id(value) : '';
const docId = (value: unknown) => /^[a-z0-9_-]{1,120}$/i.test(id(value)) ? id(value) : '';
const titleKey = (title: string) => normalizeMeetingTitle(title).toLowerCase().replace(/\s+/g, '');

function instant(value: unknown): number {
  if (typeof value === 'number' || typeof value === 'string' && /^\d{10}(?:\d{3})?$/.test(value)) {
    const number = Number(value), ms = number < 1e12 ? number * 1000 : number;
    return Number.isFinite(ms) && ms > 0 && ms <= 8.64e15 ? ms : NaN;
  }
  const date = text(value).replace(/[年/]/g, '-').replace('月', '-').replace('日', ' ');
  const local = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(:\d{2}(?:\.\d{1,3})?)?$/.exec(date);
  if (local) {
    const ms = Date.parse(local[1] + 'T' + local[2] + (local[3] || ':00') + '+08:00');
    return Number.isFinite(ms) && chinaDay(ms) === local[1] ? ms : NaN;
  }
  return /(?:Z|[+-]\d{2}:?\d{2})$/i.test(date) ? Date.parse(date) : NaN;
}

function failure(value: string): ContentFailure | undefined {
  if (/generating|生成中|转写中|处理中/i.test(value)) return new ContentFailure('generating');
  if (/no.?recording|录制不存在|未开启.*(?:录制|AI听)|无.{0,8}(?:录制|转写|逐字稿)|暂未生成逐字稿/i.test(value)) return new ContentFailure('no-recording');
  if (/\b403\b|forbidden|no.permission|permission denied|无权|权限不足/i.test(value)) return new ContentFailure('no-permission');
  if (/ENOENT|找不到.*weclaw-cli/i.test(value)) return new ContentFailure('not-logged-in', '未找到员工助手 CLI，请检查 CMO 安装或员工助手。');
  if (/ECONNREFUSED|connection refused|localhost:3008|127\.0\.0\.1:3008|actively refused/i.test(value)) {
    return new ContentFailure('not-logged-in', '请展开员工助手悬浮球后重试。');
  }
  if (/\b401\b|not.logged.in|unauthorized|登录失效|未登录|请登录/i.test(value)) return new ContentFailure('not-logged-in');
}

function decoded(raw: string): unknown {
  const value = stripVTControlCharacters(raw).trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(value);
  try { return JSON.parse(fenced?.[1] ?? value); } catch { return value; }
}

function payload(raw: string): unknown {
  let value = decoded(raw);
  for (let depth = 0; depth < 3; depth++) {
    const row = record(value);
    if (!row) break;
    const status = id(row.status ?? row.code);
    const error = [status, text(row.error), text(row.message), text(row.hint)].filter(Boolean).join(' ');
    if (error && (row.answer === undefined || /error|failed|^[45]\d\d$|generating|no.recording|no.permission|not.logged.in/i.test(status))) {
      if (/\b429\b|rate.?limit|限流/i.test(error)) throw Object.assign(new Error('员工助手读取过于频繁。'), { code: 429 });
      const known = failure(error);
      if (known) throw known;
      if (/error|failed|^[45]\d\d$/i.test(status)) throw new ContentFailure('request-failed');
    }
    if (!Object.hasOwn(row, 'answer')) break;
    value = typeof row.answer === 'string' ? decoded(row.answer) : row.answer;
  }
  if (typeof value === 'string' && !value.includes('\n')) {
    const known = failure(value);
    if (known) throw known;
  }
  return value;
}

function cliAccount(value: unknown): string {
  const row = record(value);
  if (row) {
    const direct = text(row.account ?? row.userAccount ?? row.user_account ?? row.uid ?? row.user_id ?? row.username);
    return direct ? direct.toLowerCase() : cliAccount(row.data ?? row.user);
  }
  return (/^(?:user\s+account|account|uid|工号|用户账号|账号|帐号)\s*[:：]\s*([^\s,;]+)\s*$/im.exec(text(value))?.[1] ?? '').toLowerCase();
}

interface Entry {
  subject: string;
  start: number;
  end: number;
  meetingId: string;
  docId: string;
  attachmentId?: string;
  body: string;
  format: 'text' | 'json';
  segments?: MeetingTranscriptSegment[];
}

function entry(row: Record<string, unknown>): Entry {
  const segments = row.segments ?? row.utterances ?? row.sentences;
  return {
    subject: text(row.subject ?? row.meeting_subject ?? row.meeting_name ?? row.title ?? row.docTitle ?? row.doc_title),
    start: instant(row.start_time ?? row.startTime ?? row.meeting_start_time ?? row.start),
    end: instant(row.end_time ?? row.endTime ?? row.meeting_end_time ?? row.end),
    meetingId: meetingId(row.meeting_id ?? row.meetingId),
    docId: docId(row.doc_id ?? row.docId ?? row.document_id),
    attachmentId: docId(row.attachment_id ?? row.attachmentId) || undefined,
    body: text(row.content ?? row.text ?? row.transcript ?? row.minutes ?? row.body),
    format: 'json',
    segments: Array.isArray(segments) ? segments.flatMap(item => {
      const line = record(item);
      const value = text(line?.text ?? line?.content ?? line?.sentence ?? item);
      const speaker = text(line?.speaker ?? line?.speaker_name ?? line?.user_name);
      const time = text(line?.time ?? line?.timestamp);
      return value ? [{ text: value, ...(speaker && { speaker }), ...(time && { time }) }] : [];
    }) : undefined,
  };
}

function formatted(value: string): Entry[] {
  const label = (line: string) => line.trim().replace(/^(?:[-*]\s+|#{1,6}\s+|\d+[.)、]\s*)/, '').replace(/\*\*/g, '');
  const blocks: string[][] = [];
  let block: string[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (/^(?:【(?:会议主题|会议名称|标题)】|(?:会议主题|会议名称|标题)[:：])/u.test(label(line)) && block.some(part => /会议时间|场次时间/.test(part))) {
      if (block.length) blocks.push(block);
      block = [];
    }
    block.push(line);
  }
  if (block.length) blocks.push(block);
  return blocks.flatMap(lines => {
    const fields: Record<string, unknown> = {};
    const body: string[] = [];
    let content = false;
    for (const line of lines) {
      const field = /^(?:【([^】]+)】|([^:：]+)[:：])\s*(.*)$/u.exec(label(line));
      const name = field?.[1] ?? field?.[2], value = field?.[3] ?? '';
      if (content) { body.push(line); continue; }
      if (['会议主题', '会议名称', '主题', '标题'].includes(name ?? '')) fields.subject = value;
      else if (name === 'meeting_id' || name === '会议主键') fields.meeting_id = value;
      else if (name === 'doc_id' || name === '文档ID') fields.doc_id = value;
      else if (name === 'attachment_id' || name === '附件ID') fields.attachment_id = value;
      else if (name === 'start_time' || name === '会议开始时间') fields.start_time = value;
      else if (name === 'end_time' || name === '会议结束时间') fields.end_time = value;
      else if (name === '会议时间' || name === '场次时间') {
        const time = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(?:\s*[-—–~至]\s*(?:(\d{4}-\d{2}-\d{2})[ T])?(\d{2}:\d{2}(?::\d{2})?))?/.exec(value);
        if (time) {
          fields.start_time = time[1] + ' ' + time[2];
          if (time[4]) fields.end_time = (time[3] ?? time[1]) + ' ' + time[4];
        }
      } else if (['会议纪要', '会议AI听', '逐字稿', '正文', '内容', '笔记'].includes(name ?? '')) {
        content = true;
        if (value) body.push(value);
      }
    }
    if (!Object.keys(fields).length) return [];
    return [{ ...entry({ ...fields, body: body.join('\n') }), format: 'text' }];
  });
}

function entries(value: unknown, depth = 0): Entry[] {
  if (depth > 3) return [];
  if (typeof value === 'string') return formatted(value);
  if (Array.isArray(value)) return value.flatMap(item => entries(item, depth + 1));
  const row = record(value);
  if (!row) return [];
  const found = entry(row);
  if (found.docId && !found.attachmentId && Array.isArray(row.attachments)) {
    const attachments = row.attachments.flatMap(attachment => {
      const item = record(attachment), attachmentId = docId(item?.attachment_id ?? item?.attachmentId ?? item?.id);
      if (!attachmentId) return [];
      const time = entry(item!);
      return [{ ...found, attachmentId, start: Number.isFinite(time.start) ? time.start : found.start, end: Number.isFinite(time.end) ? time.end : found.end }];
    });
    if (attachments.length) return attachments;
  }
  if (found.subject || found.meetingId || found.docId || Number.isFinite(found.start)) return [found];
  return entries(row.items ?? row.results ?? row.documents ?? row.list ?? row.records ?? row.data, depth + 1);
}

export interface WeclawMeetingTarget {
  account: string;
  subject: string;
  start: string;
  end: string;
  meetingId: string;
}
type Window = { subject: string; from: number; to: number; target?: WeclawMeetingTarget };
type ContentDependencies = {
  run(args: string[], timeoutMs: number, signal?: AbortSignal): Promise<string>;
  account(): Promise<string>;
  task(id: string): WeclawMeetingTarget | undefined;
  now?: () => number;
};
const shanghai = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const iso = (time: number) => new Date(time).toISOString();
const close = (a: number, b: number) => Math.abs(a - b) <= tolerance;
const candidateId = (row: Entry) => createHash('sha256').update(JSON.stringify([row.subject, row.start, row.end, row.meetingId, row.docId, row.attachmentId])).digest('hex').slice(0, 32);
const describe = (row: Entry): MeetingContentCandidate => ({
  id: candidateId(row), subject: row.subject, start: iso(row.start), ...(Number.isFinite(row.end) && { end: iso(row.end) }),
  ...(row.meetingId && { meetingId: row.meetingId }),
});

export class WeclawContentClient implements MeetingContentApi {
  private queue: Promise<unknown> = Promise.resolve();
  private cacheAccount = '';
  private readonly cache = new Map<string, { until: number; result: MeetingMaterialResult }>();
  constructor(private readonly deps: ContentDependencies) {}
  private now() { return (this.deps.now ?? Date.now)(); }

  private async invoke(args: string[], timeout: number, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      try { return payload(await this.deps.run(args, timeout, signal)); }
      catch (error) {
        signal.throwIfAborted();
        const message = error instanceof Error ? error.message : String(error);
        const code = (error as { code?: unknown } | null)?.code;
        if ((String(code) === '429' || /\b429\b|rate.?limit|限流/i.test(message)) && attempt < 2) {
          await delay(1000 * (attempt + 1), undefined, { signal });
          continue;
        }
        if (error instanceof ContentFailure) throw error;
        const known = failure(String(code ?? '') + ' ' + message);
        if (known) throw known;
        if (!attempt && /ETIMEDOUT|ECONNRESET|timeout|timed out|\b50[234]\b/i.test(message)) continue;
        throw new ContentFailure('request-failed');
      }
    }
  }

  private async verifiedAccount(signal: AbortSignal): Promise<string> {
    try {
      const owner = (await this.deps.account()).trim().toLowerCase();
      const account = cliAccount(await this.invoke(['whoami'], 5000, signal));
      if (!owner || !account) throw new ContentFailure('not-logged-in');
      if (owner !== account) throw new ContentFailure('no-permission', '员工助手和 WeLink 的登录账号不同，请切换到同一账号。');
      if (this.cacheAccount !== owner) { this.cache.clear(); this.cacheAccount = owner; }
      return owner;
    } catch (error) {
      this.cache.clear(); this.cacheAccount = '';
      throw error;
    }
  }

  private async read<T>(caller: AbortSignal | undefined, work: (account: string, signal: AbortSignal) => Promise<T>, finish?: (result: T) => T): Promise<T> {
    const deadline = AbortSignal.timeout(120_000), signal = caller ? AbortSignal.any([caller, deadline]) : deadline;
    const operation = this.queue.then(async () => {
      signal.throwIfAborted();
      const account = await this.verifiedAccount(signal), result = await work(account, signal);
      signal.throwIfAborted();
      if (await this.verifiedAccount(signal) !== account) throw new ContentFailure('no-permission', '读取期间登录账号已切换，请重试。');
      signal.throwIfAborted();
      return finish ? finish(result) : result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async material(kind: MeetingMaterial, window: Window, selection: string | undefined, signal: AbortSignal): Promise<MeetingMaterialResult> {
    const { subject, from, to, target } = window;
    const query = normalizeMeetingTitle(subject);
    const matchingTitle = (row: Entry) => target ? titleKey(row.subject) === titleKey(query) : titleKey(row.subject).includes(titleKey(query));
    const matchingTime = (row: Entry) => target
      ? close(row.start, Date.parse(target.start)) && (!Number.isFinite(row.end) || close(row.end, Date.parse(target.end)))
      : row.start >= from && row.start < to;
    const rows = entries(await this.invoke(kind === 'notes'
      ? ['wenote', 'list', '--page-size', '50', '--page-no', '1']
      : ['meeting', 'search-content', '--material-type', kind === 'minutes' ? '会议纪要' : '会议AI听',
        '--subject', query, '--start-date', shanghai.format(from), '--end-date', shanghai.format(to),
        '--return-type', kind === 'minutes' ? '文档全文' : '文档片段'], 30000, signal));
    const named = rows.filter(matchingTitle);
    const candidates = [...new Map(named.filter(row => matchingTime(row) && (
      kind === 'notes' ? !!row.docId : !target || !row.meetingId || row.meetingId === target.meetingId
    )).map(row => [candidateId(row), row])).values()];
    if (!candidates.length) {
      if (!rows.length || named.some(row => !Number.isFinite(row.start))) return fail('unverified');
      if (target && named.length === 1 && Number.isFinite(named[0].start) && !matchingTime(named[0])) return { status: 'wrong-session', actualTime: iso(named[0].start) };
      return fail('no-recording');
    }
    if (selection && !candidates.some(row => candidateId(row) === selection)) return fail('unverified', '所选场次已变化，请重新读取候选。');
    if (!selection && (candidates.length > 1 || titleKey(candidates[0].subject) !== titleKey(query))) return { status: 'candidates', candidates: candidates.slice(0, 30).map(describe) };
    const chosen = selection ? candidates.find(row => candidateId(row) === selection)! : candidates[0];
    if (kind === 'minutes') return this.ready(chosen);
    if (kind === 'transcript') {
      const lookupId = chosen.meetingId || target?.meetingId;
      return lookupId ? this.transcript(lookupId, chosen.start, chosen.end, signal, target) : fail('unverified');
    }
    if (!chosen.attachmentId) return fail('unverified', '笔记列表缺少可核对的录音附件标识。');
    const notes = entries(await this.invoke(['wenote', 'get', '--doc-id', chosen.docId, '--attachment-id', chosen.attachmentId], 60000, signal));
    if (notes.length !== 1 || notes[0].docId !== chosen.docId || notes[0].attachmentId !== chosen.attachmentId) return fail('unverified');
    if (Number.isFinite(notes[0].start) && (!close(notes[0].start, chosen.start) || !matchingTime(notes[0]))) return { status: 'wrong-session', actualTime: iso(notes[0].start) };
    return this.ready({ ...notes[0], start: chosen.start });
  }

  private ready(row: Entry): MeetingMaterialResult {
    const body = row.body || row.segments?.map(segment => [segment.time, segment.speaker, segment.text].filter(Boolean).join(' ')).join('\n');
    return body && Number.isFinite(row.start)
      ? { status: 'ready', start: iso(row.start), fetchedAt: this.now(), format: row.format, text: body, ...(row.segments?.length && { segments: row.segments }) }
      : fail('unverified');
  }

  private async transcript(lookupId: string, expectedStart: number, expectedEnd: number, signal: AbortSignal, target?: WeclawMeetingTarget): Promise<MeetingMaterialResult> {
    const rows = entries(await this.invoke(['meeting', 'get-asr', '--meeting-id', lookupId], 60000, signal));
    if (rows.length !== 1 || !Number.isFinite(rows[0].start)) return fail('unverified');
    const result = rows[0];
    if (!close(result.start, expectedStart) || target && !close(result.start, Date.parse(target.start))
      || Number.isFinite(result.end) && (Number.isFinite(expectedEnd) && !close(result.end, expectedEnd) || target && !close(result.end, Date.parse(target.end)))) {
      return { status: 'wrong-session', actualTime: iso(result.start) };
    }
    if (result.meetingId !== lookupId) return fail('unverified');
    return this.ready(result);
  }

  async meetingContent(query: MeetingContentQuery, caller?: AbortSignal): Promise<MeetingContent> {
    const kinds = query.material ? [query.material] : materials;
    const resultFor = (result: MeetingMaterialResult): MeetingContent => Object.fromEntries(kinds.map(kind => [kind, result]));
    let target: WeclawMeetingTarget | undefined;
    const fresh = new Map<string, MeetingMaterialResult>();
    try {
      return await this.read(caller, async (account, signal) => {
        let window: Window;
        if (query.taskId) {
          target = this.deps.task(query.taskId);
          if (!target) return resultFor(fail('unlinked'));
          if (target.account.toLowerCase() !== account) return resultFor(fail('no-permission'));
          const start = Date.parse(target.start), end = Date.parse(target.end);
          if (!meetingId(target.meetingId) || !normalizeMeetingTitle(target.subject) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return resultFor(fail('unlinked'));
          window = { subject: target.subject, from: start - tolerance, to: end + tolerance, target };
        } else {
          const day = query.date!, from = dayMillis(day);
          if (!Number.isFinite(from) || chinaDay(from) !== day || !normalizeMeetingTitle(query.subject!)) return resultFor(fail('unverified', '请指定有效的会议主题和日期。'));
          window = { subject: query.subject!, from, to: dayMillis(nextDay(day)) };
        }
        const result: MeetingContent = {};
        for (const kind of kinds) {
          const key = JSON.stringify([account, kind, window, query.candidate]);
          const cached = this.cache.get(key);
          if (!query.refresh && cached && cached.until > this.now()) { result[kind] = cached.result; continue; }
          const read = await this.material(kind, window, query.candidate, signal).catch(asFailure);
          result[kind] = read;
          if (read.status === 'ready' && read.text.length <= 1024 * 1024 || read.status === 'generating' || read.status === 'no-recording') fresh.set(key, read);
        }
        return result;
      }, result => {
        if (query.taskId && JSON.stringify(this.deps.task(query.taskId)) !== JSON.stringify(target)) return resultFor(fail('unverified', '读取期间日程已变化，请重试。'));
        for (const [key, material] of fresh) {
          if (this.cache.size >= 20) this.cache.delete(this.cache.keys().next().value!);
          this.cache.set(key, { until: this.now() + (material.status === 'generating' ? 120_000 : 600_000), result: material });
        }
        return result;
      });
    } catch (error) { caller?.throwIfAborted(); return resultFor(asFailure(error)); }
  }

  async meetingTranscript(query: MeetingTranscriptQuery, caller?: AbortSignal): Promise<MeetingMaterialResult> {
    try {
      return await this.read(caller, (_account, signal) => this.transcript(String(query.meetingId), instant(query.expectedStart), NaN, signal));
    } catch (error) { caller?.throwIfAborted(); return asFailure(error); }
  }
}
