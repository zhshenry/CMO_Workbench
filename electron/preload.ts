import type { WorkbenchApi } from '../shared/workbench-api';
import type { ChatSession } from '../shared/todo-contracts';
import type { BrowserTask, BrowserTabCommand } from '../shared/browser-automation-contracts';
import { contextBridge, ipcRenderer, webUtils } from 'electron';

const onAsk = (callback: (ask: { id: string; sessionId: string; question: string; options: { label: string; description?: string }[] }) => void): (() => void) => {
  const listener = (_event: unknown, ask: { id: string; sessionId: string; question: string; options: { label: string; description?: string }[] }): void => callback(ask);
  ipcRenderer.on('ai:ask', listener);
  return () => {
    ipcRenderer.off('ai:ask', listener);
  };
};

const todo: WorkbenchApi['todo'] = {
  state: () => ipcRenderer.invoke('todo:state'),
  info: () => ipcRenderer.invoke('todo:info'),
  create: (input: unknown) => ipcRenderer.invoke('todo:create', input),
  update: (id: string, patch: unknown, revision: string) =>
    ipcRenderer.invoke('todo:update', id, patch, revision),
  remove: (id: string, revision: string) => ipcRenderer.invoke('todo:remove', id, revision),
  snooze: (id: string) => ipcRenderer.invoke('todo:snooze', id),
  restore: (id: string) => ipcRenderer.invoke('todo:restore', id),
  createCategory: (input: unknown) => ipcRenderer.invoke('todo:createCategory', input),
  updateCategory: (id: string, input: unknown, revision: string) =>
    ipcRenderer.invoke('todo:updateCategory', id, input, revision),
  removeCategory: (id: string, revision: string) =>
    ipcRenderer.invoke('todo:removeCategory', id, revision),
  review: (): Promise<string> => ipcRenderer.invoke('todo:review'),
  onChanged: (callback: () => void): (() => void) => {
    const listener = (): void => callback();
    ipcRenderer.on('todo:changed', listener);
    return () => {
      ipcRenderer.off('todo:changed', listener);
    };
  },
};

// 阅读清单:书单与 Obsidian 读书库只读关联
const reading: WorkbenchApi['reading'] = {
  list: () => ipcRenderer.invoke('reading:list'),
  save: (input: unknown) => ipcRenderer.invoke('reading:save', input),
  remove: (id: string) => ipcRenderer.invoke('reading:remove', id),
  setVault: (vaultPath: string) => ipcRenderer.invoke('reading:setVault', vaultPath),
  scan: (vaultPath: string) => ipcRenderer.invoke('reading:scan', vaultPath),
  aggregate: (folder: string) => ipcRenderer.invoke('reading:aggregate', folder),
  openObsidian: (vault: string, rel?: string): Promise<void> => ipcRenderer.invoke('reading:openObsidian', vault, rel),
};

