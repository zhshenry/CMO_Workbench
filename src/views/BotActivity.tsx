import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { ArrowLeft, ChatCircle, CheckCircle, CheckSquare, ClockCounterClockwise, X } from '@phosphor-icons/react';
import type { BotCard, BotOpen, BotTask } from '../../shared/bot-contracts';
import type { ChatEntry, ChatSession } from '../../shared/todo-contracts';
import type { groupBotProgress } from '../bot-progress';
import { errorText, IconButton, Segmented } from '../ui/controls';
import { botStatusLabel, BotTaskDetail } from './BotTasks';

type Filter = '全部' | '工作' | '对话';
type Selection = { kind: 'task' | 'conversation' | 'archive'; id: string };
type Archive = BotOpen['history'][number];
const filters = (['全部', '工作', '对话'] as const).map(value => ({ value, label: value }));
const dateFormat = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const dateLabel = (value: string) => Number.isFinite(Date.parse(value)) ? dateFormat.format(new Date(value)) : '日期不可用';

function ArchivedConversation({ item, canReference, onReference, renderEntry }: {
  item: Archive; canReference: boolean; onReference(chat: ChatSession): void; renderEntry(entry: ChatEntry): ReactNode;
}) {
  const [chat, setChat] = useState<ChatSession>(), [error, setError] = useState(''), [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState(20), [copyError, setCopyError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    void window.workbench.ai.chatOpen(item.chatId).then(value => { if (live) setChat(value); }, cause => { if (live) setError(errorText(cause)); });
    return () => { live = false; };
  }, [item.chatId, attempt]);
  if (!chat) return error
    ? <p className="bot-error" role="alert">{error} <button onClick={() => setAttempt(value => value + 1)}>重试</button></p>
    : <p className="bot-work-muted" role="status">正在读取历史对话…</p>;
  return <>
    <h3>{chat.title || '历史对话'}</h3>
    <div className="bot-history-banner"><span>只读历史</span><button disabled={!item.canReference || !canReference} onClick={() => onReference(chat)}>在主对话引用</button></div>
    {chat.draft && <section className="bot-history-draft"><h4>历史未发送草稿</h4><p>{chat.draft}</p><button onClick={() => { setCopyError(''); void navigator.clipboard.writeText(chat.draft).catch(cause => setCopyError(errorText(cause))); }}>复制这段草稿</button>{copyError && <p role="alert">{copyError}</p>}</section>}
    {chat.entries.length > limit && <button className="bot-text-button" onClick={() => setLimit(value => value + 20)}>查看更早消息</button>}
    {chat.entries.length ? chat.entries.slice(-limit).map(renderEntry) : <p className="bot-work-muted">没有历史消息</p>}
  </>;
}

