import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const devPort = 5180;

export default defineConfig(({ command }) => ({
  plugins: [react(), {
    name: 'workbench-csp',
    transformIndexHtml(_html, context) {
      const devUrl = command === 'serve' ? context.server?.resolvedUrls?.local[0] : undefined;
      const devSocketOrigin = devUrl ? new URL(devUrl).origin.replace(/^http/, 'ws') : undefined;
      return [{
        tag: 'meta',
        attrs: {
          'http-equiv': 'Content-Security-Policy',
          content: [
            "default-src 'self'",
            `script-src 'self' 'wasm-unsafe-eval'${command === 'serve' ? " 'unsafe-inline'" : ''}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "media-src 'self' blob:",
            "font-src 'self' data:",
            `connect-src 'self' wb-pdf:${devSocketOrigin ? ` ${devSocketOrigin}` : ''}`,
            "worker-src 'self' blob:",
            "frame-src 'self' http: https:",
            "object-src 'none'",
            "base-uri 'none'",
            "form-action 'none'",
          ].join('; '),
        },
        injectTo: 'head-prepend',
      }];
    },
  }],
  server: {
    port: devPort,
    strictPort: false,
  },
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  clearScreen: false,
}));
