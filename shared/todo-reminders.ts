import type { Task } from './todo-contracts';
import { localDay, taskDay } from './todo-date';
import { meetingEndAt } from './todo-format';
import { welinkMeetingPeers } from './welink-occurrence';

export const SNOOZE_MINUTES = 10;

export function meetingReminderEnded(task: Task, now: number): boolean {
  if (task.kind !== 'meeting') return false;
  const endAt = meetingEndAt(task);
  if (endAt) return Date.parse(endAt) <= now;
  const day = taskDay(task);
  return !!day && day < localDay(new Date(now));
}

export function hasActiveReminder(task: Task, now: number): task is Task & { remindAt: string } {
  return !task.deletedAt && task.status !== 'done' && !task.reminderDismissed &&
    !!task.remindAt && !meetingReminderEnded(task, now);
}

export function isReminderDue(task: Task, now: number): task is Task & { remindAt: string } {
  return hasActiveReminder(task, now) && Date.parse(task.remindAt) <= now;
}

export function dueReminderGroups(
  tasks: readonly Task[], now: number, visible: (task: Task) => boolean = () => true,
): { task: Task & { remindAt: string }; peer?: Task }[] {
  const peers = welinkMeetingPeers(tasks);
  const seen = new Set<string>();
  return tasks.flatMap(task => {
    if (seen.has(task.id)) return [];
    const peer = peers.get(task);
    if (!peer) return isReminderDue(task, now) && visible(task) ? [{ task }] : [];
    seen.add(task.id); seen.add(peer.id);
    if ([task, peer].some(row => row.status === 'done' || row.reminderDismissed)) return [];
    const calendar = task.external?.provider === 'calendar' ? task : peer;
    const meeting = calendar === task ? peer : task;
    const primary = calendar.remindAt && visible(calendar) ? calendar : meeting;
    return isReminderDue(primary, now) && visible(primary)
      ? [{ task: primary, peer: primary === calendar ? meeting : calendar }] : [];
  });
}
