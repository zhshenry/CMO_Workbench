import type { Task } from './todo-contracts';

export type WelinkSource = 'calendar' | 'meeting';

/** External identity is separate from the workbench's local reminder and completion state. */
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

export interface WelinkOccurrence {
  external?: WelinkEventIdentity;
  start: string | null;
  end: string | null;
}

export type VerifiedWelinkOccurrence = WelinkOccurrence & { meetingNo?: string; welinkLinkedTo?: WelinkMeetingLink | null };

// The optional discovery email in an older namespace is not part of calendar identity.
export const welinkAccount = (event: WelinkEventIdentity): string => event.account.split(':', 1)[0];
export const WELINK_OCCURRENCE_TOLERANCE = 5 * 60000;
export const welinkMeetingNumber = (value: string | undefined): string => {
  const digits = value?.normalize('NFKC').replace(/[\s-]/g, '') ?? '';
  return /^\d{6,20}$/.test(digits) ? digits : '';
};

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

export function taskMeetingOccurrence(task: Task): VerifiedWelinkOccurrence & { title: string } {
  const source = task.external;
  // Older shared records can predate the external account and occurrence identifiers.
  const external = !task.deletedAt && task.source === 'welink' && task.kind === 'meeting' &&
    source && (source.provider === 'calendar' || source.provider === 'meeting') &&
    typeof source.account === 'string' && typeof source.id === 'string'
    ? { provider: source.provider, account: source.account, id: source.id,
      changeKey: typeof source.changeKey === 'string' ? source.changeKey : undefined, isAllDay: source.isAllDay }
    : undefined;
  return { title: task.title, start: task.dateAt, end: task.endAt ?? null, meetingNo: task.welinkMeetingNo, welinkLinkedTo: task.welinkLinkedTo, external };
}

export function verifiedWelinkPeers<T>(rows: readonly T[], occurrence: (row: T) => VerifiedWelinkOccurrence): Map<T, T> {
  const keyFor = (item: VerifiedWelinkOccurrence, sourceId: string) => JSON.stringify([welinkAccount(item.external!).toLowerCase(), sourceId]);
  const meetings = new Map<string, T[]>();
  for (const row of rows) {
    const meeting = occurrence(row);
    if (meeting.external?.provider !== 'meeting') continue;
    const number = welinkMeetingNumber(meeting.meetingNo);
    if (!number) continue;
    const key = keyFor(meeting, number);
    const found = meetings.get(key);
    if (found) found.push(row); else meetings.set(key, [row]);
  }
  const pairs = new Map<T, T[]>();
  for (const row of rows) {
    const calendar = occurrence(row), link = calendar.welinkLinkedTo;
    if (calendar.external?.provider !== 'calendar' || link?.provider !== 'meeting' || !link.meetingNo || link.calendarChangeKey !== calendar.external.changeKey) continue;
    const possible = meetings.get(keyFor(calendar, link.meetingNo))?.filter(peer => welinkOccurrenceMatches(calendar, occurrence(peer)));
    if (possible?.length !== 1 || occurrence(possible[0]).external?.id !== link.id) continue;
    const claimed = pairs.get(possible[0]);
    if (claimed) claimed.push(row); else pairs.set(possible[0], [row]);
  }
  const verified = new Map<T, T>();
  for (const [meeting, calendars] of pairs) {
    if (calendars.length !== 1) continue;
    verified.set(calendars[0], meeting);
    verified.set(meeting, calendars[0]);
  }
  return verified;
}

export function welinkMeetingPeers(tasks: readonly Task[]): Map<Task, Task> {
  return verifiedWelinkPeers(tasks, taskMeetingOccurrence);
}

export function welinkMeetingPeer(task: Task, tasks: readonly Task[]): Task | undefined {
  if (!taskMeetingOccurrence(task).external) return;
  const current = tasks.find(row => row.id === task.id);
  return current ? welinkMeetingPeers(tasks).get(current) : undefined;
}
