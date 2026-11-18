import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowRight } from '@phosphor-icons/react';
import type { BotCard, BotCollaboration, BotExchange, BotExchangeQuery, BotMessage, BotSubmit, BotTask } from '../../shared/bot-contracts';
import { errorText } from '../ui/controls';
import { ActionCard, botStatusLabel } from './BotTasks';
import { BotAvatar } from './BotAvatar';
import './bot-collaboration.css';

const api = window.workbench.bot;
type MessageLink = Pick<BotMessage, 'id' | 'fromBotId' | 'toBotId'>;
export function BotReceivedMessage({ message, cards, onExchange }: { message: MessageLink; cards: BotCard[]; onExchange(message: MessageLink): void }) {
  const from = cards.find(bot => bot.id === message.fromBotId);
  return <div className="bot-incoming-event-row"><button className="bot-message-event bot-incoming-event" title="查看双方往来" onClick={() => onExchange(message)}><span>消息来自</span><BotAvatar avatar={from?.avatar ?? 'ring:blue'} small /><span className="bot-message-event-name">{from?.name ?? 'Bot'}</span><ArrowRight size={14} /></button></div>;
}
export function BotIncomingMessage({ task, cards, onExchange, onLayout }: { task: BotTask; cards: BotCard[]; onExchange(message: MessageLink): void; onLayout(): void }) {
  const [message, setMessage] = useState<BotMessage>(), [error, setError] = useState(''), [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    void api.getTask(task.id).then(detail => {
      if (live) { setMessage(detail.messages.find(item => item.id === task.sourceMessageId && item.toBotId === task.botId)); setError(''); }
    }, cause => { if (live) setError(errorText(cause)); });
    return () => { live = false; };
  }, [task.id, task.sourceMessageId, task.botId, reload]);
  useLayoutEffect(() => onLayout(), [message, error, onLayout]);
  if (error) return <button className="bot-message-event bot-incoming-event" title={error} onClick={() => setReload(value => value + 1)}>重新读取消息来源</button>;
  if (!message) return null;
  return <BotReceivedMessage message={message} cards={cards} onExchange={onExchange} />;
}

export function BotCollaborationCard({ task, entryId, cards, copyBusy, onExchange, onAmend, onLayout }: { task: BotTask; entryId?: string; cards: BotCard[]; copyBusy: boolean; onExchange(message: MessageLink): void; onAmend(target: NonNullable<BotSubmit['target']>, label: string): void; onLayout(): void }) {
  const [detail, setDetail] = useState<BotCollaboration>(), [error, setError] = useState(''), [reload, setReload] = useState(0), [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true, sequence = 0;
    const load = () => { const ticket = ++sequence; void api.getCollaboration(task.rootTaskId).then(value => { if (live && ticket === sequence) { setDetail(value); setError(''); } }, cause => { if (live && ticket === sequence) setError(errorText(cause)); }); };
    load(); const off = api.onChanged(event => { if (event.kind === 'host' || event.kind === 'task' && event.taskId === task.rootTaskId) load(); });
    return () => { live = false; off(); };
  }, [task.rootTaskId, task.revision, reload]);
  useLayoutEffect(() => onLayout(), [detail, onLayout]);
  const refresh = () => setReload(value => value + 1);
  const run = async (job: () => Promise<unknown>) => { if (busy) return; setBusy(true); try { await job(); refresh(); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); } };
  if (!detail) return error ? <p className="bot-error" role="alert">{error}<button onClick={refresh}>重试</button></p> : <p className="bot-help" role="status">正在读取协作…</p>;
  const showActions = !entryId || entryId === task.assistantEntryId;
  const blocked = showActions ? detail.tasks.filter(item => ['failed', 'interrupted', 'waiting_resource'].includes(item.status)) : [];
  const replyIds = task.assistantEntryIds ?? (task.assistantEntryId ? [task.assistantEntryId] : []);
  const anchor = (message: BotMessage) => message.sourceAssistantEntryId && replyIds.includes(message.sourceAssistantEntryId) ? message.sourceAssistantEntryId : replyIds[0];
  const actions = detail.actions.filter(action => {
    if (['delegate', 'artifact'].includes(action.kind)) return false;
    const request = detail.messages.find(message => message.kind === 'request' && message.taskId === action.taskId && message.fromBotId === task.botId);
    return request ? !entryId || anchor(request) === entryId : showActions;
  });
  const events = detail.messages.filter(message => {
    if (['request', 'question', 'notification'].includes(message.kind)) return message.fromBotId === task.botId && (!entryId || anchor(message) === entryId);
    // Legacy runs overwrote one reply. Keep their recorded events before the final
    // reply without inventing earlier text or moving events on a status change.
    return !task.assistantEntryIds?.length && message.toBotId === task.botId && (message.parentTaskId === task.id || message.originTaskId === task.id);
  }).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  if (!events.length && !actions.length && !blocked.length && !error) return null;
  return <section className="bot-collaboration-inline" aria-label="协作与确认">
    {events.map(message => {
      if (['result', 'cancel'].includes(message.kind)) return <BotReceivedMessage key={message.id} message={message} cards={cards} onExchange={onExchange} />;
      const owner = cards.find(bot => bot.id === message.toBotId);
      return <button key={message.id} className="bot-message-event bot-handoff-event" title="查看双方往来" onClick={() => onExchange(message)}><span>已发消息给</span><BotAvatar avatar={owner?.avatar ?? 'ring:blue'} small /><span className="bot-message-event-name">{owner?.name ?? 'Bot'}</span><ArrowRight size={14} /></button>;
    })}
    {actions.map(action => <div key={action.id} className="bot-projected-action"><div className="bot-projected-owner"><small>{cards.find(bot => bot.id === action.botId)?.name ?? 'Bot'}</small>{action.status === 'pending' && <button type="button" className="bot-text-button" onClick={() => onAmend({ intent: 'amend', rootTaskId: task.rootTaskId, taskId: action.taskId, actionId: action.id, expectedActionRevision: action.revision }, detail.tasks.find(item => item.id === action.taskId)?.title ?? task.title)}>补充此项</button>}</div>{['applied', 'discarded', 'undone'].includes(action.status) ? <details><summary>{action.status === 'applied' ? '已处理' : action.status === 'undone' ? '已撤销' : '已保留原内容'} · {action.kind === 'question' ? '补充回答' : action.kind === 'todo' ? '待办修改' : action.kind === 'external' ? '业务操作' : '定时任务'}</summary><ActionCard action={action} refresh={refresh} copyBusy={copyBusy} /></details> : <ActionCard action={action} refresh={refresh} copyBusy={copyBusy} />}</div>)}
    {blocked.map(item => <div className="bot-collaboration-blocked" key={item.id}><p>{cards.find(bot => bot.id === item.botId)?.name} · {item.reason || botStatusLabel[item.status]}</p><button disabled={busy} onClick={() => void run(() => api.retryTask(item.id, item.revision))}>继续处理</button><button disabled={busy} onClick={() => void run(() => api.cancelTask(item.id, item.revision))}>取消</button></div>)}
    {error && <p className="bot-error" role="alert">{error}<button onClick={refresh}>重新读取</button></p>}
  </section>;
}

