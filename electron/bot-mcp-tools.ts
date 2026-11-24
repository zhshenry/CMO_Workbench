import { createHash } from 'node:crypto';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { BotTask } from '../shared/bot-contracts';
import type { BotHost } from './bot-host';
import { payloadHash, type BotStore } from './bot-store';

export async function botMcpTools(store: BotStore, task: BotTask, host: BotHost, signal: AbortSignal, canRun: () => boolean) {
  const tools: ReturnType<typeof defineTool>[] = [], errors: string[] = [];
  if (task.memoryRequest) return { tools, prompt: '' };
  const bindings = store.extensions.bindings(task.botId);
  for (const binding of bindings.mcp) {
    const server = store.extensions.list().find(server => server.id === binding.serverId);
    if (!server?.definition.enabled || !binding.tools.length) continue;
    try {
      const available = await store.extensions.tools(task.botId, server.id, signal);
      for (const permission of binding.tools) {
        const tool = available.find(tool => tool.name === permission.name);
        if (!tool || permission.mode === 'read' && tool.annotations?.readOnlyHint !== true || task.kind === 'message' && permission.mode !== 'read') continue;
        const suffix = createHash('sha256').update(server.id + ':' + tool.name).digest('hex').slice(0, 10);
        const name = 'mcp_' + server.id.slice(0, 8) + '_' + tool.name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30) + '_' + suffix;
        tools.push(defineTool({ name, label: server.definition.name + ' · ' + tool.name, executionMode: 'sequential',
          description: (tool.description ?? tool.name) + (permission.mode === 'read' ? '（已分配的只读工具）' : '（先生成确认卡，用户确认后才执行）'),
          parameters: Type.Unsafe<Record<string, unknown>>(tool.inputSchema),
          execute: async (id, args) => {
            if (!canRun()) throw new Error('本轮已经结束，不能调用外部工具');
            if (permission.mode === 'read') {
              const response = await store.extensions.call(task.botId, server.id, tool.name, args, 'read', signal);
              return { content: [{ type: 'text' as const, text: JSON.stringify(response).slice(0, 500_000) }], details: {} };
            }
            const operation = { serverId: server.id, toolName: tool.name, arguments: args, version: store.extensions.version(task.botId, server.id), toolHash: payloadHash(tool) };
            const action = host.waitForAction(task.id, task.id + ':mcp:' + id, 'mcp', {
              title: server.definition.name + ' · ' + tool.name, ...operation, fingerprint: payloadHash(operation),
            });
            return { content: [{ type: 'text' as const, text: JSON.stringify({ operationId: action.id, waitingForConfirmation: true, executed: false }) }], details: {} };
          },
        }));
      }
    } catch {
      signal.throwIfAborted();
      errors.push(server.definition.name + ' 当前无法连接，请在 Bot 的「工具与 MCP」中检查连接与授权。');
    }
  }
  return { tools, prompt: 'MCP 工具只按当前 Bot 的已保存分配开放。需要确认的工具必须等待用户操作确认卡，未执行前不能宣称已完成。' +
    (errors.length ? '\n未就绪的连接：' + JSON.stringify(errors) : '') };
}
