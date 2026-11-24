import { z } from 'zod';

const serverBase = {
  id: z.string().uuid(), name: z.string().trim().min(1, '请输入连接名称').max(80), enabled: z.boolean(),
  credentialName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_-]*$/, '密钥名称只能包含字母、数字、下划线和连字符').max(100).optional(),
  credentialPrefix: z.string().max(40).optional(),
};
export const mcpServerSchema = z.discriminatedUnion('transport', [
  z.object({ ...serverBase, transport: z.literal('stdio'), command: z.string().trim().min(1).max(1000), args: z.array(z.string().max(4000)).max(100) }).strict(),
  z.object({ ...serverBase, transport: z.literal('http'), url: z.string().url('请输入有效的服务地址').max(2000).refine(value => {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash;
  }, '地址只能包含 HTTP/HTTPS 的主机和路径，凭据请填入密钥栏') }).strict(),
]);
export type McpServerDefinition = z.infer<typeof mcpServerSchema>;
export interface McpServer { id: string; definition: McpServerDefinition; revision: number; hasCredential: boolean; }
export interface McpToolView { name: string; description: string; readOnly: boolean; }
export const botBindingsSchema = z.object({
  revision: z.number().int().nonnegative(),
  mcp: z.array(z.object({ serverId: z.string().uuid(), tools: z.array(z.object({
    name: z.string().min(1).max(200), mode: z.enum(['read', 'confirm']),
  }).strict()).max(500) }).strict()).max(30),
}).strict();
export type BotBindings = z.infer<typeof botBindingsSchema>;
export interface BotExtensionsView { servers: McpServer[]; bindings: BotBindings; builtins: { name: string; label: string }[]; usage: Record<string, string[]>; }
