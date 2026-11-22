import { TaskFieldRow } from '../../modules/todo/ui/TaskFormFields';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowClockwise, CaretRight, WarningCircle, LinkSimple, MapPin, TextAlignLeft, Users } from '@phosphor-icons/react';
import type { Task } from '../../shared/todo-contracts';
import { scheduleTimeRange } from '../../shared/todo-format';
import type { WelinkWeekStatus } from '../../shared/island-contracts';
import { welinkSourceName, type WelinkEventDetails, type WelinkSourceStatus } from '../../shared/welink-agenda';
import type { MeetingMaterial, MeetingMaterialResult } from '../../shared/weclaw-content';
import type { ScheduleDetailControls } from '../../modules/todo/ui/CalendarWorkspace';
import { ScheduleDetailTabs } from '../../modules/todo/ui/ScheduleDetailTabs';
import { ScheduleMeetingTabs } from './ScheduleMeetingTabs';
import { errorText } from '../ui/controls';

const formatSyncTime = (timestamp: number) => new Date(timestamp).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
function sourceLabel(source: WelinkSourceStatus | undefined) {
  if (!source || source.state === 'idle') return '未读取';
  if (source.state === 'success') return source.lastSuccessAt ? '已更新 ' + formatSyncTime(source.lastSuccessAt) : '已更新';
  return (source.state === 'partial' ? '部分更新' : '未更新') + (source.count ? ' · 含缓存' : '');
}

export function WelinkWeekCoverage({ start, end, toolbarTarget }: { start: string; end: string; toolbarTarget: HTMLDivElement | null }) {
  const statusId = useId();
  const [status, setStatus] = useState<WelinkWeekStatus>();
  const [request, setRequest] = useState({ id: 0, manual: false });
  const [busy, setBusy] = useState(true);
  const lastConnection = useRef<WelinkWeekStatus['connection']>(undefined);
  const island = window.workbench.island;
  useEffect(() => island.onWelinkSyncChanged?.(sync => {
    if (busy || sync.syncing || !sync.connection || sync.connection === lastConnection.current) return;
    lastConnection.current = sync.connection;
    setBusy(true); setRequest(current => ({ manual: false, id: current.id + 1 }));
  }), [busy, island]);
  useEffect(() => {
    let current = true;
    const timer = setTimeout(() => {
      void island.welinkWeek(start, end, request.manual).then(value => {
        if (current) { lastConnection.current = value.connection; setStatus(value); }
      }, cause => {
        if (current) setStatus({ automatic: true, error: errorText(cause) });
      }).finally(() => { if (current) setBusy(false); });
    }, request.manual ? 0 : 180);
    return () => { current = false; clearTimeout(timer); };
  }, [start, end, island, request]);

  const needsLogin = status?.connection === 'needs-login';
  const desktopUnavailable = status?.connection === 'client-closed';
  const openSettings = needsLogin || desktopUnavailable;
  const temporary = status?.connection === 'temporary';
  const hasIssue = !busy && (openSettings || temporary || Boolean(status?.error)
    || Object.values(status?.sources ?? {}).some(source => source.state === 'error' || source.state === 'partial'));
  const label = needsLogin ? '重新扫码' : desktopUnavailable ? '连接 WeLink' : busy ? '刷新中…'
    : hasIssue ? '重试外部日程' : '刷新外部日程';
  const state = busy ? '正在读取当前日程…' : needsLogin ? 'WeLink 需要重新扫码' : desktopUnavailable
    ? 'WeLink 桌面客户端未连接' : temporary ? '暂时无法更新外部日程' : '';
  const sources = !busy && status?.sources;
  const details = sources ? (['meeting', 'calendar'] as const).map(provider => {
    const source = sources[provider];
    return [welinkSourceName(provider) + '：' + sourceLabel(source), source?.error,
      source?.state !== 'success' && source?.lastSuccessAt ? '上次更新 ' + formatSyncTime(source.lastSuccessAt) : ''].filter(Boolean).join(' · ');
  }) : [];
  const summary = [state, ...details, !busy && !sources ? status?.error : ''].filter(Boolean).join('\n');
  const Icon = hasIssue || openSettings ? WarningCircle : ArrowClockwise;

  function runAction() {
    if (openSettings) {
      void island.navigate({ view: 'settings-welink' });
      return;
    }
    setBusy(true);
    setRequest(value => ({ id: value.id + 1, manual: true }));
  }

  const control = <div className="calendar-coverage" aria-busy={busy}>
    <button type="button" className="btn btn-sec btn-sm" aria-label={label} aria-describedby={summary ? statusId : undefined}
      title={[label, summary].filter(Boolean).join('\n')} disabled={busy && !openSettings} onClick={runAction}>
      <Icon aria-hidden="true" size={14} />
    </button>
    <div id={statusId} className="calendar-coverage-status" role="status">{summary}</div>
  </div>;
  return toolbarTarget && createPortal(control, toolbarTarget);
}

