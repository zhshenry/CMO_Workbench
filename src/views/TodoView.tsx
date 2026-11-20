import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { CheckCircle, Clock, PencilSimple, Plus } from '@phosphor-icons/react';
import { activeToday, localDay, type Task } from '../../shared/todo-contracts';
import { welinkMeetingPeer } from '../../shared/welink-display';
import { TaskEditor, type TaskEditHandle, type TaskEditorApi, type TodoState } from '../../modules/todo/ui/TaskEditor';
import { TodayBoard, type Mutate } from '../../modules/todo/ui/TodayBoard';
import { ScheduleInfo, type ScheduleTab } from '../../modules/todo/ui/CalendarWorkspace';
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

export function TodoView({ data, clock, mutate, editor, setEditor, editHandle, workspaceHeader, onPrepareMeeting, onRecordMeeting, onRooms }: {
  data: TodoState; clock: Date; mutate: Mutate;
  editor: Task | 'new' | null; setEditor(task: Task | 'new' | null): void;
  editHandle: RefObject<TaskEditHandle | null>;
  workspaceHeader?: HTMLElement | null;
  onPrepareMeeting?(task: Task): void;
  onRecordMeeting?(task?: Task): void;
  onRooms?(): void;
}) {
  const [tab, setTab] = useState<ScheduleTab>(() => editor && editor !== 'new' && editor.kind === 'task' ? 'todo' : 'calendar');
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [planView, setPlanView] = useState<'rows' | 'tiles'>(() => { try { return localStorage.getItem('wb.todo.plan-view') === 'tiles' ? 'tiles' : 'rows'; } catch { return 'rows'; } });
  const createId = useId();
  const todoView = useRef<HTMLElement>(null);
  const editOrigin = useRef<HTMLElement | null>(null);
  const focusAfterEdit = useRef<HTMLElement | null | undefined>(undefined);
  const pageEdit = editor && editor !== 'new' && editor.source !== 'welink';
  function closeEditor(restoreFocus = true) {
    if (pageEdit && restoreFocus) focusAfterEdit.current = editOrigin.current;
    editOrigin.current = null;
    setEditor(null);
  }
  useLayoutEffect(() => {
    const origin = focusAfterEdit.current;
    if (pageEdit || origin === undefined) return;
    focusAfterEdit.current = undefined;
    const view = todoView.current;
    if (!view?.getClientRects().length || view.closest('[inert]')) return;
    if (origin?.isConnected && origin.getClientRects().length) {
      origin.focus({ preventScroll: true });
      if (document.activeElement === origin) return;
    }
    const add = view.querySelector<HTMLButtonElement>('.calendar-todos:not([hidden]) .dash-actions .btn-pri');
    (add ?? view).focus({ preventScroll: true });
  }, [pageEdit]);
  function leaveDetails(navigate: () => void) {
    const edit = editHandle.current;
    if (edit) edit.leave(navigate);
    else navigate();
  }
  function editItem(task: Task) {
    editOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setEditor(task);
  }
  const today = localDay(clock), categoryById = new Map(data.categories.map(category => [category.id, category]));
  const reminder = activeToday(data.tasks, today).find(task => task.status !== 'done' && task.remindAt && Date.parse(task.remindAt) <= clock.getTime());
  const addAction = <button type="button" className="btn btn-pri btn-sm" aria-haspopup="dialog" aria-expanded={editor === 'new'}
    aria-controls={editor === 'new' ? createId : undefined} onClick={() => leaveDetails(() => setEditor('new'))}><Plus size={14} aria-hidden="true" />新增</button>;
  function changePlanView(value: 'rows' | 'tiles') {
    setPlanView(value);
    try { localStorage.setItem('wb.todo.plan-view', value); setNotice(`已切换为${value === 'rows' ? '列表' : '卡片'}样式`); } catch { setNotice('样式已切换，暂未保存到本机'); }
  }
  function saveItem(state: TodoState) {
    const updated = mutate(async () => state);
    setNotice('事项已保存');
    return updated;
  }


  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 5000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.isComposing || document.querySelector('dialog[open], dialog:popover-open')) return;
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); leaveDetails(() => setEditor('new')); }
      else if (event.key.toLowerCase() === 'f') { event.preventDefault(); leaveDetails(() => { setTab('todo'); setLibraryOpen(true); }); }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, [setEditor, editHandle]);

  const editForm = editor && <TaskEditor key={editor === 'new' ? 'new' : editor.id} task={editor === 'new' ? undefined : editor} id={editor === 'new' ? createId : undefined}
    page={pageEdit ? { handle: editHandle, backLabel: tab === 'todo' ? (libraryOpen ? '返回全部事项' : '返回待办') : '返回日程' } : undefined}
    categories={data.categories} api={editorApi} changed={state => mutate(async () => state)} saved={saveItem} close={closeEditor} />;

  return <section ref={todoView} className="view on todo-workspace" id="view-todo" aria-label="日程待办" tabIndex={-1}>
    <div className="todo-panel">
      {reminder && !libraryOpen && <div className="reminder-strip"><Clock size={15} /><span>{reminder.title}</span><button onClick={() => { void mutate(() => api.snooze(reminder.id), '将在10分钟后提醒'); }}>稍后10分钟</button></div>}
      <TodayBoard tasks={data.tasks} today={today} categoryById={categoryById} planView={planView} mutating={false} api={editorApi} mutate={mutate} setEditor={editItem}
        workspace={{ tab, onTab: setTab, leaveDetails, workspaceHeader, calendarActions: addAction, editForm: pageEdit ? editForm : undefined, coverage: (start, end, toolbarTarget) => <WelinkWeekCoverage key={start + ':' + end} start={start} end={end} toolbarTarget={toolbarTarget} />,
          records: (onRecordMeeting || onRooms) && <div className="meeting-tools">
            {onRecordMeeting && <button type="button" className="btn btn-pri btn-sm" onClick={() => onRecordMeeting()}>会议伴侣</button>}
            {onRooms && <button type="button" className="btn btn-sec btn-sm" onClick={onRooms}>会议室预约</button>}
          </div>, details: (task, visible, controls) => {
            const external = task.source === 'welink';
            const info = <ScheduleInfo category={categoryById.get(task.categoryId ?? '')?.name} remindAt={task.remindAt} note={external ? undefined : task.note} />;
            const originals = task.displaySources?.flatMap(source => data.tasks.find(row => row.id === source.taskId && !row.deletedAt) ?? []);
            const actions = <div className="calendar-detail-actions">
              {!controls.expanded && task.kind === 'meeting' && onPrepareMeeting && <button type="button" className="btn btn-sec btn-sm" onClick={() => onPrepareMeeting(task)}>整理会前材料</button>}
              {!controls.expanded && task.kind === 'meeting' && onRecordMeeting && <button type="button" className="btn btn-sec btn-sm" onClick={() => onRecordMeeting(task)}>录制与纪要</button>}
              <button type="button" className={`btn ${external ? 'btn-sec' : 'btn-pri'} btn-sm`} onClick={() => editItem(task)}>
                {external ? <IconDocs size={15} /> : <PencilSimple size={15} aria-hidden="true" />}
                {external ? '查看日程详情' : '编辑日程'}
              </button>
            </div>;
            if (!external) return <>{info}{actions}</>;
            return <>
              {!controls.expanded && <div className="calendar-detail-meta"><TaskSourceBadge source={task.source} external={task.external} displaySources={task.displaySources} /></div>}
              {!controls.expanded && info}
              <WelinkScheduleDetails key={JSON.stringify([task.id, task.dateAt, task.endAt, task.external?.provider === 'meeting' ? task.updatedAt : task.external?.changeKey])} task={task}
                meeting={task.external?.provider === 'calendar' ? welinkMeetingPeer(task, data.tasks) : task} visible={visible} now={clock.getTime()}
                controls={controls} actions={controls.expanded && originals && originals.length > 1 ? null : actions} originals={originals} openOriginal={editItem} />
            </>;
          } }}
        toolbar={<div className="dash-actions">{!libraryOpen && <span className="todo-style-control"><GameOptionsMenu kind="dashboard" active={!libraryOpen} context={planView} label="更换待办样式">{close => <><div className="dashboard-style-menu-title">更换样式</div>{(['rows', 'tiles'] as const).map(value => <button key={value} type="button" className="todo-style-option" role="menuitemradio" aria-checked={planView === value} onClick={() => { changePlanView(value); close(); }}><span>{value === 'rows' ? '列表' : '卡片'}</span><CheckCircle size={16} weight="fill" aria-hidden="true" /></button>)}</>}</GameOptionsMenu></span>}<button type="button" className="btn btn-sec btn-sm" aria-pressed={libraryOpen} onClick={() => setLibraryOpen(value => !value)}><IconDocs size={14} />全部事项</button>{addAction}</div>}
        todoContent={libraryOpen ? <TaskLibrary tasks={data.tasks} categories={data.categories} api={libraryApi} changed={state => mutate(async () => state)} edit={editItem} close={() => setLibraryOpen(false)} /> : undefined} />
    </div>
    {!pageEdit && editForm}
    <div className="todo-notice" data-show={notice ? '1' : '0'} role="status" aria-live="polite">{notice}</div>
  </section>;
}
