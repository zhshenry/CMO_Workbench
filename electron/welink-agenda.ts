import { agendaRange, dayMillis, nextDay, welinkAccount, type WelinkAgenda, type WelinkCalendarDetails, type WelinkEvent, type WelinkSourceStatus } from '../shared/welink-agenda';

export type WelinkRunner = (args: string[], timeout?: number) => Promise<string>;
const PAGE_SIZE = 30;
const CALENDAR_MAX = 500;
const idle = (): WelinkSourceStatus => ({ state: 'idle', count: 0, lastSuccessAt: null, error: '' });
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('返回结构无法识别，已保留原有日程。');
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => typeof value === 'string' ? value : '';
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
  constructor(private run: WelinkRunner, private now = Date.now, private pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))) {}

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
    const raw = await this.request(['auth', 'status']);
    const uid = raw.match(/UID:\s*([A-Za-z0-9]+)/)?.[1];
    if (!uid || !/User Token:\s*valid|Refresh Token:\s*valid|Status:\s*authenticated/i.test(raw)) throw new Error('请先在 W3 接入中登录 WeLink，再同步日程。');
    return uid.toLowerCase();
  }

  async query(start: string, end: string, email: string): Promise<WelinkAgenda> {
    agendaRange(start, end);
    const account = await this.account();
    const result: WelinkAgenda = { start, end, account, events: [], sources: { calendar: idle(), meeting: idle() } };
    for (const provider of ['calendar', 'meeting'] as const) {
      const events: WelinkEvent[] = [];
      try {
        if (provider === 'calendar') await this.calendar(start, end, account, email, events);
        else await this.meetings(start, end, account, events);
        result.sources[provider] = { state: 'success', count: events.filter(e => !e.cancelled).length, lastSuccessAt: this.now(), error: '' };
      } catch (error) {
        result.sources[provider] = { state: events.length ? 'partial' : 'error', count: events.filter(e => !e.cancelled).length, lastSuccessAt: null, error: welinkError(error) };
      }
      result.events.push(...events);
    }
    return result;
  }

  private async calendar(start: string, end: string, account: string, email: string, events: WelinkEvent[]): Promise<void> {
    const seen = new Map<string, string>();
    for (let day = start; day < end; day = nextDay(day)) {
      const raw = await this.calendarRequest(['calendar', '--tz', 'China Standard Time', 'list', '--start', day, '--end', nextDay(day), '--max', String(CALENDAR_MAX)], email);
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

  private async calendarRequest(args: string[], email: string): Promise<string> {
    try { return await this.request(args); }
    catch (error) {
      // Calendar reads normally reuse CLI credentials/configuration. Only an explicit
      // missing EWS-discovery error may trigger this optional setup fallback.
      const message = String(error);
      const needsDiscovery = /(?:please|first|must|未|尚未|需要|先)[\s\S]*(?:autodiscover|邮箱.*配置)|(?:EWS|mailbox|mail service)[\s\S]*(?:not (?:configured|initialized)|未配置|未初始化)/i.test(message);
      if (!needsDiscovery) throw error;
      if (!email) throw new Error('邮箱服务尚未配置。可展开“手动配置邮箱（可选）”填写本人邮箱后重试。');
      await this.request(['mail', 'autodiscover', '--email', email]);
      return this.request(args);
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
          events.push({ external: { provider: 'meeting', account, id: String(id) }, title, start: new Date(begin).toISOString(), end: new Date(finish).toISOString(), location: text(item.location), cancelled: false, meetingId: id, meetingNo: text(item.meetingNo) });
        }
        // total is not trustworthy (observed nonempty pages with total=0).
        const size = typeof data.size === 'number' && data.size > 0 && data.size <= PAGE_SIZE ? data.size : PAGE_SIZE;
        if (rows.length < size) break;
      }
    }
  }

  async details(event: WelinkEvent, email: string): Promise<WelinkCalendarDetails> {
    if (event.external.provider !== 'calendar' || welinkAccount(event.external) !== await this.account()) throw new Error('日程所属邮箱与当前账号不一致，请重新同步。');
    const item = object(JSON.parse(await this.calendarRequest(['calendar', '--tz', 'China Standard Time', 'get', '--item-id', event.external.id, '--body-type', 'Text'], email)));
    if (item.itemId !== event.external.id) throw new Error('日程详情标识不匹配，请重新同步。');
    const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((s): s is string => typeof s === 'string') : [];
    let onlineMeetingUrl = text(item.onlineMeetingUrl);
    try { if (!['https:', 'http:'].includes(new URL(onlineMeetingUrl).protocol)) onlineMeetingUrl = ''; } catch { onlineMeetingUrl = ''; }
    return { subject: required(item.subject, 'subject'), location: text(item.location), organizer: text(item.organizer), organizerEmail: text(item.organizerEmail), requiredAttendees: strings(item.requiredAttendees), optionalAttendees: strings(item.optionalAttendees), body: text(item.body).slice(0, 10000), onlineMeetingUrl, isAllDay: item.isAllDay === true, isCancelled: item.isCancelled === true };
  }
}
