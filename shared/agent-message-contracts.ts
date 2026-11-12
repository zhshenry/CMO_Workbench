import { z } from 'zod';

// CodeAI(Claude Code)是唯一的 Agent 提供方;预留 provider 字段以便将来扩展。
export const AGENT_PROVIDERS = ['codeai'] as const;
export type AgentProvider = typeof AGENT_PROVIDERS[number];
export const AGENT_LABELS: Record<AgentProvider, string> = { codeai: 'CodeAI' };
const identifier = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_.:-]+$/);

// CodeAI Stop hook 落盘的事件;MVP 只区分 reply(跑完一轮)与 failed(运行失败),不接 approval。
// transcriptPath 指向 ~/.claude/projects/{dir}/{sessionId}.jsonl,后端 poll 时读尾部取摘要。
export const AgentEventSchema = z.object({
  provider: z.enum(AGENT_PROVIDERS), sessionId: identifier, turnId: identifier,
  kind: z.enum(['reply', 'failed']),
  requestKey: z.string().max(200).default(''), workspace: z.string().max(4096).default(''),
  title: z.string().max(200).default(''), detail: z.string().max(500).default(''),
  transcriptPath: z.string().max(4096).default(''),
  occurredAt: z.number().int().positive(),
}).strict();
export type AgentEvent = z.infer<typeof AgentEventSchema>;

export const AgentMessageSchema = z.object({
  id: z.string(), provider: z.enum(AGENT_PROVIDERS), sessionId: identifier, turnId: identifier,
  requestKey: z.string(), workspace: z.string(), project: z.string(),
  kind: z.enum(['reply', 'failed']), title: z.string(), detail: z.string(),
  transcriptPath: z.string(),
  createdAt: z.number(), updatedAt: z.number(), readAt: z.number().nullable(), resolvedAt: z.number().nullable(),
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;
export type AgentReadTarget = Pick<AgentMessage, 'id' | 'updatedAt'>;

// connected 表示本地 hook 注入是否就绪,不代表 CodeAI 本身的信任状态或实际投递。
export interface AgentConnection { provider: AgentProvider; connected: boolean; error?: string; }

// MVP 无 approval,agentPending 恒为 false;保留函数签名避免调用点改动。
export function agentPending(_message: AgentMessage): boolean { return false; }
export function agentMessageStatus(message: AgentMessage): string {
  return message.kind === 'failed' ? '运行失败' : message.readAt ? '已读' : '有新回复';
}

// 最近项目来自 CodeAI 本地历史，历史会话仅作补充；路径有效性由主进程检查。
export interface DiscoveredProject {
  dir: string; cwd: string; lastActive: number; sessionCount: number;
  source: 'recent' | 'manual' | 'history'; available: boolean; problem?: string;
}
export const agentProjectKey = (path: string): string => path.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

// 多项目 hook 注入结果:enabled 为已成功注入的项目路径,failed 为注入失败的项目与原因(前端按项标红)。
export interface AgentConnectResult { enabled: string[]; failed: { path: string; error: string }[]; }
