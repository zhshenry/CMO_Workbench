import { useCallback, useEffect, useRef, useState } from 'react';
import type { BotCard, BotHostState } from '../../shared/bot-contracts';
import { GearSix, PlugsConnected, PuzzlePiece, Wrench } from '@phosphor-icons/react';
import { errorText, Modal, Segmented, Select } from '../ui/controls';
import { Rows } from './SettingsView';
import { BotAvatar } from './BotAvatar';
import { BotExtensionsSettings } from './BotExtensionsSettings';
import { BotSkillsSettings } from './BotSkillsSettings';
import './bot-management.css';

const wb = window.workbench;
// A change can still be running when the user leaves and reopens settings.
let backgroundChange: Promise<BotHostState> | undefined;

export type BotSettingsState = { dirty: boolean; busy: boolean; discard?(): void };
const tabs = [
  { value: 'runtime', label: '后台运行', icon: <GearSix size={16} /> },
  { value: 'tools', label: '工具', icon: <Wrench size={16} /> },
  { value: 'mcp', label: 'MCP', icon: <PlugsConnected size={16} /> },
  { value: 'skills', label: '技能', icon: <PuzzlePiece size={16} /> },
];

export function BotManagement({ onStateChange }: { onStateChange?(state: BotSettingsState): void }) {
  const [tab, setTab] = useState('runtime'), [cards, setCards] = useState<BotCard[]>([]), [botId, setBotId] = useState('');
  const [serverId, setServerId] = useState(''), [reload, setReload] = useState(0);
  const [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<BotSettingsState>({ dirty: false, busy: false });
  const [pending, setPending] = useState<{ run(): void }>();
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    void wb.bot.list().then(value => {
      if (!current) return;
      setCards(value); setBotId(prior => value.some(card => card.id === prior) ? prior : value[0]?.id ?? '');
    }, cause => { if (current) setError(errorText(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [reload]);
  useEffect(() => { onStateChange?.(editing); }, [editing, onStateChange]);
  useEffect(() => () => onStateChange?.({ dirty: false, busy: false }), [onStateChange]);
  function request(run: () => void) {
    if (editing.busy) return;
    if (editing.dirty) setPending({ run });
    else run();
  }
  const card = cards.find(item => item.id === botId);
  const picker = card && <Select aria-label="选择配置的 Bot" value={botId} disabled={editing.busy} matchTriggerWidth title={card.name}
    options={cards.map(item => ({ value: item.id, label: item.name }))}
    triggerContent={<span className="bot-settings-bot"><BotAvatar avatar={card.avatar} small /><span>{card.name}</span></span>}
    renderOption={option => <span className="bot-settings-bot"><BotAvatar avatar={cards.find(item => item.id === option.value)!.avatar} small /><span>{option.label}</span></span>}
    onChange={value => request(() => setBotId(value))} />;
  return <section className="bot-management">
    <p className="bot-settings-lead">在这里管理后台运行、工具、MCP 与技能。</p>
    <fieldset className="bot-management-tabs" disabled={editing.busy}>
      <Segmented variant="content" aria-label="Bot 管理内容" value={tab} options={tabs} onChange={value => request(() => setTab(value))} />
    </fieldset>
    {tab === 'runtime' ? <BotBackgroundSettings onStateChange={setEditing} /> : <>
      {loading && <p className="bot-settings-help" role="status">正在读取 Bot…</p>}
      {error && <div className="bot-settings-feedback"><p className="error" role="alert">{error}</p><button type="button" className="set-btn" onClick={() => setReload(value => value + 1)}>重新读取 Bot</button></div>}
      {!loading && !error && !card && <p className="bot-settings-help">暂无可配置的 Bot。</p>}
      {card && (tab === 'skills'
        ? <BotSkillsSettings key={botId} botId={botId} botName={card.name} picker={picker} onStateChange={setEditing} />
        : <BotExtensionsSettings key={botId} botId={botId} picker={picker} tab={tab as 'tools' | 'mcp'} selected={serverId} selectServer={setServerId}
          request={request} onStateChange={setEditing} showMcp={id => request(() => { if (id) setServerId(id); setTab('mcp'); })} />)}
    </>}
    {pending && <Modal title="分配修改还没有保存" className="confirm" close={() => setPending(undefined)}>
      <p>继续编辑可保留当前修改，放弃后再切换。</p>
      <div className="actions"><button type="button" autoFocus onClick={() => setPending(undefined)}>继续编辑</button>
        <button type="button" className="danger" onClick={() => { const next = pending; setPending(undefined); editing.discard?.(); next.run(); }}>放弃修改并切换</button></div>
    </Modal>}
  </section>;
}

function BotBackgroundSettings({ onStateChange }: { onStateChange(state: BotSettingsState): void }) {
  const [host, setHost] = useState<BotHostState>();
  const [hostError, setHostError] = useState('');
  const [busy, setBusy] = useState(false);
  const hostRequest = useRef(0);
  useEffect(() => { onStateChange({ dirty: false, busy }); }, [busy, onStateChange]);
  useEffect(() => () => onStateChange({ dirty: false, busy: false }), [onStateChange]);

  const readHost = useCallback(() => {
    const request = ++hostRequest.current;
    const pending = backgroundChange;
    setBusy(Boolean(pending));
    setHostError('');
    void (pending ?? wb.bot.getHostState()).then(next => {
      if (request === hostRequest.current) setHost(next);
    }, cause => {
      if (request !== hostRequest.current) return;
      setHost(undefined);
      setHostError(errorText(cause));
    }).finally(() => {
      if (request === hostRequest.current) setBusy(false);
    });
  }, []);

  useEffect(() => {
    readHost();
    let timer: number | undefined;
    const unsubscribe = wb.bot.onChanged(({ kind }) => {
      if (kind !== 'host' || backgroundChange || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        if (!backgroundChange) readHost();
      }, 250);
    });
    return () => {
      hostRequest.current++;
      window.clearTimeout(timer);
      unsubscribe();
    };
  }, [readHost]);

  function changeBackground() {
    if (!host || backgroundChange) return;
    const pending = wb.bot.setBackground(!host.supervised);
    backgroundChange = pending;
    const clear = () => { backgroundChange = undefined; };
    void pending.then(clear, clear);
    readHost();
  }

  const issue = hostError || host?.error;
  return <section className="bot-background-settings" aria-labelledby="bot-management-runtime">
    <h2 id="bot-management-runtime">后台运行</h2>
    <Rows query="" rows={[{
      key: 'botBackground',
      title: '独立 Bot 后台',
      desc: '登录系统后待命。退出应用后，可继续执行所需资源仍可用的任务。休眠或关机时暂停。浏览器任务需要工作区在线。',
      control: <button type="button" className="toggle" role="switch" aria-checked={host?.supervised ?? false}
        aria-label="独立 Bot 后台" disabled={busy || !host} onClick={changeBackground} />,
    }]} />
    {issue && <div className="bot-management-feedback">
      <p className="error" role="alert">{issue}</p>
      <button type="button" className="set-btn" disabled={busy} onClick={readHost}>重新读取后台状态</button>
    </div>}
  </section>;
}
