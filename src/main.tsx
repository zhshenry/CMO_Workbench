import { createRoot } from 'react-dom/client';
import { StrictMode } from 'react';
import { App } from './App';
import { FloatTodoApp } from './views/FloatTodo';
import './shell.css';
import './views/speech.css';
import '../modules/todo/ui/todo.css';
import '../modules/browser/ui/pane.css';
import '../modules/reading/ui/reading.css';

const root = createRoot(document.getElementById('root')!);

// 悬浮待办窗:独立小窗经 ?window=float 载入同一 bundle
if (new URLSearchParams(location.search).get('window') === 'float') {
  root.render(
    <StrictMode>
      <FloatTodoApp />
    </StrictMode>,
  );
} else if ((import.meta.env.DEV || import.meta.env.MODE === 'diagnostics') && location.hash.startsWith('#dev/browser')) {
  void import('./views/DevBrowserView').then(({ DevBrowserView }) => root.render(
    <StrictMode>
      <DevBrowserView />
    </StrictMode>,
  ));
} else if ((import.meta.env.DEV || import.meta.env.MODE === 'diagnostics') && location.hash.startsWith('#dev/office')) {
  void import('./views/DevOfficeView').then(({ DevOfficeView }) => root.render(
    <StrictMode>
      <DevOfficeView />
    </StrictMode>,
  ));
} else {
  // dev 模式去掉 StrictMode:StrictMode 双挂载会触发 pane 卸载 cleanup 释放 webview 租约,
  // 导致内置浏览器(权限查询等)acquire 后 150ms 即被 release,webview 永不 attach。
  root.render(<App />);
}