const materialLabels = { minutes: '纪要', transcript: 'AI 听', notes: 'WeNote 笔记' } satisfies Record<MeetingMaterial, string>;
const meetingStamp = (iso: string) => new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function MeetingMaterialPanel({ taskId, material, active }: { taskId: string; material: MeetingMaterial; active: boolean }) {
  const label = materialLabels[material];
  const [request, setRequest] = useState<{ candidate?: string; refresh?: boolean } | null>(null);
  const [result, setResult] = useState<MeetingMaterialResult>();
  useEffect(() => {
    if (active) setRequest(current => current ?? {});
  }, [active]);
  useEffect(() => {
    if (!request) return;
    let current = true;
    setResult(undefined);
    void Promise.resolve().then(() => window.workbench.island.welinkMeetingContent({ taskId, material, ...request })).then(value => {
      if (current) setResult(value[material] ?? { status: 'request-failed', message: '暂时无法读取，请稍后重试。' });
    }, () => { if (current) setResult({ status: 'request-failed', message: '暂时无法读取，请稍后重试。' }); });
    return () => { current = false; };
  }, [taskId, material, request]);
  useEffect(() => {
    if (!active || result?.status !== 'generating') return;
    const timer = setTimeout(() => setRequest({ candidate: request?.candidate }), 120000);
    return () => clearTimeout(timer);
  }, [active, request?.candidate, result]);

  const status = result?.status;
  return <div className="calendar-detail-section calendar-meeting-material" aria-busy={!result}>
    {!result && <p role="status">正在读取{label}…</p>}
    {result?.status === 'ready' && <>
      {material === 'transcript' && <h3>本场逐字稿</h3>}
      <div className="calendar-meeting-text" role="region" aria-label={label + '正文'}>
        {material === 'transcript' && !!result.segments?.length ? <ol className="calendar-transcript" role="list">
          {result.segments.map((segment, i) => <li key={i}>
            <span>{segment.time}</span><strong>{segment.speaker}</strong><span>{segment.text}</span>
          </li>)}
        </ol> : result.text}
      </div>
    </>}
    {result?.status === 'candidates' && <>
      <p>请选择场次</p>
      <ul className="calendar-meeting-candidates">{result.candidates.map(candidate => <li key={candidate.id}>
        <button type="button" className="btn btn-sec btn-sm" onClick={() => setRequest({ candidate: candidate.id })}>
          {meetingStamp(candidate.start)} · {candidate.subject}{candidate.meetingId && ' · 记录 ' + candidate.meetingId}
        </button>
      </li>)}</ul>
    </>}
    {result?.status === 'wrong-session' && <p role="status">员工助手返回的是 {meetingStamp(result.actualTime)} 场次，已隐藏正文。</p>}
    {result && 'message' in result && <p role="status">{result.message}</p>}
    {status && status !== 'ready' && status !== 'candidates' && status !== 'unlinked' && status !== 'no-recording' && status !== 'no-permission' &&
      <button type="button" className="btn btn-sec btn-sm" aria-label={'重新读取' + label} onClick={() => setRequest({ refresh: true })}>重新读取</button>}
  </div>;
}

function WelinkMeetingReader({ taskId, active }: { taskId: string; active: boolean }) {
  const [authRevision, setAuthRevision] = useState(0);
  const [selected, setSelected] = useState<MeetingMaterial>('minutes');
  useEffect(() => window.workbench.island.onWelinkAuthChanged?.(() => setAuthRevision(value => value + 1)), []);
  return <ScheduleDetailTabs<MeetingMaterial> label="WeLink 会议资料" selected={selected} onTab={setSelected}
    tabs={(Object.keys(materialLabels) as MeetingMaterial[]).map(material => ({
      id: material, label: materialLabels[material],
      content: selected => <MeetingMaterialPanel key={authRevision} taskId={taskId} material={material} active={active && selected} />,
    }))} />;
}

