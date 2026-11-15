import { localDay, type Task } from './todo-contracts';

/** Build read-only card views from the shared task library, using local calendar days. */
export function dashboardSummary(tasks: Task[], clock: Date) {
  const today = localDay(clock);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(clock); date.setDate(date.getDate() - 6 + index);
    return { date: localDay(date), weekday: date.getDay(), completed: 0, pending: 0 };
  });
  const upcomingDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(clock); date.setDate(date.getDate() + index);
    return { date: localDay(date), weekday: date.getDay(), tasks: 0, meetings: 0 };
  });
  const active = tasks.filter(task => !task.deletedAt);
  for (const task of active) {
    if (task.kind === 'task') {
      const day = days.find(item => item.date === task.plannedDate);
      if (day) day[task.status === 'done' ? 'completed' : 'pending']++;
    }
    if (task.status !== 'done') {
      const day = upcomingDays.find(item => item.date === task.plannedDate);
      if (day) day[task.kind === 'meeting' ? 'meetings' : 'tasks']++;
    }
  }
  const earlierPending = active.filter(task => task.kind === 'task' && task.status !== 'done' && task.plannedDate < days[0].date).length;
  const plannedCompleted = days.reduce((sum, day) => sum + day.completed, 0), plannedPending = days.reduce((sum, day) => sum + day.pending, 0);
  return { today, days, upcomingDays, earlierPending, plannedCompleted, plannedPending, total: plannedCompleted + plannedPending };
}