const ai: WorkbenchApi['ai'] = {
  openLink: (url: string): Promise<void> => ipcRenderer.invoke('ai:openLink', url),
  config: () => ipcRenderer.invoke('ai:config'),
  setEnabled: (enabled: boolean) => ipcRenderer.invoke('ai:setEnabled', { aiEnabled: enabled }),
  saveProvider: (input: unknown) => ipcRenderer.invoke('ai:provider:save', input),
  removeProvider: (id: string) => ipcRenderer.invoke('ai:provider:remove', id),
  saveModel: (input: unknown) => ipcRenderer.invoke('ai:model:save', input),
  removeModel: (id: string) => ipcRenderer.invoke('ai:model:remove', id),
  activateModel: (id: string) => ipcRenderer.invoke('ai:model:activate', id),
  test: (input: unknown): Promise<string> => ipcRenderer.invoke('ai:test', input),
  saveRlcdProvider: (input: unknown) => ipcRenderer.invoke('ai:rlcd:provider:save', input),
  removeRlcdProvider: (id: string) => ipcRenderer.invoke('ai:rlcd:provider:remove', id),
  saveRlcdModel: (input: unknown) => ipcRenderer.invoke('ai:rlcd:model:save', input),
  removeRlcdModel: (id: string) => ipcRenderer.invoke('ai:rlcd:model:remove', id),
  testRlcd: (input: unknown): Promise<string> => ipcRenderer.invoke('ai:rlcd:test', input),
  chatList: () => ipcRenderer.invoke('ai:chat:list'),
  chatOpen: (id?: string) => ipcRenderer.invoke('ai:chat:open', id),
  chatNew: (tag?: unknown) => ipcRenderer.invoke('ai:chat:new', tag),
    chatRename: (id: string, title: string) => ipcRenderer.invoke('ai:chat:rename', id, title),
    chatRemove: (id: string) => ipcRenderer.invoke('ai:chat:remove', id),
    chatDraft: (id: string, text: string): Promise<void> => ipcRenderer.invoke('ai:chat:draft', id, text),
    chatContext: (id: string, scope: import('../shared/ai-scope').AiScope) => ipcRenderer.invoke('ai:chat:context', id, scope),
    ask: (sessionId: string, text: string, context?: import('../shared/ai-reference').AiTurnContext): Promise<void> => ipcRenderer.invoke('ai:ask', sessionId, text, context),
  cancel: (sessionId: string): void => {
    ipcRenderer.send('ai:cancel', sessionId);
  },
  apply: (token: string, indices: number[]) => ipcRenderer.invoke('ai:apply', token, indices),
  discard: (token: string) => ipcRenderer.invoke('ai:discard', token),
  onAsk: onAsk,
  answerAsk: (input: { id: string; sessionId: string; kind: 'option' | 'text' | 'skip'; value?: string }): void => {
    ipcRenderer.send('ai:answer', input);
  },
  onChat: (callback: (chat: ChatSession) => void): (() => void) => {
    const listener = (_event: unknown, chat: ChatSession): void => callback(chat);
    ipcRenderer.on('ai:chat', listener);
    return () => {
      ipcRenderer.off('ai:chat', listener);
    };
  },
  onConfigChanged: (callback: (config: import('../shared/workbench-api').AiConfig) => void): (() => void) => {
    const listener = (_event: unknown, config: import('../shared/workbench-api').AiConfig): void => callback(config);
    ipcRenderer.on('ai:config-changed', listener);
    return () => {
      ipcRenderer.off('ai:config-changed', listener);
    };
  },
};

// 内置浏览器:仅暴露三个租约操作,不暴露 IPC 与 Electron 对象
const browser = {
  acquire: (workspace: string, tabId?: string) => ipcRenderer.invoke('browser:acquire', workspace, tabId),
  release: (lease: string): Promise<void> => ipcRenderer.invoke('browser:release', lease),
  onOpenRequested: (lease: string, listener: (url: string, tabId?: string) => void): (() => void) => {
    const l = (_event: unknown, request: unknown): void => {
      if (typeof request !== 'object' || request === null) return;
      const r = request as Record<string, unknown>;
      if (r.lease !== lease || typeof r.url !== 'string') return;
      listener(r.url, typeof r.tabId === 'string' ? r.tabId : undefined);
    };
    ipcRenderer.on('browser:open-requested', l);
    return () => {
      ipcRenderer.off('browser:open-requested', l);
    };
  },
  onSsoState: (workspace: string, listener: (state: import('../shared/browser-contracts').SsoState) => void): (() => void) => {
    const l = (_event: unknown, payload: unknown): void => {
      if (typeof payload !== 'object' || payload === null) return;
      const p = payload as Record<string, unknown>;
      if (p.workspace !== workspace) return;
      listener({ active: p.active === true, hasCredentials: p.hasCredentials === true });
    };
    ipcRenderer.on('browser:sso-state', l);
    return () => {
      ipcRenderer.off('browser:sso-state', l);
    };
  },
};

const browserAutomation: WorkbenchApi['browserAutomation'] = {
  tabs: (workspace: string) => ipcRenderer.invoke('browser:tabs', workspace),
  deleteHistory: (workspace: string, ids: string[]) => ipcRenderer.invoke('browser:delete-history', workspace, ids),
  clearData: (input: unknown) => ipcRenderer.invoke('browser:clear-data', input),
  state: (workspace: string) => ipcRenderer.invoke('browser:state', workspace),
  saveTabs: (workspace: string, tabs: unknown, activeId: string) => ipcRenderer.invoke('browser:save-tabs', workspace, tabs, activeId),
  activate: (workspace: string, tabId: string) => ipcRenderer.invoke('browser:activate', workspace, tabId),
  control: (id: string, action: string, expectedOrigin?: string) => ipcRenderer.invoke('browser:task-control', id, action, expectedOrigin),
  clear: (workspace: string, kind: string, origin?: string) => ipcRenderer.invoke('browser:clear', workspace, kind, origin),
  onTask: (listener: (task: BrowserTask) => void) => {
    const callback = (_event: unknown, task: BrowserTask) => listener(task);
    ipcRenderer.on('browser:task', callback); return () => ipcRenderer.off('browser:task', callback);
  },
  onTabCommand: (listener: (command: BrowserTabCommand) => void) => {
    const callback = (_event: unknown, command: BrowserTabCommand) => listener(command);
    ipcRenderer.on('browser:tab-command', callback); return () => ipcRenderer.off('browser:tab-command', callback);
  },
};

