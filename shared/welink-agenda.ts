export type WelinkSource = 'calendar' | 'meeting';

/** External identity is separate from CMO's local completion state. */
export interface WelinkEventIdentity {
  provider: WelinkSource;
  account: string;
  id: string;
  changeKey?: string;
  isAllDay?: boolean;
}

export interface WelinkEvent {
  taskId?: string;
  cached?: boolean;
  external: WelinkEventIdentity;
  title: string;
  start: string;
  end: string;
  location: string;
  cancelled: boolean;
  meetingId?: number;
  meetingNo?: string;
}

export interface WelinkSourceStatus {
  state: 'idle' | 'success' | 'partial' | 'error';
  count: number;
  lastSuccessAt: number | null;
  error: string;
}

export interface WelinkAgenda {
  start: string;
  end: string;
  account: string;
  events: WelinkEvent[];
  sources: Record<WelinkSource, WelinkSourceStatus>;
}

export interface WelinkCalendarDetails {
  subject: string;
  location: string;
  organizer: string;
  organizerEmail: string;
  requiredAttendees: string[];
  optionalAttendees: string[];
  body: string;
  onlineMeetingUrl: string;
  isAllDay: boolean;
  isCancelled: boolean;
}

export interface WelinkAgendaApi {
  agenda(start: string, end: string): Promise<WelinkAgenda>;
  details(taskId: string): Promise<WelinkCalendarDetails>;
}

export const welinkSourceName = (provider: WelinkSource): string => provider === 'calendar' ? '邮箱日历' : 'WeLink 会议';
// Earlier CMO builds included the discovery email in this namespace. The CLI
// selects the logged-in user's calendar, so that optional hint is not its identity.
export const welinkAccount = (event: WelinkEventIdentity): string => event.account.split(':', 1)[0];
export const chinaDay = (ms: number): string => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
export const nextDay = (date: string, days = 1): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const dayMillis = (date: string): number => Date.parse(`${date}T00:00:00+08:00`);

export function agendaRange(start: string, end: string): void {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayMillis(value)) && chinaDay(dayMillis(value)) === value;
  if (!valid(start) || !valid(end) || dayMillis(end) <= dayMillis(start) || dayMillis(end) - dayMillis(start) > 31 * 86400000) {
    throw new Error('请提供有效的起止日期，结束日期不含当天，每次最多查询 31 天。');
  }
}
