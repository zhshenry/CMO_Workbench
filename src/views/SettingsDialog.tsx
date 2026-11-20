import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Desktop, GearSix, Info, ListChecks, Palette, PlugsConnected, Robot, Sparkle, UserCircle, WechatLogo } from '@phosphor-icons/react';
import type { AvatarColor, ViewId } from '../../shared/contracts';
import { workbenchById } from '../nav';
import { Modal } from '../ui/controls';
import type { AppearanceController } from '../appearance';
import { SettingsView } from './SettingsView';

const SECTION_ICONS: Partial<Record<ViewId, typeof GearSix>> = {
  'settings-profile': UserCircle,
  'settings-welink': WechatLogo,
  'settings-general': GearSix,
  'settings-appearance': Palette,
  'settings-island': Desktop,
  'settings-ai': Sparkle,
  'settings-bots': Robot,
  'settings-agents': PlugsConnected,
  'settings-data': ListChecks,
  'settings-about': Info,
};

export function SettingsDialog({ view, onNavigate, close, ...settings }: {
  view: ViewId;
  onNavigate(view: ViewId): void;
  close(): void;
  appearance: AppearanceController;
  botManagement?: ReactNode;
  onAvatarColorChange(color: AvatarColor): void;
}) {
  const sections = useRef<HTMLElement>(null);
  const selection = useRef<HTMLSpanElement>(null);
  const page = useRef<HTMLDivElement>(null);
  const lastView = useRef<ViewId | null>(null);
  const [displayedView, setDisplayedView] = useState(view);
  const leaving = displayedView !== view;

  useLayoutEffect(() => {
    if (!leaving) return;
    const fade = page.current?.getAnimations?.().find(animation =>
      'animationName' in animation && animation.animationName === 'settings-page-out');
    let current = true;
    const showSelected = (): void => { if (current) setDisplayedView(view); };
    if (!fade) { showSelected(); return; }
    void fade.finished.then(showSelected, showSelected);
    return () => { current = false; };
  }, [view, leaving]);

  useLayoutEffect(() => {
    const content = page.current?.parentElement;
    if (content) content.scrollTop = 0;
  }, [displayedView]);

  useLayoutEffect(() => {
    const previous = lastView.current;
    lastView.current = view;
    const nav = sections.current, marker = selection.current;
    const active = nav?.querySelector<HTMLButtonElement>('[aria-current="page"]');
    if (!nav || !marker || !active) return;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const place = (): void => {
      const { offsetWidth, offsetHeight, offsetLeft, offsetTop } = active;
      marker.style.width = `${offsetWidth}px`;
      marker.style.height = `${offsetHeight}px`;
      marker.style.transform = `translate(${offsetLeft}px, ${offsetTop}px)`;
    };
    const snap = (): void => {
      nav.dataset.selectionMotion = 'off';
      place();
      marker.getBoundingClientRect();
      delete nav.dataset.selectionMotion;
    };
    if (previous === null || motion.matches) snap();
    else place();
    nav.dataset.selectionReady = 'true';
    if (previous === null) active.focus({ preventScroll: true });
    const observer = new ResizeObserver(place);
    observer.observe(nav);
    observer.observe(active);
    const reduceMotion = (): void => { if (motion.matches) snap(); };
    motion.addEventListener('change', reduceMotion);
    return () => {
      observer.disconnect();
      motion.removeEventListener('change', reduceMotion);
    };
  }, [view]);

  return <Modal title="设置" className="settings-dialog" close={close}>
    <div className="settings-dialog-layout">
      <nav className="settings-sections" aria-label="设置分类" ref={sections}>
        <span className="settings-selection" ref={selection} aria-hidden="true" />
        {workbenchById('settings').subs.map(sub => {
          if (!sub.view) return null;
          const Icon = SECTION_ICONS[sub.view];
          return <button key={sub.view} type="button" data-settings-view={sub.view}
            aria-current={sub.view === view ? 'page' : undefined} onClick={() => onNavigate(sub.view!)}>
            {Icon && <Icon size={20} aria-hidden="true" />}<span>{sub.label}</span>
          </button>;
        })}
      </nav>
      <div className="settings-content">
        <div className="settings-dialog-page" key={displayedView} ref={page} data-leaving={leaving || undefined} inert={leaving}>
          <SettingsView view={displayedView} {...settings} />
        </div>
      </div>
    </div>
  </Modal>;
}
