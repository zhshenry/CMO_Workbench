import { parseAuthStatus, welinkConnectionFailure, WelinkConnectionError, type WelinkAuthState } from './welink-auth';
export { welinkConnectionFailure } from './welink-auth';
import { agendaRange, dayMillis, nextDay, welinkAccount, type WelinkAgenda, type WelinkCalendarDetails, type WelinkEvent, type WelinkEventDetails, type WelinkSourceStatus } from '../shared/welink-agenda';
import { AppSettingsSchema } from '../shared/contracts';

export type WelinkRunner = (args: string[], timeout?: number) => Promise<string>;
const PAGE_SIZE = 30;
const CALENDAR_MAX = 500;
const MAILBOX_RETRY_MS = 10 * 60_000;
const needsMailbox = (error: unknown): boolean => /exchange server domain not found|(?:please|first|must|未|尚未|需要|先)[\s\S]*(?:autodiscover|邮箱.*配置)|(?:EWS|mailbox|mail service)[\s\S]*(?:not (?:configured|initialized)|未配置|未初始化)/i.test(String(error));
class MailboxSetupError extends Error {}
const idle = (): WelinkSourceStatus => ({ state: 'idle', count: 0, lastSuccessAt: null, error: '' });
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('返回结构无法识别，已保留原有日程。');
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const webUrl = (value: unknown): string => {
  const url = text(value).trim();
  try { return ['https:', 'http:'].includes(new URL(url).protocol) ? url : ''; } catch { return ''; }
};

