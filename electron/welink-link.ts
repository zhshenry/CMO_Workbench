import type { Task } from '../shared/todo-contracts';
import { welinkAccount, welinkMeetingNumber, welinkOccurrenceMatches, type WelinkCalendarDetails, type WelinkMeetingLink, type WelinkOccurrence } from '../shared/welink-agenda';
import { welinkMeetingPeer } from '../shared/welink-display';
import type { WeclawMeetingTarget } from './weclaw-content';

export const taskOccurrence = (task: Task): WelinkOccurrence => ({ external: task.external, start: task.dateAt, end: task.endAt ?? null });

export function meetingContentTarget(taskId: string, rows: Task[]): WeclawMeetingTarget | undefined {
  const task = rows.find(row => row.id === taskId && !row.deletedAt && row.source === 'welink' && row.kind === 'meeting');
  if (!task?.external || task.external.isAllDay) return;
  const peer = welinkMeetingPeer(task, rows);
  const calendar = task.external.provider === 'calendar' ? task : peer ?? task;
  const meeting = task.external.provider === 'meeting' ? task : peer;
  if (!meeting?.external || !calendar.dateAt || !calendar.endAt) return;
  return { account: welinkAccount(task.external), subject: calendar.title, start: calendar.dateAt, end: calendar.endAt, meetingId: meeting.external.id };
}

// Detail evidence is reusable only for the exact source revision and occurrence that was read.
export function calendarRevision(calendar: WelinkOccurrence): string {
  const source = calendar.external!;
  return JSON.stringify([welinkAccount(source), source.id, source.changeKey, calendar.start, calendar.end]);
}

export function calendarMeetingNumber(details: WelinkCalendarDetails): string | null {
  if (details.isCancelled || details.isAllDay) return null;
  const body = details.body.replace(/<\/?[a-z][^>]*>/gi, ' ').replace(/&nbsp;/gi, ' ').normalize('NFKC');
  const numbers = [...body.matchAll(/(?:\bMeeting\s*ID|会议号(?:码)?)\s*[:：]?\s*(\d+(?:[ \t-]+\d+)*)/gi)].map(match => welinkMeetingNumber(match[1]));
  if (details.onlineMeetingUrl) {
    try { numbers.push(...new URL(details.onlineMeetingUrl).searchParams.getAll('id').map(welinkMeetingNumber)); }
    catch { return null; }
  }
  return numbers[0] && numbers.every(number => number === numbers[0]) ? numbers[0] : null;
}

export function recheckWelinkLinks(rows: Task[], touched: Set<string>, proofs: ReadonlyMap<string, string | null> | undefined, verifiedAt: string): Map<Task, WelinkMeetingLink | null> {
  const meetings = rows.flatMap(task => task.external?.provider === 'meeting' && welinkMeetingNumber(task.welinkMeetingNo)
    ? [{ task, occurrence: taskOccurrence(task), number: welinkMeetingNumber(task.welinkMeetingNo) }] : []);
  const calendars = rows.flatMap(task => {
    const external = task.external;
    if (external?.provider !== 'calendar') return [];
    const occurrence = taskOccurrence(task), proof = touched.has(task.id) ? proofs?.get(calendarRevision(occurrence)) : undefined, saved = task.welinkLinkedTo;
    const old = saved?.provider === 'meeting' && saved.calendarChangeKey === external.changeKey && !external.isAllDay ? saved : undefined;
    return [{ task, external, occurrence, proof, old, number: proof === undefined ? old?.meetingNo : proof }];
  });
  const changed = new Map<Task, WelinkMeetingLink | null>();
  for (const calendar of calendars) {
    const { task, external, occurrence, proof, old, number } = calendar;
    if (!number) {
      if (task.welinkLinkedTo) changed.set(task, null);
      continue;
    }
    const alternatives = meetings.filter(meeting => meeting.number === number && welinkOccurrenceMatches(occurrence, meeting.occurrence));
    const match = alternatives.length === 1 ? alternatives[0] : undefined;
    const fresh = match && proofs && touched.has(task.id) && touched.has(match.task.id);
    const competing = match && calendars.some(other => other !== calendar && welinkOccurrenceMatches(other.occurrence, match.occurrence)
      && (other.number === number || fresh && touched.has(other.task.id) && other.number === undefined));
    const id = match?.task.external?.id;
    if (id && !competing && old?.id === id && old.meetingNo === number) continue;
    if (id && !competing && fresh && proof === number) changed.set(task, { provider: 'meeting', id, meetingNo: number, calendarChangeKey: external.changeKey, verifiedAt });
    else if (task.welinkLinkedTo) changed.set(task, null);
  }
  return changed;
}
