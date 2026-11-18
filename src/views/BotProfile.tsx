import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, CaretRight, ChatsCircle, Desktop, PencilSimple, Trash, X } from '@phosphor-icons/react';
import type { BotCard, BotMemory, BotProfile as Profile } from '../../shared/bot-contracts';
import type { AiConfig } from '../../shared/workbench-api';
import { errorText, IconButton, Segmented, Select } from '../ui/controls';
import { BotAvatar } from './BotAvatar';
import { BotAvatarPicker } from './BotAvatarPicker';
import { BotModelPicker } from './BotModelPicker';
import { BotSchedules } from './BotSchedules';
import { normalizeBotAvatar } from '../../shared/bot-avatar';

const api = window.workbench.bot;
const capabilityLabels: Record<string, string> = { '权限与 PIC 群组（需工作区在线）': '权限与 PIC 群组', 'PBI 浏览器（需工作区在线）': '网页操作', '待办查询与确认写入': '待办管理' };

export type InspectorTab = 'details' | 'library';
type Fields = Pick<Profile, 'name' | 'description' | 'avatar' | 'instructions' | 'modelId'>;
type ProfileDraft = { revision: number; fields: Partial<Fields> };
const edits = new Map<string, ProfileDraft>();

export function BotProfile({ ref, card, profile, config, tab, expanded, onTab, close, onSaved, onReload, onWorkspace, onActivity, onSettings, onManageInMain, library }: {
  ref: Ref<HTMLElement>; card: BotCard; profile?: Profile; config?: AiConfig; tab: InspectorTab; expanded: boolean;
  onTab(value: InspectorTab): void; close(): void; onSaved(profile: Profile): void; onReload(): void;
  onWorkspace(): void; onActivity(): void; onSettings(): void; onManageInMain?(): void; library: ReactNode;
}) {
  const [section, setSection] = useState<'details' | 'memory'>('details');
  const [picker, setPicker] = useState(false), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(() => edits.get(card.id)), [conflict, setConflict] = useState<Profile>();
  const [memories, setMemories] = useState<BotMemory[]>(), [memory, setMemory] = useState<BotMemory>();
  const avatarButton = useRef<HTMLButtonElement>(null);
  const avatarPopover = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const priorIdentityDraft = useRef<ProfileDraft | undefined>(undefined);
  useEffect(() => {
    if (expanded) closeButton.current?.focus({ preventScroll: true });
    else setPicker(false);
  }, [expanded]);
  useEffect(() => {
    if (!picker) return;
    const panel = avatarPopover.current;
    panel?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true });
    const dismissOutside = (event: Event) => {
      if (event.target instanceof Node && !panel?.contains(event.target) && !avatarButton.current?.contains(event.target)) setPicker(false);
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('focusin', dismissOutside, true);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('focusin', dismissOutside, true);
    };
  }, [picker]);
  const closePicker = () => { setPicker(false); avatarButton.current?.focus({ preventScroll: true }); };
  const form = profile && { ...profile, ...draft?.fields };
  const remember = (next?: ProfileDraft) => {
    if (next) edits.set(card.id, next); else edits.delete(card.id);
    setDraft(next);
  };
  const reset = () => { remember(); priorIdentityDraft.current = undefined; setConflict(undefined); setError(''); };
  const edit = (patch: Partial<Fields>) => {
    if (!profile) return;
    const fields = { ...draft?.fields, ...patch };
    for (const key of Object.keys(patch) as (keyof Fields)[]) {
      if (fields[key] === profile[key]) delete fields[key];
    }
    if (Object.keys(fields).length) remember({ revision: draft?.revision ?? profile.revision, fields });
    else reset();
  };
  const run = async (job: () => Promise<unknown>, profileRevision?: number) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await job(); } catch (cause) {
      setError(errorText(cause));
      if (profileRevision !== undefined) {
        const reported = (cause as { current?: Profile })?.current;
        // The desktop bridge can deliver just the error message on a failed save.
        const latest = reported?.mainChatId ? reported : (await api.open(card.id).catch(() => undefined))?.bot;
        if (latest && latest.revision !== profileRevision) { onSaved(latest); setConflict(latest); }
      }
    } finally { setBusy(false); }
  };
  const save = () => {
    if (!draft || !form) return;
    if (picker) closePicker();
    const { name, description, instructions, avatar, modelId } = form;
    if (!name.trim() || !description.trim()) { setError('请填写 Bot 名称和简介。'); return; }
    void run(async () => {
      const saved = await api.updateProfile(card.id, draft.revision, { name: name.trim(), description: description.trim(), instructions, avatar: normalizeBotAvatar(avatar), modelId: modelId ?? null });
      onSaved(saved); reset();
    }, draft.revision);
  };
  const openMemory = () => { setSection('memory'); void run(async () => setMemories(await api.listMemories(card.id))); };
  const editingChild = !!memory;
  const name = profile?.name ?? card.name;
  const showHeaderActions = draft?.fields.name !== undefined || draft?.fields.description !== undefined || tab === 'library' || section !== 'details';
  const identityField = (field: 'name' | 'description') => {
    const label = field === 'name' ? 'Bot 名称' : '简介';
    const value = form?.[field] ?? card[field];
    if (onManageInMain) return <button type="button" className="bot-identity-text" aria-label={`在主窗口编辑${label}`} onClick={onManageInMain}>{value}</button>;
    return <textarea className="bot-identity-text" aria-label={label} rows={1} maxLength={field === 'name' ? 30 : 100}
      disabled={!profile || busy || editingChild} value={value}
      onFocus={() => { priorIdentityDraft.current = draft; }}
      onChange={event => edit({ [field]: field === 'name' ? event.target.value.replace(/[\r\n]+/g, ' ') : event.target.value })}
      onKeyDown={event => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
        if (event.key === 'Escape') {
          event.preventDefault(); remember(priorIdentityDraft.current); setError(''); closeButton.current?.focus({ preventScroll: true });
        } else if (event.key === 'Enter' && (field === 'name' || !event.shiftKey)) {
          event.preventDefault(); save();
        }
      }} />;
  };
  const profileActions = (inPicker = false) => draft && <div className="actions" inert={picker && !inPicker}><button type="button" disabled={busy} onClick={() => { reset(); if (picker) closePicker(); }}>取消修改</button><button type="button" className="primary" disabled={busy} onClick={save}>{busy ? '保存中…' : '保存修改'}</button></div>;
  return <aside ref={ref} id="bot-inspector" className="bot-inspector bot-profile" aria-label={`${name}的 Bot 资料`} onKeyDown={event => {
    if (event.key !== 'Escape' || event.defaultPrevented || busy) return;
    event.preventDefault();
    if (picker) closePicker(); else if (!editingChild) close();
  }}>
    <button type="button" disabled={busy} className="ibtn bot-inspector-close" ref={closeButton} aria-label="关闭 Bot 侧栏" onClick={close}><X size={17} /></button>
    <div className="bot-inspector-hero">
      <button type="button" ref={avatarButton} className="bot-inspector-avatar" title="更换 Bot 头像" aria-label="更换 Bot 头像" aria-haspopup={onManageInMain ? undefined : 'dialog'} aria-expanded={onManageInMain ? undefined : picker} aria-controls={picker ? 'bot-avatar-editor' : undefined}
        disabled={!profile || busy || editingChild} onClick={onManageInMain ?? (() => setPicker(open => !open))}><BotAvatar avatar={form?.avatar ?? card.avatar} /><span className="bot-avatar-edit-mark" aria-hidden="true"><PencilSimple size={16} weight="bold" /></span></button>
      <h2 aria-label={name}>{identityField('name')}</h2>
      <div className="bot-inspector-description">{identityField('description')}</div>
      {showHeaderActions && profileActions()}
      <Segmented aria-label="Bot 侧栏内容" value={tab} options={[{ value: 'details', label: '详情' }, { value: 'library', label: '资料库' }]} onChange={value => { setPicker(false); onTab(value as InspectorTab); }} />
    </div>
    {picker && form && <div className="bot-avatar-popover-position">
      <div ref={avatarPopover} id="bot-avatar-editor" className="bot-avatar-popover" role="dialog" aria-label="编辑 Bot 头像">
        <BotAvatarPicker value={form.avatar} seedKey={card.seedKey} disabled={busy} onChange={avatar => edit({ avatar })} />
        {profileActions(true)}
      </div>
    </div>}
    {error && <div role="alert" className="bot-error">{error}</div>}
    {conflict && draft && <div className="bot-profile-conflict"><strong>资料已在其他入口更新</strong><p>{conflict.name} · {conflict.description}</p><button onClick={() => { const next = { ...draft, revision: conflict.revision }; remember(next); setConflict(undefined); setError(''); }}>保留本地编辑，使用最新版本</button></div>}
    {tab === 'library' && <div className="bot-inspector-library">{library}</div>}
    <div className="bot-inspector-body" hidden={tab !== 'details'}>
      {section !== 'details' && <button className="bot-text-button bot-inspector-back" disabled={editingChild} onClick={() => { setSection('details'); setError(''); }}><ArrowLeft size={15} />返回详情</button>}
      {section === 'memory' ? <section aria-label="Bot 记忆">
        <div className="bot-profile-section-heading"><h3>已保存</h3>{!memory && <button className="bot-button primary" disabled={busy || !memories} onClick={() => setMemory({ id: crypto.randomUUID(), botId: card.id, scope: 'private', text: '', source: '用户编辑', revision: 0, updatedAt: '' })}>＋ 添加记忆</button>}</div>
          <p className="bot-help">私人记忆仅当前 Bot 使用；共享记忆由全部 Bot 使用。</p>
          {!memories && !error && <p className="bot-empty" role="status">正在读取记忆…</p>}
          {memories?.length === 0 && <p className="bot-empty">还没有保存记忆。可以记录你的习惯或偏好。</p>}
      {memories?.map(item => <div className="bot-memory-item" key={item.id}><p>{item.text}</p><span className="bot-help">{item.scope === 'shared' ? '共享记忆' : '私人记忆'} · {item.source || '手动记录'}</span><div><IconButton className="bot-button" label="编辑记忆" disabled={busy} onClick={() => setMemory({ ...item })}><PencilSimple size={16} /></IconButton><button className="bot-button bot-button-danger" disabled={busy} onClick={() => setMemory({ ...item, text: '' })}><Trash size={16} />删除</button></div></div>)}
      {memory ? <form noValidate onSubmit={event => { event.preventDefault(); void run(async () => { if (!memory.text.trim()) { if (memory.revision) await api.removeMemory(memory.id, memory.revision); } else await api.updateMemory({ id: memory.id, revision: memory.revision, scope: memory.scope, source: memory.source, text: memory.text.trim(), botId: memory.scope === 'private' ? card.id : null }); setMemories(await api.listMemories(card.id)); setMemory(undefined); }); }}>
        <label>记忆内容<textarea aria-label="记忆内容" autoFocus value={memory.text} maxLength={4000} rows={4} placeholder={memory.revision ? '留空后确认删除这条记忆' : '例如：结果使用简洁的中文，并保留依据'} onChange={event => setMemory({ ...memory, text: event.target.value })} /></label>
        <Select aria-label="记忆范围" value={memory.scope} options={[{ value: 'private', label: '当前 Bot' }, { value: 'shared', label: '全部 Bot' }]} onChange={value => setMemory({ ...memory, scope: value as 'private' | 'shared' })} />
        <div className="actions"><button type="button" disabled={busy} onClick={() => setMemory(undefined)}>取消</button><button className={!memory.text.trim() && memory.revision ? 'danger' : 'primary'} disabled={busy || !memory.text.trim() && !memory.revision}>{!memory.text.trim() && memory.revision ? '确认删除' : '保存记忆'}</button></div>
      </form> : null}

        {error && <button className="bot-button" disabled={busy} onClick={openMemory}>重新读取记忆</button>}
      </section> : <>
        {!onManageInMain && expanded && tab === 'details' && <BotSchedules key={card.id} botId={card.id} botName={name} compact />}
        <button className="bot-inspector-workspace" onClick={onWorkspace}><span className="bot-screen-icon"><Desktop size={28} /></span><strong>工作台</strong><ArrowRight size={17} /></button>
        {onManageInMain ? <button className="bot-button" onClick={onManageInMain}><PencilSimple size={15} />在主窗口编辑 Bot</button> : form ? <form noValidate onSubmit={event => { event.preventDefault(); save(); }}>
          <BotModelPicker config={config} value={form.modelId ?? null} disabled={busy || !expanded || tab !== 'details'} onChange={modelId => edit({ modelId })} onSettings={onSettings} />
          <section className="bot-profile-guidance" aria-labelledby="bot-guidance-title">
            <h3 id="bot-guidance-title">能力与工作说明</h3>
            <ul className="bot-capabilities">{card.capabilities.map(item => <li key={item}>{capabilityLabels[item] ?? item}</li>)}</ul>
            <label>工作说明<textarea aria-label="工作说明" rows={4} maxLength={6000} disabled={busy} value={form.instructions} onChange={event => edit({ instructions: event.target.value })} /></label>
          </section>
          {!showHeaderActions && profileActions()}
        </form> : <button className="bot-text-button" onClick={onReload}>重新读取 Bot 资料</button>}
        <div className="bot-inspector-links">
          {!onManageInMain && <button onClick={openMemory}><BookOpen />记忆<CaretRight /></button>}
          <button onClick={onActivity}><ChatsCircle />工作与对话<CaretRight /></button>
        </div>
      </>}
    </div>
  </aside>;
}
