import type { Task } from '../../../shared/todo-contracts';
import './task-source-badge.css';

export const hasWelinkDualSource = ({ displaySources }: Pick<Task, 'displaySources'>) => !!displaySources?.some(source => source.external.provider === 'meeting')
  && displaySources.some(source => source.external.provider === 'calendar');
export const taskSourceName = (task: Pick<Task, 'external' | 'displaySources'>): string => hasWelinkDualSource(task)
  ? 'WeLink + 日历' : task.external?.provider === 'calendar' ? '邮箱日历' : 'WeLink';

export function TaskSourceBadge({ source, external, displaySources, readonly = false }: { source: Task['source']; external?: Task['external']; displaySources?: Task['displaySources']; readonly?: boolean }) {
  if (source !== 'welink') return null;
  const name = taskSourceName({ external, displaySources });
  return <span className="task-source-badge" title={`来自 ${name} 的同步日程`}>{name}{readonly ? ' · 只读' : ''}</span>;
}
