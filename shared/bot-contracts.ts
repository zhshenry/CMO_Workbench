import type { BotFilesView, BotSkillsView, BotWorkspaceFile } from './bot-files';
import type { BotBindings, BotExtensionsView, McpServer, McpServerDefinition, McpToolView } from './bot-extensions';
import { z } from 'zod';
import type { AiTurnContext } from './ai-reference';
import { officeSceneSchema } from './office-workbench';
import type { ChatEntry, ChatSession } from './todo-contracts';
import { groupInputSchema, type GroupInput } from './permission-group-contracts';

export const BOT_CONTRACT_VERSION = 'bot-workbench/v28';
export const configurationSections = [
  { id: 'permission', label: '权限管理', views: ['permission-query', 'permission-groups'] },
  { id: 'delivery', label: '交付件管理', views: ['delivery-projects'] },
  { id: 'pbi', label: 'PBI系统', views: ['pbi-features', 'pbi-modules'] },
  { id: 'dts', label: 'DTS系统', views: ['dts-query'] },
] as const;

export function configurationSectionForView(view: string) {
  return configurationSections.find(section => view === `workspace:${section.id}` || (section.views as readonly string[]).includes(view));
}

// Keep the permission Bot's stored identity when upgrading existing installations.
export const configurationBotSeed = {
  seedKey: 'permission', workspaceId: 'permission', name: '配置管理管家', avatar: 'drop:graphite',
  description: '权限、交付件、PBI 和 DTS',
  instructions: '协助权限查询、PIC 群组申请、交付件、PBI 系统和 DTS 系统工作。按用户目标使用已授权的权限或 PBI 入口，遵守参数校验和提交确认，已提交不代表审批生效。交付系统和 DTS 尚未接入，可整理用户提供的资料和保存本地产物，不能声称已查询或修改系统记录。',
  views: configurationSections.flatMap(section => [...section.views]),
} as const;
export const retiredConfigurationBot = (seedKey: string): boolean => configurationSections.slice(1).some(section => section.id === seedKey);

