import { z } from 'zod';
import type { AiTurnContext } from './ai-reference';
import type { ChatEntry, ChatSession } from './todo-contracts';
import { groupInputSchema, type GroupInput } from './permission-group-contracts';

export const BOT_CONTRACT_VERSION = 'bot-workbench/v10';
export const botSeeds = [
  { seedKey: 'coordinator', workspaceId: 'home', name: '总管', avatar: 'ring:blue', description: 'CMO 总台', instructions: '协调各领域负责人，跟进工作与交付。依据真实结果汇报，不把已委派当成已完成。', views: ['home'] },
  { seedKey: 'schedule', workspaceId: 'todo', name: '助理', avatar: 'square:violet', description: '日程和待办', instructions: '管理日程和待办。写入前展示具体建议，等待用户确认并核对真实回执。', views: ['todo'] },
  { seedKey: 'office', workspaceId: 'office', name: '办公助理', avatar: 'hex:blue', description: '工作消息、邮件和简报', instructions: '根据本机已读取的办公资料回答，说明时间范围和缺失的来源。按原话区分确定信息与待核对的事项。使用「待处理」中的建议入口提交待办确认。', views: ['office'] },
  { seedKey: 'permission', workspaceId: 'permission', name: '权限管家', avatar: 'drop:graphite', description: '权限管理', instructions: '协助权限查询和 PIC 群组申请。遵守站点授权、参数校验和提交确认；已提交不代表审批生效。', views: ['permission-query', 'permission-groups'] },
  { seedKey: 'delivery', workspaceId: 'delivery', name: '交付件管家', avatar: 'ghost:green', description: '交付件管理', instructions: '整理用户明确提供的内容及保存本地产物。项目交付系统尚未接入，不能声称查询或修改了系统记录。', views: ['delivery-projects'] },
  { seedKey: 'pbi', workspaceId: 'pbi', name: 'PBI系统管家', avatar: 'sail:orange', description: 'PBI 管理', instructions: '使用已授权浏览器页面协助 PBI 业务，核验真实页面结果；没有专用结构化 PBI API。', views: ['pbi-features', 'pbi-modules'] },
  { seedKey: 'dts', workspaceId: 'dts', name: 'DTS系统管家', avatar: 'hex:pink', description: 'DTS 管理', instructions: '整理用户提供的问题和本地产物。DTS 业务系统尚未接入，不能声称查询或修改了系统记录。', views: ['dts-query'] },
] as const;
export type BotSeedKey = typeof botSeeds[number]['seedKey'];
export type BotWorkspaceId = typeof botSeeds[number]['workspaceId'];
export interface BotProfile {
  id: string; seedKey: BotSeedKey; workspaceId: BotWorkspaceId; name: string; avatar: string;
  description: string; instructions: string; modelId?: string | null; mainChatId: string; enabled: boolean; revision: number; updatedAt: string;
}
export type BotRunActivity = 'thinking' | 'searching' | 'working' | 'sending' | 'replying';
export type BotActivity = BotRunActivity | 'idle' | 'queued' | 'waiting_bot' | 'waiting_user' | 'waiting_resource' | 'interrupted';
export type BotCard = Omit<BotProfile, 'instructions'> & { capabilities: string[]; unreadCount?: number; waitingCount?: number; runningCount?: number; activity?: BotActivity; completion?: string };
export const resourceRefSchema = z.object({ kind: z.enum(['todo', 'reading', 'artifact', 'chat']), id: z.string().min(1).max(200), version: z.string().max(100).optional(), label: z.string().max(200).optional() }).strict();
export type BotResourceRef = z.infer<typeof resourceRefSchema>;
export const draftValueSchema = z.object({ text: z.string().max(10000), replyToTaskId: z.string().uuid().nullable(), resources: z.array(resourceRefSchema).max(8) }).strict();
export type BotDraftValue = z.infer<typeof draftValueSchema>;
export type BotDraftSurface = 'main' | 'island';
export const draftSnapshotSchema = draftValueSchema.extend({ chatId: z.string().uuid(), surface: z.enum(['main', 'island']), revision: z.number().int().nonnegative() }).strict();
export interface DraftSnapshot extends BotDraftValue { chatId: string; surface: BotDraftSurface; revision: number; }
export const taskStatuses = ['queued', 'running', 'waiting_user', 'waiting_bot', 'waiting_resource', 'interrupted', 'completed', 'failed', 'cancelled'] as const;
export type BotTaskStatus = typeof taskStatuses[number];
export const terminalTask = (status: BotTaskStatus): boolean => ['completed', 'failed', 'cancelled'].includes(status);
export interface BotTask {
  id: string; botId: string; chatId: string; rootTaskId: string; parentTaskId?: string;
  sourceMessageId: string; latestUserMessageId?: string; replyToEntryId?: string; kind: 'chat' | 'work' | 'delegated' | 'routine' | 'message';
  status: BotTaskStatus; title: string; input: string; context: AiTurnContext; resources: BotResourceRef[];
  revision: number; createdAt: string; updatedAt: string; reason?: string; result?: string;
  piSessionPath?: string; assistantEntryId?: string; resumeInput?: string; workerId?: string;
  assistantEntryIds?: string[];
  /** Delivered replies awaiting the next assistant entry. */
  pendingReplyMessageIds?: string[];
  operationIds: string[]; dependencyIds: string[];
  requirementsRevision?: number; runGeneration?: number;
  groupFollowup?: { input: GroupInput; requirementsRevision: number; pendingFill: boolean; browserTaskId?: string };
  amendedActionId?: string;
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
  id: string; taskId: string; botId: string; kind: 'todo' | 'external' | 'question' | 'delegate' | 'artifact' | 'schedule';
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
  mediaType: string; resource: BotResourceRef; content?: string; createdAt: string;
}
export interface BotMemory { id: string; botId: string | null; scope: 'private' | 'shared'; text: string; source: string; revision: number; updatedAt: string; }
export const scheduleSpecSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), at: z.iso.datetime() }).strict(),
  z.object({ kind: z.literal('interval'), minutes: z.number().int().min(1).max(525600) }).strict(),
  z.object({ kind: z.literal('daily'), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), timeZone: z.string().min(1).max(100) }).strict(),
]);
export interface BotSchedule { id: string; botId: string; title: string; prompt: string; enabled: boolean; spec: z.infer<typeof scheduleSpecSchema>; nextRunAt: string; revision: number; updatedAt: string; }
export interface BotSubmit {
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
export type BotChatSync = { epoch: string; sequence: number; chat: ChatSession } | { epoch: string; sequence: number; updates: BotChatUpdate[] };
export interface BotOpen { bot: BotProfile; chat: ChatSession; history: { chatId: string; title: string; updatedAt: string; reason?: string; canReference: boolean }[]; }
export interface BotHostState { connected: boolean; running: boolean; independent: boolean; pid: number; activeTasks: number; queuedTasks: number; startedAt: string; supervised: boolean; error?: string; }
export interface BotNavigation { kind: 'task' | 'todo'; id: string; }
export interface BotChanged { botId?: string; chatId?: string; taskId?: string; revision?: number; draftSurface?: BotDraftSurface; kind: 'profile' | 'draft' | 'task' | 'activity' | 'chat' | 'artifact' | 'memory' | 'schedule' | 'host' | 'read' | 'navigation'; }
export interface BotBridge {
  list(): Promise<BotCard[]>;
  open(botId: string): Promise<BotOpen>;
  markRead(botId: string): Promise<void>;
  getLaunchTarget(): Promise<BotNavigation | null>;
  updateProfile(botId: string, expectedRevision: number, patch: Pick<BotProfile, 'name' | 'avatar' | 'description' | 'instructions' | 'modelId'>): Promise<BotProfile>;
  getDraft(chatId: string): Promise<DraftSnapshot>;
  saveDraft(chatId: string, expectedRevision: number, value: BotDraftValue): Promise<DraftSnapshot>;
  submit(input: BotSubmit): Promise<BotSubmitReceipt>;
  getSubmissionStatus(input: BotSubmit, dataEpoch?: string): Promise<BotSubmissionStatus>;
  getPendingSubmission(chatId: string): Promise<BotPendingSubmission | null>;
  retainPendingDraft(chatId: string, value: BotDraftValue): Promise<void>;
  acknowledgeSubmission(chatId: string, requestId: string): Promise<void>;
  syncChat(chatId: string, after?: number, epoch?: string): Promise<BotChatSync>;
  onChatUpdate(callback: (update: BotChatUpdate) => void): () => void;
  listTasks(botId: string, limit?: number): Promise<BotTask[]>;
  getTask(taskId: string): Promise<{ task: BotTask; children: BotTask[]; messages: BotMessage[]; actions: BotAction[] }>;
  getCollaboration(rootTaskId: string): Promise<BotCollaboration>;
  getBotExchange(botAId: string, botBId: string, query?: BotExchangeQuery): Promise<BotExchange>;
  cancelTask(taskId: string, revision: number): Promise<BotTask>;
  retryTask(taskId: string, revision: number): Promise<BotTask>;
  answerAction(operationId: string, revision: number, answer: BotActionAnswer): Promise<BotAction>;
  reconcileAction(operationId: string, revision: number, result: 'applied' | 'not_applied', note: string): Promise<BotAction>;
  undoAction(operationId: string, revision: number): Promise<BotAction>;
  listArtifacts(botId: string): Promise<BotArtifact[]>;
  openArtifact(id: string): Promise<BotArtifact>;
  listMemories(botId: string): Promise<BotMemory[]>;
  updateMemory(input: Omit<BotMemory, 'updatedAt'>): Promise<BotMemory>;
  removeMemory(id: string, revision: number): Promise<void>;
  listSchedules(botId: string): Promise<BotSchedule[]>;
  saveSchedule(input: Omit<BotSchedule, 'nextRunAt' | 'updatedAt'>): Promise<BotSchedule>;
  setScheduleEnabled(id: string, revision: number, enabled: boolean): Promise<BotSchedule>;
  removeSchedule(id: string, revision: number): Promise<void>;
  getHostState(): Promise<BotHostState>;
  setBackground(enabled: boolean): Promise<BotHostState>;
  onChanged(callback: (event: BotChanged) => void): () => void;
}
