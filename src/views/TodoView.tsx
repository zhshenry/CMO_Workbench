import { useEffect, useId, useRef, useState } from 'react';
import { CheckCircle, Clock, PencilSimple, Plus } from '@phosphor-icons/react';
import { activeToday, insightTarget, localDay, openToday, type Task } from '../../shared/todo-contracts';
import { isOverdue } from '../../shared/todo-format';
import { welinkDisplayTasks } from '../../shared/welink-display';
import { TaskEditor, type TaskEditorApi, type TodoState } from '../../modules/todo/ui/TaskEditor';
import { TodayBoard, type Mutate } from '../../modules/todo/ui/TodayBoard';
import type { ScheduleTab } from '../../modules/todo/ui/CalendarWorkspace';
import { TaskLibrary } from '../../modules/todo/ui/TaskLibrary';
import { TaskSourceBadge } from '../../modules/todo/ui/TaskSourceBadge';
import { IconDocs } from '../icons';
import { GameOptionsMenu } from './GameOptionsMenu';

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

export function TodoView({ data, clock, mutate, editor, setEditor }: {
  data: TodoState; clock: Date; mutate: Mutate;
  editor: Task | 'new' | null; setEditor(task: Task | 'new' | null): void;
}) {
  const [tab, setTab] = useState<ScheduleTab>('calendar');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [planView, setPlanView] = useState<'rows' | 'tiles'>(() => { try { return localStorage.getItem('wb.todo.plan-view') === 'tiles' ? 'tiles' : 'rows'; } catch { return 'rows'; } });
  const addButton = useRef<HTMLButtonElement>(null), createId = useId();
  const today = localDay(clock), categoryById = new Map(data.categories.map(category => [category.id, category]));
  const todayTasks = activeToday(data.tasks, today), openTasks = welinkDisplayTasks(openToday(data.tasks, today));
  const doneToday = welinkDisplayTasks(todayTasks.filter(task => task.status === 'done')).length;
  const overdue = openTasks.filter(task => isOverdue(task, clock.getTime())).length;
  const reminder = todayTasks.find(task => task.status !== 'done' && task.remindAt && Date.parse(task.remindAt) <= clock.getTime());
  const insight = insightTarget(openTasks, clock);
  function changePlanView(value: 'rows' | 'tiles') {
    setPlanView(value);
    try { localStorage.setItem('wb.todo.plan-view', value); setNotice(`已切换为${value === 'rows' ? '列表' : '卡片'}样式`); } catch { setNotice('样式已切换，暂未保存到本机'); }
  }

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
    <div className="greet">
      <div><h1>日程待办</h1><div className="gsub">今天已完成 <b>{doneToday}</b> 项{openTasks.length > 0 && <> ,还有 <b>{openTasks.length}</b> 项待办</>}{overdue > 0 && <> · <span className="bad">逾期 {overdue} 项</span></>}{insight && <span className="insight"> · {insight.context}</span>}</div></div>
      <div className="dash-actions"><button ref={addButton} type="button" className="btn btn-pri btn-sm" aria-haspopup="dialog" aria-expanded={editor === 'new'} aria-controls={editor === 'new' ? createId : undefined} onClick={() => { if (editor === 'new') document.getElementById(createId)?.dispatchEvent(new Event('cancel', { cancelable: true })); else setEditor('new'); }}><Plus size={14} />新增</button></div>
    </div>
    <div className="todo-panel">
      {reminder && !libraryOpen && <div className="reminder-strip"><Clock size={15} /><span>{reminder.title}</span><button onClick={() => { void mutate(() => api.snooze(reminder.id), '将在10分钟后提醒'); }}>稍后10分钟</button></div>}
      <TodayBoard tasks={data.tasks} today={today} categoryById={categoryById} planView={planView} mutating={false} api={editorApi} mutate={mutate} setEditor={setEditor}
        workspace={{ tab, onTab: setTab, details: task => <>
          {task.source === 'welink' && <div className="calendar-detail-meta"><TaskSourceBadge source={task.source} external={task.external} displaySources={task.displaySources} /></div>}
          <div className="calendar-detail-actions">
            <button type="button" className="btn btn-pri btn-sm" onClick={() => setEditor(task)}>
              {task.source === 'welink' ? <IconDocs size={15} /> : <PencilSimple size={15} />}
              {task.source === 'welink' ? '查看日程详情' : '编辑日程'}
            </button>
          </div>
        </> }}
        toolbar={<div className="dash-actions">{!libraryOpen && <span className="todo-style-control"><GameOptionsMenu kind="dashboard" active={!libraryOpen} context={planView} label="更换待办样式">{close => <><div className="dashboard-style-menu-title">更换样式</div>{(['rows', 'tiles'] as const).map(value => <button key={value} type="button" className="todo-style-option" role="menuitemradio" aria-checked={planView === value} onClick={() => { changePlanView(value); close(); }}><span>{value === 'rows' ? '列表' : '卡片'}</span><CheckCircle size={16} weight="fill" aria-hidden="true" /></button>)}</>}</GameOptionsMenu></span>}<button type="button" className="btn btn-sec btn-sm" aria-pressed={libraryOpen} onClick={() => setLibraryOpen(value => !value)}><IconDocs size={14} />全部事项</button></div>}
        todoContent={libraryOpen ? <TaskLibrary tasks={data.tasks} categories={data.categories} api={libraryApi} changed={state => mutate(async () => state)} edit={setEditor} close={() => setLibraryOpen(false)} /> : undefined} />
    </div>
    {editor && <TaskEditor key={editor === 'new' ? 'new' : editor.id} task={editor === 'new' ? undefined : editor} id={editor === 'new' ? createId : undefined} anchor={editor === 'new' ? addButton.current : undefined} categories={data.categories} api={editorApi}
      changed={state => mutate(async () => state)} saved={state => { mutate(async () => state); setNotice('事项已保存'); }} close={() => setEditor(null)} />}
    <div className="todo-notice" data-show={notice ? '1' : '0'} role="status" aria-live="polite">{notice}</div>
  </section>;
}
