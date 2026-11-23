import type { DashboardWidget, WidgetId } from '../shared/dashboard-layout';
import { dashboardSummary, type DashboardQuotaEntry } from '../shared/dashboard-summary';
import type { Task } from '../shared/todo-contracts';

export const dashboardContentGuide = '日程和待办按卡片当前图表口径回答，合并展示的 WeLink 日程只计一场。AI 额度卡统计各 New API 账号的今日 Tokens 消耗量。区分今日用量、缓存数据、真实 0、暂无用量和账号未连接。';

export async function readDashboardCardData(widgets: readonly DashboardWidget[], clock: Date, sources: {
  tasks(): Task[];
  quota?(): Promise<DashboardQuotaEntry[]>;
}): Promise<Partial<Record<WidgetId, unknown>>> {
  const quotaRequest = widgets.some(widget => widget.id === 'quota') ? sources.quota?.().catch(() => undefined) : undefined;
  const taskCard = widgets.find(widget => widget.id === 'today');
  const data: Partial<Record<WidgetId, unknown>> = {};
  if (taskCard) {
    try {
      const summary = dashboardSummary(sources.tasks(), clock);
      data.today = taskCard.style === 'counts'
        ? { days: summary.upcomingDays, meetings: summary.upcomingMeetings, tasks: summary.upcomingTasks }
        : { days: summary.days, completed: summary.plannedCompleted, pending: summary.plannedPending, earlierPending: summary.earlierPending };
    } catch { /* The query reports the affected card as unavailable. */ }
  }
  data.quota = await quotaRequest;
  return data;
}
