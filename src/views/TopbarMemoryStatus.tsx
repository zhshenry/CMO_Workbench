import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { ArrowRight, CaretUp, Circle, CircleNotch, Clock, Notebook, WarningCircle } from '@phosphor-icons/react';
import type { BotCard, BotMemoryReviewStatus } from '../../shared/bot-contracts';

export function useAutomaticMemoryStatus() {
  const [status, setStatus] = useState<BotMemoryReviewStatus>();
  useEffect(() => {
    const bot = window.workbench.bot;
    let request = 0;
    function read() {
      const current = ++request;
      void bot.getAutomaticMemoryStatus().then(value => {
        if (request === current) setStatus(value);
      }, () => { if (request === current) setStatus(undefined); });
    }
    const unsubscribe = bot.onChanged(event => {
      if (event.kind === 'memory-review' || event.kind === 'memory' || event.kind === 'host') read();
    });
    read();
    return () => { request++; unsubscribe(); };
  }, []);
  return status;
}

const reviewTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const reviewDay = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric' });
function checkedTime(value: string) {
  const date = new Date(value), time = reviewTime.format(date);
  return date.toDateString() === new Date().toDateString() ? time : `${reviewDay.format(date)} ${time}`;
}

export function TopbarMemoryStatus({ status, bots, compact, aiTrigger, panel, onOpen, onView }: {
  status: BotMemoryReviewStatus; bots: BotCard[]; compact: boolean; aiTrigger: RefObject<HTMLButtonElement | null>;
  panel: RefObject<HTMLDivElement | null>; onOpen(): void; onView(bot: BotCard, memoryId?: string): void;
}) {
  const id = useId(), trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const element = panel.current, anchor = (compact ? aiTrigger : trigger).current;
    if (!open || !element || !anchor) return;
    const tools = anchor.closest('.tb-tools');
    const place = () => {
      const rect = anchor.getBoundingClientRect(), center = rect.left + rect.width / 2;
      const left = Math.max(12, Math.min(center - element.offsetWidth * 0.39, window.innerWidth - element.offsetWidth - 12));
      element.style.left = `${left}px`;
      element.style.top = `${(tools?.getBoundingClientRect().bottom ?? rect.bottom) + 8}px`;
      element.style.setProperty('--memory-pointer-left', `${center - left - 10}px`);
    };
    place();
    element.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    if (tools) observer.observe(tools);
    window.addEventListener('resize', place);
    return () => { observer.disconnect(); window.removeEventListener('resize', place); };
  }, [open, compact, aiTrigger, panel]);

  const { activeBotId, retryBotId, pending, lastResult } = status;
  const activeName = bots.find(bot => bot.id === (activeBotId ?? retryBotId))?.name;
  const owner = bots.find(bot => bot.id === lastResult?.botId);
  const botLabel = activeName ? ` · ${activeName}` : '';
  const waiting = `${pending} 条发言待检查`;
  const message = activeBotId ? `正在检查${botLabel}`
    : retryBotId ? `等待重试${botLabel}`
      : pending ? waiting : '等待新发言';
  const StatusIcon = activeBotId ? CircleNotch : retryBotId ? WarningCircle : pending ? Clock : Circle;
  const summary = lastResult && [
    lastResult.added ? `新增 ${lastResult.added} 条` : '',
    lastResult.updated ? `更新 ${lastResult.updated} 条` : '',
  ].filter(Boolean).join(' · ');
  const title = lastResult?.destination?.title;
  const showTitle = title && lastResult && lastResult.added + lastResult.updated === 1;
  return <>
    {!compact && <button ref={trigger} type="button" className="ibtn topbar-memory-trigger" title={`自动记忆 · ${message}`}
      aria-label={`自动记忆，${message}`} aria-haspopup="dialog" aria-expanded={open} aria-controls={id} popoverTarget={id} data-running={!!activeBotId}>
      <Notebook size={20} aria-hidden="true" />
      {activeBotId && <Circle className="topbar-memory-dot" size={7} weight="fill" aria-hidden="true" />}
    </button>}
    <div ref={panel} id={id} className="topbar-memory-popover" popover="auto" role="dialog" aria-label="自动记忆" tabIndex={-1}
      onToggle={event => { const next = event.newState === 'open'; setOpen(next); if (next) onOpen(); }}
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
        event.preventDefault(); event.stopPropagation();
        panel.current?.hidePopover(); (compact ? aiTrigger : trigger).current?.focus({ preventScroll: true });
      }}>
      <CaretUp className="topbar-memory-pointer" size={20} weight="fill" aria-hidden="true" />
      <h2>自动记忆</h2>
      <div className="topbar-memory-state" role="status">
        <StatusIcon size={17} data-tone={activeBotId ? 'running' : retryBotId ? 'retry' : 'idle'} aria-hidden="true" />
        <span>{message}</span>
        {pending > 0 && (activeBotId || retryBotId) && <span className="topbar-memory-waiting">{activeBotId && '另有 '}{waiting}</span>}
      </div>
      <div className="topbar-memory-last">
        <div className="topbar-memory-last-heading">
          <span>上次检查</span>{lastResult && <time dateTime={lastResult.checkedAt}>{checkedTime(lastResult.checkedAt)}</time>}
        </div>
        <div>{lastResult ? (summary ? <>{summary}{showTitle && `「${title}」`}</> : '检查完成，记忆无变化') : '还没有检查记录'}</div>
        {owner && owner.id !== activeBotId && <span className="topbar-memory-owner">{owner.name}</span>}
        {owner && lastResult?.destination && <button type="button" className="topbar-memory-view" onClick={() => {
          panel.current?.hidePopover(); onView(owner, lastResult?.destination?.memoryId);
        }}>查看记忆<ArrowRight size={15} aria-hidden="true" /></button>}
      </div>
    </div>
  </>;
}
