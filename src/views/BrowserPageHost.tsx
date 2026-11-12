import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { BrowserWorkspacePane } from '../../modules/browser/ui/workspace-pane';
import type { BrowserDefaultTab } from '../../shared/browser-contracts';

/** 通用浏览器页面 Host:工作台切换只隐藏 DOM，页面状态保留。 */
export function BrowserPageHost({ active, focusTarget, onPending, workspace, initialUrl, label, slogan, defaultTabs, activeWorkspace, onActiveWorkspaceChange }: {
  active: boolean;
  focusTarget: RefObject<HTMLElement | null>;
  onPending(message: string): void;
  workspace: string;
  initialUrl?: string;
  label: string;
  slogan?: string;
  defaultTabs?: readonly BrowserDefaultTab[];
  activeWorkspace?: string;
  onActiveWorkspaceChange?(workspace: string): void;
}) {
  const [entered, setEntered] = useState(active);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => { if (active) setEntered(true); }, [active]);
  useLayoutEffect(() => {
    if (!active && host.current && (document.activeElement === document.body || host.current.contains(document.activeElement))) focusTarget.current?.focus({ preventScroll: true });
  }, [active, focusTarget]);
  if (!active && !entered) return null;
  return <div ref={host} className="view-fade browser-host" hidden={!active} inert={!active} aria-hidden={!active} onFocusCapture={event => { if (!active) { (event.target as HTMLElement).blur(); focusTarget.current?.focus({ preventScroll: true }); } }}>
    <section className="view on media-browser-view" id={`view-${workspace}`} aria-label={label}>
      <BrowserWorkspacePane workspace={workspace} initialUrl={initialUrl} tabs slogan={slogan} onPending={onPending}
        defaultTabs={defaultTabs} activeWorkspace={activeWorkspace} onActiveWorkspaceChange={onActiveWorkspaceChange} />
    </section>
  </div>;
}
