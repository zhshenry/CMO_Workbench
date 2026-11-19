import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { CheckCircle, Clock, PencilSimple, Plus } from '@phosphor-icons/react';
import { activeToday, localDay, type Task } from '../../shared/todo-contracts';
import { welinkMeetingPeer } from '../../shared/welink-display';
import { TaskEditor, type TaskEditorApi, type TodoState } from '../../modules/todo/ui/TaskEditor';
import { TodayBoard, type Mutate } from '../../modules/todo/ui/TodayBoard';
import type { ScheduleTab } from '../../modules/todo/ui/CalendarWorkspace';
import { TaskLibrary } from '../../modules/todo/ui/TaskLibrary';
import { TaskSourceBadge } from '../../modules/todo/ui/TaskSourceBadge';
import { IconDocs } from '../icons';
import { GameOptionsMenu } from './GameOptionsMenu';
import { WelinkScheduleDetails, WelinkWeekCoverage } from './WelinkSchedule';

const api = window.workbench.todo;
const editorApi: TaskEditorApi = {
  create: input => api.create(input),
  update: (id, patch, revision) => api.update(id, patch, revision),
  remove: (id, revision) => api.remove(id, revision),
  createCategory: input => api.createCategory(input),
};
const libraryApi = {
  update: (id: string, patch: unknown, revision: string) => api.update(id, patch, revision),
  restore: (id: string) => api.restore(id),
};

