import type { Task } from './todo-contracts';
import { welinkAccount, type WelinkEvent, type WelinkEventIdentity } from './welink-agenda';

type Meeting = { title: string; start: string | null; end: string | null; external?: WelinkEventIdentity };
const titleKey = (title: string) => title.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

/** Pair two source records for display only; source identities and stored records stay intact. */
function groupMeetings<T>(rows: T[], meeting: (row: T) => Meeting): { primary: T; sources: T[] }[] {
  const used = new Set<number>();
  return rows.flatMap((row, i) => {
    if (used.has(i)) return [];
    const a = meeting(row), key = titleKey(a.title);
    const pair = a.external && key && a.start ? rows.findIndex((other, j) => {
      if (j <= i || used.has(j)) return false;
      const b = meeting(other);
      return b.external && b.external.provider !== a.external!.provider && welinkAccount(b.external) === welinkAccount(a.external!)
        && Boolean(b.external.isAllDay) === Boolean(a.external!.isAllDay) && titleKey(b.title) === key
        && b.start && Math.abs(Date.parse(a.start!) - Date.parse(b.start)) <= 60000
        && (a.end === null && b.end === null || a.end && b.end && Math.abs(Date.parse(a.end) - Date.parse(b.end)) <= 60000);
    }) : -1;
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
  return groupMeetings(tasks, task => ({ title: task.title, start: task.dateAt, end: task.endAt ?? null, external: task.source === 'welink' && task.kind === 'meeting' ? task.external : undefined }))
    .map(({ primary, sources }) => sources.length === 1 ? primary : { ...primary, displaySources: sources.map(task => ({ taskId: task.id, external: task.external! })) });
}
