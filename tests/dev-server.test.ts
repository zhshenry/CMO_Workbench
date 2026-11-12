import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { type TestContext } from 'node:test';
import { JSDOM } from 'jsdom';
import { createServer, type ViteDevServer } from 'vite';

const root = path.resolve(import.meta.dirname, '..');

async function startVite(t: TestContext, port: number) {
  const directory = await mkdtemp(path.join(tmpdir(), 'cmo-dev-server-'));
  let server: ViteDevServer | undefined;
  t.after(async () => {
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  });
  server = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    cacheDir: directory,
    logLevel: 'silent',
    server: { host: '127.0.0.1', port, watch: null },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  await server.listen();
  return server;
}

async function connectSources(server: ViteDevServer) {
  const response = await fetch(server.resolvedUrls!.local[0]);
  assert.equal(response.status, 200);
  const html = await response.text();
  const policy = new JSDOM(html).window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content');
  assert.ok(policy, 'the served page must retain its Content Security Policy');
  return policy.split('; ').find(value => value.startsWith('connect-src '))!.split(' ').slice(1);
}

test('dev startup selects a free port without stopping the existing service', async t => {
  const existing = createHttpServer((_request, response) => response.end('existing preview'));
  await new Promise<void>(resolve => existing.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve, reject) => existing.close(error => error ? reject(error) : resolve())));
  const port = (existing.address() as AddressInfo).port;

  const server = await startVite(t, port);
  assert.notEqual((server.httpServer!.address() as AddressInfo).port, port);
  assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), 'existing preview');
  const socketOrigin = new URL(server.resolvedUrls!.local[0]).origin.replace(/^http/, 'ws');
  assert.deepEqual(await connectSources(server), ["'self'", 'wb-pdf:', socketOrigin]);
});

test('dev page permits hot reload on its actual listening origin', async t => {
  const server = await startVite(t, 0);
  const socketOrigin = new URL(server.resolvedUrls!.local[0]).origin.replace(/^http/, 'ws');
  assert.deepEqual(await connectSources(server), ["'self'", 'wb-pdf:', socketOrigin]);
});
