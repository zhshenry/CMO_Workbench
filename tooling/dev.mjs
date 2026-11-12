// 开发模式:先构建主进程/preload,再起 Vite 与 Electron。
// 修改 electron/、shared/ 或主进程引用的 modules/ 后请重启 npm run dev。
// 显式置 development,避免外部 NODE_ENV=production 导致 vite 误判生产模式、
// react-refresh preamble 不注入进而报 $RefreshSig$ is not defined 白屏。
process.env.NODE_ENV = 'development';
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

await import('./build.mjs');
const server = await createServer({ configFile: 'vite.config.ts' });
await server.listen();
server.printUrls();

const electronPath = require('electron');
const child = spawn(electronPath, ['.'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    WORKBENCH_DEV_URL: server.resolvedUrls.local[0],
    ELECTRON_ENABLE_LOGGING: '1',
  },
});

child.on('exit', (code) => {
  server.close();
  process.exit(code ?? 1);
});

const forward = (signal) => {
  process.on(signal, () => {
    child.kill();
    server.close();
    process.exit(0);
  });
};
for (const sig of ['SIGINT', 'SIGTERM']) forward(sig);
