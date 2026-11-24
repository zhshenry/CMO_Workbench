import { useEffect, useState } from 'react';
import { ArrowLeft, FolderOpen, Paperclip, UploadSimple } from '@phosphor-icons/react';
import type { BotResourceRef } from '../../shared/bot-contracts';
import type { BotFilesView } from '../../shared/bot-files';
import { errorText } from '../ui/controls';

const api = window.workbench.bot;
export function BotFilesPanel({ botId, back, onReference }: { botId: string; back(): void; onReference?(ref: BotResourceRef): void }) {
  const [data, setData] = useState<BotFilesView>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let live = true;
    void api.getFiles(botId).then(value => { if (live) { setData(value); setError(''); } }, cause => { if (live) setError(errorText(cause)); });
    return () => { live = false; };
  }, [botId, reload]);
  const run = async (job: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await job(); setReload(value => value + 1); } catch (cause) { setError(errorText(cause)); }
    finally { setBusy(false); }
  };
  return <section className="bot-files-panel" aria-label="文件">
    <header className="bot-profile-section-heading"><button type="button" className="bot-text-button" onClick={back}><ArrowLeft size={15} />返回 Bot 资料</button><h3>文件</h3></header>
    {error && <p role="alert" className="bot-error">{error}<button type="button" disabled={busy} onClick={() => setReload(value => value + 1)}>重新读取</button></p>}
    {!data && !error && <p role="status" className="bot-help">正在读取文件…</p>}
    {data && <>
      <p className="bot-help">工作说明和记忆在应用内修改，目录中的只读副本自动同步。</p>
      <p className="bot-help" role="status">{data.directory.pending ? data.directory.error || '部分只读副本待同步，应用会自动重试。' : '只读副本已同步'}</p>
      <button type="button" className="bot-button" disabled={busy} onClick={() => void run(() => api.openFiles(botId, 'root'))}><FolderOpen size={16} />打开 Bot 目录</button>
      {(['inputs', 'outputs'] as const).map(folder => <section key={folder} className="bot-files-group">
        <div className="bot-profile-section-heading"><h3>{folder === 'inputs' ? '用户文件' : '生成文件'}</h3>
          <button type="button" className="bot-text-button" disabled={busy} onClick={() => void run(() => api.openFiles(botId, folder))}>打开目录</button></div>
        {folder === 'inputs' && <button type="button" className="bot-button" disabled={busy} onClick={() => void run(() => api.importFiles(botId))}><UploadSimple size={15} />导入文件</button>}
        <p className="bot-help">{folder === 'inputs' ? 'inputs · 保留原件，Bot 只读' : 'outputs · 草稿、加工结果与交付文件'}</p>
        <ul className="bot-files-list">{data.files.filter(file => file.path.startsWith(folder + '/')).map(file => <li key={file.id}>
          <span title={file.path}><strong>{file.name}</strong><small>{file.bytes < 1024 ? file.bytes + ' B' : (file.bytes / 1024).toLocaleString('zh-CN', { maximumFractionDigits: 1 }) + ' KB'}</small></span>
          {onReference && <button type="button" className="ibtn" aria-label={'引用文件 ' + file.name} title="引用到对话" disabled={busy} onClick={() => onReference({ kind: 'file', id: file.id, label: file.name })}><Paperclip size={16} /></button>}
        </li>)}</ul>
        {!data.files.some(file => file.path.startsWith(folder + '/')) && <p className="bot-help">暂无文件</p>}
      </section>)}
    </>}
  </section>;
}
