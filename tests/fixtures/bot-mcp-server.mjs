import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { appendFileSync } from 'node:fs';

const server = new Server({ name: 'isolated-test-server', version: '1.0.0' }, { capabilities: { tools: {} } });
const schema = { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false };
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'inspect', description: 'Read fixture context', inputSchema: schema, annotations: { readOnlyHint: true } },
  { name: 'record', description: 'Write fixture receipt', inputSchema: schema },
  { name: 'uncertain', description: 'Write then lose receipt', inputSchema: schema },
] }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const { name, arguments: args } = request.params;
  if (name !== 'inspect') appendFileSync(process.argv[2], JSON.stringify({ name, args }) + '\n');
  if (name === 'uncertain') { setTimeout(() => process.exit(0), 0); await new Promise(() => {}); }
  return { content: [{ type: 'text', text: JSON.stringify({ cwd: process.cwd(), hasCredential: !!process.env.BOT_FIXTURE_KEY, value: args.value }) }] };
});
await server.connect(new StdioServerTransport());
