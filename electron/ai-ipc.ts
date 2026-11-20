import type { AiConfig } from '../shared/workbench-api';
// AI 编排(移植自上游 electron/main.ts 的 AI 段,存储独立化修订 2026-09-23):
// - 供应商/模型/Key/启用/会话 → 工作台自有 AiStore(userData,不碰共享库)
// - 待办数据(tasks/categories/applyPlan)→ OnO / CMO 事项共享库
// 建议-确认制 pending 管理与上游一致。
import { applyTodoProposal } from './todo-proposal';
import { previewTodoActions } from '../shared/todo-proposal';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ipcMain as electronIpc, safeStorage, BrowserWindow, shell, app } from 'electron';
import { z } from 'zod';
import type { Store } from '../modules/todo/store';
import type { AiStore, StoredProvider, StoredModel, StoredRlcdProvider } from './ai-store';
import { aiProtocolSchema, aiProviderKindSchema, rlcdProviderKindSchema, type AIProvider, type AIModel, type RlcdProvider, type ChatSession, type Proposal } from '../shared/todo-contracts';
import { runAgentLoop, testConnection, validateEndpoint, type AiModuleContribution } from './ai-core';
import { buildTodoContribution, planFromReply, taskSnapshot } from '../modules/todo/ai-tools';
import { buildReadingContribution } from '../modules/reading/ai';
import { buildWelinkContribution } from '../modules/welink/ai-tools';
import type { ReadingStore } from '../modules/reading/store';
import { buildWorkbenchContribution, describeAiScope, withWorkbenchContext } from '../modules/workbench-ai';
import { buildBrowserContribution, type ConfirmWrite } from '../modules/browser/ai';
import { buildGroupContribution, useGroupWorkflow } from '../modules/permission/group-tools';
import type { BrowserAutomation } from './browser/tasks';
import type { WebContents } from 'electron';
import { aiScopeKey, chatContextScope, chatScope, sameAiWorkbench, workbenchForScope, type AiScope } from '../shared/ai-scope';
import { browserWorkspaceForView } from '../shared/browser-contracts';

import { aiReferencesSchema, describeAiReference } from '../shared/ai-reference';
import { resolveAiReferences, withAiReferenceSnapshots } from './ai-reference';
import { recordThinkingPhase, thinkingElapsedMs, type ThinkingTiming } from '../shared/ai-thinking';

const MAX_PROVIDERS = 8;
const MAX_MODELS = 8;

const activeRequests = new Map<string, AbortController>();
// ask_user 等待用户回答期间暂停该对话回合超时;用户回答后恢复,避免"超过 0.75 分钟限制"误取消正在等用户作答的对话
const turnResumers = new WeakMap<AbortController, () => void>();
const pendingAsks = new Map<string, { ask: { id: string; question: string; options: { label: string; description?: string }[] }; resolve: (answer: string) => void; reject: () => void }>();
function cancelRequests(): void {
  for (const controller of activeRequests.values()) controller.abort();
  for (const question of pendingAsks.values()) question.reject();
  pendingAsks.clear();
}
type Pending = { sessionId: string; plan: Proposal; revisions: Map<string, string> };
const pending = new Map<string, Pending>();

function encryptKey(value: string): string {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('系统加密暂不可用,未保存密钥,请稍后重试');
  return safeStorage.encryptString(value).toString('base64');
}
function decryptKey(encrypted: string): string {
  if (!encrypted) return '';
  try { return safeStorage.decryptString(Buffer.from(encrypted, 'base64')); }
  catch { return ''; }
}
function activeConnection(ai: AiStore): { provider: StoredProvider; model: StoredModel } | null {
  const config = ai.readConfig();
  const model = config.models.find(item => item.id === config.activeModelId) ?? config.models[0];
  if (!model) return null;
  const provider = config.providers.find(item => item.id === model.providerId);
  return provider ? { provider, model } : null;
}
let broadcast: ((channel: string, value?: unknown) => void) | undefined;
function emitChat(chat: ChatSession): void {
  if (broadcast) broadcast('ai:chat', chat);
  else for (const win of BrowserWindow.getAllWindows()) win.webContents.send('ai:chat', chat);
}
function emitConfig(config: AiConfig): void {
  if (broadcast) broadcast('ai:config-changed', config);
  else for (const win of BrowserWindow.getAllWindows()) win.webContents.send('ai:config-changed', config);
}
function emitChatWithToken(ai: AiStore, token: string): void {
  for (const summary of ai.chats()) {
    const chat = ai.chat(summary.id);
    if (chat.entries.some(entry => entry.proposal?.token === token)) emitChat(chat);
  }
}
function assertUniqueName(items: { id: string; name: string }[], name: string, exceptId: string | undefined, message: string): void {
  const normalized = name.trim().toLocaleLowerCase('zh-CN');
  if (items.some(item => item.id !== exceptId && item.name.toLocaleLowerCase('zh-CN') === normalized)) throw new Error(message);
}
function todoChanged(): void {
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('todo:changed');
}

