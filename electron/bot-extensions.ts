import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { BotError, payloadHash } from './bot-store';
import { botBindingsSchema, mcpServerSchema, type BotBindings, type McpServer, type McpServerDefinition, type McpToolView } from '../shared/bot-extensions';
import type { BotStore } from './bot-store';

type Encryption = { encrypt(value: string): string; decrypt(value: string): string };
type SavedServer = { definition: McpServerDefinition; revision: number };
export class BotExtensions {
  private encryption?: Encryption;
  private readonly clients = new Map<string, { revision: number; client: Client }>();
  private readonly pendingClients = new Map<string, Promise<Client>>();
  constructor(private readonly store: BotStore) {}
  configureEncryption(encryption: Encryption): void { this.encryption = encryption; }
  private saved(): SavedServer[] { return this.store.ai.setting<SavedServer[]>('bot.mcp.servers', []); }
  list(): McpServer[] {
    return this.saved().map(server => ({ id: server.definition.id, definition: mcpServerSchema.parse(server.definition), revision: server.revision,
      hasCredential: !!this.store.ai.setting('bot.mcp.secret.' + server.definition.id, '') }));
  }
  bindings(botId: string): BotBindings {
    this.store.profile(botId);
    return botBindingsSchema.parse(this.store.ai.setting('bot.bindings.' + botId, { revision: 0, mcp: [] }));
  }
  save(definition: McpServerDefinition, revision: number, credential?: string): McpServer {
    definition = mcpServerSchema.parse(definition);
    const servers = this.saved(), prior = servers.find(server => server.definition.id === definition.id);
    if ((prior?.revision ?? 0) !== revision) throw new Error('连接已更新，请刷新后再保存');
    const hasCredential = credential === undefined ? !!this.store.ai.setting('bot.mcp.secret.' + definition.id, '') : !!credential;
    if (hasCredential && definition.transport === 'stdio' && !definition.credentialName) throw new Error('请设置本地程序接收密钥的环境变量名');
    let encrypted: string | undefined;
    if (credential) {
      if (!this.encryption) throw new Error('系统加密不可用，未保存密钥');
      encrypted = this.encryption.encrypt(credential);
    }
    const next = { definition, revision: revision + 1 };
    this.store.transaction(() => {
      this.store.ai.setSetting('bot.mcp.servers', [...servers.filter(server => server.definition.id !== definition.id), next]);
      if (credential !== undefined) this.store.ai.setSetting('bot.mcp.secret.' + definition.id, encrypted ?? '');
      this.dirty();
    });
    void this.dropServer(definition.id);
    return this.list().find(server => server.id === definition.id)!;
  }
  async remove(id: string, revision: number): Promise<void> {
    const prior = this.saved().find(server => server.definition.id === id);
    if (!prior || prior.revision !== revision) throw new Error('连接已变化，请刷新后重试');
    this.store.transaction(() => {
      this.store.ai.setSetting('bot.mcp.servers', this.saved().filter(server => server.definition.id !== id));
      this.store.ai.setSetting('bot.mcp.secret.' + id, '');
      for (const bot of this.store.all<{ id: string }>('bots')) {
        const bindings = this.bindings(bot.id);
        if (bindings.mcp.some(item => item.serverId === id)) {
          this.store.ai.setSetting('bot.bindings.' + bot.id, { revision: bindings.revision + 1, mcp: bindings.mcp.filter(item => item.serverId !== id) });
        }
      }
      this.dirty();
    });
    await this.dropServer(id);
  }
  saveBindings(botId: string, input: BotBindings): BotBindings {
    const next = botBindingsSchema.parse(input), current = this.bindings(botId);
    if (next.revision !== current.revision) throw new Error('Bot 工具分配已更新，请刷新后重试');
    const known = new Set(this.saved().map(server => server.definition.id));
    if (new Set(next.mcp.map(binding => binding.serverId)).size !== next.mcp.length ||
      next.mcp.some(binding => !known.has(binding.serverId) || new Set(binding.tools.map(tool => tool.name)).size !== binding.tools.length)) throw new Error('连接或工具分配无效');
    const saved = { ...next, revision: current.revision + 1 };
    this.store.transaction(() => { this.store.ai.setSetting('bot.bindings.' + botId, saved); this.dirty(); });
    return saved;
  }
  version(botId: string, serverId: string): string { return this.server(serverId).revision + ':' + this.bindings(botId).revision; }
  private dirty(): void {
    this.store.db.prepare("INSERT OR IGNORE INTO bot_file_dirty VALUES('registry:')").run();
    for (const bot of this.store.all<{ id: string }>('bots')) this.store.db.prepare('INSERT OR IGNORE INTO bot_file_dirty VALUES(?)').run('bot:' + bot.id);
  }
  private server(id: string): SavedServer {
    const server = this.saved().find(server => server.definition.id === id);
    if (!server?.definition.enabled) throw new Error('MCP 连接未启用或已移除');
    return { ...server, definition: mcpServerSchema.parse(server.definition) };
  }
  private async connection(botId: string, serverId: string, signal?: AbortSignal): Promise<Client> {
    const key = botId + ':' + serverId + ':' + this.server(serverId).revision;
    const pending = this.pendingClients.get(key);
    if (pending) return pending;
    const connection = this.connect(botId, serverId, signal);
    this.pendingClients.set(key, connection);
    try { return await connection; } finally { if (this.pendingClients.get(key) === connection) this.pendingClients.delete(key); }
  }
  private async connect(botId: string, serverId: string, signal?: AbortSignal): Promise<Client> {
    this.store.profile(botId);
    signal?.throwIfAborted();
    const server = this.server(serverId), key = botId + ':' + serverId, prior = this.clients.get(key);
    if (prior?.revision === server.revision) return prior.client;
    if (prior) { this.clients.delete(key); await prior.client.close(); }
    const encrypted = this.store.ai.setting('bot.mcp.secret.' + serverId, '');
    if (encrypted && !this.encryption) throw new Error('系统加密不可用，无法连接');
    const secret = encrypted ? this.encryption!.decrypt(encrypted) : '';
    const { definition } = server;
    const client = new Client({ name: 'bot-workbench', version: '1.0.0' }, { capabilities: {} });
    const transport = definition.transport === 'stdio'
      ? new StdioClientTransport({ command: definition.command, args: definition.args, cwd: this.store.files.paths(botId).workspace,
        env: secret && definition.credentialName ? { [definition.credentialName]: (definition.credentialPrefix ?? '') + secret } : undefined,
        stderr: 'ignore', maxBufferSize: 2_000_000 })
      : new StreamableHTTPClientTransport(new URL(definition.url), { reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
        requestInit: { headers: secret ? { [definition.credentialName ?? 'Authorization']: (definition.credentialPrefix ?? (!definition.credentialName || definition.credentialName.toLowerCase() === 'authorization' ? 'Bearer ' : '')) + secret } : {} } });
    try {
      await client.connect(transport, { signal, timeout: 15_000 });
      if (this.server(serverId).revision !== server.revision) throw new Error('连接配置已经变化');
      this.clients.set(key, { revision: server.revision, client });
      client.onclose = () => { if (this.clients.get(key)?.client === client) this.clients.delete(key); };
      return client;
    } catch (error) { await client.close().catch(() => {}); throw new Error('MCP 连接失败，请检查服务、地址和授权', { cause: error }); }
  }
  async tools(botId: string, serverId: string, signal?: AbortSignal): Promise<Tool[]> {
    const client = await this.connection(botId, serverId, signal), tools: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : undefined, { signal, timeout: 15_000 });
      tools.push(...page.tools); cursor = page.nextCursor;
      if (tools.length > 1000) throw new Error('服务工具过多，请在服务端限定需要的工具');
    } while (cursor);
    return tools;
  }
  async discover(botId: string, serverId: string): Promise<McpToolView[]> {
    return (await this.tools(botId, serverId)).map(tool => ({ name: tool.name, description: tool.description ?? '', readOnly: tool.annotations?.readOnlyHint === true }));
  }
  async call(botId: string, serverId: string, name: string, args: Record<string, unknown>, mode: 'read' | 'confirm', signal?: AbortSignal, expectedToolHash?: string) {
    const binding = this.bindings(botId).mcp.find(binding => binding.serverId === serverId)?.tools.find(tool => tool.name === name);
    if (!binding || binding.mode !== mode) throw new BotError('PRECONDITION_FAILED', '这个 MCP 工具未分配给当前 Bot，或权限已变化');
    const tool = (await this.tools(botId, serverId, signal)).find(tool => tool.name === name);
    if (!tool || mode === 'read' && tool.annotations?.readOnlyHint !== true || expectedToolHash && payloadHash(tool) !== expectedToolHash) throw new BotError('PRECONDITION_FAILED', '工具已变化，请重新检查并分配');
    const validation = new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(args);
    if (!validation.valid) throw new BotError('PRECONDITION_FAILED', '工具参数无效：' + validation.errorMessage);
    const client = await this.connection(botId, serverId, signal);
    const response = await client.callTool({ name, arguments: args }, undefined, { signal, timeout: 60_000 });
    if (response.isError) throw new Error('MCP 工具返回执行错误，请核对服务结果');
    return response;
  }
  recordTools(botId: string, tools: { name: string; label: string }[]): void {
    const rows = tools.map(({ name, label }) => ({ name, label }));
    if (JSON.stringify(rows) === JSON.stringify(this.store.ai.setting('bot.tools.' + botId, []))) return;
    this.store.transaction(() => { this.store.ai.setSetting('bot.tools.' + botId, rows); this.dirty(); });
  }
  private async dropServer(id: string): Promise<void> {
    for (const [key, connection] of [...this.clients]) if (key.endsWith(':' + id)) { this.clients.delete(key); await connection.client.close(); }
  }
  async close(): Promise<void> { await Promise.allSettled([...this.pendingClients.values()]); const clients = [...this.clients.values()]; this.clients.clear(); await Promise.allSettled(clients.map(connection => connection.client.close())); }
}