export function BotExchangeView({ botA, botB, anchorMessageId, cards }: { botA: string; botB: string; anchorMessageId?: string; cards: BotCard[] }) {
  const [data, setData] = useState<BotExchange>(), [error, setError] = useState(''), [busy, setBusy] = useState(false), [query, setQuery] = useState<BotExchangeQuery>({ anchorMessageId });
  const container = useRef<HTMLDivElement>(null);
  const locate = useRef(true);
  useEffect(() => { setQuery({ anchorMessageId }); }, [botA, botB, anchorMessageId]);
  useEffect(() => {
    let live = true, timer: ReturnType<typeof setTimeout> | undefined; setBusy(true); locate.current = true;
    const load = () => { void api.getBotExchange(botA, botB, query).then(value => { if (live) { setData(value); setError(''); } }, cause => { if (live) setError(errorText(cause)); }).finally(() => { if (live) setBusy(false); }); };
    load(); const off = api.onChanged(event => { if (event.kind === 'host' || event.kind === 'task' && (!event.botId || [botA, botB].includes(event.botId))) { clearTimeout(timer); timer = setTimeout(load, 100); } });
    return () => { live = false; clearTimeout(timer); off(); };
  }, [botA, botB, query]);
  useLayoutEffect(() => { if (!data || !locate.current) return; locate.current = false; const target = query.anchorMessageId && container.current?.querySelector<HTMLElement>(`[data-message-id="${query.anchorMessageId}"]`); if (target) target.scrollIntoView({ block: 'center' }); else container.current?.scrollIntoView({ block: 'start' }); }, [data]);
  return <div className="bot-exchange" ref={container} aria-label="双方消息记录" aria-busy={busy}>
    <p className="bot-exchange-hint">双方的连续往来 · 只读</p>
    {data?.hasEarlier && <button className="bot-text-button" disabled={busy} onClick={() => setQuery({ before: data.messages[0].id })}>更早的消息</button>}
    {data?.messages.map(message => {
      const from = cards.find(bot => bot.id === message.fromBotId);
      return <article key={message.id} data-message-id={message.id} data-anchor={message.id === anchorMessageId || undefined} className="bot-exchange-message"><BotAvatar avatar={from?.avatar ?? 'ring:blue'} small /><div><header><strong>{from?.name ?? 'Bot'}</strong><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></header><p>{message.content}</p><small>{message.deliveredAt ? '已投递' : '待投递'}</small></div></article>;
    })}
    {data?.hasLater && <button className="bot-text-button" disabled={busy} onClick={() => setQuery({ after: data.messages.at(-1)!.id })}>后续消息</button>}
    {data && !data.messages.length && <p className="bot-empty">还没有双方往来</p>}
    {error && <p className="bot-error" role="alert">{error}<button onClick={() => setQuery({ ...query })}>重试</button></p>}
  </div>;
}