// 文档转 PDF:Word/PPT 字节进,PDF 字节出(结果用 {ok} 判别联合,错误码见 shared/office-contracts)
const office: WorkbenchApi['office'] = {
  convert: (filename: string, bytes: Uint8Array) =>
    ipcRenderer.invoke('office:convert', filename, bytes),
};

// 应用设置与关于页(工作台自有,存 userData/app-settings.json)
const settings: WorkbenchApi['settings'] = {
  get: () => ipcRenderer.invoke('settings:get'),
  patch: (patch: unknown) => ipcRenderer.invoke('settings:patch', patch),
};

const appInfo: WorkbenchApi['appInfo'] = {
  about: () => ipcRenderer.invoke('app:about'),
  openUserDataDir: (): Promise<void> => ipcRenderer.invoke('app:openUserDataDir'),
  openTodoDir: (): Promise<void> => ipcRenderer.invoke('app:openTodoDir'),
};

const updater = {
  status: (): Promise<import('../shared/contracts').UpdateStatus> => ipcRenderer.invoke('updater:status'),
  check: (): Promise<void> => ipcRenderer.invoke('updater:check'),
  install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
  notes: (): Promise<void> => ipcRenderer.invoke('updater:notes'),
  onStatus: (callback: (status: import('../shared/contracts').UpdateStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: import('../shared/contracts').UpdateStatus): void => callback(status);
    ipcRenderer.on('updater:status', listener);
    return () => ipcRenderer.off('updater:status', listener);
  },
};

  const float = {
  toggle: (): Promise<boolean> => ipcRenderer.invoke('float:toggle'),
  show: (): Promise<void> => ipcRenderer.invoke('float:show'),
  onVisibilityChanged: (callback: (visible: boolean) => void): (() => void) => {
    const listener = (_event: unknown, visible: unknown): void => {
      if (typeof visible === 'boolean') callback(visible);
    };
    ipcRenderer.on('float:visibility-changed', listener);
    ipcRenderer.send('float:subscribe');
    return () => ipcRenderer.off('float:visibility-changed', listener);
  },
};

