import { taskDay } from '../../../shared/todo-date';
import { useRef, useState, type ReactNode } from 'react';
import { Check, CaretDown } from '@phosphor-icons/react';
import { localDay, openToday, taskTime, type Task } from '../../../shared/todo-contracts';
import { isOverdue, scheduleStamp, stampLabel } from './ui';
import type { TaskEditorApi, TodoState } from './TaskEditor';
import { TaskSourceBadge, taskSourceName } from './TaskSourceBadge';
import { CalendarWorkspace, type ScheduleNavigation } from './CalendarWorkspace';
import { welinkDisplayTasks } from '../../../shared/welink-display';

// compact 沿用上游 src/App.tsx 的 TodayBoard/PlanRow/shiftDay；workspace 参照 OnoSan 独立待办页。
// 上游 api: DesktopAPI 在此参数化为工作台注入的 TaskEditorApi。
export type Mutate = (action: () => Promise<TodoState>, message?: string) => Promise<void> | void;

function shiftDay(day: string, days: number) {
  const date = new Date(`${day}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDay(date);
}

export function TodayBoard({ tasks, today, categoryById, planView, mutating, api, mutate, setEditor, toolbar, emptyText, workspace, todoContent }: {
  tasks: Task[]; today: string; categoryById: Map<string, { id: string; name: string; color: string }>;
  planView: 'rows' | 'tiles'; mutating: boolean;
  api: TaskEditorApi; mutate: Mutate;
  setEditor: (task: Task | 'new') => void; toolbar: ReactNode; emptyText?: string;
  workspace?: ScheduleNavigation; todoContent?: ReactNode;
}) {
  const [openFolder, setOpenFolder] = useState<string | null>(null);
  const [armedId, setArmedId] = useState<string | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function disarmArm() {
    if (armTimer.current) { clearTimeout(armTimer.current); armTimer.current = null; }
    setArmedId(null);
  }
  function armTask(task: Task) {
    setArmedId(task.id);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmedId(null), 4000);
  }
  function onRowCheck(task: Task) {
    if (task.status === 'done') { void mutate(() => api.update(task.id, { status: 'todo' }, task.updatedAt)); return; }
    if (armedId === task.id) { disarmArm(); return; } // 再次点击圆框 = 取消
    armTask(task);
  }
  function confirmRow(task: Task) {
    disarmArm();
    void mutate(() => api.update(task.id, { status: 'done' }, task.updatedAt));
  }
  const openItems = openToday(tasks, today);
  const todos = openItems.filter(task => task.kind === 'task');
  const currentId = workspace ? todos.find(task => task.status === 'doing')?.id : openItems[0]?.id;
  const tiles = planView === 'tiles';
  const columns = Boolean(workspace) && !tiles;
  const todoSection = <section className={`plan-card plan-today${todos.length ? '' : ' is-empty'}`} aria-label="待办">
      <header className="plan-card-heading">
        {!workspace && <h2>待办</h2>}
        {toolbar}
      </header>
      {todoContent ?? (todos.length ? <ul className={tiles ? 'plan-tiles' : columns ? 'plan-list plan-column-list' : 'plan-list'}>
        {columns && <li className="plan-column-heading" aria-hidden="true">
          <span>事项</span><span>分类</span><span>截止时间</span><span>操作</span>
        </li>}
        {todos.map(task => <PlanRow key={task.id} task={task} tiles={tiles} columns={columns} category={task.categoryId ? categoryById.get(task.categoryId) : undefined} current={task.id === currentId} mutating={mutating} setEditor={setEditor} allowReschedule={Boolean(workspace)} armed={armedId === task.id} onCheck={() => onRowCheck(task)} onConfirm={() => confirmRow(task)} onDisarm={disarmArm} />)}
      </ul> : <div className="plan-empty">{emptyText ?? '点击 + 添加,或让 AI 帮你安排。'}</div>)}
    </section>;

  if (workspace) {
    const meetings = tasks.filter(task => task.kind === 'meeting' && !task.deletedAt && task.status !== 'done');
    return <CalendarWorkspace {...workspace} meetings={meetings} mergeMeetings={welinkDisplayTasks} today={today} todo={todoSection} />;
  }

  const meetings = welinkDisplayTasks(openItems.filter(task => task.kind === 'meeting'));
  const tomorrow = shiftDay(today, 1);
  const dayAfter = shiftDay(today, 2);
  const weekEnd = shiftDay(today, 7);
  const laterStart = shiftDay(today, 8);
  const shortDate = (date: string) => `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`;
  const meetingItems = (from: string, through: string | null) => welinkDisplayTasks(tasks.filter(task => !task.deletedAt && task.status !== 'done' && task.kind === 'meeting' && taskDay(task) !== null && taskDay(task)! >= from && (!through || taskDay(task)! <= through))
    .sort((a, b) => (taskDay(a) ?? '').localeCompare(taskDay(b) ?? '') || taskTime(a) - taskTime(b) || a.createdAt.localeCompare(b.createdAt)));
  const groups = [
    { id: 'today', label: '今天', range: shortDate(today), items: meetings },
    { id: 'tomorrow', label: '明天', range: shortDate(tomorrow), items: meetingItems(tomorrow, tomorrow) },
    { id: 'soon', label: '近期', range: `${shortDate(dayAfter)} – ${shortDate(weekEnd)}`, items: meetingItems(dayAfter, weekEnd) },
    { id: 'later', label: '更晚', range: `${shortDate(laterStart)} 起`, items: meetingItems(laterStart, null) },
  ].filter(group => group.items.length > 0);
  return <div className="today-board">
    {todoSection}
    <section className="plan-schedule" aria-label="日程">
      <header className="plan-card-heading"><h2>日程</h2></header>
      {groups.length ? <div className="plan-schedule-groups">{groups.map(group => {
        const open = openFolder === group.id;
        return <section key={group.id} className={`plan-folder${open ? ' is-open' : ''}`}>
          <button type="button" className="plan-folder-tab" aria-expanded={open} aria-controls={`plan-folder-${group.id}`} onClick={() => setOpenFolder(open ? null : group.id)}>
            <h3>{group.label}<small>{group.range}</small></h3>
            <span className="plan-folder-count">{group.items.length}</span>
            <CaretDown className="plan-folder-caret" size={12} weight="bold" />
          </button>
          {open ? <div id={`plan-folder-${group.id}`} className="plan-folder-body">
            <ul className="plan-list">{group.items.map(task => <PlanRow key={task.id} task={task} tiles={false} category={task.categoryId ? categoryById.get(task.categoryId) : undefined} current={group.id === 'today' && task.id === currentId} mutating={mutating} setEditor={setEditor} armed={armedId === task.id} onCheck={() => onRowCheck(task)} onConfirm={() => confirmRow(task)} onDisarm={disarmArm} />)}</ul>
          </div> : null}
        </section>;
      })}</div> : <div className="plan-empty">没有日程。</div>}
    </section>
  </div>;
}

function PlanRow({ task, tiles, columns, category, current, mutating, setEditor, allowReschedule, armed, onCheck, onConfirm, onDisarm }: {
  task: Task; tiles: boolean; category?: { name: string; color: string }; current: boolean; mutating: boolean;
  setEditor: (task: Task | 'new') => void; armed: boolean; onCheck: () => void; onConfirm: () => void; onDisarm: () => void;
  allowReschedule?: boolean; columns?: boolean;
}) {
  const overdue = isOverdue(task);
  const checkable = task.kind === 'task';
  const checkActive = task.status === 'done' || armed;
  const checkSize = tiles ? 11 : 12;
  const showProgress = task.progress !== null;
  const reschedule = allowReschedule && checkable && overdue && task.source !== 'welink' &&
    <button type="button" className="text-button plan-reschedule" aria-label={`重新安排 ${task.title}`} disabled={mutating} onClick={() => setEditor(task)}>重新安排</button>;
  const confirmation = <span className="confirm-bar"><button type="button" className="confirm-btn" disabled={mutating} onClick={onConfirm}>确认完成</button><button type="button" className="confirm-cancel" onClick={onDisarm}>取消</button></span>;
  if (tiles) return <li className={`plan-item is-tile${task.status === 'done' ? ' is-done' : ''}${current ? ' is-current' : ''}${armed ? ' is-armed' : ''}`}>
    <span className="tile-top">
      {overdue ? <span className="tile-pill pill-overdue">已超期</span> : null}
      <time className={overdue ? 'is-overdue' : undefined} dateTime={task.dateAt ?? undefined}>{scheduleStamp(task)}</time>
    </span>
    <span className="tile-body">
      <button type="button" className={`task-check${checkActive ? ' is-active' : ''}`} aria-label={`${task.status === 'done' ? '恢复待办' : armed ? `取消完成 ${task.title}` : `完成 ${task.title}`}`} aria-pressed={task.status === 'done'} disabled={mutating} onClick={onCheck}>{checkActive ? <Check size={checkSize} weight="bold" /> : null}</button>
      <button type="button" className="tile-title" onClick={() => setEditor(task)} aria-label={`编辑 ${task.title}`}><b title={task.title}>{task.title}</b></button>
    </span>
    {armed
      ? confirmation
      : <span className="tile-foot">
          <span className="plan-category"><i className="plan-dot" aria-hidden="true" style={{ backgroundColor: category?.color ?? 'var(--todo-muted)' }} />{category?.name ?? '无标签'}</span>
          {showProgress ? <span className="plan-progress-num">{task.progress}%</span> : null}
          {reschedule}
        </span>}
  </li>;
  const categoryName = category?.name ?? '无标签';
  const categoryDot = <i className="plan-dot" aria-hidden="true" style={{ backgroundColor: category?.color ?? 'var(--todo-muted)' }} />;
  const overdueBadge = overdue ? <span className="plan-overdue">已超期</span> : null;
  const deadline = <time className={overdue ? 'is-overdue' : undefined} dateTime={task.dateAt ?? undefined}><span className="time-label">{stampLabel(task.kind)}</span>{scheduleStamp(task)}</time>;
  const progress = showProgress ? <span className="plan-progress-num">{task.progress}%</span> : null;
  return <li className={`plan-item${checkable ? '' : ' is-meeting'}${task.status === 'done' ? ' is-done' : ''}${current ? ' is-current' : ''}${armed ? ' is-armed' : ''}`}>
    {checkable ? <button type="button" className={`task-check${checkActive ? ' is-active' : ''}`} aria-label={`${task.status === 'done' ? '恢复待办' : armed ? `取消完成 ${task.title}` : `完成 ${task.title}`}`} aria-pressed={task.status === 'done'} disabled={mutating} onClick={onCheck}>{checkActive ? <Check size={checkSize} weight="bold" /> : null}</button> : null}
    <button type="button" className="plan-title" onClick={() => setEditor(task)} aria-label={`编辑 ${task.title}${task.source === 'welink' ? `，来源 ${taskSourceName(task)}` : ''}`}><b title={task.title}>{task.title}</b><TaskSourceBadge source={task.source} external={task.external} displaySources={task.displaySources} /></button>
    {armed
      ? confirmation
      : columns ? <>
        <span className="plan-category">{categoryDot}<span title={category?.name}>{categoryName}</span></span>
        <span className="plan-deadline">{deadline}{overdueBadge}{progress}</span>
        {reschedule}
      </> : <span className="plan-meta">
          <span className="plan-category">{overdueBadge}{categoryDot}{categoryName}</span>
          {progress}
          {deadline}
          {reschedule}
        </span>}
  </li>;
}
