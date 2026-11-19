import { useState, type Ref } from 'react';
import { Check, GearSix, X } from '@phosphor-icons/react';
import { AGENT_LABELS, agentMessageStatus } from '../../shared/agent-message-contracts';
import type { IslandState } from '../../shared/island-contracts';
import { IconButton, Segmented } from '../ui/controls';
import { IslandMascot } from '../ui/IslandMascot';
import './island-agent-messages.css';

type Run = (action: () => Promise<unknown>) => Promise<boolean>;

// 吉祥物入口共用未读徽标,同时显示事项提醒数量。
export function IslandMessageEntry({ state, onClick, buttonRef, ariaLabel = '打开待办助手' }: { state: IslandState; onClick(): void; buttonRef?: Ref<HTMLButtonElement>; ariaLabel?: string }) {
  const messages = state.agentMessages ?? [];
  const unread = messages.filter(message => message.readAt === null).length;
  const reminders = state.reminders.filter(reminder => reminder.kind !== 'agent').length;
  const count = unread + reminders;
  if (!state.settings.mascotEnabled && !messages.length && !reminders) return null;
  return <button ref={buttonRef} type="button" className="island-mascot-entry" aria-label={`${ariaLabel}，消息：${unread} 条 CodeAI 未读${reminders ? `，${reminders} 条事项提醒` : ''}`} aria-haspopup="dialog" onClick={onClick} title="点击伙伴对话或查看消息">
    <IslandMascot moving={state.settings.mascotEnabled && state.settings.mascotMotion && !state.quiet} />
    {count > 0 && <span className="island-message-badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
  </button>;
}

export function IslandAgentMessages({ state, busy, run, close, showReminders, now, embedded = false }: { state: IslandState; busy: boolean; run: Run; close(): void; showReminders(): void; now: number; embedded?: boolean }) {
  const messages = state.agentMessages ?? [];
  const unread = messages.filter(message => message.readAt === null).length;
  const reminders = state.reminders.filter(reminder => reminder.kind !== 'agent').length;
  const [filter, setFilter] = useState(unread ? 'unread' : 'all');
  const [hint, setHint] = useState('');
  const visible = messages.filter(message => filter === 'all' || message.readAt === null);
  const api = window.workbench.island;
  return <>
    {!embedded && <header className="island-messages-header"><div><h2 id="island-messages-title">CodeAI 消息</h2><small role="status">{unread} 条未读</small></div><IconButton label="关闭消息列表" onClick={close}><X size={16} /></IconButton></header>}
    <div className="island-messages-filters"><div className="island-message-filter-row">
      <Segmented value={filter} onChange={setFilter} aria-label="消息范围" options={[{ value: 'unread', label: `未读 ${unread}` }, { value: 'all', label: '全部' }]} />
      <button type="button" className="island-text-button island-messages-read-all" disabled={busy || !unread} title="将当前未读消息全部标为已读" onClick={() => void run(() => api.agentReadAll(messages.filter(message => message.readAt === null).map(({ id, updatedAt }) => ({ id, updatedAt }))))}><Check size={14} />全部已读</button>
    </div>{reminders > 0 && <button className="island-text-button" onClick={showReminders}>事项提醒 {reminders}</button>}</div>
    {hint && <p className="island-message-hint" role="status">{hint}</p>}
    <div className="island-message-list">
      {visible.map(message => <article key={message.id} className="island-agent-message" data-provider={message.provider} data-read={message.readAt !== null}>
        <span className="island-message-unread" data-unread={message.readAt === null} aria-label={message.readAt === null ? '未读' : '已读'} />
        <span className="island-message-provider-marker" aria-hidden="true"><IslandMascot /></span>
        <div className="island-message-copy"><small title={message.workspace}>{AGENT_LABELS[message.provider]} · {message.project}</small><b title={message.title}>{message.title}</b><div className="island-message-meta"><span data-status={message.kind}>{agentMessageStatus(message)}</span><time dateTime={new Date(message.updatedAt).toISOString()}>{now - message.updatedAt < 60000 ? '刚刚' : now - message.updatedAt < 3600000 ? `${Math.floor((now - message.updatedAt) / 60000)}分钟前` : new Date(message.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div></div>
        <div className="island-message-actions">
          <button disabled={busy} title="回到 CodeAI 并定位对应会话" onClick={() => void run(async () => { const result = await api.agentOpen(message.id); if (result.hint) setHint(result.hint); })}>回到 CodeAI</button>
          <div>{message.readAt === null && <IconButton label={`标为已读：${message.title}`} disabled={busy} onClick={() => void run(() => api.agentRead(message.id))}><Check size={14} /></IconButton>}</div>
        </div>
      </article>)}
      {!visible.length && <div className="island-message-empty"><p>{filter === 'unread' ? '没有未读消息' : '还没有 CodeAI 消息'}</p>{!messages.length && <p className="island-message-setup-help">开启后，CodeAI 在这些项目跑完一轮会通知你。消息仅本机保存。</p>}{messages.length ? <button onClick={() => setFilter('all')}>查看全部消息</button> : <button onClick={() => void run(() => api.navigate({ view: 'settings-agents', section: 'agents' }))}><GearSix size={14} />接入与管理消息提醒</button>}</div>}
    </div>
  </>;
}
