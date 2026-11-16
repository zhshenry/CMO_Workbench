import type { Task } from '../../../shared/todo-contracts';
import './task-source-badge.css';

export const taskSourceName = (task: Pick<Task, 'external'>): string => task.external?.provider === 'calendar' ? '邮箱日历' : 'WeLink';

export function TaskSourceBadge({ source, external, readonly = false }: { source: Task['source']; external?: Task['external']; readonly?: boolean }) {
  if (source !== 'welink') return null;
  const name = taskSourceName({ external });
  return <span className="task-source-badge" title={`来自 ${name} 的同步日程`}>{name}{readonly ? ' · 只读' : ''}</span>;
}
