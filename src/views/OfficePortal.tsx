import { useEffect, useState } from 'react';
import { ArrowClockwise, ArrowSquareOut } from '@phosphor-icons/react';
import type { OfficePortalItem, OfficePortalState } from '../../shared/office-portal';
import { errorText, Modal, Segmented } from '../ui/controls';

const labels = { todo: '待我处理', apply: '我发起的申请' };

export function OfficePortal({ onSettings, onTask }: { onSettings(): void; onTask(id: string): void }) {
  const api = window.workbench.officePortal;
  const [state, setState] = useState<OfficePortalState>();
  const [kind, setKind] = useState<OfficePortalItem['kind']>('todo');
  const [visible, setVisible] = useState(50);
  const [pending, setPending] = useState(''), [error, setError] = useState('');
  const [confirm, setConfirm] = useState<OfficePortalItem>();
  useEffect(() => {
    let mounted = true;
    const read = () => void api.state().then(value => { if (mounted) setState(value); }, cause => { if (mounted) setError(errorText(cause)); });
    read();
    const off = window.workbench.todo.onChanged(read);
    return () => { mounted = false; off(); };
  }, [api]);

  async function run(label: string, action: () => Promise<void>) {
    if (pending) return;
    setPending(label); setError('');
    try { await action(); } catch (cause) { setError(errorText(cause)); }
    finally { setPending(''); }
  }

  const rows = state?.items.filter(item => item.kind === kind) ?? [];
  return <section className="office-brief office-portal" aria-label="W3 门户">
    {!state && !error && <p role="status" className="office-empty">正在读取本机快照…</p>}
    {state?.status === 'unconfigured' ? <div className="office-connect">
      <span>维护 W3 账号后可读取门户待办和申请。</span><button type="button" className="text-button" onClick={onSettings}>打开接入设置</button>
    </div> : state && <>
      <div className="office-links office-portal-actions">
        <Segmented aria-label="W3 门户事项" value={kind} onChange={value => { setKind(value === 'apply' ? 'apply' : 'todo'); setVisible(50); }}
          options={[{ value: 'todo', label: labels.todo }, { value: 'apply', label: labels.apply }]} />
        <button type="button" className="btn btn-sec btn-sm" disabled={!!pending} onClick={() => void run('正在读取门户', async () => setState(await api.refresh()))}>
          <ArrowClockwise size={15} />刷新门户
        </button>
        <button type="button" className="text-button" disabled={!!pending} onClick={() => void run('正在打开门户', () => api.open())}>
          <ArrowSquareOut size={15} />{state.status === 'login' || state.status === 'idle' ? '打开门户登录' : '打开门户'}
        </button>
      </div>
      <p role="status" className="office-byline">{[
        state.message || (state.status === 'idle' ? '登录门户后，点击「刷新门户」读取。' : ''),
        state.readAt !== undefined && `最近读取 ${new Date(state.readAt).toLocaleString('zh-CN', { hour12: false })}`,
      ].filter(Boolean).join(' · ')}</p>
      {rows.slice(0, visible).map(item => <article className="office-brief-card" key={item.id}>
        <div className="office-byline">{[item.system, item.time, item.cached && '沿用上次记录'].filter(Boolean).join(' · ')}</div>
        <h4>{item.title}</h4>
        {(item.progress || item.person) && <p>{[item.progress, item.person && (item.kind === 'todo' ? '发起人 ' : '当前处理人 ') + item.person].filter(Boolean).join(' · ')}</p>}
        <div className="office-links">
          {item.url && <button type="button" className="text-button" disabled={!!pending} onClick={() => void run('正在打开原单', () => api.open(item.id))}><ArrowSquareOut size={15} />查看原单</button>}
          {item.taskId ? <button type="button" className="text-button" onClick={() => onTask(item.taskId!)}>查看关联待办</button>
            : <button type="button" className="text-button" disabled={!!pending} onClick={() => { setError(''); setConfirm(item); }}>转待办</button>}
        </div>
      </article>)}
      {rows.length > visible && <button type="button" className="text-button" onClick={() => setVisible(visible + 50)}>显示更多事项</button>}
      {state.status === 'ready' && !rows.length && <p className="office-empty">{kind === 'todo' ? '暂无待处理的门户事项。' : '门户未返回申请。'}</p>}
    </>}
    {!confirm && (error || pending) && <p className={error ? 'office-notice is-error' : 'office-notice'} role={error ? 'alert' : 'status'}>{error || pending + '…'}</p>}
    {confirm && <Modal title="添加到本地待办" close={() => setConfirm(undefined)} busy={!!pending} className="office-todo-confirm">
      <p>{confirm.title}</p>
      {error && <p role="alert" className="office-notice is-error">{error}</p>}
      <div className="office-links">
        <button type="button" className="btn btn-sec btn-sm" disabled={!!pending} onClick={() => setConfirm(undefined)}>取消</button>
        <button type="button" className="btn btn-pri btn-sm" disabled={!!pending} onClick={() => void run('正在创建待办', async () => {
          const id = await api.createTodo(confirm.id);
          setState(current => current && { ...current, items: current.items.map(item => item.id === confirm.id ? { ...item, taskId: id } : item) });
          setConfirm(undefined);
        })}>{pending ? '正在创建…' : '确认创建'}</button>
      </div>
    </Modal>}
  </section>;
}