export function registerAiIpc(store: Store, ai: AiStore, reading: ReadingStore, browserAutomation?: BrowserAutomation, welinkAgenda?: import('../shared/welink-agenda').WelinkAgendaApi, transport?: { ipc: Pick<typeof electronIpc, 'handle' | 'on'>; emit(channel: string, value?: unknown): void }): void {
  const ipcMain = transport?.ipc ?? electronIpc;
  if (transport) broadcast = transport.emit;
  const linked = (id: string): boolean => !!ai.db.prepare("SELECT name FROM sqlite_master WHERE name='bot_chat_links'").get() && !!ai.db.prepare('SELECT 1 FROM bot_chat_links WHERE chat_id=?').get(id);
  const assertLegacyWrite = (id: string): void => { if (linked(id)) throw new Error('DRAFT_PROTOCOL_REQUIRED: Bot 对话请通过新入口操作；历史记录仅供查阅'); };
  const configSummary = (): AiConfig => {
    const config = ai.readConfig();
    const providers: AIProvider[] = config.providers.map(({ id, kind, name, endpoint, protocol, apiKey }) => ({ id, kind, name, endpoint, protocol, hasKey: Boolean(apiKey) }));
    const models: AIModel[] = config.models;
    const rlcdProviders: RlcdProvider[] = config.rlcdProviders.map(({ id, kind, name, endpoint, protocol, apiKey }) => ({ id, kind, name, endpoint, protocol, hasKey: Boolean(apiKey) }));
    return {
      aiEnabled: config.aiEnabled,
      providers,
      models,
      activeModelId: config.activeModelId,
      rlcdProviders,
      rlcdModels: config.rlcdModels,
      activeRlcdModelId: config.activeRlcdModelId,
      hasConnection: Boolean(activeConnection(ai)),
    };
  };
  const mutateConfig = (change: (config: ReturnType<AiStore['readConfig']>) => ReturnType<AiStore['readConfig']>): void => {
    ai.writeConfig(change(ai.readConfig()));
    const summary = configSummary();
    emitConfig(summary);
  };

  ipcMain.handle('ai:config', () => configSummary());
  ipcMain.handle('ai:openLink', async (_event, value: unknown) => {
    const url = new URL(z.string().url().parse(value));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('仅支持打开网页链接');
    await shell.openExternal(url.href);
  });
  ipcMain.handle('ai:provider:save', (_event, input: unknown) => {
    const data = z.object({
      id: z.union([z.string().uuid(), z.literal('')]).optional(), kind: aiProviderKindSchema,
      name: z.string().trim().min(1, '请填写供应商名称').max(30, '供应商名称最多30字'),
      endpoint: z.string().max(2000), protocol: aiProtocolSchema,
      apiKey: z.string().max(4000).optional(), clearKey: z.boolean().optional(),
    }).strict().parse(input);
    const endpoint = validateEndpoint(data.endpoint.trim());
    const providers = ai.readConfig().providers;
    let next: StoredProvider;
    if (data.id) {
      const current = providers.find(provider => provider.id === data.id);
      if (!current) throw new Error('供应商不存在');
      assertUniqueName(providers, data.name, current.id, '已有同名供应商');
      next = {
        ...current, kind: data.kind, name: data.name, endpoint, protocol: data.protocol,
        apiKey: data.clearKey ? '' : data.apiKey ? encryptKey(data.apiKey) : current.apiKey,
      };
      providers.splice(providers.findIndex(provider => provider.id === current.id), 1, next);
    } else {
      if (providers.length >= MAX_PROVIDERS) throw new Error('最多保存8个供应商');
      assertUniqueName(providers, data.name, undefined, '已有同名供应商');
      next = { id: randomUUID(), kind: data.kind, name: data.name, endpoint, protocol: data.protocol, apiKey: data.apiKey ? encryptKey(data.apiKey) : '' };
      providers.push(next);
    }
    mutateConfig(current => ({ ...current, providers: [...providers] }));
    cancelRequests();
    pending.clear();
    return configSummary();
  });
  ipcMain.handle('ai:provider:remove', (_event, id: unknown) => {
    const providerId = z.string().uuid().parse(id);
    const config = ai.readConfig();
    if (!config.providers.some(provider => provider.id === providerId)) throw new Error('供应商不存在');
    const models = config.models.filter(model => model.providerId !== providerId);
    mutateConfig(current => ({ ...current, providers: current.providers.filter(p => p.id !== providerId), models }));
    cancelRequests();
    pending.clear();
    return configSummary();
  });
  ipcMain.handle('ai:model:save', (_event, input: unknown) => {
    const data = z.object({
      id: z.union([z.string().uuid(), z.literal('')]).optional(),
      providerId: z.string().uuid(),
      name: z.string().trim().min(1, '请填写模型名称或 ID').max(200, '模型名称最多200字'),
      supportsImages: z.boolean().optional(),
    }).strict().parse(input);
    const config = ai.readConfig();
    if (!config.providers.some(provider => provider.id === data.providerId)) throw new Error('请先保存供应商');
    const models = config.models;
    const siblings = models.filter(model => model.providerId === data.providerId);
    let next: StoredModel;
    if (data.id) {
      const current = models.find(model => model.id === data.id);
      if (!current || current.providerId !== data.providerId) throw new Error('模型不存在');
      assertUniqueName(siblings, data.name, current.id, '该供应商已有同名模型');
      next = { ...current, name: data.name, ...(data.supportsImages === undefined ? {} : { supportsImages: data.supportsImages }) };
      models.splice(models.findIndex(model => model.id === current.id), 1, next);
    } else {
      if (siblings.length >= MAX_MODELS) throw new Error('每个供应商最多保存8个模型');
      assertUniqueName(siblings, data.name, undefined, '该供应商已有同名模型');
      next = { id: randomUUID(), providerId: data.providerId, name: data.name, ...(data.supportsImages === undefined ? {} : { supportsImages: data.supportsImages }) };
      models.push(next);
    }
    mutateConfig(current => ({ ...current, models: [...models], activeModelId: current.activeModelId || next.id, hasConfiguredModel: true }));
    return configSummary();
  });
  ipcMain.handle('ai:model:remove', (_event, id: unknown) => {
    const modelId = z.string().uuid().parse(id);
    const config = ai.readConfig();
    if (!config.models.some(model => model.id === modelId)) throw new Error('模型不存在');
    mutateConfig(current => ({
      ...current,
      models: current.models.filter(m => m.id !== modelId),
      activeModelId: current.activeModelId === modelId ? '' : current.activeModelId,
    }));
    cancelRequests();
    pending.clear();
    return configSummary();
  });
  ipcMain.handle('ai:model:activate', (_event, id: unknown) => {
    const modelId = z.string().uuid().parse(id);
    const config = ai.readConfig();
    if (!config.models.some(model => model.id === modelId)) throw new Error('模型不存在');
    mutateConfig(current => ({ ...current, activeModelId: modelId }));
    return configSummary();
  });
  ipcMain.handle('ai:rlcd:provider:save', (_event, input: unknown) => {
    const data = z.object({
      id: z.union([z.string().uuid(), z.literal('')]).optional(), kind: rlcdProviderKindSchema,
      name: z.string().trim().min(1, '请填写供应商名称').max(30, '供应商名称最多30字'),
      endpoint: z.string().max(2000), protocol: aiProtocolSchema,
      apiKey: z.string().max(4000).optional(), clearKey: z.boolean().optional(),
    }).strict().parse(input);
    const endpoint = validateEndpoint(data.endpoint.trim());
    const config = ai.readConfig();
    const providers = config.rlcdProviders;
    let next: StoredRlcdProvider;
    if (data.id) {
      const current = providers.find(provider => provider.id === data.id);
      if (!current) throw new Error('RLCD 供应商不存在');
      assertUniqueName(providers, data.name, current.id, '已有同名 RLCD 供应商');
      next = { ...current, kind: data.kind, name: data.name, endpoint, protocol: data.protocol,
        apiKey: data.clearKey ? '' : data.apiKey ? encryptKey(data.apiKey) : current.apiKey };
      providers.splice(providers.findIndex(provider => provider.id === current.id), 1, next);
    } else {
      if (providers.length >= MAX_PROVIDERS) throw new Error('最多保存8个 RLCD 供应商');
      assertUniqueName(providers, data.name, undefined, '已有同名 RLCD 供应商');
      next = { id: randomUUID(), kind: data.kind, name: data.name, endpoint, protocol: data.protocol, apiKey: data.apiKey ? encryptKey(data.apiKey) : '' };
      providers.push(next);
    }
    mutateConfig(current => ({ ...current, rlcdProviders: [...providers] }));
    return configSummary();
  });
  ipcMain.handle('ai:rlcd:provider:remove', (_event, id: unknown) => {
    const providerId = z.string().uuid().parse(id);
    const config = ai.readConfig();
    if (!config.rlcdProviders.some(provider => provider.id === providerId)) throw new Error('RLCD 供应商不存在');
    const models = config.rlcdModels.filter(model => model.providerId !== providerId);
    const activeRlcdModelId = models.some(model => model.id === config.activeRlcdModelId) ? config.activeRlcdModelId : models[0]?.id ?? '';
    mutateConfig(current => ({ ...current, rlcdProviders: current.rlcdProviders.filter(provider => provider.id !== providerId), rlcdModels: models, activeRlcdModelId }));
    return configSummary();
  });
  ipcMain.handle('ai:rlcd:model:save', (_event, input: unknown) => {
    const data = z.object({
      id: z.union([z.string().uuid(), z.literal('')]).optional(), providerId: z.string().uuid(),
      name: z.string().trim().min(1, '请填写模型名称或 ID').max(200, '模型名称最多200字'),
    }).strict().parse(input);
    const config = ai.readConfig();
    if (!config.rlcdProviders.some(provider => provider.id === data.providerId)) throw new Error('请先保存 RLCD 供应商');
    const models = config.rlcdModels;
    const siblings = models.filter(model => model.providerId === data.providerId);
    let next: StoredModel;
    if (data.id) {
      const current = models.find(model => model.id === data.id);
      if (!current || current.providerId !== data.providerId) throw new Error('RLCD 模型不存在');
      assertUniqueName(siblings, data.name, current.id, '该 RLCD 供应商已有同名模型');
      next = { ...current, name: data.name };
      models.splice(models.findIndex(model => model.id === current.id), 1, next);
    } else {
      if (siblings.length >= MAX_MODELS) throw new Error('每个 RLCD 供应商最多保存8个模型');
      assertUniqueName(siblings, data.name, undefined, '该 RLCD 供应商已有同名模型');
      next = { id: randomUUID(), providerId: data.providerId, name: data.name };
      models.push(next);
    }
    mutateConfig(current => ({ ...current, rlcdModels: [...models], activeRlcdModelId: current.activeRlcdModelId || next.id }));
    return configSummary();
  });
  ipcMain.handle('ai:rlcd:model:remove', (_event, id: unknown) => {
    const modelId = z.string().uuid().parse(id);
    const config = ai.readConfig();
    if (!config.rlcdModels.some(model => model.id === modelId)) throw new Error('RLCD 模型不存在');
    const models = config.rlcdModels.filter(model => model.id !== modelId);
    const activeRlcdModelId = models.some(model => model.id === config.activeRlcdModelId) ? config.activeRlcdModelId : models[0]?.id ?? '';
    mutateConfig(current => ({ ...current, rlcdModels: models, activeRlcdModelId }));
    return configSummary();
  });
  const testProvider = async (input: unknown, surface: 'llm' | 'rlcd'): Promise<string> => {
    const data = z.object({
      providerId: z.string().uuid().optional(),
      endpoint: z.string().max(2000).optional(),
      protocol: aiProtocolSchema.optional(),
      apiKey: z.string().max(4000).optional(),
      model: z.string().trim().min(1, '请填写模型名称或 ID').max(200),
    }).strict().parse(input);
    const providers = surface === 'rlcd' ? ai.readConfig().rlcdProviders : ai.readConfig().providers;
    const provider = data.providerId ? providers.find(item => item.id === data.providerId) : undefined;
    if (data.providerId && !provider) throw new Error('供应商不存在');
    const endpoint = data.endpoint?.trim() || provider?.endpoint || '';
    const protocol = data.protocol ?? provider?.protocol ?? 'openai-chat';
    const key = data.apiKey || (provider ? decryptKey(provider.apiKey) : '');
    if (!endpoint) throw new Error('请填写服务地址');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try { return await testConnection({ endpoint, model: data.model, protocol, key }, controller.signal); }
    finally { clearTimeout(timeout); }
  };
  ipcMain.handle('ai:test', (_event, input: unknown) => testProvider(input, 'llm'));
  ipcMain.handle('ai:rlcd:test', (_event, input: unknown) => testProvider(input, 'rlcd'));

  // ---- 会话(工作台自有 chats.db) ----
  ipcMain.handle('ai:chat:list', () => ai.chats());
  ipcMain.handle('ai:chat:open', (_event, id: unknown) => {
    const activeId = ai.setting('activeChatId', '');
    const selected = id ? z.string().uuid().parse(id) : activeId;
    const chat = selected ? ai.chat(selected) : ai.newChat();
    if (linked(chat.id)) return ai.chat(chat.id);
    if (!activeRequests.has(chat.id)) {
      for (const entry of chat.entries) if (entry.actionState === 'pending' && !pending.has(entry.proposal?.token ?? '')) entry.actionState = 'expired';
    }
    ai.setSetting('activeChatId', chat.id);
    return ai.saveChat(chat);
  });
  const scopeSchema = z.discriminatedUnion('module', [
    z.object({ module: z.literal('todo') }).strict(),
    z.object({ module: z.literal('reading'), profileId: z.string().min(1) }).strict(),
    z.object({ module: z.literal('workbench'), viewId: z.string().min(1) }).strict(),
  ]);
  ipcMain.handle('ai:chat:new', (_event, tag: unknown) => {
    if (ai.db.prepare("SELECT name FROM sqlite_master WHERE name='bots'").get()) throw new Error('每个 Bot 已有主对话，请从 Bot 导航继续');
    const scope: AiScope = tag === undefined || tag === null ? { module: 'todo' } : scopeSchema.parse(tag);
    return ai.newChat(scope);
  });
  ipcMain.handle('ai:chat:rename', (_event, id: unknown, title: unknown) => {
    assertLegacyWrite(z.string().uuid().parse(id));
    const updated = ai.renameChat(z.string().uuid().parse(id), z.string().parse(title));
    emitChat(updated);
    return updated;
  });
  ipcMain.handle('ai:chat:remove', (_event, id: unknown) => {
    assertLegacyWrite(z.string().uuid().parse(id));
    const chatId = z.string().uuid().parse(id);
    if (activeRequests.has(chatId)) throw new Error('这条对话正在生成，请先停止生成');
    for (const [token, item] of pending) if (item.sessionId === chatId) pending.delete(token);
    return ai.deleteChat(chatId);
  });
  ipcMain.handle('ai:chat:draft', (_event, id: unknown, text: unknown) => {
    assertLegacyWrite(z.string().uuid().parse(id));
    const chat = ai.chat(z.string().uuid().parse(id));
    chat.draft = z.string().max(10000).parse(text);
    ai.saveChat(chat);
  });
  ipcMain.handle('ai:chat:context', (_event, id: unknown, rawScope: unknown) => {
    const chat = ai.chat(z.string().uuid().parse(id));
    const scope = scopeSchema.parse(rawScope) as AiScope;
    if (!sameAiWorkbench(chat, scope)) throw new Error('只能关联同一工作台内的页面');
    if (chat.entries.some(entry => entry.streaming)) throw new Error('这条对话正在生成，请完成后再关联页面');
    if (scope.module !== 'workbench' || chatContextScope(chat).module === 'workbench') chat.contextScope = scope;
    chat.pageScope = scope;
    const updated = ai.saveChat(chat);
    ai.setSetting('activeChatId', chat.id);
    emitChat(updated);
    return updated;
  });

  const ask = async (sessionId: string, text: string, turnContext: unknown, owner: WebContents, isMainFrame: boolean): Promise<void> => {
    const request = z.object({ sessionId: z.string().uuid(), text: z.string().trim().min(1).max(10000, '输入最多10000字') }).strict().parse({ sessionId, text });
    const context = z.object({
      scope: scopeSchema.optional(),
      pageScope: scopeSchema.optional(),
      browserTabId: z.string().min(1).max(100).nullable().optional(),
      references: aiReferencesSchema.optional(),
    }).strict().parse(turnContext ?? {});
    const connection = activeConnection(ai);
    if (!ai.readConfig().aiEnabled || !connection) throw new Error('请先在模型配置中添加对话模型');
    if (activeRequests.has(request.sessionId)) throw new Error('这条对话正在生成，请先停止生成');
    const chat = ai.chat(request.sessionId);
    assertLegacyWrite(chat.id);
    const priorScope = chatContextScope(chat);
    const requestedScope = context.scope ?? priorScope;
    if (!sameAiWorkbench(chat, requestedScope)) throw new Error('只能在同一工作台内延续这条对话');
    if (context.pageScope && !sameAiWorkbench(chat, context.pageScope)) throw new Error('当前页面不属于这条对话的工作台');
    const scope = requestedScope;
    const pageScope = context.pageScope ?? (aiScopeKey(requestedScope) === aiScopeKey(priorScope) ? chat.pageScope ?? scope : requestedScope);
    const isBrowserPage = pageScope.module === 'workbench' && browserWorkspaceForView(pageScope.viewId) !== null;
    if (isBrowserPage && !isMainFrame) throw new Error('浏览器任务仅允许主窗口文档。');
    if (context.browserTabId !== undefined && !isBrowserPage) throw new Error('请在关联的浏览器页面发送网页操作要求。');
    const referenceSnapshots = resolveAiReferences(context.references, pageScope, scope, { todo: store, reading }, { now: new Date() });
    const references = referenceSnapshots.map(snapshot => snapshot.reference);
    const selectedTaskIds = references.flatMap(reference => reference.module === 'todo' ? [reference.taskId] : []);
    const tasks = scope.module === 'todo' ? store.all() : [];
    const categories = scope.module === 'todo' ? store.categories() : [];
    const todoContribution = scope.module === 'todo' ? buildTodoContribution(tasks, categories, (ask) => new Promise<string>((resolve, reject) => {
      const abort = () => { pendingAsks.delete(chat.id); reject(new Error('已停止此对话的澄清请求。')); };
      controller.signal.addEventListener('abort', abort, { once: true });
      pendingAsks.set(chat.id, { ask, resolve: answer => { controller.signal.removeEventListener('abort', abort); resolve(answer); }, reject: abort });
      pauseTurnTimer();
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed() && win.isVisible()) win.webContents.send('ai:ask', { ...ask, sessionId: chat.id });
      }
    }), selectedTaskIds) : null;
    let contribution: AiModuleContribution = scope.module === 'reading' ? (() => {
      const bookData = reading.all();
      const book = bookData.books.find(item => item.id === (scope as { profileId: string }).profileId);
      if (!book) throw new Error('这条对话绑定的书目不存在或已删除');
      return buildReadingContribution(book, bookData.vaultPath);
    })()
      : scope.module === 'workbench' ? buildWorkbenchContribution(scope.viewId)
      : todoContribution!;
    const key = decryptKey(connection.provider.apiKey);
    const browserTask = isBrowserPage ? browserAutomation?.forChat(owner, browserWorkspaceForView(pageScope.viewId)!, request.text, chat.id, chat.browserTaskId, context.browserTabId) : undefined;
    // 按 LV1 工作台收集 skill 目录:浏览器页才有 skills,目录在 resources/skills/<workbench>
    // skillsRoot 给受限 read 工具锚定可读范围;skillPaths 给 loader 扫描该工作台全部 skill
    // welink skill 全局可用(所有 scope);工作台 skill 仍只浏览器页注入。
    const skillsBase = app.isPackaged ? path.join(process.resourcesPath, 'skills') : path.join(app.getAppPath(), 'skills');
    const skillsRoot: string | undefined = existsSync(skillsBase) ? skillsBase : undefined;
    const skillPaths: string[] | undefined = (() => {
      if (!skillsRoot) return undefined;
      const paths: string[] = [];
      const welinkDir = path.join(skillsRoot, 'welink');
      if (existsSync(welinkDir)) paths.push(welinkDir);
      if (isBrowserPage) {
        const wb = workbenchForScope(pageScope);
        if (wb) { const dir = path.join(skillsRoot, wb); if (existsSync(dir)) paths.push(dir); }
      }
      return paths.length ? paths : undefined;
    })();
    const confirmWrite: ConfirmWrite = (ask): Promise<'confirmed' | 'cancelled'> => new Promise(resolve => {
      const confirmSignal = browserTask ? browserAutomation!.signal(owner, browserTask.id) : controller.signal;
      if (confirmSignal.aborted) { resolve('cancelled'); return; }
      const abort = () => { pendingAsks.delete(chat.id); resolve('cancelled'); };
      confirmSignal.addEventListener('abort', abort, { once: true });
      const question = `即将执行写操作：${ask.intent}（${ask.target}），是否确认执行？`;
      const fullAsk = { id: ask.id, question, options: [{ label: '确认执行', description: '允许 AI 继续完成该写操作' }, { label: '取消', description: '拒绝该写操作，AI 会停下询问下一步' }] };
      pendingAsks.set(chat.id, { ask: fullAsk, resolve: answer => { confirmSignal.removeEventListener('abort', abort); resolve(['确认执行', '确认'].includes(answer.trim()) ? 'confirmed' : 'cancelled'); }, reject: abort });
      pauseTurnTimer();
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed() && !win.webContents.isDestroyed() && win.isVisible()) win.webContents.send('ai:ask', { ...fullAsk, sessionId: chat.id });
      }
    });
    if (browserTask) {
      const generic = buildBrowserContribution(browserAutomation!, owner, browserTask, connection.model.supportsImages === true, skillsRoot, confirmWrite);
      const browser = useGroupWorkflow(pageScope.module === 'workbench' ? pageScope.viewId : '', [browserTask.goal, request.text], !!browserTask.permissionGroup)
        ? buildGroupContribution(browserAutomation!, owner, browserTask, confirmWrite, generic.buildTools().filter(tool => tool.name === 'read' || tool.name === 'declare_write'))
        : generic;
      const business = scope.module === 'workbench' ? undefined : contribution;
      contribution = {
        directBrowserOperations: true,
        toolNames: [...(business?.toolNames ?? []), ...browser.toolNames], labels: { ...business?.labels, ...browser.labels },
        buildTools: () => [...(business?.buildTools() ?? []), ...browser.buildTools()],
        systemPrompt: now => `${business?.systemPrompt(now) ?? ''}\n\n${browser.systemPrompt(now)}\n业务协助对象保持不变，网页是本轮独立操作目标。本地博客修改仍只生成待确认建议；把已有内容填写到网页不需要修改本地博客。`,
      };
    }
    contribution = withAiReferenceSnapshots(contribution, referenceSnapshots);
    // WeLink 工具全局注入(待办助手/灵动岛/浏览器页都可用):发消息/建会议/查日程等。
    // WeLink 执行入口直接复用确认卡；普通对话和浏览器对话均经过同一确认通道。
    // 先把 welink 的工具/提示词物化,再合并;不能在新 contribution 的 buildTools 里引用同名变量(会自递归)。
    const base = contribution;
    const welinkContribution = buildWelinkContribution(confirmWrite, welinkAgenda);
    const welinkTools = welinkContribution.buildTools();
    contribution = {
      toolNames: [...base.toolNames, ...welinkContribution.toolNames],
      labels: { ...base.labels, ...welinkContribution.labels },
      buildTools: () => [...base.buildTools(), ...welinkTools],
      systemPrompt: now => `${base.systemPrompt(now)}\n\n${welinkContribution.systemPrompt(now)}${base.toolNames.includes('group_submit') ? '\nPIC 的 group_submit 已在实际提交入口内部确认，不能再预先调用 declare_write 重复确认。' : ''}`,
    };
    const assistantId = randomUUID();
    const history = chat.entries.filter(entry => !entry.streaming && !entry.error && entry.content.trim()).slice(-12).map(entry => {
      const earlierScope = entry.contextScope ?? chatScope(chat);
      const earlierContext = aiScopeKey(earlierScope) === aiScopeKey(scope) ? '' : `[历史关联：${describeAiScope(earlierScope)}]\n`;
      const earlierPage = entry.pageScope && aiScopeKey(entry.pageScope) !== aiScopeKey(earlierScope) ? `[当时页面：${describeAiScope(entry.pageScope)}]\n` : '';
      const earlierReferences = entry.references?.length ? `[历史参考（非本轮选择）：${entry.references.map(describeAiReference).join('、')}]\n` : '';
      return { role: entry.role, content: earlierContext + earlierPage + earlierReferences + entry.content };
    });
    const controller = new AbortController();
    if (browserTask) browserAutomation!.bind(owner, browserTask.id, chat.id, controller.signal);
    chat.contextScope = scope;
    chat.pageScope = pageScope;
    if (browserTask) chat.browserTaskId = browserTask.id;
    chat.entries.push({ id: randomUUID(), role: 'user', content: request.text, contextScope: scope, pageScope, references, referenceSnapshots }, { id: assistantId, role: 'assistant', content: '', contextScope: scope, pageScope, references, referenceSnapshots, streaming: true, tools: [], ...(browserTask ? { browserTask: { id: browserTask.id, workspace: browserTask.workspace } } : {}) });
    if (chat.title === '新对话' && !chat.titleEdited) chat.title = request.text.slice(0, 32);
    chat.draft = '';
    try { emitChat(ai.saveChat(chat)); }
    catch (error) {
      if (browserTask) browserAutomation!.finish(owner, browserTask.id, '对话保存失败，浏览器任务未执行。');
      throw error;
    }
    const updateEntry = (change: (entry: ChatSession['entries'][number]) => void): void => {
      const latest = ai.chat(chat.id);
      const entry = latest.entries.find(item => item.id === assistantId)!;
      change(entry);
      if (!entry.streaming) delete entry.responsePhase;
      emitChat(ai.saveChat(latest));
    };
    const revisePending = (): void => {
      for (const [token, item] of pending) {
        if (item.sessionId !== chat.id) continue;
        if (scope.module !== 'todo') continue;
        ai.resolveChatProposal(token, 'revised');
        pending.delete(token);
      }
    };
    activeRequests.set(chat.id, controller);
    turnResumers.set(controller, () => resumeTurnTimer());
    // 浏览器任务放宽到 15 分钟兜底;实际目标时长靠系统提示的节流规则控制步数
    let timedOut = false;
    // ask_user 等待用户回答期间暂停回合超时,回答后重置,避免用户还没来得及选就被"超过 0.75 分钟限制"误取消
    const turnMs = browserTask ? 900000 : 45000;
    const fireTurnTimeout = (): void => { timedOut = true; controller.abort(); };
    let turnTimer: ReturnType<typeof setTimeout> | null = setTimeout(fireTurnTimeout, turnMs);
    const pauseTurnTimer = (): void => { if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; } };
    const resumeTurnTimer = (): void => { if (turnTimer) clearTimeout(turnTimer); turnTimer = setTimeout(fireTurnTimeout, turnMs); };
    let deltaTimer: ReturnType<typeof setTimeout> | null = null;
    let latestDelta = '', latestThinking = '', latestThinkingActive = false;
    const thinkingTiming: ThinkingTiming = {};
    const applyStream = (entry: ChatSession['entries'][number]): void => {
      if (latestDelta) entry.content = latestDelta;
      if (latestThinking) entry.thinking = latestThinking;
      entry.thinkingActive = latestThinkingActive;
      if (thinkingTiming.thinkingMs !== undefined) {
        const now = Date.now();
        entry.thinkingMs = thinkingElapsedMs(thinkingTiming, now);
        if (latestThinkingActive) entry.thinkingStartedAt = now; else delete entry.thinkingStartedAt;
      }
    };
    const scheduleDelta = (): void => {
      if (deltaTimer) return;
      deltaTimer = setTimeout(() => { deltaTimer = null; updateEntry(applyStream); }, 50);
    };
    const onDelta = (streamText: string): void => {
      latestDelta = streamText;
      scheduleDelta();
    };
    try {
      const { reply } = await runAgentLoop({ endpoint: connection.provider.endpoint, model: connection.model.name, protocol: connection.provider.protocol, key, supportsImages: browserTask && connection.model.supportsImages === true }, request.text,
        history,
        browserTask ? browserAutomation!.signal(owner, browserTask.id) : controller.signal, withWorkbenchContext(contribution, scope, undefined, pageScope), onDelta,
        tool => updateEntry(entry => {
          const tools = entry.tools ?? [];
          const index = tools.findIndex(item => item.id === tool.id);
          if (index < 0) tools.push(tool); else tools[index] = tool;
          entry.tools = tools;
        }), (thinking, active) => {
          recordThinkingPhase(thinkingTiming, active);
          latestThinking = thinking; latestThinkingActive = active;
          scheduleDelta();
        }, phase => updateEntry(entry => { entry.responsePhase = phase; }), undefined, skillPaths);
      if (controller.signal.aborted) throw new Error(timedOut ? `任务超过 ${browserTask ? 15 : 0.75} 分钟限制已自动停止;已执行的页面操作不会撤销,可从当前页面状态继续。` : '已取消生成,输入内容已保留。');
      if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
      latestThinkingActive = false;
      recordThinkingPhase(thinkingTiming, false);
      if (todoContribution) {
        const plan = planFromReply(reply, todoContribution!.collect(), taskSnapshot(tasks, categories, selectedTaskIds).known, new Set(categories.map(c => c.id)));
        const proposal: Proposal = { ...plan, token: randomUUID(), preview: previewTodoActions(plan.actions, tasks, categories) };
        if (proposal.actions.length) {
          revisePending();
          pending.set(proposal.token, { sessionId: chat.id, plan: proposal, revisions: new Map([...tasks, ...categories].map(item => [item.id, item.updatedAt])) });
        }
        updateEntry(entry => {
          applyStream(entry);
          entry.content = proposal.message;
          entry.streaming = false;
          if (proposal.actions.length) { entry.proposal = proposal; entry.actionState = 'pending'; }
        });
      } else {
        if (!reply.trim()) throw new Error('模型未返回可用内容,请检查服务协议和模型输出');
        updateEntry(entry => { applyStream(entry); entry.content = reply; entry.streaming = false; });
      }
      if (browserTask) browserAutomation!.finish(owner, browserTask.id);
    } catch (cause) {
      // 超时 abort 先在 ai-core 的 mapAiError 被改写成通用取消文案;此处还原成超时语义,
      // 与用户手动取消区分开(手动取消 controller.signal.aborted 且 timedOut=false)
      const error = timedOut && controller.signal.aborted && cause instanceof Error && cause.message === '已取消生成,输入内容已保留。'
        ? new Error(`任务超过 ${browserTask ? 15 : 0.75} 分钟限制已自动停止;已执行的页面操作不会撤销,可从当前页面状态继续。`)
        : cause;
      if (browserTask) browserAutomation!.finish(owner, browserTask.id, error instanceof Error ? error.message : '请求失败');
      if (deltaTimer) { clearTimeout(deltaTimer); deltaTimer = null; }
      latestThinkingActive = false;
      recordThinkingPhase(thinkingTiming, false);
      updateEntry(entry => {
        applyStream(entry);
        entry.streaming = false;
        entry.error = error instanceof Error ? error.message : '请求失败,请重试';
        for (const tool of entry.tools ?? []) if (tool.status === 'running') tool.status = 'interrupted';
      });
      const latest = ai.chat(chat.id);
      latest.draft ||= request.text;
      emitChat(ai.saveChat(latest));
      throw error;
    } finally {
      if (deltaTimer) clearTimeout(deltaTimer);
      if (turnTimer) { clearTimeout(turnTimer); turnTimer = null; }
      turnResumers.delete(controller);
      if (activeRequests.get(chat.id) === controller) activeRequests.delete(chat.id);
      pendingAsks.get(chat.id)?.reject(); pendingAsks.delete(chat.id);
    }
  };
  ipcMain.handle('ai:ask', async (event, sessionId: unknown, text: unknown, context: unknown) => {
    await ask(z.string().uuid().parse(sessionId), z.string().parse(text), context, event.sender, event.senderFrame === event.sender.mainFrame);
  });
  // 用户回答 AI 的澄清提问(上游 ask:answer 同义;跳过=空答案)
  ipcMain.on('ai:answer', (_event, input: unknown) => {
    const parsed = z.object({ id: z.string(), sessionId: z.string().uuid(), kind: z.enum(['option', 'text', 'skip']), value: z.string().max(10000).optional() }).strict().safeParse(input);
    if (!parsed.success) return;
    const data = parsed.data, question = pendingAsks.get(data.sessionId);
    if (!question || data.id !== question.ask.id) return;
    const answer = data.kind === 'skip' ? '(用户选择跳过,请按你的判断继续并说明假设)' : data.kind === 'option' ? data.value ?? '' : data.value ?? '';
    pendingAsks.delete(data.sessionId); question.resolve(answer);
    const askController = activeRequests.get(data.sessionId);
    if (askController) turnResumers.get(askController)?.();
  });

  ipcMain.on('ai:cancel', (_event, input: unknown) => {
    const id = z.string().uuid().safeParse(input);
    if (!id.success) return;
    activeRequests.get(id.data)?.abort();
    pendingAsks.get(id.data)?.reject(); pendingAsks.delete(id.data);
  });
  ipcMain.handle('ai:apply', (_event, token: unknown, indices: number[]) => {
    const tokenText = z.string().uuid().parse(token);
    const item = pending.get(tokenText);
    if (!item) throw new Error('建议已应用或已过期,请重新生成');
    const chosen = z.array(z.number().int().nonnegative()).max(50).parse(indices);
    let result;
    try { result = applyTodoProposal(store, ai, item, chosen, () => pending.delete(tokenText)); }
    catch (cause) { try { emitChatWithToken(ai, tokenText); } catch { /* Original failure remains visible to the caller. */ } throw cause; }
    // Delivery/history errors after commit are not transaction failures.
    try { todoChanged(); emitChatWithToken(ai, tokenText); } catch { /* Caller also receives the committed receipt. */ }
    return result;
  });
  ipcMain.handle('ai:discard', (_event, token: unknown) => {
    const tokenText = z.string().uuid().parse(token);
    if (pending.has(tokenText)) {
      ai.resolveChatProposal(tokenText, 'discarded');
      pending.delete(tokenText);
      emitChatWithToken(ai, tokenText);
    }
    return null;
  });
}
