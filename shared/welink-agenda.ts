export type WelinkSource = 'calendar' | 'meeting';
export type WelinkConnection = 'ready' | 'needs-login' | 'client-closed' | 'temporary';

/** External identity is separate from CMO's local completion state. */
export interface WelinkEventIdentity {
  provider: WelinkSource;
  account: string;
  id: string;
  changeKey?: string;
  isAllDay?: boolean;
}

export interface WelinkMeetingLink {
  provider: 'meeting';
  id: string;
  meetingNo: string;
  verifiedAt: string;
  calendarChangeKey?: string;
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
  welinkLinkedTo?: WelinkMeetingLink | null;
}

export interface WelinkSourceStatus {
  state: 'idle' | 'success' | 'partial' | 'error';
  count: number;
  lastSuccessAt: number | null;
  error: string;
  mailboxNeedsSetup?: true;
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

export interface WelinkEventDetails extends WelinkCalendarDetails {
  meetingDetailsUrl?: string;
  meetingSummaryUrl?: string;
}

export interface WelinkAgendaApi {
  agenda(start: string, end: string): Promise<WelinkAgenda>;
  details(taskId: string): Promise<WelinkCalendarDetails>;
}

export const welinkSourceName = (provider: WelinkSource): string => provider === 'calendar' ? '邮箱日历' : 'WeLink 会议';
// Earlier CMO builds included the discovery email in this namespace. The CLI
// selects the logged-in user's calendar, so that optional hint is not its identity.
export const welinkAccount = (event: WelinkEventIdentity): string => event.account.split(':', 1)[0];
export const WELINK_SYNC_WINDOW_DAYS = 30;
export const WELINK_OCCURRENCE_TOLERANCE = 5 * 60000;
export const welinkMeetingNumber = (value: string | undefined): string => {
  const digits = value?.normalize('NFKC').replace(/[\s-]/g, '') ?? '';
  return /^\d{6,20}$/.test(digits) ? digits : '';
};

export interface WelinkOccurrence {
  external?: WelinkEventIdentity;
  start: string | null;
  end: string | null;
}

export function welinkOccurrenceMatches(calendar: WelinkOccurrence, meeting: WelinkOccurrence): boolean {
  const left = calendar.external, right = meeting.external;
  if (left?.provider !== 'calendar' || right?.provider !== 'meeting' || left.isAllDay || right.isAllDay) return false;
  const account = welinkAccount(left);
  if (!account || account.toLowerCase() !== welinkAccount(right).toLowerCase()) return false;
  const start = Date.parse(calendar.start ?? ''), end = Date.parse(calendar.end ?? '');
  const peerStart = Date.parse(meeting.start ?? ''), peerEnd = Date.parse(meeting.end ?? '');
  return start < end && peerStart < peerEnd && start < peerEnd && peerStart < end
    && Math.abs(start - peerStart) <= WELINK_OCCURRENCE_TOLERANCE && Math.abs(end - peerEnd) <= WELINK_OCCURRENCE_TOLERANCE;
}

export const chinaDay = (ms: number): string => new Date(ms + 8 * 3600000).toISOString().slice(0, 10);
export const nextDay = (date: string, days = 1): string => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
export const dayMillis = (date: string): number => Date.parse(`${date}T00:00:00+08:00`);

export function agendaRange(start: string, end: string): void {
  const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(dayMillis(value)) && chinaDay(dayMillis(value)) === value;
  if (!valid(start) || !valid(end) || dayMillis(end) <= dayMillis(start) || dayMillis(end) - dayMillis(start) > 31 * 86400000) {
    throw new Error('请提供有效的起止日期，结束日期不含当天，每次最多查询 31 天。');
  }
}
