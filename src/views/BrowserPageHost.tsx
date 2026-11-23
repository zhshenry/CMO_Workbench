import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { BrowserWorkspacePane } from '../../modules/browser/ui/workspace-pane';
import type { BrowserDefaultTab } from '../../shared/browser-contracts';
import { WorkbenchPage } from '../ui/WorkbenchPage';

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
  useEffect(() => {
    if (active || entered || !defaultTabs) return;
    return window.workbench.browserAutomation?.onTabCommand(command => {
      if (command.type === 'prepare' && defaultTabs.some(tab => tab.workspace === command.workspace && tab.id === command.tabId)) setEntered(true);
    });
  }, [active, entered, defaultTabs]);
  useLayoutEffect(() => {
    if (!active && host.current && (document.activeElement === document.body || host.current.contains(document.activeElement))) focusTarget.current?.focus({ preventScroll: true });
  }, [active, focusTarget]);
  if (!active && !entered) return null;
  return <div ref={host} className="view-fade browser-host business-browser-host" hidden={!active} inert={!active} aria-hidden={!active} onFocusCapture={event => { if (!active) { (event.target as HTMLElement).blur(); focusTarget.current?.focus({ preventScroll: true }); } }}>
    <WorkbenchPage id={`view-${workspace}`} title={label} className="media-browser-view workbench-browser-view">
      <BrowserWorkspacePane workspace={workspace} initialUrl={initialUrl} tabs slogan={slogan} onPending={onPending}
        defaultTabs={defaultTabs} activeWorkspace={activeWorkspace} onActiveWorkspaceChange={onActiveWorkspaceChange} />
    </WorkbenchPage>
  </div>;
}