function detailFields(item: Record<string, unknown>, subject: string): WelinkCalendarDetails {
  return {
    subject, location: text(item.location), organizer: text(item.organizer), organizerEmail: text(item.organizerEmail),
    requiredAttendees: strings(item.requiredAttendees), optionalAttendees: strings(item.optionalAttendees),
    body: text(item.body).slice(0, 10000), onlineMeetingUrl: webUrl(item.onlineMeetingUrl), isAllDay: item.isAllDay === true, isCancelled: item.isCancelled === true,
  };
}
const required = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`日程缺少 ${field}，本次结果不完整。`);
  return value;
};
const timestamp = (value: unknown, allDay = false): string => {
  const raw = required(value, '时间');
  const sourceDay = new Date(`${raw.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(sourceDay.getTime()) || sourceDay.toISOString().slice(0, 10) !== raw.slice(0, 10)) throw new Error('日程日期无效，本次结果不完整。');
  const iso = allDay && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00+08:00` : raw;
  if (!/(?:Z|[+-]\d{2}:\d{2})$/.test(iso) || !Number.isFinite(Date.parse(iso))) throw new Error('日程时间或时区无效，本次结果不完整。');
  return new Date(iso).toISOString();
};
export const welinkError = (error: unknown): string => (error instanceof Error ? error.message : String(error))
  .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
  .replace(/((?:token|password|cookie|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[已隐藏]')
  .replace(/https?:\/\/[^\s]+/gi, '[服务地址]').slice(0, 400);

/** Only the two known sources; a failed or truncated response is never an empty snapshot. */
export class WelinkAgendaClient {
  private queue: Promise<unknown> = Promise.resolve();
  private mailboxFailure?: { account: string; email: string; retryAt: number; error: MailboxSetupError };
  constructor(private run: WelinkRunner, private now = Date.now, private pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
    private authStatus?: () => Promise<WelinkAuthState>) {}

  private request(args: string[]): Promise<string> {
    const request = this.queue.then(async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          const raw = await this.run(args, 30000);
          let response: { code?: unknown; message?: unknown } | undefined;
          try { response = JSON.parse(raw); } catch { /* autodiscover/auth return text */ }
          const code = response?.code;
          if (code === 429) throw new Error('HTTP 429：服务限流');
          if (typeof code === 'number' && code !== 200) {
            const message = response?.message;
            throw new Error(`服务查询失败：${typeof message === 'string' ? message : text(message && typeof message === 'object' ? (message as Record<string, unknown>).message : '') || code}`);
          }
          return raw;
        } catch (error) {
          if (attempt >= 2 || !/\b429\b|too many requests|限流/i.test(String(error))) throw error;
          await this.pause(1000 * 2 ** attempt);
        }
      }
    });
    this.queue = request.catch(() => {});
    return request;
  }

  async account(): Promise<string> {
    let auth: WelinkAuthState;
    try { auth = this.authStatus ? await this.authStatus() : parseAuthStatus(await this.request(['auth', 'status'])); }
    catch (error) {
      const auth = welinkConnectionFailure(error);
      throw new WelinkConnectionError(auth.connection, auth.connection === 'temporary' ? welinkError(error) : auth.reason!);
    }
    if (auth.connection !== 'ready') throw new WelinkConnectionError(auth.connection, auth.reason!);
    if (!auth.uid) throw new WelinkConnectionError('temporary', 'WeLink 未返回当前登录账号，请稍后重试。');
    return auth.uid.toLowerCase();
  }

  async query(start: string, end: string, email: string | ((account: string) => string), retryMailbox = false): Promise<WelinkAgenda> {
    agendaRange(start, end);
    const account = await this.account();
    const savedEmail = typeof email === 'function' ? email(account) : email;
    const result: WelinkAgenda = { start, end, account, events: [], sources: { calendar: idle(), meeting: idle() } };
    for (const provider of ['calendar', 'meeting'] as const) {
      const events: WelinkEvent[] = [];
      try {
        if (provider === 'calendar') await this.calendar(start, end, account, savedEmail, events, retryMailbox);
        else await this.meetings(start, end, account, events);
        result.sources[provider] = { state: 'success', count: events.filter(e => !e.cancelled).length, lastSuccessAt: this.now(), error: '' };
      } catch (error) {
        result.sources[provider] = { state: events.length ? 'partial' : 'error', count: events.filter(e => !e.cancelled).length, lastSuccessAt: null, error: welinkError(error), ...(error instanceof MailboxSetupError ? { mailboxNeedsSetup: true } : {}) };
      }
      result.events.push(...events);
    }
    return result;
  }

  private async calendar(start: string, end: string, account: string, email: string, events: WelinkEvent[], retryMailbox: boolean): Promise<void> {
    const seen = new Map<string, string>();
    for (let day = start; day < end; day = nextDay(day)) {
      const raw = await this.calendarRequest(['calendar', '--tz', 'China Standard Time', 'list', '--start', day, '--end', nextDay(day), '--max', String(CALENDAR_MAX)], account, email, retryMailbox);
      if (raw.trim() === 'No events found.') continue;
      const rows: unknown = JSON.parse(raw);
      if (!Array.isArray(rows)) throw new Error('邮箱日历未返回 JSON 数组，请检查邮箱连接或 CLI 版本。');
      for (const row of rows) {
        const item = object(row), id = required(item.itemId, 'itemId'), title = required(item.subject, 'subject');
        if (typeof item.isAllDay !== 'boolean' || typeof item.isCancelled !== 'boolean') throw new Error('日历缺少全天或取消标志，本次结果不完整。');
        const begin = timestamp(item.start, item.isAllDay), finish = timestamp(item.end, item.isAllDay);
        if (Date.parse(finish) <= Date.parse(begin)) throw new Error('日历结束时间无效，本次结果不完整。');
        const previous = seen.get(id);
        if (previous && previous !== begin) throw new Error('日历返回重复的事件标识，需核实周期实例；已保留原有日程。');
        if (previous) continue;
        seen.set(id, begin);
        if (Date.parse(finish) <= dayMillis(start) || Date.parse(begin) >= dayMillis(end)) continue;
        events.push({ external: { provider: 'calendar', account, id, changeKey: text(item.changeKey), isAllDay: item.isAllDay }, title, start: begin, end: finish, location: text(item.location), cancelled: item.isCancelled });
      }
      if (rows.length >= CALENDAR_MAX) throw new Error('邮箱日历达到单日 500 条上限，本次结果可能不完整。');
    }
  }

  private async currentMailbox(): Promise<string> {
    try {
      const profile = object(JSON.parse(await this.request(['onebox', 'user-info'])));
      const data = profile.data as Record<string, unknown> | undefined;
      for (const candidate of [profile, data, profile.user, data?.user]) {
        if (!candidate || typeof candidate !== 'object') continue;
        const { email, mail } = candidate as Record<string, unknown>;
        for (const value of [email, mail]) {
          const parsed = AppSettingsSchema.shape.welinkEmail.safeParse(typeof value === 'string' ? value.trim() : value);
          if (parsed.success && parsed.data) return parsed.data;
        }
      }
    } catch (error) {
      const failure = welinkConnectionFailure(error);
      if (failure.connection !== 'temporary') throw new WelinkConnectionError(failure.connection, failure.reason!);
    }
    return '';
  }

  private async calendarRequest(args: string[], account: string, email: string, retryMailbox = false): Promise<string> {
    try { return await this.request(args); }
    catch (error) {
      if (!needsMailbox(error)) throw error;
    }
    const previous = this.mailboxFailure;
    if (!retryMailbox && previous?.account === account && previous.email === email && this.now() < previous.retryAt) throw previous.error;
    try {
      const address = email || await this.currentMailbox();
      if (await this.account() !== account) throw new WelinkConnectionError('temporary', 'WeLink 账号已切换，请重新同步。');
      if (!address) throw new MailboxSetupError('邮箱服务尚未配置，未能从 WeLink 读取邮箱地址。请选择“手动配置邮箱”。');
      try { await this.request(['mail', 'autodiscover', '--email', address]); }
      catch (error) {
        const failure = welinkConnectionFailure(error);
        if (failure.connection !== 'temporary') throw new WelinkConnectionError(failure.connection, failure.reason!);
        throw new MailboxSetupError('邮箱自动配置未成功。请核对企业邮箱后重试。');
      }
      try {
        const raw = await this.request(args);
        this.mailboxFailure = undefined;
        return raw;
      } catch (error) {
        if (!needsMailbox(error)) throw error;
        throw new MailboxSetupError('邮箱服务仍未配置。请核对企业邮箱后重试。');
      }
    } catch (error) {
      if (error instanceof MailboxSetupError) this.mailboxFailure = { account, email, retryAt: this.now() + MAILBOX_RETRY_MS, error };
      throw error;
    }
  }

  private async meetings(start: string, end: string, account: string, events: WelinkEvent[]): Promise<void> {
    const seen = new Set<string>();
    // Include meetings already ended today; "upcoming" alone cannot represent a day's agenda.
    for (const type of dayMillis(start) < this.now() ? [1, 2] : [1]) {
      const fingerprints = new Set<string>();
      for (let page = 1; ; page++) {
        if (page > 50) throw new Error('会议查询超过分页上限，本次结果不完整。');
        const response = object(JSON.parse(await this.request(['meeting', 'query-list', '--page', String(page), '--size', String(PAGE_SIZE), '--meeting-start-time', String(dayMillis(start)), '--meeting-end-time', String(dayMillis(end) - 1), '--type', String(type), '--meeting-sort', 'asc'])));
        if (response.code !== 200) throw new Error(`WeLink 查询失败：${text(response.message) || text(object(response.message ?? {}).message) || response.code}`);
        const data = object(response.data);
        const rows = data.data;
        if (!Array.isArray(rows)) {
          if (rows === undefined && data.total === 0 && typeof data.page === 'number' && typeof data.size === 'number') break;
          throw new Error('会议列表结构无法识别，本次结果不完整。');
        }
        if (!rows.length) break;
        const fingerprint = JSON.stringify(rows.map(row => object(row).meetingId));
        if (fingerprints.has(fingerprint)) throw new Error('会议分页返回重复数据，本次结果不完整。');
        fingerprints.add(fingerprint);
        for (const row of rows) {
          const item = object(row), id = item.meetingId;
          if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('会议缺少有效 meetingId，本次结果不完整。');
          const title = required(item.subject, 'subject');
          const begin = Number(item.meetingStartTime), finish = Number(item.meetingEndTime);
          if (!Number.isFinite(begin) || !Number.isFinite(finish) || begin <= 0 || finish <= begin || !Number.isFinite(new Date(finish).getTime())) throw new Error('会议时间无效，本次结果不完整。');
          if (seen.has(String(id)) || finish <= dayMillis(start) || begin >= dayMillis(end)) continue;
          seen.add(String(id));
          events.push({ external: { provider: 'meeting', account, id: String(id) }, title, start: new Date(begin).toISOString(), end: new Date(finish).toISOString(), location: text(item.location), cancelled: false, meetingId: id, meetingNo: Number.isSafeInteger(item.meetingNo) ? String(item.meetingNo) : text(item.meetingNo) });
        }
        // total is not trustworthy (observed nonempty pages with total=0).
        const size = typeof data.size === 'number' && data.size > 0 && data.size <= PAGE_SIZE ? data.size : PAGE_SIZE;
        if (rows.length < size) break;
      }
    }
  }

  async details(event: WelinkEvent, email: string): Promise<WelinkEventDetails> {
    const account = welinkAccount(event.external);
    if (account !== await this.account()) throw new Error('日程所属账号与当前账号不一致，请重新同步。');
    const details = event.external.provider === 'meeting'
      ? await this.meetingDetails(event)
      : await this.calendarDetails(event, account, email);
    if (account !== await this.account()) throw new Error('读取详情期间 WeLink 账号已切换，请重新同步。');
    return details;
  }

  private async calendarDetails(event: WelinkEvent, account: string, email: string): Promise<WelinkCalendarDetails> {
    const item = object(JSON.parse(await this.calendarRequest(['calendar', '--tz', 'China Standard Time', 'get', '--item-id', event.external.id, '--body-type', 'Text'], account, email)));
    if (item.itemId !== event.external.id) throw new Error('日程详情标识不匹配，请重新同步。');
    const allDay = item.isAllDay === true;
    if (text(item.changeKey) && event.external.changeKey && item.changeKey !== event.external.changeKey
      || text(item.start) && timestamp(item.start, allDay) !== event.start
      || text(item.end) && timestamp(item.end, allDay) !== event.end) throw new Error('日程内容已变化，请重新同步。');
    return detailFields(item, required(item.subject, 'subject'));
  }

  private async meetingDetails(event: WelinkEvent): Promise<WelinkEventDetails> {
    const id = event.external.id;
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) throw new Error('会议缺少有效主键，请重新同步。');
    const response = object(JSON.parse(await this.request(['meeting', 'info', '--meeting-id', id])));
    if (response.code != null && String(response.code) !== '200') throw new Error('WeLink 未能返回会议详情，请稍后重试。');
    const item = object(response.data ?? response.response ?? response);
    if (item.meetingId != null && String(item.meetingId) !== id) throw new Error('会议详情标识不匹配，请重新同步。');
    if (item.meetingId == null && !Array.isArray(item.jumpUrls)) throw new Error('无法识别 WeLink 会议详情，请稍后重试。');
    const links: { basic?: string; summary?: string } = {};
    const entries: unknown[] = Array.isArray(item.jumpUrls) ? item.jumpUrls : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object') continue;
      const { type, url, jumpUrl } = entry as Record<string, unknown>;
      if (type === 'basic' || type === 'summary') links[type] ||= webUrl(url) || webUrl(jumpUrl);
    }
    return { ...detailFields(item, text(item.subject) || event.title), meetingDetailsUrl: links.basic, meetingSummaryUrl: links.summary };
  }
}