const island: WorkbenchApi['island'] = {
  state: () => ipcRenderer.invoke('island:state'),
  patch: patch => ipcRenderer.invoke('island:patch', patch),
  mode: (mode, reducedMotion) => ipcRenderer.invoke('island:mode', mode, reducedMotion),
  pin: () => ipcRenderer.invoke('island:pin'),
  hold: value => ipcRenderer.send('island:hold', value),
  speechHeight: value => ipcRenderer.send('island:speechHeight', value),
  onChanged: callback => { const listener = (_: unknown, state: import('../shared/island-contracts').IslandState) => callback(state); ipcRenderer.on('island:changed', listener); return () => ipcRenderer.off('island:changed', listener); },
  onError: callback => { const listener = (_: unknown, message: string) => callback(message); ipcRenderer.on('island:error', listener); return () => ipcRenderer.off('island:error', listener); },
  navigate: target => ipcRenderer.invoke('island:navigate', target),
  onNavigate: callback => { const listener = (_: unknown, target: import('../shared/island-contracts').IslandNavigation) => callback(target); ipcRenderer.on('island:navigate', listener); return () => ipcRenderer.off('island:navigate', listener); },
  displays: () => ipcRenderer.invoke('island:displays'),
  filesAdd: (paths, directory) => ipcRenderer.invoke('island:filesAdd', paths, directory),
  filePath: file => webUtils.getPathForFile(file),
  fileIcon: id => ipcRenderer.invoke('island:fileIcon', id),
  fileOpen: id => ipcRenderer.invoke('island:fileOpen', id),
  fileDrag: id => ipcRenderer.send('island:fileDrag', id),
  fileRelocate: id => ipcRenderer.invoke('island:fileRelocate', id),
  filesRemove: id => ipcRenderer.invoke('island:filesRemove', id),
  noteDraft: draft => ipcRenderer.invoke('island:noteDraft', draft),
  noteSave: (text, id) => ipcRenderer.invoke('island:noteSave', text, id),
  noteRemove: id => ipcRenderer.invoke('island:noteRemove', id),
  focus: (action, minutes, taskId) => ipcRenderer.invoke('island:focus', action, minutes, taskId),
  water: action => ipcRenderer.invoke('island:water', action),
  sedentary: action => ipcRenderer.invoke('island:sedentary', action),
  dismiss: id => ipcRenderer.invoke('island:dismiss', id),
  quotas: () => ipcRenderer.invoke('island:quotas'),
  quotaRefresh: () => ipcRenderer.invoke('island:quotaRefresh'),
  quotaConnect: (label, baseUrl, username, password) => ipcRenderer.invoke('island:quotaConnect', label, baseUrl, username, password),
  quotaUpdate: (id, label, baseUrl, username, password) => ipcRenderer.invoke('island:quotaUpdate', id, label, baseUrl, username, password),
  quotaRemove: id => ipcRenderer.invoke('island:quotaRemove', id),
  quotaSelect: id => ipcRenderer.invoke('island:quotaSelect', id),
  quotaOfficial: id => ipcRenderer.invoke('island:quotaOfficial', id),
  agentProjects: () => ipcRenderer.invoke('island:agentProjects'),
  agentConnect: projects => ipcRenderer.invoke('island:agentConnect', projects),
  agentRead: id => ipcRenderer.invoke('island:agentRead', id),
  agentReadAll: targets => ipcRenderer.invoke('island:agentReadAll', targets),
  agentOpen: id => ipcRenderer.invoke('island:agentOpen', id),
  welinkStatus: () => ipcRenderer.invoke('island:welinkStatus'),
  welinkLogin: () => ipcRenderer.invoke('island:welinkLogin'),
  welinkCancelLogin: () => ipcRenderer.invoke('island:welinkCancelLogin'),
  welinkLogout: () => ipcRenderer.invoke('island:welinkLogout'),
  welinkRefresh: () => ipcRenderer.invoke('island:welinkRefresh'),
  onWelinkSyncChanged: callback => { const listener = (_: unknown, status: import('../shared/island-contracts').WelinkSyncStatus) => callback(status); ipcRenderer.on('island:welinkSyncChanged', listener); return () => ipcRenderer.off('island:welinkSyncChanged', listener); },
  onWelinkLoginEvent: callback => { const listener = (_e: unknown, event: { qrAscii?: string; qrImageUrl?: string; done: boolean; error?: string }) => callback(event); ipcRenderer.on('island:welinkLoginEvent', listener); return () => ipcRenderer.off('island:welinkLoginEvent', listener); },
  assistant: action => ipcRenderer.invoke('island:assistant', action),
  onAssistantOpen: callback => { const listener = () => callback(); ipcRenderer.on('island:assistant-open', listener); return () => ipcRenderer.off('island:assistant-open', listener); },
};

const api: WorkbenchApi = {
  minimize: (): void => {
    ipcRenderer.send('win:minimize');
  },
  maximizeToggle: (): void => {
    ipcRenderer.send('win:maximizeToggle');
  },
  close: (): void => {
    ipcRenderer.send('win:close');
  },
  onMaximized: (callback: (maximized: boolean) => void): (() => void) => {
    const listener = (_event: unknown, maximized: boolean): void => callback(maximized);
    ipcRenderer.on('win:maximized', listener);
    return () => {
      ipcRenderer.off('win:maximized', listener);
    };
  },
  todo,
  reading,
  island,
  float,
  ai,
  browser,
  browserAutomation,
  speech: {
    prepare: id => ipcRenderer.invoke('speech:prepare', id),
    transcribe: input => ipcRenderer.invoke('speech:transcribe', input),
    cancel: id => ipcRenderer.invoke('speech:cancel', id),
  },
  office,
  settings,
  appInfo,
  updater,
  auth: {
    saveCredentials: (credentials) => ipcRenderer.invoke('auth:saveCredentials', credentials),
    hasCredentials: () => ipcRenderer.invoke('auth:hasCredentials'),
    clearCredentials: () => ipcRenderer.invoke('auth:clearCredentials'),
    logout: () => ipcRenderer.invoke('auth:logout'),
  },
  clipboard: {
    write: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write', text),
  },
};

contextBridge.exposeInMainWorld('workbench', api);

export type { WorkbenchApi } from '../shared/workbench-api';
