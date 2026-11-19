import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import type { Task } from '../../shared/todo-contracts';
import type { WelinkWeekStatus } from '../../shared/island-contracts';
import { welinkSourceName, type WelinkEventDetails, type WelinkSourceStatus } from '../../shared/welink-agenda';
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

export function WelinkScheduleDetails({ task, meeting, selected }: { task: Task; meeting?: Task; selected: boolean }) {
  const [details, setDetails] = useState<WelinkEventDetails>();
  const [error, setError] = useState('');
  const [request, setRequest] = useState(0);
  const provider = task.external?.provider;
  const detailLabel = provider === 'calendar' ? '邮箱详情' : '会议详情';
  const load = !!provider && (selected || request > 0);
  useEffect(() => {
    if (!load) return;
    let current = true;
    void window.workbench.island.welinkDetails(task.id).then(value => {
      if (current) setDetails(value);
    }, cause => { if (current) setError(errorText(cause)); });
    return () => { current = false; };
  }, [load, request, task.id]);
  const meetingNo = meeting?.welinkMeetingNo || meeting?.note.match(/^会议号 (.+)$/m)?.[1];
  const location = details?.location || task.note.split('\n').find(line => line && !line.startsWith('会议号 '));
  const organizer = details?.organizer || details?.organizerEmail;
  const { onlineMeetingUrl, meetingDetailsUrl, meetingSummaryUrl } = details ?? {};
  function openLink(url: string) {
    setError('');
    void window.workbench.ai.openLink(url).catch(cause => setError(errorText(cause)));
  }
  return <>
    {(meetingNo || location || organizer || details?.requiredAttendees.length || details?.optionalAttendees.length) ? <dl className="calendar-detail-fields">
      {meetingNo && <><dt>会议号</dt><dd>{meetingNo}</dd></>}
      {location && <><dt>地点</dt><dd>{location}</dd></>}
      {organizer && <><dt>组织者</dt><dd>{organizer}</dd></>}
      {!!details?.requiredAttendees.length && <><dt>参会人</dt><dd>{details.requiredAttendees.join('、')}</dd></>}
      {!!details?.optionalAttendees.length && <><dt>可选参会</dt><dd>{details.optionalAttendees.join('、')}</dd></>}
    </dl> : null}
    {details?.isCancelled && <p className="calendar-detail-note">原日程已取消。</p>}
    {details?.body && <details className="calendar-detail-description"><summary>日程说明</summary><p className="calendar-detail-note">{details.body}</p></details>}
    {onlineMeetingUrl && !details?.isCancelled && <button type="button" className="btn btn-sec btn-sm calendar-detail-link" onClick={() => openLink(onlineMeetingUrl)}>加入会议</button>}
    {(meetingDetailsUrl || meetingSummaryUrl) && <div className="calendar-detail-actions">
      {meetingDetailsUrl && <button type="button" className="btn btn-sec btn-sm" onClick={() => openLink(meetingDetailsUrl)}>查看 WeLink 原始详情</button>}
      {meetingSummaryUrl && <button type="button" className="btn btn-sec btn-sm" onClick={() => openLink(meetingSummaryUrl)}>查看 WeLink 纪要</button>}
    </div>}
    {provider === 'meeting' && details && !meetingDetailsUrl && !meetingSummaryUrl && !onlineMeetingUrl && <p className="calendar-detail-note">WeLink 未返回可打开的详情或纪要链接。</p>}
    {provider && !details && (load && !error ? <p className="calendar-detail-note" role="status">正在读取{detailLabel}…</p> : <button type="button" className="btn btn-sec btn-sm calendar-detail-link" onClick={() => { setError(''); setRequest(value => value + 1); }}>{error ? '重试' + detailLabel : '展开' + detailLabel}</button>)}
    {error && <p className="calendar-detail-note" role="status">{error}</p>}
  </>;
}