export const botSeeds = [
  { seedKey: 'coordinator', workspaceId: 'home', name: '总管', avatar: 'ring:blue', description: 'CMO 总台', instructions: '协调各领域负责人，跟进工作与交付。依据真实结果汇报，不把已委派当成已完成。', views: ['home'] },
  { seedKey: 'schedule', workspaceId: 'todo', name: '日程助理', avatar: 'square:violet', description: '日程待办', instructions: '管理日程和待办。写入前展示具体建议，等待用户确认并核对真实回执。', views: ['todo'] },
  { seedKey: 'office', workspaceId: 'office', name: '办公助理', avatar: 'hex:blue', description: '工作消息、邮件和简报', instructions: '根据本机已读取的办公资料回答，说明时间范围和缺失的来源。按原话区分确定信息与待核对的事项。使用「待处理」中的建议入口提交待办确认。', views: ['office'] },
  configurationBotSeed,
] as const;
type ConfigurationSectionId = typeof configurationSections[number]['id'];
export type BotSeedKey = typeof botSeeds[number]['seedKey'] | ConfigurationSectionId;
export type BotWorkspaceId = typeof botSeeds[number]['workspaceId'] | ConfigurationSectionId;
export interface BotProfile {
  id: string; seedKey: BotSeedKey; workspaceId: BotWorkspaceId; name: string; avatar: string;
  description: string; instructions: string; modelId?: string | null; mainChatId: string; enabled: boolean; revision: number; updatedAt: string;
}
export type BotRunActivity = 'thinking' | 'searching' | 'working' | 'sending' | 'replying';
export type BotActivity = BotRunActivity | 'idle' | 'queued' | 'waiting_bot' | 'waiting_user' | 'waiting_resource' | 'interrupted';
export type BotCard = Omit<BotProfile, 'instructions'> & { archivedBotIds?: string[]; unreadCount?: number; waitingCount?: number; runningCount?: number; activity?: BotActivity; completion?: string };
export const resourceRefSchema = z.object({ kind: z.enum(['todo', 'reading', 'artifact', 'chat', 'file']), id: z.string().min(1).max(200), version: z.string().max(100).optional(), label: z.string().max(200).optional() }).strict();
export type BotResourceRef = z.infer<typeof resourceRefSchema>;
export const draftValueSchema = z.object({ generatedPrompts: z.array(z.string().min(1).max(10000)).max(16).optional(), text: z.string().max(10000), replyToTaskId: z.string().uuid().nullable(), resources: z.array(resourceRefSchema).max(8), officeScene: officeSceneSchema.optional() }).strict();
export type BotDraftValue = z.infer<typeof draftValueSchema>;
export type BotDraftSurface = 'main' | 'island';
export const draftSnapshotSchema = draftValueSchema.extend({ chatId: z.string().uuid(), surface: z.enum(['main', 'island']), revision: z.number().int().nonnegative() }).strict();
export interface DraftSnapshot extends BotDraftValue { chatId: string; surface: BotDraftSurface; revision: number; }
export const taskStatuses = ['queued', 'running', 'waiting_user', 'waiting_bot', 'waiting_resource', 'interrupted', 'completed', 'failed', 'cancelled'] as const;
export type BotTaskStatus = typeof taskStatuses[number];
export const terminalTask = (status: BotTaskStatus): boolean => ['completed', 'failed', 'cancelled'].includes(status);
export type BotRouteIntent = 'amend' | 'status' | 'pause' | 'switch' | 'resume' | 'cancel';
export interface BotInputRoute {
  intent: BotRouteIntent | 'interpret' | 'clarify'; candidates: string[];
  explicit?: BotSubmit['target'];
}
export interface BotTask {
  memoryRequest?: BotMemoryRequest;
  memoryReceipts?: BotMemoryReceipt[];
  dashboardHandoff?: import('./dashboard-operations').DashboardHandoff;
  inputRoute?: BotInputRoute;
  relatedWorkId?: string;
  pausedStatus?: BotTaskStatus;
  priority?: boolean;
  id: string; botId: string; chatId: string; rootTaskId: string; parentTaskId?: string;
  sourceMessageId: string; latestUserMessageId?: string; replyToEntryId?: string; kind: 'chat' | 'work' | 'delegated' | 'routine' | 'message';
  status: BotTaskStatus; title: string; input: string; context: AiTurnContext; resources: BotResourceRef[];
  revision: number; createdAt: string; updatedAt: string; reason?: string; result?: string;
  piSessionPath?: string; assistantEntryId?: string; resumeInput?: string; workerId?: string;
  assistantEntryIds?: string[];
  /** Delivered replies awaiting the next assistant entry. */
  pendingReplyMessageIds?: string[];
  operationIds: string[]; dependencyIds: string[];
  /** Original reply location for a proposal, even when the latest turn changes. */
  todoActionEntryIds?: Record<string, string>;
  requirementsRevision?: number; runGeneration?: number;
  /** The execution page and tab in context are pinned to this task. */
  configurationBrowserRouted?: true;
  groupFollowup?: { input: GroupInput; requirementsRevision: number; pendingFill: boolean; browserTaskId?: string };
  amendedActionId?: string;
  queueDisposition?: 'deleted' | 'steered';
  messageIds?: string[];
}
export interface BotMessage {
  id: string; fromBotId: string; toBotId: string; taskId?: string; rootTaskId?: string; parentTaskId?: string;
  kind: 'request' | 'question' | 'notification' | 'result' | 'cancel'; content: string; references: BotResourceRef[];
  sourceUserMessageId?: string; replyTo?: string; createdAt: string; deliveredAt?: string;
  sourceAssistantEntryId?: string;
  purpose?: 'work' | 'query' | 'notification' | 'amendment' | 'reply';
  originTaskId?: string;
  when?: 'now' | 'queue';
  consumedAt?: string;
}
export interface BotAction {
  id: string; taskId: string; botId: string; kind: 'todo' | 'external' | 'question' | 'delegate' | 'artifact' | 'schedule' | 'mcp';
  status: 'pending' | 'executing' | 'applied' | 'discarded' | 'failed' | 'unknown' | 'undone' | 'superseded';
  requirementsRevision?: number;
  revision: number; payload: Record<string, unknown>; receipt?: unknown; error?: string; createdAt: string; updatedAt: string;
}
export const botActionAnswerSchema = z.object({
  approved: z.boolean().optional(), indices: z.array(z.number().int().nonnegative()).max(20).optional(),
  text: z.string().max(10000).optional(), group: groupInputSchema.optional(),
}).strict();
export type BotActionAnswer = z.infer<typeof botActionAnswerSchema>;
export interface BotArtifact {
  id: string; producerBotId: string; taskId: string; rootTaskId: string; chatId: string; title: string;
  mediaType: string; resource: BotResourceRef; content?: string; createdAt: string; libraryRemovedAt?: string;
}
export const BOT_MEMORY_TEXT_LIMIT = 300;
export const BOT_MEMORY_TITLE_LIMIT = 32;
export const BOT_MEMORY_TOPIC_LIMIT = 16;
export const botMemoryRequestSchema = z.object({
  scope: z.enum(['private', 'shared']), clarifies: z.string().uuid().optional(),
  edit: z.object({ id: z.string().uuid(), revision: z.number().int().nonnegative() }).strict().optional(),
}).strict();
export type BotMemoryRequest = z.infer<typeof botMemoryRequestSchema>;
export interface BotMemoryReceipt {
  id: string; entryId: string; messageId: string; title: string; text: string; scope: BotMemory['scope'];
  operation: 'added' | 'updated' | 'reused'; requestText: string;
}
export interface BotMemorySource { chatId: string; messageId: string; quote: string; }
export interface BotMemory {
  id: string; botId: string | null; scope: 'private' | 'shared'; text: string; source: string; revision: number; updatedAt: string;
  title?: string; topic?: string;
  retention?: 'resident' | 'on-demand'; origin?: 'manual' | 'explicit' | 'automatic'; sources?: BotMemorySource[];
}
export type BotMemoryView = Omit<BotMemory, 'sources'> & { title: string; topic: string; sourceCount?: number };
export interface BotMemoryReviewStatus {
  enabled: boolean;
  pending: number;
  activeBotId?: string;
  retryBotId?: string;
  lastResult?: {
    checkedAt: string;
    botId: string;
    added: number;
    updated: number;
    destination?: { memoryId?: string; title?: string };
  };
}
export type BotMemoryEdit = Pick<BotMemory, 'id' | 'botId' | 'scope' | 'title' | 'topic' | 'text' | 'source' | 'revision'>;
export const scheduleSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.iso.datetime() }).strict(),
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(1).max(525600) }).strict(),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: z.string().min(1).max(100) }).strict(),
]);
export interface BotSchedule { id: string; botId: string; title: string; prompt: string; enabled: boolean; spec: z.infer<typeof scheduleSpecSchema>; nextRunAt: string; revision: number; updatedAt: string; }
export function isQueuedBotMessage(task: BotTask): boolean {
  return task.status === 'queued' && task.rootTaskId === task.id && !task.parentTaskId && (task.kind === 'chat' || task.kind === 'work')
    && !task.runGeneration && !task.workerId && !task.piSessionPath && !task.assistantEntryId && !task.assistantEntryIds?.length
    && !task.latestUserMessageId && !task.requirementsRevision && !task.resumeInput && !task.operationIds.length && !task.dependencyIds.length;
}