export function WelinkScheduleDetails({ task, meeting, now, originals, openOriginal, controls, summary, leaveDetails, recordMeeting, prepareMeeting, openTask }: {
  task: Task; meeting?: Task; now: number; originals?: Task[]; openOriginal(task: Task): void;
  controls: ScheduleDetailControls; summary: ReactNode;
  leaveDetails(navigate: () => void): void; recordMeeting?(): void; prepareMeeting?(): void; openTask(id: string): void;
}) {
  const [details, setDetails] = useState<WelinkEventDetails>();
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const provider = task.external?.provider;
  const detailLabel = provider === 'calendar' ? '邮箱详情' : '会议详情';
  useEffect(() => {
    if (!provider) return;
    let current = true;
    void window.workbench.island.welinkDetails(task.id).then(value => {
      if (current) setDetails(value);
    }, cause => { if (current) setError(errorText(cause)); });
    return () => { current = false; };
  }, [provider, request, task.id]);
  const meetingNo = meeting?.welinkMeetingNo || meeting?.note.match(/^会议号 (.+)$/m)?.[1];
  const location = details?.location || task.location || task.note.split('\n').find(line => line && !line.startsWith('会议号 '));
  const organizer = details?.organizer || details?.organizerEmail;
  const { meetingDetailsUrl, meetingSummaryUrl } = details ?? {};
  const onlineMeetingUrl = details?.onlineMeetingUrl || task.meetingUrl;
  const missing = details ? '来源未提供' : '—';
  const ended = !!provider && !!task.endAt && Date.parse(task.endAt) <= now && !details?.isCancelled;
  const linked = Boolean(meeting?.external && !task.external?.isAllDay);
  function openLink(url: string) {
    setError('');
    void window.workbench.ai.openLink(url).catch(cause => setError(errorText(cause)));
  }
  const info = <>
    <div className="task-editor-rows" role="group" aria-label="同步的日程字段">
      <TaskFieldRow icon={<Users size={18} />}>
        <div className="task-editor-readonly">
          <strong>邀请对象</strong>
          <span>{details?.requiredAttendees.join('、') || (details?.optionalAttendees.length ? '—' : missing)}</span>
          {!!details?.optionalAttendees.length && <span>可选 · {details.optionalAttendees.join('、')}</span>}
        </div>
      </TaskFieldRow>
      <TaskFieldRow icon={<LinkSimple size={18} />}>
        <div className="task-editor-readonly">
          <strong>会议链接</strong>
          <span>{onlineMeetingUrl || missing}</span>
          {onlineMeetingUrl && !details?.isCancelled && <div><button type="button" className="btn btn-sec btn-sm calendar-detail-link"
            onClick={() => openLink(onlineMeetingUrl)}>加入会议</button></div>}
        </div>
      </TaskFieldRow>
      <TaskFieldRow icon={<MapPin size={18} />}>
        <div className="task-editor-readonly"><strong>地点</strong><span>{location || missing}</span></div>
      </TaskFieldRow>
      <TaskFieldRow icon={<TextAlignLeft size={18} />}>
        <div className="task-editor-readonly"><strong>说明</strong><span>{details?.body || missing}</span></div>
      </TaskFieldRow>
    </div>
    {(meetingNo || organizer) && <dl className="calendar-detail-fields">
      {meetingNo && <><dt>会议号</dt><dd>{meetingNo}</dd></>}
      {organizer && <><dt>组织者</dt><dd>{organizer}</dd></>}
    </dl>}
    {details?.isCancelled && <p className="calendar-detail-note">原日程已取消。</p>}
    {(meetingDetailsUrl || meetingSummaryUrl) && <div className="calendar-detail-actions">
      {meetingDetailsUrl && <button type="button" className="btn btn-sec btn-sm" onClick={() => openLink(meetingDetailsUrl)}>查看 WeLink 原始详情</button>}
      {meetingSummaryUrl && <button type="button" className="btn btn-sec btn-sm" onClick={() => openLink(meetingSummaryUrl)}>查看 WeLink 纪要</button>}
    </div>}
    {provider === 'meeting' && details && !meetingDetailsUrl && !meetingSummaryUrl && !onlineMeetingUrl && <p className="calendar-detail-note">WeLink 未返回可打开的详情或纪要链接。</p>}
    {provider && !details && (error ? <button type="button" className="btn btn-sec btn-sm calendar-detail-link" onClick={() => { setError(''); setRequest(value => value + 1); }}>重试{detailLabel}</button>
      : <p className="calendar-detail-note" role="status">正在读取{detailLabel}…</p>)}
    {error && <p className="calendar-detail-note" role="status">{error}</p>}
    {originals && originals.length > 1 && openOriginal && <section className="calendar-detail-section">
      <h3>原始记录</h3>
      <ul className="calendar-detail-records">{originals.map(item => {
        if (!item.external) return null;
        const duplicate = originals.some(other => other.id !== item.id && other.external?.provider === item.external!.provider);
        const source = welinkSourceName(item.external.provider);
        return <li key={item.id}><button type="button" onClick={() => openOriginal(item)}>
          <span>{source}{duplicate && ' · ' + item.title + ' · ' + scheduleTimeRange(item)}</span><CaretRight size={15} aria-hidden="true" />
        </button></li>;
      })}</ul>
    </section>}
    {ended && !linked && <p className="calendar-detail-note">该日程暂无已核验的会议系统记录。</p>}
  </>;

  return <ScheduleMeetingTabs task={task} controls={controls} leaveDetails={leaveDetails}
    info={<>{summary}{info}</>} recordMeeting={recordMeeting} prepareMeeting={prepareMeeting} openTask={openTask}
    materials={active => <div className="calendar-welink-materials">{ended && linked
      ? <WelinkMeetingReader key={JSON.stringify([task.external, task.title, task.dateAt, task.endAt, meeting?.id, meeting?.dateAt, meeting?.endAt])} taskId={task.id} active={active} />
      : <p className="calendar-detail-note">{details?.isCancelled ? '原日程已取消。' : !linked ? '暂无已核验的 WeLink 会议资料。' : '会议结束后可查看 WeLink 会议资料。'}</p>}
    </div>} />;
}
