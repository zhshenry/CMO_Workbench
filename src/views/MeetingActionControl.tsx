import type { MeetingMinute } from '../../shared/meeting-companion';

export function MeetingActionControl({ note, busy, confirming, toggle, openTask, create }: {
  note: MeetingMinute; busy: boolean; confirming: boolean; toggle(): void; openTask(id: string): void; create(): Promise<void>;
}) {
  if (note.taskId) return <button type="button" className="text-button" onClick={() => openTask(note.taskId!)}>查看待办</button>;
  if (note.kind !== 'action') return null;
  return <>
    <button type="button" className="text-button" aria-expanded={confirming} disabled={busy} onClick={toggle}>转待办</button>
    {confirming && <button type="button" className="btn btn-pri btn-sm" disabled={busy} onClick={() => void create()}>确认创建</button>}
  </>;
}
