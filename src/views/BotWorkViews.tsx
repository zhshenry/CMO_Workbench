import { useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowSquareOut, CheckSquare, DotsThree, FileText } from '@phosphor-icons/react';
import type { BotArtifact, BotCard, BotResourceRef } from '../../shared/bot-contracts';
import { AiResponse } from './AiResponse';

const workTime = (value: string) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const artifactType = (artifact: BotArtifact) => artifact.mediaType === 'text/markdown' ? 'Markdown' : '工作区文稿';

const libraryFilters = ['全部', '本 Bot 创建', '协作交付'] as const;
const shortArtifactDate = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });

function ArtifactRow({ artifact, selected, onOpen, onTask, onOpenResource }: {
  artifact: BotArtifact; selected: boolean; onOpen(artifact: BotArtifact): void;
  onTask(id: string): void; onOpenResource?(ref: BotResourceRef): void;
}) {
  const menuId = useId(), trigger = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const linked = artifact.resource.kind !== 'artifact';
  const created = Date.parse(artifact.createdAt);
  const Icon = linked ? ArrowSquareOut : FileText;
  const closeActions = () => { menu.current?.hidePopover(); trigger.current?.focus({ preventScroll: true }); };

  return <li className="bot-delivery-row" data-selected={selected}>
    <button type="button" className="bot-work-row" data-artifact-id={artifact.id} aria-label={artifact.title} title={artifact.title}
      aria-current={selected || undefined} onClick={() => onOpen(artifact)}>
      <Icon size={18} weight="duotone" aria-label={linked ? '工作区原件' : '文档'} /><strong>{artifact.title}</strong>
      {Number.isFinite(created) && <time dateTime={artifact.createdAt} title={workTime(artifact.createdAt)}>{shortArtifactDate.format(created)}</time>}
    </button>
    <button ref={trigger} type="button" className="bot-delivery-more" aria-label={`${artifact.title}的更多操作`} title="更多操作"
      aria-haspopup="dialog" aria-expanded={actionsOpen} popoverTarget={menuId}><DotsThree size={18} weight="bold" aria-hidden="true" /></button>
    <div ref={menu} id={menuId} popover="auto" role="dialog" aria-label="资料操作" className="bot-delivery-menu"
      onBeforeToggle={event => setActionsOpen(event.newState === 'open')}
      onToggle={event => {
        if (event.newState !== 'open' || !trigger.current) return;
        const popup = event.currentTarget, anchor = trigger.current.getBoundingClientRect();
        const bounds = trigger.current.closest('.bot-inspector')?.getBoundingClientRect();
        popup.toggleAttribute('data-above', !!bounds && bounds.bottom - anchor.bottom < popup.offsetHeight + 4 && anchor.top - bounds.top > bounds.bottom - anchor.bottom);
        popup.querySelector('button')?.focus({ preventScroll: true });
      }}
      onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget) && event.relatedTarget !== trigger.current) menu.current?.hidePopover(); }}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeActions(); } }}>
      {actionsOpen && <>
        {linked && onOpenResource
          ? <button type="button" onClick={() => { closeActions(); onOpenResource(artifact.resource); }}><ArrowSquareOut size={16} />打开原件</button>
          : <button type="button" onClick={() => { closeActions(); onOpen(artifact); }}><FileText size={16} />查看内容</button>}
        <button type="button" onClick={() => { closeActions(); onTask(artifact.taskId); }}><CheckSquare size={16} />查看来源任务</button>
      </>}
    </div>
  </li>;
}

export function BotArtifactsView({ botId, artifacts, cards, selectedId, onSelect, onTask, onOpenResource, onExternalPreview }: {
  botId: string; artifacts: BotArtifact[]; cards: BotCard[]; selectedId?: string; onSelect(id?: string): void;
  onTask(id: string): void; onOpenResource?(ref: BotResourceRef): void; onExternalPreview?(artifact: BotArtifact): void;
}) {
  const directory = useRef<HTMLElement>(null), detail = useRef<HTMLElement>(null);
  const [filter, setFilter] = useState<typeof libraryFilters[number]>('全部');
  const selected = artifacts.find(artifact => artifact.id === selectedId);
  const monday = new Date();
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7);
  const groups: Record<'本周' | '更早', BotArtifact[]> = { 本周: [], 更早: [] };
  for (const artifact of artifacts) {
    const source = artifact.producerBotId === botId ? '本 Bot 创建' : '协作交付';
    if (filter === '全部' || filter === source) groups[Date.parse(artifact.createdAt) >= monday.getTime() ? '本周' : '更早'].push(artifact);
  }
  const owner = (artifact: BotArtifact) => cards.find(card => card.id === artifact.producerBotId)?.name ?? 'Bot';
  const open = (artifact: BotArtifact) => { if (onExternalPreview) onExternalPreview(artifact); else { onSelect(artifact.id); requestAnimationFrame(() => detail.current?.focus()); } };
  const back = () => { onSelect(undefined); requestAnimationFrame(() => directory.current?.querySelector<HTMLButtonElement>(`button[data-artifact-id="${selectedId}"]`)?.focus()); };
  return <div className="bot-work-view bot-artifacts-view" data-detail-open={!!selected}>
    <section className="bot-work-directory" ref={directory} aria-label={selected ? '交付件目录' : '交付件清单'}>
      {selected && <button className="bot-text-button bot-artifact-list-back" onClick={back}><ArrowLeft size={15} />全部交付件</button>}
      {artifacts.length > 0 && <div className="bot-library-filters" role="group" aria-label="资料分类">
        {libraryFilters.map(value => <button type="button" key={value} aria-pressed={filter === value} onClick={() => { setFilter(value); if (selected) onSelect(undefined); }}>{value}</button>)}
      </div>}
      {Object.entries(groups).map(([period, items]) => items.length > 0 && <section key={period} className="bot-library-group" aria-label={period}>
        <h3>{period}</h3><ul>{items.map(artifact => <ArtifactRow key={artifact.id} artifact={artifact} selected={selectedId === artifact.id}
          onOpen={open} onTask={onTask} onOpenResource={onOpenResource} />)}</ul>
      </section>)}
      {!groups.本周.length && !groups.更早.length && <p className="bot-library-empty">{artifacts.length ? '该分类暂无资料' : '这个 Bot 保存的资料会显示在这里。'}</p>}
    </section>
    {selected && <section className="bot-work-detail bot-delivery-preview" ref={detail} aria-label="交付件预览" tabIndex={-1}>
      <button className="bot-text-button bot-work-root-back" onClick={back}><ArrowLeft size={15} />返回交付件</button>
      <header className="bot-delivery-heading"><h3>{selected.title}</h3><div><p>{owner(selected)} · {artifactType(selected)} · {workTime(selected.createdAt)}</p><button className="bot-button" onClick={() => onTask(selected.taskId)}>查看来源任务<ArrowRight size={15} /></button></div></header>
      {selected.resource.kind !== 'artifact' && onOpenResource && <button className="bot-text-button" onClick={() => onOpenResource(selected.resource)}>打开原件<ArrowSquareOut size={15} /></button>}
      {selected.content ? <AiResponse entry={{ id: selected.id, role: 'assistant', content: selected.content }} /> : <p className="bot-work-muted">{selected.resource.kind !== 'artifact' ? '此交付件关联工作区原件，打开原件可查看最新内容。' : '此交付件没有保存正文。'}</p>}
    </section>}
  </div>;
}
