import type { Task } from './todo-contracts';
import type { WelinkEvent } from './welink-agenda';
import { taskMeetingOccurrence, verifiedWelinkPeers, welinkAccount, type VerifiedWelinkOccurrence } from './welink-occurrence';
export { welinkMeetingPeer, welinkMeetingPeers } from './welink-occurrence';

/** Same-source duplicates are grouped for presentation. Only verified pairs share local state. */
function groupMeetings<T>(rows: T[], meeting: (row: T) => VerifiedWelinkOccurrence & { title: string }): { primary: T; sources: T[] }[] {
  const peers = verifiedWelinkPeers(rows, meeting);
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
  return groupMeetings(tasks, taskMeetingOccurrence)
    .map(({ primary, sources }) => sources.length === 1 ? primary : { ...primary, displaySources: sources.map(task => ({ taskId: task.id, external: task.external! })) });
}
