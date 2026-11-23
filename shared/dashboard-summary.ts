import { taskDay } from './todo-date';
import { localDay, type Task } from './todo-contracts';
import { welinkDisplayTasks } from './welink-display';
import type { NewApiAccount } from './island-contracts';

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
  for (const task of welinkDisplayTasks(active)) {
    if (task.kind === 'task') {
      const day = days.find(item => item.date === taskDay(task));
      if (day) day[task.status === 'done' ? 'completed' : 'pending']++;
    }
    if (task.status !== 'done') {
      const day = upcomingDays.find(item => item.date === taskDay(task));
      if (day) day[task.kind === 'meeting' ? 'meetings' : 'tasks']++;
    }
  }
  const earlierPending = active.filter(task => task.kind === 'task' && task.status !== 'done' && taskDay(task) !== null && taskDay(task)! < days[0].date).length;
  const plannedCompleted = days.reduce((sum, day) => sum + day.completed, 0), plannedPending = days.reduce((sum, day) => sum + day.pending, 0);
  const upcomingMeetings = upcomingDays.reduce((sum, day) => sum + day.meetings, 0);
  const upcomingTasks = upcomingDays.reduce((sum, day) => sum + day.tasks, 0);
  return { today, days, upcomingDays, upcomingMeetings, upcomingTasks, earlierPending, plannedCompleted, plannedPending, total: plannedCompleted + plannedPending };
}

export function dashboardQuotaEntry(account: NewApiAccount, clock: Date, readFailed = false) {
  const hasToday = Boolean(account.hasData && account.updatedAt && localDay(new Date(account.updatedAt)) === localDay(clock) && account.status !== 'disconnected');
  const cached = Boolean(readFailed || account.message || account.status === 'error' || (account.updatedAt && clock.getTime() - account.updatedAt > 600000));
  const statusLabel = account.status === 'connecting' ? '正在更新' : hasToday ? (cached ? '缓存数据' : '今日消耗') : account.status === 'error' ? '读取失败' : '暂无今日数据';
  return { id: account.id, label: account.label, status: account.status, statusLabel, cached, updatedAt: account.updatedAt, todayTokens: hasToday ? account.todayQuota : null };
}

export type DashboardQuotaEntry = ReturnType<typeof dashboardQuotaEntry>;
