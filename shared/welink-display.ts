import type { Task } from './todo-contracts';
import { welinkAccount, type WelinkEvent, type WelinkEventIdentity } from './welink-agenda';

type Meeting = { title: string; start: string | null; end: string | null; external?: WelinkEventIdentity };
const titleKey = (title: string) => title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

const taskMeeting = (task: Task): Meeting => ({ title: task.title, start: task.dateAt, end: task.endAt ?? null, external: task.source === 'welink' && task.kind === 'meeting' ? task.external : undefined });

function sameOccurrence(a: Meeting, b: Meeting): boolean {
  const key = titleKey(a.title);
  return Boolean(a.external && b.external && b.external.provider !== a.external.provider && welinkAccount(b.external) === welinkAccount(a.external)
    && Boolean(b.external.isAllDay) === Boolean(a.external.isAllDay) && key && titleKey(b.title) === key
    && a.start && b.start && Math.abs(Date.parse(a.start) - Date.parse(b.start)) <= 60000
    && (a.end === null && b.end === null || a.end && b.end && Math.abs(Date.parse(a.end) - Date.parse(b.end)) <= 60000));
}

/** Apply local state only to a reciprocal, unambiguous pair with complete times. */
export function welinkMeetingPeer(task: Task, tasks: readonly Task[]): Task | undefined {
  const meeting = taskMeeting(task);
  if (task.deletedAt || !meeting.external || !welinkAccount(meeting.external) || !meeting.end || !meeting.start || Date.parse(meeting.end) <= Date.parse(meeting.start)) return;
  const matches = (a: Meeting, candidate: Task) => !candidate.deletedAt && sameOccurrence(a, taskMeeting(candidate));
  const peers = tasks.filter(candidate => matches(meeting, candidate));
  if (peers.length === 1 && peers[0].dateAt && peers[0].endAt && Date.parse(peers[0].endAt) > Date.parse(peers[0].dateAt)
    && tasks.filter(candidate => matches(taskMeeting(peers[0]), candidate)).length === 1) return peers[0];
}

/** Pair two source records for display only; source identities and stored records stay intact. */
function groupMeetings<T>(rows: T[], meeting: (row: T) => Meeting): { primary: T; sources: T[] }[] {
  const used = new Set<number>();
  return rows.flatMap((row, i) => {
    if (used.has(i)) return [];
    const a = meeting(row);
    const pair = a.external && a.start && titleKey(a.title) ? rows.findIndex((other, j) => j > i && !used.has(j) && sameOccurrence(a, meeting(other))) : -1;
    if (pair < 0) return [{ primary: row, sources: [row] }];
    used.add(pair);
    const other = rows[pair];
    return [{ primary: a.external!.provider === 'calendar' ? row : other, sources: [row, other] }];
  });
}

export function welinkDisplayEvents(events: WelinkEvent[]) {
  return groupMeetings(events, event => event);
}

export function welinkDisplayTasks(tasks: Task[]): Task[] {
  return groupMeetings(tasks, taskMeeting)
    .map(({ primary, sources }) => sources.length === 1 ? primary : { ...primary, displaySources: sources.map(task => ({ taskId: task.id, external: task.external! })) });
}
