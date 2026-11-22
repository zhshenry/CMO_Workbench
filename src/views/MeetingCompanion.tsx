import { useEffect, useRef, useState } from 'react';
import type { MeetingRecording, MeetingRecordingSummary } from '../../shared/meeting-companion';
import { validateSpeechWave } from '../../shared/speech-audio';
import type { Task } from '../../shared/todo-contracts';
import { MeetingRecorder } from '../ui/meeting-recorder';
import { errorText, Modal, Select } from '../ui/controls';
import { MeetingActionControl } from './MeetingActionControl';
import './meeting-workspace.css';

const time = (ms: number) => [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map(n => String(n).padStart(2, '0')).join(':');
const stateText = { recording: '录制中', stopped: '已结束', interrupted: '录制中断' };
const noteKind = { topic: '议题', fact: '事实', decision: '决定', action: '行动项', question: '待核实' };

export function MeetingCompanion({ open, task, close, onTask }: { open: boolean; task?: Task; close(): void; onTask(id: string): void }) {
  const api = window.workbench.meetingCompanion;
  const [history, setHistory] = useState<MeetingRecordingSummary[]>([]), [record, setRecord] = useState<MeetingRecording>();
  const [sources, setSources] = useState<{ id: string; label: string }[]>([]), [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [title, setTitle] = useState(''), [screen, setScreen] = useState(''), [device, setDevice] = useState('');
  const [microphone, setMicrophone] = useState(true), [systemAudio, setSystemAudio] = useState(false), [autoNotes, setAutoNotes] = useState(false);
  const [useFrames, setUseFrames] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [checking, setChecking] = useState<string>();
  const [paused, setPaused] = useState(false), [seek, setSeek] = useState('');
  const [question, setQuestion] = useState(''), [answer, setAnswer] = useState('');
  const [media, setMedia] = useState<{ url: string; kind: 'audio' | 'frame'; at: number; offset: number }>();
  const mediaPreview = useRef<HTMLElement>(null);
  const recorder = useRef<{ id: string; capture: MeetingRecorder } | null>(null), selected = useRef('');
  const busyRef = useRef(false);

  function choose(id: string) {
    selected.current = id; setChecking(undefined); setAnswer(''); setSeek(''); setMedia(undefined);
    if (!id) { setRecord(undefined); return; }
    void api.get(id).then(value => { if (selected.current === id) setRecord(value); }, cause => setError(errorText(cause)));
  }
  useEffect(() => {
    if (!open) return;
    let active = true;
    setTitle(task?.title ?? ''); setError('');
    void api.list().then(list => {
      if (!active) return;
      setHistory(list);
      const row = recorder.current?.id ?? (task ? list.find(item => item.taskId === task.id)?.id : list[0]?.id);
      if (row) choose(row); else choose('');
    }, cause => { if (active) setError(errorText(cause)); });
    void api.sources().then(available => { if (active) setSources(available); }, cause => { if (active) setError(errorText(cause)); });
    void navigator.mediaDevices?.enumerateDevices().then(devices => { if (active) setInputDevices(devices.filter(item => item.kind === 'audioinput' && item.deviceId && item.label)); }).catch(() => {});
    const off = api.onChanged(id => {
      void api.list().then(list => { if (active) setHistory(list); }).catch(() => {});
      if (selected.current === id) void api.get(id).then(value => { if (active && selected.current === id) setRecord(value); }).catch(cause => { if (active) setError(errorText(cause)); });
    });
    return () => { active = false; off(); };
  }, [api, open, task?.id]);
  useEffect(() => {
    if (!media) return;
    mediaPreview.current?.scrollIntoView({ block: 'nearest' });
    return () => URL.revokeObjectURL(media.url);
  }, [media]);

  async function run(label: string, action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(label); setError('');
    try { await action(); } catch (cause) { setError(errorText(cause)); }
    finally { busyRef.current = false; setBusy(''); }
  }
  async function stop() {
    const active = recorder.current;
    if (!active) return;
    recorder.current = null;
    setPaused(false);
    await active.capture.stop();
    const value = await api.stop(active.id);
    if (selected.current === value.id) setRecord(value);
  }
  async function start() {
    if (recorder.current || !title.trim() || !microphone && !screen) return;
    const value = await api.start({ title, taskId: task?.id, autoNotes, useFrames: !!screen && useFrames, sourceId: screen || undefined, systemAudio: !!screen && systemAudio });
    selected.current = value.id; setRecord(value); setMedia(undefined); setAnswer(''); setSeek('');
    const capture = new MeetingRecorder(value.id, value.startedAt, cause => setError(errorText(cause)), () => {
      void stop().catch(cause => setError(errorText(cause)));
    });
    recorder.current = { id: value.id, capture };
    try { await capture.start(!!screen, !!screen && systemAudio, microphone, device); }
    catch (cause) { await stop(); throw cause; }
  }

  if (!open) return null;
  const timeline = record ? [...record.transcript.map(row => ({ ...row, kind: 'audio' as const })), ...record.frames.map(row => ({ ...row, kind: 'frame' as const }))]
    .sort((a, b) => a.at - b.at) : [];
  const hasEvidence = record?.transcript.some(row => row.text) || !!(record?.useFrames && record.frames.length);
  const readMedia = async (item: { id: string; at: number }, kind: 'audio' | 'frame', at = item.at) => {
    if (!record) return false;
    const bytes = new Uint8Array(await api.media(record.id, item.id, kind));
    if (selected.current !== record.id) return false;
    const offset = Math.max(0, at - item.at) / 1000;
    if (kind === 'audio' && offset && offset >= validateSpeechWave(bytes)) return false;
    const url = URL.createObjectURL(new Blob([bytes], { type: kind === 'audio' ? 'audio/wav' : 'image/jpeg' }));
    setMedia({ url, kind, at, offset });
    return true;
  };
  const showMedia = (item: { id: string; at: number }, kind: 'audio' | 'frame') => void run('读取材料', async () => {
    await readMedia(item, kind);
  });
  const seekTo = (value: string) => void run('定位会议材料', async () => {
    const parts = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(value.trim());
    if (!parts) throw new Error('请输入会议经过时间，格式为 00:00:00。');
    const at = (Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3])) * 1000;
    if (!record || at > (record.endedAt ?? Date.now()) - record.startedAt) throw new Error('该时间超出会议记录范围。');
    const audio = record.transcript.find(row => row.at >= at && row.at < at + 1000)
      ?? record.transcript.filter(row => row.at <= at).sort((a, b) => b.at - a.at)[0];
    if (audio && (audio.durationMs === undefined || at < audio.at + audio.durationMs) && await readMedia(audio, 'audio', at)) return;
    const frame = record.frames.filter(row => row.at <= at).sort((a, b) => b.at - a.at)[0];
    if (frame && await readMedia(frame, 'frame')) return;
    setMedia(undefined);
    throw new Error('该时间没有已保存的音频或截图。');
  });
  return <Modal title="会议伴侣" close={close} className="meeting-workspace" closeText="返回日程">
    <div className="meeting-controls">
      <Select aria-label="会议记录" value={record?.id ?? ''} options={[{ value: '', label: '新录制' }, ...history.map(item => ({ value: item.id, label: `${item.title} · ${new Date(item.startedAt).toLocaleDateString('zh-CN')}` }))]} onChange={choose} />
      {recorder.current ? <>
        <button type="button" className="btn btn-sec btn-sm" disabled={!!busy} onClick={() => {
          const capture = recorder.current?.capture;
          if (!capture) return;
          if (paused) capture.resume(); else capture.pause();
          setPaused(!paused);
        }}>{paused ? '继续录制' : '暂停录制'}</button>
        <button type="button" className="btn btn-pri btn-sm" disabled={!!busy} onClick={() => void run('正在保存录制', stop)}>停止录制</button>
      </>
        : <button type="button" className="btn btn-pri btn-sm" disabled={!!busy || !title.trim() || !microphone && !screen} onClick={() => void run('正在准备录制', start)}>开始录制</button>}
    </div>
    {!recorder.current && <div className="meeting-setup">
      <label>会议标题<input value={title} maxLength={200} placeholder="输入会议标题" onChange={event => setTitle(event.target.value)} /></label>
      <Select aria-label="录制画面" value={screen} onChange={value => { setScreen(value); if (!value) { setSystemAudio(false); setUseFrames(false); } }}
        options={[{ value: '', label: '不采集画面' }, ...sources.map(source => ({ value: source.id, label: source.label }))]} />
      <label><input type="checkbox" checked={microphone} onChange={event => setMicrophone(event.target.checked)} />麦克风</label>
      {microphone && !!inputDevices.length && <Select aria-label="麦克风设备" value={device} onChange={setDevice} options={[{ value: '', label: '默认麦克风' }, ...inputDevices.map(input => ({ value: input.deviceId, label: input.label }))]} />}
      <label><input type="checkbox" checked={systemAudio} disabled={!screen} onChange={event => setSystemAudio(event.target.checked)} />系统声音</label>
      <label><input type="checkbox" checked={autoNotes} onChange={event => setAutoNotes(event.target.checked)} />自动整理纪要</label>
      {screen && <label title="仅在整理纪要或问答时将精选截图发送给支持图片的办公助理模型"><input type="checkbox" checked={useFrames} onChange={event => setUseFrames(event.target.checked)} />允许模型读取精选截图</label>}
    </div>}
    {busy && <p role="status">{busy}…</p>}{error && <p role="alert" className="meeting-error">{error}</p>}
    {record && <>
      <div className="meeting-controls"><h3>{record.title} <small role="status">{recorder.current?.id === record.id && paused ? '录制已暂停' : stateText[record.status]}</small></h3>
        <button type="button" className="btn btn-sec btn-sm" disabled={!!busy || !hasEvidence} onClick={() => void run('正在整理纪要', async () => setRecord(await api.organize(record.id)))}>整理纪要</button>
        <button type="button" className="text-button" disabled={!!busy} onClick={() => void run('导出纪要', async () => { await api.export(record.id); })}>导出</button>
        {record.transcript.some(row => row.status !== 'ready') && record.status !== 'recording' && <button type="button" className="text-button" disabled={!!busy} onClick={() => void run('补转写', () => api.retry(record.id))}>补转写</button>}
      </div>
      {record.noteError && <p className="meeting-error" role="status">{record.noteError}</p>}
      <div className="meeting-content">
        <section aria-label="会议纪要"><h3>纪要</h3>
          {record.minutes.map(note => <article className="meeting-note" key={note.id}><small>{noteKind[note.kind]}</small><p>{note.text}</p>
            {note.sources.map(id => { const row = timeline.find(value => value.id === id); return row && <button className="text-button" type="button" key={id} onClick={() => showMedia(row, row.kind)}>{time(row.at)} {row.kind === 'audio' ? '原话' : '截图'}</button>; })}
            <MeetingActionControl note={note} busy={!!busy} confirming={checking === note.id} toggle={() => setChecking(checking === note.id ? undefined : note.id)}
              openTask={onTask} create={() => run('正在创建待办', async () => {
              await api.action(record.id, note.id); setChecking(undefined);
            })} />
          </article>)}
          {!record.minutes.length && <p className="office-empty">取得转写或可分析截图后，可整理纪要。</p>}
        </section>
        <section aria-label="会议时间线"><h3>时间线</h3>
          {!!timeline.length && <form className="meeting-controls" onSubmit={event => { event.preventDefault(); seekTo(seek); }}>
            <input aria-label="会议经过时间" placeholder="00:00:00" value={seek} maxLength={9} onChange={event => setSeek(event.target.value)} />
            <button type="submit" className="btn btn-sec btn-sm" disabled={!!busy || !seek.trim()}>定位</button>
          </form>}
          {media && <figure className="meeting-media" ref={mediaPreview}><figcaption>{time(media.at)}</figcaption>{media.kind === 'audio'
            ? <audio key={media.url} controls src={media.url} onLoadedMetadata={event => { event.currentTarget.currentTime = media.offset; }} />
            : <img src={media.url} alt={`会议画面 ${time(media.at)}`} />}</figure>}
          {timeline.map(row => <article className="meeting-note" key={row.id}>
              <button type="button" className="text-button" onClick={() => showMedia(row, row.kind)}>{time(row.at)} {row.kind === 'frame' ? '查看画面' : '回听音频'}</button>
              {row.kind === 'audio' && <p>{row.text || (row.status === 'queued' ? '等待转写' : row.status === 'failed' ? row.error || '转写失败' : '静音或未识别到语音')}</p>}
            </article>)}
        </section>
      </div>
      <form className="meeting-controls" onSubmit={event => { event.preventDefault(); if (question.trim() && hasEvidence) void run('正在回查会议材料', async () => setAnswer(await api.ask(record.id, question))); }}>
        <input aria-label="向会议提问" maxLength={2000} value={question} placeholder="问这场会议的决定或细节" onChange={event => setQuestion(event.target.value)} />
        <button type="submit" className="btn btn-sec btn-sm" disabled={!question.trim() || !!busy || !hasEvidence}>提问</button>
        {record.status !== 'recording' && <button type="button" className="text-button" disabled={!!busy || !hasEvidence} onClick={() => void run('正在复核会议', async () => setAnswer(await api.ask(record.id, '复核会后纪要。找出可能遗漏的决定、行动项和前后矛盾，给出原话时间。')))}>会后复核</button>}
      </form>
      {answer && <p className="meeting-answer" aria-live="polite">{answer.split(/(\d{2,3}:[0-5]\d:[0-5]\d)/).map((part, index) => {
        return index % 2 ? <button type="button" className="text-button" key={index} onClick={() => seekTo(part)}>{part}</button> : part;
      })}</p>}
    </>}
  </Modal>;
}