export function TodoView({ data, clock, mutate, editor, setEditor, workspaceHeader, onPrepareMeeting, onRecordMeeting, onRooms }: {
  data: TodoState; clock: Date; mutate: Mutate;
  editor: Task | 'new' | null; setEditor(task: Task | 'new' | null): void;
  workspaceHeader?: HTMLElement | null;
  onPrepareMeeting?(task: Task): void;
  onRecordMeeting?(task?: Task): void;
  onRooms?(): void;
}) {
  const [tab, setTab] = useState<ScheduleTab>('calendar');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const savedTodo = useRef<Task | null>(null);
  const [planView, setPlanView] = useState<'rows' | 'tiles'>(() => { try { return localStorage.getItem('wb.todo.plan-view') === 'tiles' ? 'tiles' : 'rows'; } catch { return 'rows'; } });
  const createId = useId();
  const today = localDay(clock), categoryById = new Map(data.categories.map(category => [category.id, category]));
  const reminder = activeToday(data.tasks, today).find(task => task.status !== 'done' && task.remindAt && Date.parse(task.remindAt) <= clock.getTime());
  const addAction = <button type="button" className="btn btn-pri btn-sm" aria-haspopup="dialog" aria-expanded={editor === 'new'}
    aria-controls={editor === 'new' ? createId : undefined} onClick={() => setEditor('new')}><Plus size={14} aria-hidden="true" />新增</button>;
  function changePlanView(value: 'rows' | 'tiles') {
    setPlanView(value);
    try { localStorage.setItem('wb.todo.plan-view', value); setNotice(`已切换为${value === 'rows' ? '列表' : '卡片'}样式`); } catch { setNotice('样式已切换，暂未保存到本机'); }
  }
  function saveItem(state: TodoState) {
    if (tab === 'todo' && editor && editor !== 'new') savedTodo.current = editor;
    mutate(async () => state);
    setNotice('事项已保存');
  }

  useLayoutEffect(() => {
    const previous = savedTodo.current;
    // 编辑框关闭与待办列表刷新可能落在不同的渲染批次。
    if (!previous || editor || data.tasks.some(task => task.id === previous.id && task.updatedAt === previous.updatedAt)) return;
    savedTodo.current = null;
    if (tab !== 'todo' || document.activeElement !== document.body) return;
    const list = document.querySelector('#view-todo .calendar-todos:not([hidden])');
    const fallback = list?.querySelector<HTMLButtonElement>('.dash-actions .btn-pri');
    fallback?.focus({ preventScroll: true });
  }, [data.tasks, editor, tab]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || document.querySelector('dialog[open], dialog:popover-open')) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); setEditor('new'); }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); setTab('todo'); setLibraryOpen(true); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [setEditor]);

  return <section className="view on todo-workspace" id="view-todo" aria-label="日程待办">
    <div className="todo-panel">
      {reminder && !libraryOpen && <div className="reminder-strip"><Clock size={15} /><span>{reminder.title}</span><button onClick={() => { void mutate(() => api.snooze(reminder.id), '将在10分钟后提醒'); }}>稍后10分钟</button></div>}
      <TodayBoard tasks={data.tasks} today={today} categoryById={categoryById} planView={planView} mutating={false} api={editorApi} mutate={mutate} setEditor={setEditor}
        workspace={{ tab, onTab: setTab, workspaceHeader, calendarActions: addAction, coverage: (start, end, toolbarTarget) => <WelinkWeekCoverage key={start + ':' + end} start={start} end={end} toolbarTarget={toolbarTarget} />,
          records: (onRecordMeeting || onRooms) && <div className="meeting-tools">
            {onRecordMeeting && <button type="button" className="btn btn-pri btn-sm" onClick={() => onRecordMeeting()}>会议伴侣</button>}
            {onRooms && <button type="button" className="btn btn-sec btn-sm" onClick={onRooms}>会议室预约</button>}
          </div>, details: (task, selected) => <>
          {task.source === 'welink' && <>
            <div className="calendar-detail-meta"><TaskSourceBadge source={task.source} external={task.external} displaySources={task.displaySources} /></div>
            <WelinkScheduleDetails key={task.id + ':' + (task.external?.provider === 'meeting' ? task.updatedAt : task.external?.changeKey ?? '')} task={task}
              meeting={task.external?.provider === 'calendar' ? welinkMeetingPeer(task, data.tasks) : task} selected={selected} />
          </>}
          <div className="calendar-detail-actions">
            {task.kind === 'meeting' && onPrepareMeeting && <button type="button" className="btn btn-sec btn-sm" onClick={() => onPrepareMeeting(task)}>整理会前材料</button>}
            {task.kind === 'meeting' && onRecordMeeting && <button type="button" className="btn btn-sec btn-sm" onClick={() => onRecordMeeting(task)}>录制与纪要</button>}
            <button type="button" className="btn btn-pri btn-sm" onClick={() => setEditor(task)}>
              {task.source === 'welink' ? <IconDocs size={15} /> : <PencilSimple size={15} />}
              {task.source === 'welink' ? '查看日程详情' : '编辑日程'}
            </button>
          </div>
        </> }}
        toolbar={<div className="dash-actions">{!libraryOpen && <span className="todo-style-control"><GameOptionsMenu kind="dashboard" active={!libraryOpen} context={planView} label="更换待办样式">{close => <><div className="dashboard-style-menu-title">更换样式</div>{(['rows', 'tiles'] as const).map(value => <button key={value} type="button" className="todo-style-option" role="menuitemradio" aria-checked={planView === value} onClick={() => { changePlanView(value); close(); }}><span>{value === 'rows' ? '列表' : '卡片'}</span><CheckCircle size={16} weight="fill" aria-hidden="true" /></button>)}</>}</GameOptionsMenu></span>}<button type="button" className="btn btn-sec btn-sm" aria-pressed={libraryOpen} onClick={() => setLibraryOpen(value => !value)}><IconDocs size={14} />全部事项</button>{addAction}</div>}
        todoContent={libraryOpen ? <TaskLibrary tasks={data.tasks} categories={data.categories} api={libraryApi} changed={state => mutate(async () => state)} edit={setEditor} close={() => setLibraryOpen(false)} /> : undefined} />
    </div>
    {editor && <TaskEditor key={editor === 'new' ? 'new' : editor.id} task={editor === 'new' ? undefined : editor} id={editor === 'new' ? createId : undefined} categories={data.categories} api={editorApi}
      changed={state => mutate(async () => state)} saved={saveItem} close={() => setEditor(null)} />}
    <div className="todo-notice" data-show={notice ? '1' : '0'} role="status" aria-live="polite">{notice}</div>
  </section>;
}