const queuedMessageVersion = z.object({ taskId: z.string().uuid(), revision: z.number().int().nonnegative() });
export const botQueueChangeSchema = z.discriminatedUnion('kind', [
  queuedMessageVersion.extend({ kind: z.literal('edit'), text: z.string().min(1).max(10000).refine(text => !!text.trim(), '请输入消息') }).strict(),
  queuedMessageVersion.extend({ kind: z.literal('delete') }).strict(),
  queuedMessageVersion.extend({ kind: z.literal('steer'), targetTaskId: z.string().uuid(), targetRun: z.number().int().nonnegative() }).strict(),
]);
export type BotQueueChange = z.infer<typeof botQueueChangeSchema>;

export interface BotSubmit {
  memoryRequest?: BotMemoryRequest;
  generatedPrompts?: BotDraftValue['generatedPrompts'];
  botId: string; chatId: string; expectedDraftRevision: number; clientRequestId: string;
  text: string; replyToTaskId: string | null; resources: BotResourceRef[]; pageContext?: AiTurnContext;
  target?: { intent: 'amend'; rootTaskId: string; taskId: string; actionId?: string; expectedActionRevision?: number };
}
export interface BotSubmitReceipt { task: BotTask; messageId: string; draft: DraftSnapshot; duplicate: boolean; disposition?: 'created' | 'amended'; }
export type BotSubmissionStatus = { dataEpoch: string } & ({ status: 'accepted'; receipt: BotSubmitReceipt } | { status: 'not_found' } | { status: 'epoch_changed' });
export interface BotPendingSubmission { input: BotSubmit; dataEpoch: string; localDraft?: BotDraftValue; }
export interface BotCollaboration { root: BotTask; tasks: BotTask[]; actions: BotAction[]; messages: BotMessage[]; artifacts: BotArtifact[]; }
export interface BotExchangeQuery { anchorMessageId?: string; before?: string; after?: string; limit?: number; }
export interface BotExchange { messages: BotMessage[]; hasEarlier: boolean; hasLater: boolean; }
export interface BotChatUpdate { chatId: string; epoch: string; sequence: number; entry: ChatEntry; updatedAt: string; }
export const botChatPageSize = 30;
const chatEntryId = z.string().min(1);
export const botChatViewSchema = z.object({
  range: z.object({ kind: z.enum(['older', 'newer', 'from']), entryId: chatEntryId }).strict().optional(),
  collapsedAt: chatEntryId.optional(),
}).strict();
export type BotChatView = z.infer<typeof botChatViewSchema>;
export interface BotChatSnapshot {
  epoch: string; sequence: number; chat: ChatSession; hasEarlier: boolean; hasLater: boolean;
  lastEntryId?: string; collapsedAt?: string; pageTasks?: BotTask[];
  liveEntries: ChatEntry[]; latestUser?: Pick<ChatEntry, 'id' | 'content' | 'createdAt' | 'resourceRefs'>; toolReplyIds: string[];
}
export type BotChatSync = BotChatSnapshot | { epoch: string; sequence: number; updates: BotChatUpdate[] };
export interface BotOpen extends BotChatSnapshot { bot: BotProfile; history: { chatId: string; title: string; updatedAt: string; reason?: string; canReference: boolean }[]; }
export interface BotHostState { connected: boolean; running: boolean; independent: boolean; pid: number; activeTasks: number; queuedTasks: number; startedAt: string; supervised: boolean; error?: string; }
export interface BotNavigation { kind: 'task' | 'todo'; id: string; }
export interface BotChanged { botId?: string; chatId?: string; taskId?: string; revision?: number; draftSurface?: BotDraftSurface; kind: 'profile' | 'draft' | 'task' | 'activity' | 'chat' | 'artifact' | 'memory' | 'memory-review' | 'schedule' | 'host' | 'read' | 'navigation'; }
export interface BotBridge {
  getFiles(botId: string): Promise<BotFilesView>;
  getSkills(botId: string): Promise<BotSkillsView>;
  readSkill(botId: string, source: 'shared' | 'private', name: string): Promise<string>;
  openFiles(botId: string, folder: 'root' | 'inputs' | 'outputs' | 'skills' | 'sharedSkills'): Promise<void>;
  importFiles(botId: string): Promise<BotWorkspaceFile[]>;
  getExtensions(botId: string): Promise<BotExtensionsView>;
  saveMcpServer(definition: McpServerDefinition, revision: number, credential?: string): Promise<McpServer>;
  removeMcpServer(id: string, revision: number): Promise<void>;
  discoverMcpTools(botId: string, serverId: string): Promise<McpToolView[]>;
  saveBindings(botId: string, bindings: BotBindings): Promise<BotBindings>;
  list(): Promise<BotCard[]>;
  open(botId: string, view?: BotChatView): Promise<BotOpen>;
  markRead(botId: string): Promise<void>;
  getLaunchTarget(): Promise<BotNavigation | null>;
  updateProfile(botId: string, expectedRevision: number, patch: Pick<BotProfile, 'name' | 'avatar' | 'description' | 'instructions' | 'modelId'>): Promise<BotProfile>;
  getDraft(chatId: string): Promise<DraftSnapshot>;
  saveDraft(chatId: string, expectedRevision: number, value: BotDraftValue): Promise<DraftSnapshot>;
  submit(input: BotSubmit): Promise<BotSubmitReceipt>;
  getSubmissionStatus(input: BotSubmit, dataEpoch?: string): Promise<BotSubmissionStatus>;
  getPendingSubmission(chatId: string, mode?: boolean | 'office-reply'): Promise<BotPendingSubmission | null>;
  retainPendingDraft(chatId: string, value: BotDraftValue): Promise<void>;
  acknowledgeSubmission(chatId: string, requestId: string): Promise<void>;
  syncChat(chatId: string, after?: number, epoch?: string, view?: BotChatView): Promise<BotChatSync>;
  getConversationEntries(taskId: string): Promise<ChatEntry[]>;
  onChatUpdate(callback: (update: BotChatUpdate) => void): () => void;
  listTasks(botId: string, limit?: number): Promise<BotTask[]>;
  getTask(taskId: string): Promise<{ task: BotTask; entries?: ChatEntry[]; children: BotTask[]; messages: BotMessage[]; actions: BotAction[] }>;
  getCollaboration(rootTaskId: string): Promise<BotCollaboration>;
  getBotExchange(botAId: string, botBId: string, query?: BotExchangeQuery): Promise<BotExchange>;
  changeQueuedMessage(change: BotQueueChange): Promise<BotTask>;
  cancelTask(taskId: string, revision: number): Promise<BotTask>;
  retryTask(taskId: string, revision: number): Promise<BotTask>;
  answerAction(operationId: string, revision: number, answer: BotActionAnswer): Promise<BotAction>;
  reconcileAction(operationId: string, revision: number, result: 'applied' | 'not_applied', note: string): Promise<BotAction>;
  undoAction(operationId: string, revision: number): Promise<BotAction>;
  listArtifacts(botId: string): Promise<BotArtifact[]>;
  openArtifact(id: string): Promise<BotArtifact>;
  removeArtifactFromLibrary(id: string): Promise<void>;
  listMemories(botId: string): Promise<BotMemoryView[]>;
  memorySources(botId: string, id: string): Promise<BotMemorySource[]>;
  getAutomaticMemory(): Promise<boolean>;
  getAutomaticMemoryStatus(): Promise<BotMemoryReviewStatus>;
  setAutomaticMemory(enabled: boolean): Promise<boolean>;
  updateMemory(input: BotMemoryEdit): Promise<BotMemoryView>;
  removeMemory(id: string, revision: number): Promise<void>;
  listSchedules(botId: string): Promise<BotSchedule[]>;
  saveSchedule(input: Omit<BotSchedule, 'nextRunAt' | 'updatedAt'>): Promise<BotSchedule>;
  setScheduleEnabled(id: string, revision: number, enabled: boolean): Promise<BotSchedule>;
  removeSchedule(id: string, revision: number): Promise<void>;
  getHostState(): Promise<BotHostState>;
  setBackground(enabled: boolean): Promise<BotHostState>;
  onChanged(callback: (event: BotChanged) => void): () => void;
}