export function BotActivity({ ref, progress, chat, history, cards, initialTaskId, historyFirst, onProfile, close, reply, copyBusy, canReference, onReference, renderEntry }: {
  ref: Ref<HTMLElement>; progress: ReturnType<typeof groupBotProgress>; chat?: ChatSession; history?: Archive[]; cards: BotCard[];
  initialTaskId?: string; historyFirst?: boolean; onProfile?(): void; close(): void; reply(task: BotTask): void; copyBusy: boolean;
  canReference: boolean; onReference(chat: ChatSession): void; renderEntry(entry: ChatEntry): ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>(historyFirst ? '对话' : '全部');
  const [selected, setSelected] = useState<Selection | undefined>(initialTaskId ? { kind: 'task', id: initialTaskId } : undefined);
  const trigger = useRef<HTMLButtonElement>(null), heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => { (!selected && trigger.current?.isConnected ? trigger.current : heading.current)?.focus({ preventScroll: true }); }, [selected]);
  const back = () => setSelected(undefined);
  const row = (kind: Selection['kind'], id: string, title: string, caption: string, status?: BotTask['status']) => {
    const Icon = kind === 'archive' ? ClockCounterClockwise : kind === 'conversation' ? ChatCircle : status === 'completed' ? CheckCircle : CheckSquare;
    return <button type="button" key={id} className="bot-work-row" data-status={status} title={title} onClick={event => { trigger.current = event.currentTarget; setSelected({ kind, id }); }}>
      <Icon size={17} aria-hidden="true" /><span><strong>{title}</strong><small>{caption}</small></span>
    </button>;
  };
  const group = (label: string, rows: ReactNode[]) => rows.length > 0 && <section aria-label={label}><h3>{label} <span>{rows.length}</span></h3>{rows}</section>;
  const workGroup = (label: string, items: BotTask[]) => group(label, items.map(task => row('task', task.id, task.title, botStatusLabel[task.status] + ' · ' + dateLabel(task.updatedAt), task.status)));
  const workCount = progress.attention.length + progress.active.length + progress.ended.length;
  const chatCount = progress.conversations.length + (history?.length ?? 0);
  const conversation = selected?.kind === 'conversation' ? progress.conversations.find(task => task.id === selected.id) : undefined;
  const archive = selected?.kind === 'archive' ? history?.find(item => item.chatId === selected.id) : undefined;
  let entries: ChatEntry[] = [];
  if (conversation) {
    const ids = new Set([conversation.sourceMessageId, conversation.latestUserMessageId, conversation.assistantEntryId, ...(conversation.assistantEntryIds ?? [])]);
    entries = chat?.entries.filter(entry => ids.has(entry.id)) ?? [];
    if (!entries.some(entry => entry.role === 'user')) entries.unshift({ id: conversation.sourceMessageId, role: 'user', content: conversation.input });
    if (conversation.result && !entries.some(entry => entry.role === 'assistant')) entries.push({ id: conversation.id, role: 'assistant', content: conversation.result });
  }
  return <aside ref={ref} id="bot-inspector" className="bot-inspector bot-activity" aria-label="工作与对话" onKeyDown={event => {
    if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); if (selected) back(); else close(); }
  }}>
    <header className="bot-activity-header">
      {(selected || onProfile) && <IconButton label={selected ? '返回列表' : '返回详情'} onClick={selected ? back : onProfile}><ArrowLeft size={17} /></IconButton>}
      <h2 ref={heading} tabIndex={-1}>工作与对话</h2>
      <IconButton label="关闭 Bot 侧栏" onClick={close}><X size={17} /></IconButton>
    </header>
    <div className="bot-activity-list" hidden={!!selected}>
      <Segmented aria-label="记录类型" value={filter} options={filters} onChange={value => setFilter(value as Filter)} />
      <div className="bot-activity-rows" key={filter}>
        {filter !== '对话' && <>{workGroup('需要关注', progress.attention)}{workGroup('进行中', progress.active)}{workGroup('已结束', progress.ended)}</>}
        {filter !== '工作' && <>
          {group('普通对话', progress.conversations.map(task => row('conversation', task.id, task.title, dateLabel(task.updatedAt))))}
          {group('迁移前的对话', (history ?? []).map(item => row('archive', item.chatId, item.title || '历史对话', [dateLabel(item.updatedAt), item.reason].filter(Boolean).join(' · '))))}
        </>}
        {!history ? <p className="bot-work-muted" role="status">正在读取记录…</p> : !(filter !== '对话' && workCount || filter !== '工作' && chatCount) && <p className="bot-work-muted">{filter === '工作' ? '暂无工作记录' : filter === '对话' ? '暂无历史对话' : '暂无工作或对话记录'}</p>}
      </div>
    </div>
    {selected && <div className="bot-activity-detail" key={selected.id}>
      {selected.kind === 'task' ? <BotTaskDetail taskId={selected.id} cards={cards} back={back} backLabel="" embedded reply={reply} copyBusy={copyBusy} />
        : archive ? <ArchivedConversation item={archive} canReference={canReference} onReference={onReference} renderEntry={renderEntry} />
        : conversation ? <><h3>{conversation.title}</h3>{entries.map(renderEntry)}</> : <p className="bot-work-muted">此记录已不可用</p>}
    </div>}
  </aside>;
}
