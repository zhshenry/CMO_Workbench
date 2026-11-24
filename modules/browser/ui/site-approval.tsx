import { useEffect, useRef, useState, type RefObject } from 'react';
import { CaretRight, CheckCircle, Globe, ShieldCheck } from '@phosphor-icons/react';
import type { ChatSession } from '../../../shared/todo-contracts';
import type { BrowserSiteApproval, BrowserSsoLogin, BrowserTask } from '../../../shared/browser-automation-contracts';
import { BotOperationCard, BotOperationSubject } from '../../../src/views/BotOperationCard';
import { errorText } from '../../../src/ui/controls';

export function useBrowserApprovalTasks(chat: ChatSession | null) {
  const chatId = chat?.id;
  const references = new Map(chat?.entries.flatMap(entry => entry.browserTask ? [[entry.browserTask.id, entry.browserTask] as const] : []));
  const referenceKey = JSON.stringify([...references.values()]);
  const [snapshot, setSnapshot] = useState<{ chatId?: string; tasks: Record<string, BrowserTask>; error: string }>({ tasks: {}, error: '' });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    if (!chatId || referenceKey === '[]') return;
    const refs: { id: string; workspace: string }[] = JSON.parse(referenceKey);
    const belongs = (task: BrowserTask): boolean => (!task.chatId || task.chatId === chatId) && refs.some(ref => ref.id === task.id && ref.workspace === task.workspace);
    let live = true;
    const changed = new Set<string>();
    const api = window.workbench.browserAutomation;
    setSnapshot({ chatId, tasks: {}, error: '' });
    const off = api.onTask(task => {
      if (!live || !belongs(task)) return;
      changed.add(task.id);
      setSnapshot(previous => ({ chatId, tasks: { ...previous.tasks, [task.id]: task }, error: '' }));
    });
    void Promise.all([...new Set(refs.map(ref => ref.workspace))].map(workspace => api.state(workspace))).then(states => {
      if (!live) return;
      setSnapshot(previous => ({ chatId, tasks: { ...Object.fromEntries(states.flatMap(state => state.tasks).filter(task => belongs(task) && !changed.has(task.id)).map(task => [task.id, task])), ...previous.tasks }, error: '' }));
    }, cause => { if (live) setSnapshot(previous => ({ ...previous, error: `无法读取站点授权：${errorText(cause)}` })); });
    return () => { live = false; off(); };
  }, [chatId, referenceKey, reload]);
  return {
    tasks: snapshot.chatId === chatId ? snapshot.tasks : {},
    error: snapshot.chatId === chatId ? snapshot.error : '',
    retry: () => setReload(value => value + 1),
    update: (task: BrowserTask, expectedOrigin: string) => setSnapshot(previous => previous.chatId === chatId && references.get(task.id)?.workspace === task.workspace
      && previous.tasks[task.id]?.status === 'site-approval' && previous.tasks[task.id]?.pendingOrigin === expectedOrigin
      ? { ...previous, tasks: { ...previous.tasks, [task.id]: task }, error: '' } : previous),
  };
}

export function browserSiteApprovalForCard(task?: BrowserTask): BrowserSiteApproval | undefined {
  if (task?.status === 'site-approval' && task.pendingOrigin) return { origin: task.pendingOrigin, status: 'pending' };
  const latest = task?.siteApprovals?.at(-1);
  return latest?.status !== 'pending' ? latest : undefined;
}

export function BrowserSsoLoginCard({ taskId, request, onOpenLogin }: {
  taskId: string; request: BrowserSsoLogin; onOpenLogin(): void;
}) {
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const busy = request.status === 'submitting' || sending && request.status === 'ready';
  const authorize = async () => {
    if (inFlight.current || request.status !== 'ready') return;
    inFlight.current = true; setSending(true); setError('');
    try { await window.workbench.browserAutomation.authorizeSso(taskId, request.id); }
    catch (cause) { inFlight.current = false; setSending(false); setError(errorText(cause)); }
  };
  const description = request.status === 'manual'
    ? '请在登录页完成登录或验证。返回原业务页后，管家会自动继续。'
    : busy ? '正在等待 SSO 返回原业务页。'
    : request.status === 'ready' ? '授权后，CMO 会用页面中已填写的凭据登录一次。返回原业务页后自动继续。'
    : '正在检查登录表单。';
  return <BotOperationCard className="bot-site-approval" aria-label="需要华为 SSO 登录" aria-busy={busy}
    label="需要华为 SSO 登录" icon={<ShieldCheck size={18} />} collapsible={false}
    status={busy ? '正在登录' : request.status === 'manual' ? '需要你处理' : '等待登录'} tone={busy ? 'active' : 'pending'}>
    <BotOperationSubject title="login.huawei.com">{description}</BotOperationSubject>
    {error && <p className="bot-error" role="alert">{error}</p>}
    <div className="bot-action-buttons">
      <button type="button" disabled={busy} onClick={onOpenLogin}>打开登录页</button>
      {request.status !== 'manual' && <button type="button" className="primary" disabled={busy || request.status !== 'ready'}
        onClick={() => void authorize()}>授权登录</button>}
    </div>
  </BotOperationCard>;
}

