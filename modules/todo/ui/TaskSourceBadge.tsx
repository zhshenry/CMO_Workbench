import type { Task } from '../../../shared/todo-contracts';
import './task-source-badge.css';

export function TaskSourceBadge({ source, readonly = false }: { source: Task['source']; readonly?: boolean }) {
  if (source !== 'welink') return null;
  return <span className="task-source-badge" title="来自 WeLink 的同步日程">WeLink{readonly ? ' · 只读' : ''}</span>;
}
