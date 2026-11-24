import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { CaretRight, Clock, FileText } from '@phosphor-icons/react';
import { activeToday, localDay, taskDay, taskTime, type TimedSchedule, type Task } from '../../shared/todo-contracts';
import { welinkDisplayTasks, welinkMeetingPeer } from '../../shared/welink-display';
import { scheduleStamp } from '../../shared/todo-format';
import { TaskEditor, type TaskEditHandle, type TaskEditorApi, type TodoState } from '../../modules/todo/ui/TaskEditor';
import { TodayBoard, type Mutate } from '../../modules/todo/ui/TodayBoard';
import { ScheduleInfo, type ScheduleDetailRequest, type ScheduleDetailTab, type ScheduleTab } from '../../modules/todo/ui/CalendarWorkspace';
import { TaskLibrary } from '../../modules/todo/ui/TaskLibrary';
import { TaskCreateButton } from '../../modules/todo/ui/TaskScheduling';
import { TaskSourceBadge } from '../../modules/todo/ui/TaskSourceBadge';
import { IconDocs } from '../icons';
import { WelinkScheduleDetails, WelinkWeekCoverage } from './WelinkSchedule';
import { ScheduleMeetingTabs } from './ScheduleMeetingTabs';
import { dueReminderGroups, meetingReminderEnded, SNOOZE_MINUTES } from '../../shared/todo-reminders';

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
  const createId = useId();
  const [createDefaults, setCreateDefaults] = useState<{ kind: Task['kind']; time?: TimedSchedule } | null>(null);
  const [detailRequest, setDetailRequest] = useState<ScheduleDetailRequest | null>(null);
  const [meetingEditVersion, setMeetingEditVersion] = useState(0);
  const [original, setOriginal] = useState<Task | null>(null);
  const todoView = useRef<HTMLElement>(null);
  const editOrigin = useRef<HTMLElement | null>(null);
  const focusAfterEdit = useRef<HTMLElement | null | undefined>(undefined);
  const appMeeting = editor && editor !== 'new' && editor.kind === 'meeting' ? editor : null;
  const editing = appMeeting ? null : editor;
  const pageEdit = editing && editing !== 'new' && editing.source !== 'welink';
  function closeEditor(restoreFocus = true) {
    if (pageEdit && restoreFocus) focusAfterEdit.current = editOrigin.current;
    editOrigin.current = null;
    setCreateDefaults(null);
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
  function openMeeting(task: Task, panel: ScheduleDetailTab) {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const source = tab === 'records' ? 'records' : 'calendar';
    leaveDetails(() => {
      if (tab !== source) setTab(source);
      setDetailRequest({ taskId: task.id, tab: panel, source, trigger, returnTo: tab === 'todo' ? 'todo' : undefined });
    });
  }
  function editItem(task: Task) {
    if (task.kind === 'meeting') { openMeeting(task, 'info'); return; }
    const origin = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    leaveDetails(() => { editOrigin.current = origin; setEditor(task); });
  }
  function openRecordingTask(id: string) {
    const task = data.tasks.find(item => item.id === id && !item.deletedAt);
    if (task) editItem(task);
    else setNotice('关联待办已删除或不可用。');
  }
  function resetMeetingEditor() {
    setMeetingEditVersion(version => version + 1);
  }
  useEffect(() => {
    if (appMeeting) { openMeeting(appMeeting, 'info'); setEditor(null); }
  }, [appMeeting]);
  const today = localDay(clock), categoryById = new Map(data.categories.map(category => [category.id, category]));
  const now = clock.getTime();
  const reminder = dueReminderGroups(activeToday(data.tasks, today), now)[0]?.task;
  const [reminderBusy, setReminderBusy] = useState(false);
  const dismissReminder = (id: string) => mutate(() => api.dismissMeetingReminder(id), '本场提醒已关闭');
  async function changeReminder(task: Task, dismiss: boolean) {
    if (reminderBusy) return;
    setReminderBusy(true);
    try {
      if (dismiss) await dismissReminder(task.id);
      else await mutate(() => api.snooze(task.id), meetingReminderEnded(task, now + SNOOZE_MINUTES * 60000)
        ? '会议结束后停止提醒' : '将在10分钟后提醒');
    } finally { setReminderBusy(false); }
  }
  function createItem(kind: Task['kind'], time?: TimedSchedule) {
    setCreateDefaults({ kind, time });
    setEditor('new');
  }
  const addAction = <TaskCreateButton onClick={() => leaveDetails(() => createItem('task'))} />;
  function saveItem(state: TodoState, message: string) {
    const updated = mutate(async () => state);
    setNotice(message);
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

  const editForm = editing && <TaskEditor key={editing === 'new' ? 'new' : editing.id} task={editing === 'new' ? undefined : editing} id={editing === 'new' ? createId : undefined}
    initialKind={createDefaults?.kind} initialSchedule={createDefaults?.time}
    page={pageEdit ? { handle: editHandle, backLabel: tab === 'todo' ? (libraryOpen ? '返回全部事项' : '返回待办') : '返回会议详情' } : undefined}
    categories={data.categories} api={editorApi} changed={state => mutate(async () => state)} saved={saveItem} close={closeEditor} />;

  const records = tab === 'records' ? welinkDisplayTasks(data.tasks.filter(task => task.kind === 'meeting' && !task.deletedAt))
    .sort((a, b) => (taskDay(b) ?? '').localeCompare(taskDay(a) ?? '') || taskTime(b) - taskTime(a)) : [];

  return <section ref={todoView} className="view on todo-workspace" id="view-todo" aria-label="日程待办" tabIndex={-1}>
    <div className="todo-panel">
      {reminder && !libraryOpen && <div className="reminder-strip" aria-busy={reminderBusy}>
        <Clock size={15} aria-hidden="true" /><span title={reminder.title}>{reminder.title}</span>
        <button type="button" disabled={reminderBusy} onClick={() => void changeReminder(reminder, false)}>稍后10分钟</button>
        {reminder.kind === 'meeting' && <button type="button" className="reminder-dismiss" disabled={reminderBusy}
          onClick={() => void changeReminder(reminder, true)}>不再提醒</button>}
      </div>}
      <TodayBoard tasks={data.tasks} today={today} categoryById={categoryById} planView="rows" mutating={false} api={editorApi} mutate={mutate} setEditor={editItem}
        onCardSaved={state => saveItem(state, '待办已保存')}
        workspace={{ tab, onTab: setTab, leaveDetails, workspaceHeader, createItem, taskEditHandle: editHandle, editForm: pageEdit ? editForm : undefined, detailRequest, coverage: (start, end, toolbarTarget) => <WelinkWeekCoverage key={start + ':' + end} start={start} end={end} toolbarTarget={toolbarTarget} />,
          records: (openRecord, activeId) => <section className="calendar-records" aria-label="会议记录">
            {(onRecordMeeting || onRooms) && <div className="calendar-records-tools">
              {onRecordMeeting && <button type="button" className="btn btn-sec btn-sm" onClick={() => onRecordMeeting()}>会议伴侣</button>}
              {onRooms && <button type="button" className="btn btn-sec btn-sm" onClick={onRooms}>会议室预约</button>}
            </div>}
            {records.length ? <ul className="calendar-record-list">{records.map(task =>
              <li key={task.id}><button type="button" aria-current={activeId === task.id || undefined} onClick={() => openRecord(task)}>
                <FileText size={17} aria-hidden="true" />
                <span><strong>{task.title}</strong><small>{scheduleStamp(task)}</small></span>
                <CaretRight size={15} aria-hidden="true" />
              </button></li>)}</ul> : <p className="plan-empty">暂无会议记录</p>}
          </section>,
          details: (task, controls) => {
            const recordMeeting = onRecordMeeting ? () => onRecordMeeting(task) : undefined;
            const prepareMeeting = onPrepareMeeting ? () => onPrepareMeeting(task) : undefined;
            if (task.source === 'welink') {
              const originals = task.displaySources?.flatMap(source => data.tasks.find(row => row.id === source.taskId && !row.deletedAt) ?? []);
              return <WelinkScheduleDetails key={JSON.stringify([task.id, task.dateAt, task.endAt, task.external?.provider === 'meeting' ? task.updatedAt : task.external?.changeKey])}
                task={task} meeting={task.external?.provider === 'calendar' ? welinkMeetingPeer(task, data.tasks) : task} now={clock.getTime()}
                controls={controls} originals={originals} openOriginal={setOriginal} leaveDetails={leaveDetails} openTask={openRecordingTask} recordMeeting={recordMeeting} prepareMeeting={prepareMeeting}
                summary={<><div className="calendar-detail-meta"><TaskSourceBadge source={task.source} external={task.external} displaySources={task.displaySources} />
                  <span className="calendar-detail-readonly">只读</span></div><ScheduleInfo category={categoryById.get(task.categoryId ?? '')?.name}
                    task={task} now={now} onDismissReminder={() => dismissReminder(task.id)} /></>} />;
            }
            const info = !pageEdit && controls.tab === 'info' && <TaskEditor key={`${task.id}:${meetingEditVersion}`} task={task}
              categories={data.categories} api={editorApi} page={{ handle: editHandle }}
              meetingReminder={{ now, dismiss: api.dismissMeetingReminder }}
              changed={state => mutate(async () => state)} saved={saveItem} close={resetMeetingEditor} />;
            return <ScheduleMeetingTabs key={task.id} task={task} controls={controls} info={info} leaveDetails={leaveDetails}
              recordMeeting={recordMeeting} prepareMeeting={prepareMeeting} openTask={openRecordingTask} />;
          } }}
        toolbar={<div className="dash-actions">
          <button type="button" className="btn btn-sec btn-sm" aria-pressed={libraryOpen} onClick={() => leaveDetails(() => setLibraryOpen(value => !value))}><IconDocs size={14} />全部事项</button>
          {addAction}
        </div>}
        todoContent={libraryOpen ? <TaskLibrary tasks={data.tasks} categories={data.categories} api={libraryApi} changed={state => mutate(async () => state)} edit={editItem} close={() => setLibraryOpen(false)} /> : undefined} />
    </div>
    {!pageEdit && editForm}
    {original && <TaskEditor key={original.id} task={original} categories={data.categories} api={editorApi}
      changed={state => mutate(async () => state)} saved={saveItem} close={() => setOriginal(null)} />}
    <div className="todo-notice" data-show={notice ? '1' : '0'} role="status" aria-live="polite">{notice}</div>
  </section>;
}