export function BrowserSiteApprovalCard({ task, id, elementRef, inline, located, onTask }: {
  task: BrowserTask; id?: string; elementRef?: RefObject<HTMLElement | null>; inline?: boolean; located?: boolean; onTask(task: BrowserTask): void;
}) {
  const [working, setWorking] = useState<'approve-site' | 'cancel' | null>(null);
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const approval = browserSiteApprovalForCard(task);
  const origin = approval?.status === 'pending' ? approval.origin : undefined;
  const allowed = inline && approval?.status === 'allowed';
  const decide = async (action: 'approve-site' | 'cancel'): Promise<void> => {
    if (inFlight.current || task.status !== 'site-approval' || !origin) return;
    inFlight.current = true; setWorking(action); setError('');
    try { onTask(await window.workbench.browserAutomation.control(task.id, action, origin)); }
    catch (cause) { setError(errorText(cause)); }
    finally { inFlight.current = false; setWorking(null); }
  };
  if (inline && approval) {
    const status = approval.status === 'pending' ? '待授权' : approval.status === 'allowed' ? '已授权' : approval.status === 'denied' ? '已拒绝' : '已失效';
    return <BotOperationCard id={id} ref={elementRef} className="bot-site-approval" data-status={approval.status}
      data-chat-action-id={task.id} data-located={located || undefined} aria-label="站点授权" aria-busy={working !== null}
      tabIndex={-1} label="站点授权" summary={origin ? approval.origin + ' · 仅本次任务' : approval.origin}
      icon={<ShieldCheck size={18} />} status={status} tone={origin ? 'pending' : allowed ? 'success' : 'neutral'}
      initialOpen={!!origin}>
      {origin && <>
        <BotOperationSubject title={origin} />
        <dl className="bot-operation-fields">
          <dt>用途</dt><dd>{task.goal || '访问并操作此站点'}</dd>
          <dt>范围</dt><dd>仅本次任务</dd>
        </dl>
        {error && <p className="bot-error" role="alert">{error}</p>}
        <div className="bot-action-buttons">
          <button type="button" disabled={working !== null} onClick={() => void decide('cancel')}>{working === 'cancel' ? '正在停止…' : '不允许'}</button>
          <button type="button" className="primary" disabled={working !== null}
            onClick={() => void decide('approve-site')}>{working === 'approve-site' ? '正在授权…' : '允许并继续'}</button>
        </div>
      </>}
    </BotOperationCard>;
  }
  if (!origin && !allowed) return null;
  return <section id={id} ref={elementRef} className="ai-site-approval" data-status={allowed ? 'allowed' : 'pending'}
    data-chat-action-id={inline && origin ? task.id : undefined} data-located={located && !!origin || undefined}
    aria-label="站点授权" aria-busy={!!origin && working !== null} tabIndex={origin ? -1 : undefined}>
    <header><h3><span className="ai-site-approval-icon"><ShieldCheck size={20} /></span>站点授权</h3><span className="ai-site-approval-badge" aria-live={inline ? 'polite' : undefined}>{allowed ? '已授权' : '待处理'}</span></header>
    {origin && <>
      <div className="ai-site-approval-body">
        <div className="ai-site-approval-site"><span className="ai-site-approval-icon"><Globe size={20} /></span><div><strong>{origin.replace(/^https?:\/\//, '')}</strong><span>{origin}</span></div></div>
        <p>允许 AI 在本次任务中访问并操作此站点。</p>
        <p className="ai-site-approval-scope">仅本次任务有效。</p>
        {error && <p className="ai-error" role="alert">{error}</p>}
      </div>
      <footer><button type="button" className="ai-discard" disabled={working !== null} onClick={() => void decide('cancel')}>{working === 'cancel' ? '正在停止…' : '不允许'}</button>
        <button type="button" className="ai-apply" disabled={working !== null} onClick={() => void decide('approve-site')}>{working === 'approve-site' ? '正在授权…' : '允许并继续'}</button></footer>
    </>}
  </section>;
}

export function BrowserSiteApprovalReceipts({ task, onLocate, cardId }: { task: BrowserTask; onLocate?(): void; cardId?: string }) {
  const approvals: BrowserSiteApproval[] = task.siteApprovals ?? (task.status === 'site-approval' && task.pendingOrigin ? [{ origin: task.pendingOrigin, status: 'pending' }] : []);
  return <>{approvals.map((approval, index) => {
    const pending = approval.status === 'pending' && task.status === 'site-approval' && task.pendingOrigin === approval.origin;
    if ((!onLocate || !cardId) && (pending || approval.status === 'allowed')) return null;
    const label = pending ? '等待站点授权' : approval.status === 'allowed' ? task.status === 'running' ? '已授权，正在继续' : '已允许访问此站点' : approval.status === 'denied' ? '未授权，已停止本次任务' : '授权请求已失效';
    return <div className="ai-site-approval-receipt" key={`${approval.origin}:${index}`} role="status">
      {approval.status === 'allowed' ? <CheckCircle size={15} /> : <ShieldCheck size={15} />}<div><span>{label}</span><small>{approval.origin}</small></div>
      {pending && <button type="button" aria-controls={cardId} onClick={onLocate}>定位授权卡<CaretRight size={12} /></button>}
    </div>;
  })}</>;
}
