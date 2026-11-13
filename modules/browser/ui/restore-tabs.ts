import type { BrowserSavedTab } from '../../../shared/browser-automation-contracts';
import type { BrowserDefaultTab } from '../../../shared/browser-contracts';

const tabUrlOrigin = (url: string): string | null => { try { return new URL(url).origin; } catch { return null; } };

/**
 * 把持久化标签恢复为可渲染的初始标签集。
 *
 * 多标签形态下,保证首位始终承载工作台主页(initialUrl):重启后首个持久化标签可能是被
 * 导航到的任意地址(如弹窗成为首标签、或被导航到其他站点),pane.tsx 的位置守卫会把它误当
 * 主页永久保护,真正的主页反从标签条丢失。首位与 initialUrl 不同源时,在首位补一个主页
 * 标签,使「首个=主页」重新成立。
 */
export function restorableBrowserTabs(tabs: BrowserSavedTab[], initialUrl?: string, single = false): BrowserSavedTab[] {
  const safe = tabs.filter(tab => /^https?:\/\//.test(tab.url));
  if (!safe.length) return [{ id: crypto.randomUUID(), url: initialUrl ?? '' }];
  const limited = safe.slice(0, single ? 1 : 20);
  if (!single && initialUrl) {
    const homeOrigin = tabUrlOrigin(initialUrl);
    if (homeOrigin && tabUrlOrigin(limited[0].url) !== homeOrigin) return [{ id: crypto.randomUUID(), url: initialUrl }, ...limited].slice(0, 20);
  }
  return limited;
}

/** 固定标签按身份恢复，保留页面跳转后的地址及原有登录分区。 */
export function restoreDefaultBrowserTabs(tabs: BrowserSavedTab[], defaults: readonly BrowserDefaultTab[]): BrowserSavedTab[] {
  const remaining = [...tabs];
  const fixed = defaults.map(tab => {
    let index = remaining.findIndex(saved => saved.id === tab.id);
    if (index < 0) index = remaining.findIndex(saved => saved.workspace === tab.workspace && tabUrlOrigin(saved.url) === tabUrlOrigin(tab.url));
    const saved = index < 0 ? undefined : remaining.splice(index, 1)[0];
    return { id: tab.id, url: saved && /^https?:\/\//.test(saved.url) ? saved.url : tab.url, workspace: tab.workspace };
  });
  const ids = new Set(fixed.map(tab => tab.id));
  return [...fixed, ...remaining.filter(tab => {
    if (ids.has(tab.id) || !defaults.some(item => item.workspace === tab.workspace) || !/^https?:\/\//.test(tab.url)) return false;
    ids.add(tab.id); return true;
  })].slice(0, 20);
}
