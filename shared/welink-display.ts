import type { Task } from './todo-contracts';
import { welinkAccount, welinkMeetingNumber, welinkOccurrenceMatches, type WelinkEvent, type WelinkMeetingLink, type WelinkOccurrence } from './welink-agenda';

type Meeting = WelinkOccurrence & { title: string; meetingNo?: string; welinkLinkedTo?: WelinkMeetingLink | null };

const taskMeeting = (task: Task): Meeting => ({
  title: task.title, start: task.dateAt, end: task.endAt ?? null, meetingNo: task.welinkMeetingNo, welinkLinkedTo: task.welinkLinkedTo,
  external: !task.deletedAt && task.source === 'welink' && task.kind === 'meeting' ? task.external : undefined,
});

function verifiedPeers<T>(rows: readonly T[], occurrence: (row: T) => Meeting): Map<T, T> {
  const id = (item: Meeting, sourceId: string) => JSON.stringify([welinkAccount(item.external!).toLowerCase(), sourceId]);
  const meetings = new Map<string, T[]>();
  for (const row of rows) {
    const meeting = occurrence(row);
    if (meeting.external?.provider !== 'meeting') continue;
    const number = welinkMeetingNumber(meeting.meetingNo);
    if (!number) continue;
    const key = id(meeting, number);
    const found = meetings.get(key);
    if (found) found.push(row); else meetings.set(key, [row]);
  }
  const pairs = new Map<T, T[]>();
  for (const row of rows) {
    const calendar = occurrence(row), link = calendar.welinkLinkedTo;
    if (calendar.external?.provider !== 'calendar' || link?.provider !== 'meeting' || !link.meetingNo || link.calendarChangeKey !== calendar.external.changeKey) continue;
    const possible = meetings.get(id(calendar, link.meetingNo))?.filter(peer => welinkOccurrenceMatches(calendar, occurrence(peer)));
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

export function welinkMeetingPeers(tasks: readonly Task[]): Map<Task, Task> { return verifiedPeers(tasks, taskMeeting); }

export function welinkMeetingPeer(task: Task, tasks: readonly Task[]): Task | undefined {
  if (!taskMeeting(task).external) return;
  const current = tasks.find(row => row.id === task.id);
  return current ? welinkMeetingPeers(tasks).get(current) : undefined;
}

/** Same-source duplicates are grouped for presentation. Only verified pairs share local state. */
function groupMeetings<T>(rows: T[], meeting: (row: T) => Meeting): { primary: T; sources: T[] }[] {
  const peers = verifiedPeers(rows, meeting);
  const groups = rows.flatMap(row => {
    const peer = peers.get(row);
    if (peer && meeting(row).external?.provider === 'meeting') return [];
    return [{ primary: row, sources: peer ? [row, peer] : [row] }];
  });
  const calendars = new Map<string, typeof groups>();
  for (const group of groups) {
    const item = meeting(group.primary);
    if (item.external?.provider !== 'calendar' || !item.start || !item.end || !welinkAccount(item.external)) continue;
    const title = item.title.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
    const start = Date.parse(item.start), end = Date.parse(item.end);
    if (!title || !(start < end)) continue;
    const key = JSON.stringify([welinkAccount(item.external).toLowerCase(), title, start, end, Boolean(item.external.isAllDay)]);
    const found = calendars.get(key);
    if (found) found.push(group); else calendars.set(key, [group]);
  }
  const hidden = new Set<typeof groups[number]>();
  for (const duplicates of calendars.values()) {
    if (duplicates.length < 2) continue;
    const linked = duplicates.filter(group => group.sources.length > 1);
    if (linked.length > 1) continue;
    const primary = linked[0] ?? duplicates[0];
    for (const duplicate of duplicates) {
      if (duplicate === primary) continue;
      primary.sources.push(duplicate.primary);
      hidden.add(duplicate);
    }
  }
  return groups.filter(group => !hidden.has(group));
}

export function welinkDisplayEvents(events: WelinkEvent[]) { return groupMeetings(events, event => event.cancelled ? { ...event, external: undefined } : event); }

export function welinkDisplayTasks(tasks: Task[]): Task[] {
  return groupMeetings(tasks, taskMeeting)
    .map(({ primary, sources }) => sources.length === 1 ? primary : { ...primary, displaySources: sources.map(task => ({ taskId: task.id, external: task.external! })) });
}
