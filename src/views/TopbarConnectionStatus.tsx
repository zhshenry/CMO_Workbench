import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, ChatCircle, Circle, Plug, Shield } from '@phosphor-icons/react';
import type { WelinkConnection } from '../../shared/welink-agenda';
import type { ConnectionSettingsSection } from './SettingsView';

const welinkLabels = {
  checking: '正在检查…', ready: '已登录', 'needs-login': '未登录',
  'client-closed': '客户端未打开', temporary: '暂无法确认',
};

export function TopbarConnectionStatus({ w3Configured, onOpen, onSettings }: {
  w3Configured?: boolean | null;
  onOpen(): void;
  onSettings(section: ConnectionSettingsSection): void;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const revision = useRef(0);
  const [open, setOpen] = useState(false);
  const [welink, setWelink] = useState<WelinkConnection | 'checking'>('checking');
  const readWelink = useCallback(() => {
    const request = ++revision.current;
    void window.workbench.island.welinkStatus().then(status => {
      if (request === revision.current) setWelink(status.connection ?? (status.authenticated ? 'ready' : 'needs-login'));
    }, () => { if (request === revision.current) setWelink('temporary'); });
  }, []);
  useEffect(() => {
    const off = window.workbench.island.onWelinkAuthChanged(readWelink);
    readWelink();
    return () => { revision.current++; off(); };
  }, [readWelink]);

  const needsLogin = welink === 'needs-login';
  const needsAttention = needsLogin || welink === 'client-closed' || w3Configured === false;
  const w3Label = w3Configured === undefined ? '正在读取…' : w3Configured === null ? '暂无法确认' : w3Configured ? '已设置账号' : '未设置账号';
  function openSettings(section: ConnectionSettingsSection) {
    panel.current?.hidePopover();
    trigger.current?.focus({ preventScroll: true });
    onSettings(section);
  }

  return <>
    <button ref={trigger} type="button" className="ibtn topbar-connection-trigger" title="接入状态"
      aria-label={needsAttention ? '接入状态，有待处理项' : '接入状态'} aria-haspopup="dialog"
      aria-expanded={open} aria-controls={id} popoverTarget={id}
      onClick={() => { if (!open) { onOpen(); readWelink(); } }}>
      <Plug size={18} aria-hidden="true" />
      {needsAttention && <Circle className="topbar-connection-dot" size={7} weight="fill" aria-hidden="true" />}
    </button>
    <div ref={panel} id={id} className="topbar-connection-popover" popover="auto" role="dialog" aria-labelledby={`${id}-heading`} tabIndex={-1}
      onToggle={event => {
        const next = event.newState === 'open';
        setOpen(next);
        if (next) event.currentTarget.focus({ preventScroll: true });
      }}>
      <h2 id={`${id}-heading`}>接入状态</h2>
      <div className="topbar-connection-row">
        <span className="topbar-connection-symbol"><ChatCircle size={18} aria-hidden="true" /></span>
        <div><strong>WeLink</strong><span className="topbar-connection-state" role="status">{welinkLabels[welink]}</span></div>
        <button type="button" className="topbar-connection-action" onClick={() => openSettings('welink')}>
          {needsLogin ? <>去登录<ArrowRight size={14} aria-hidden="true" /></> : '查看设置'}
        </button>
      </div>
      <div className="topbar-connection-row">
        <span className="topbar-connection-symbol"><Shield size={18} aria-hidden="true" /></span>
        <div><strong>W3</strong><span className="topbar-connection-state" role="status">{w3Label}</span></div>
        <button type="button" className="topbar-connection-action" onClick={() => openSettings('w3')}>维护账号</button>
      </div>
    </div>
  </>;
}
