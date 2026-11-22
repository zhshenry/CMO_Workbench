import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ClipboardText, Microphone } from '@phosphor-icons/react';
import type { MeetingMinute, MeetingRecording } from '../../shared/meeting-companion';
import type { Task } from '../../shared/todo-contracts';
import type { ScheduleDetailControls } from '../../modules/todo/ui/CalendarWorkspace';
import { ScheduleDetailTabs } from '../../modules/todo/ui/ScheduleDetailTabs';
import { errorText } from '../ui/controls';
import { MeetingActionControl } from './MeetingActionControl';

const api = window.workbench.meetingCompanion;

export function ScheduleMeetingTabs({ task, controls, info, materials, leaveDetails, recordMeeting, prepareMeeting, openTask }: {
  task: Task; controls: ScheduleDetailControls; info: ReactNode; materials?(active: boolean): ReactNode;
  leaveDetails(navigate: () => void): void; recordMeeting?(): void; prepareMeeting?(): void; openTask(id: string): void;
}) {
  const [recordings, setRecordings] = useState<MeetingRecording[]>();
  const [loadError, setLoadError] = useState(''), [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false), [actionError, setActionError] = useState('');
  const creating = useRef(false);
  const [checking, setChecking] = useState<string>();
  const recordingScope = JSON.stringify([task.id, ...(task.displaySources?.map(source => source.taskId) ?? [])]);
  const reading = controls.tab !== 'info';
  useEffect(() => {
    if (!reading) return;
    const ids = new Set<string>(JSON.parse(recordingScope));
    let request = 0;
    async function load() {
      const version = ++request;
      try {
        const list = await api.list();
        if (version !== request) return;
        const matches = await Promise.all(list.filter(item => item.taskId && ids.has(item.taskId)).map(item => api.get(item.id)));
        if (version === request) { setRecordings(matches); setLoadError(''); }
      } catch (cause) {
        if (version === request) setLoadError(errorText(cause));
      }
    }
    void load();
    const unsubscribe = api.onChanged(() => void load());
    return () => { ++request; unsubscribe(); };
  }, [reading, recordingScope, retry]);

  async function createTask(record: MeetingRecording, note: MeetingMinute) {
    if (creating.current) return;
    creating.current = true; setBusy(true); setActionError('');
    try {
      const taskId = await api.action(record.id, note.id);
      setRecordings(current => current?.map(item => item.id === record.id ? {
        ...item, minutes: item.minutes.map(value => value.id === note.id ? { ...value, taskId } : value),
      } : item));
      setChecking(undefined);
      setRetry(value => value + 1);
    } catch (cause) {
      setActionError(errorText(cause));
    } finally { creating.current = false; setBusy(false); }
  }

  const actions = recordings?.flatMap(record => record.minutes.filter(note => note.kind === 'action').map(note => ({ record, note }))) ?? [];
  const minutes = recordings?.filter(record => record.minutes.some(note => note.kind !== 'action')) ?? [];
  const status = loadError ? <><p role="alert">{loadError}</p><button type="button" className="text-button" onClick={() => setRetry(value => value + 1)}>重试读取</button></>
    : recordings ? null : <p className="calendar-detail-hint" role="status">正在读取录制记录…</p>;
  return <ScheduleDetailTabs selected={controls.tab} onTab={controls.onTab} leaveDetails={leaveDetails} tabs={[
    { id: 'info', label: '日程信息', content: () => info },
    { id: 'materials', label: '会议资料', content: active => <>
      {prepareMeeting && <button type="button" className="btn btn-sec btn-sm" onClick={prepareMeeting}><ClipboardText size={16} aria-hidden="true" />整理会前材料</button>}
      {materials?.(active)}
      <section className="calendar-detail-section">
        <div className="calendar-recording-heading"><h3>录制纪要</h3>
          {recordMeeting && <button type="button" className="btn btn-sec btn-sm" onClick={recordMeeting}><Microphone size={15} aria-hidden="true" />录制与纪要</button>}
        </div>
        {status ?? (!minutes.length && <p className="calendar-detail-hint">暂无录制纪要。</p>)}
        {minutes.map(record => <div className="calendar-recording-note" key={record.id}>
          <strong>{record.title}</strong>
          {record.minutes.filter(note => note.kind !== 'action').map(note => <p key={note.id}>{note.text}</p>)}
        </div>)}
      </section>
    </> },
    { id: 'actions', label: '行动项', content: () => <section className="calendar-detail-section" aria-label="会议行动项">
      {status ?? (!actions.length && <p className="calendar-detail-hint">暂无已整理的行动项。</p>)}
      {actions.map(({ record, note }) => {
        const key = record.id + ':' + note.id;
        return <article className="meeting-note" key={key}>
          <p>{note.text}</p>
          <MeetingActionControl note={note} busy={busy} confirming={checking === key} toggle={() => setChecking(checking === key ? undefined : key)}
            openTask={openTask} create={() => createTask(record, note)} />
        </article>;
      })}
      {actionError && <p role="alert" className="meeting-error">{actionError}</p>}
    </section> },
  ]} />;
}
