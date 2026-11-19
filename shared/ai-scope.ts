import type { ChatSession, ChatSummary } from './todo-contracts';
import type { ViewId, WorkbenchId } from './contracts';

export const TODO_AI_WORKBENCH_NAME = 'To-Do-List';

export type AiScope =
  | { module: 'todo' }
  | { module: 'reading'; profileId: string }
  | { module: 'workbench'; viewId: string };

/** 旧持久化会话里可能存的已废弃 viewId,归一到当前等价页(避免历史会话命中时回退显示原始 ID)。 */
const legacyViewAliases: Record<string, ViewId> = {
  'settings-notifications': 'settings-data',
};

/** 在会话加载边界把 workbench scope 的原始 viewId 归一到当前等价页(chatScope/chatContextScope 共用)。 */
function normalizeAiScope(scope: AiScope): AiScope {
  if (scope.module === 'workbench' && legacyViewAliases[scope.viewId]) return { module: 'workbench', viewId: legacyViewAliases[scope.viewId] };
  return scope;
}

export function chatScope(chat: Pick<ChatSession, 'module' | 'draftId' | 'profileId' | 'viewId'>): AiScope {
  if (chat.module === 'reading' && chat.profileId) return { module: 'reading', profileId: chat.profileId };
  if (chat.module === 'workbench' && chat.viewId) return normalizeAiScope({ module: 'workbench', viewId: chat.viewId });
  return { module: 'todo' }; // 旧会话没有 module，归入原来的待办会话。
}

export function aiScopeKey(scope: AiScope): string {
  switch (scope.module) {
    case 'reading': return `reading:${scope.profileId}`;
    case 'workbench': return `workbench:${scope.viewId}`;
    default: return 'todo';
  }
}

export function sameAiScope(chat: Pick<ChatSession, 'module' | 'draftId' | 'profileId' | 'viewId'>, scope: AiScope): boolean {
  return aiScopeKey(chatScope(chat)) === aiScopeKey(scope);
}

const viewWorkbenches: Record<ViewId, WorkbenchId> = {
  browser: 'web',
  home: 'home', todo: 'todo', office: 'office', reading: 'life',
  'permission-query': 'permission', 'permission-groups': 'permission',
  'delivery-projects': 'delivery',
  'pbi-features': 'pbi', 'pbi-modules': 'pbi',
  'dts-query': 'dts',
  'settings-profile': 'settings', 'settings-welink': 'settings', 'settings-general': 'settings', 'settings-appearance': 'settings', 'settings-island': 'settings',
  'settings-ai': 'settings', 'settings-bots': 'settings', 'settings-agents': 'settings', 'settings-data': 'settings', 'settings-notifications': 'settings', 'settings-about': 'settings',
};

export function defaultAiScopeForWorkbench(workbench: WorkbenchId): AiScope | null {
  if (workbench === 'todo') return { module: 'todo' };
  if (workbench === 'home') return { module: 'workbench', viewId: 'home' };
  if (workbench === 'web') return { module: 'workbench', viewId: 'browser' };
  if (workbench === 'office') return { module: 'workbench', viewId: 'workspace:office' };
  if (workbench === 'life' || workbench === 'settings' || workbench === 'permission' || workbench === 'delivery' || workbench === 'pbi' || workbench === 'dts') return { module: 'workbench', viewId: `workspace:${workbench}` };
  return null;
}

export function workbenchForScope(scope: AiScope): WorkbenchId | null {
  if (scope.module === 'todo') return 'todo';
  if (scope.module === 'reading') return 'life';
  if (scope.viewId === 'workspace:life') return 'life';
  if (scope.viewId === 'workspace:office') return 'office';
  if (scope.viewId === 'workspace:settings') return 'settings';
  if (scope.viewId === 'workspace:permission') return 'permission';
  if (scope.viewId === 'workspace:delivery') return 'delivery';
  if (scope.viewId === 'workspace:pbi') return 'pbi';
  if (scope.viewId === 'workspace:dts') return 'dts';
  return viewWorkbenches[scope.viewId as ViewId] ?? null;
}

export function sameAiWorkbench(chat: Pick<ChatSession, 'module' | 'draftId' | 'profileId' | 'viewId'>, scope: AiScope): boolean {
  const original = chatScope(chat);
  const workbench = workbenchForScope(original);
  return workbench ? workbench === workbenchForScope(scope) : aiScopeKey(original) === aiScopeKey(scope);
}

/** Restore a remembered chat within its workbench, then fall back to its latest chat. */
export function preferredAiChat(chats: ChatSummary[], scope: AiScope, preferredId?: string): ChatSummary | undefined {
  const scoped = chats.filter(chat => sameAiWorkbench(chat, scope));
  return scoped.find(chat => chat.id === preferredId) ?? scoped[0];
}

export function chatContextScope(chat: Pick<ChatSession, 'module' | 'draftId' | 'profileId' | 'viewId' | 'contextScope'>): AiScope {
  return chat.contextScope && sameAiWorkbench(chat, chat.contextScope) ? normalizeAiScope(chat.contextScope) : chatScope(chat);
}
