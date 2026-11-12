import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise } from '@phosphor-icons/react';
import type { NewApiAccount } from '../../shared/island-contracts';
import { formatQuota } from '../../shared/island-quota';
import { localDay } from '../../shared/todo-contracts';
import { errorText, IconButton } from '../ui/controls';

const api = window.workbench.island;

export function HomeQuotaCard({ clock }: { clock: Date }) {
  const [accounts, setAccounts] = useState<NewApiAccount[] | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const alive = useRef(false), revision = useRef(0), refreshPending = useRef(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh && refreshPending.current) return;
    if (refresh) { refreshPending.current = true; setRefreshing(true); }
    const current = ++revision.current;
    try {
      const next = await (refresh ? api.quotaRefresh() : api.quotas());
      if (alive.current && current === revision.current) { setAccounts(next); setError(''); }
    } catch (cause) {
      if (alive.current && current === revision.current) setError(errorText(cause));
    } finally {
      if (refresh) { refreshPending.current = false; if (alive.current) setRefreshing(false); }
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    const read = () => { void load(); };
    const off = api.onChanged(read);
    read();
    window.addEventListener('focus', read);
    return () => { alive.current = false; off(); window.removeEventListener('focus', read); };
  }, [load]);

  const openConnections = () => {
    void api.navigate({ view: 'settings-island', section: 'quota' }).catch(cause => {
      if (alive.current) setError(errorText(cause));
    });
  };

  return <section className="panel glass home-quota" aria-labelledby="home-quota-title" aria-busy={refreshing}>
    <div className="phead home-quota-heading">
      <h2 className="ptitle" id="home-quota-title">AI 额度消耗</h2>
      <div className="home-quota-actions">
        <IconButton label="刷新 AI 额度" disabled={refreshing || (accounts === null && !error)} onClick={() => void load(true)}><ArrowClockwise size={16} />刷新额度</IconButton>
      </div>
    </div>
    {accounts && accounts.length > 0 && <p className="home-quota-caption">New API · 今日 Token 用量</p>}
    {accounts === null && !error && <p className="home-quota-empty" role="status">正在读取额度消耗…</p>}
    {accounts?.length === 0 && <div className="home-quota-empty"><p>尚未连接 New API 账号，连接后可查看今日消耗。</p><button type="button" className="set-btn" onClick={openConnections}>去连接</button></div>}
    {accounts && accounts.length > 0 && <ul className="home-quota-accounts">
      {accounts.map(account => {
        const hasToday = Boolean(account.hasData && account.updatedAt && localDay(new Date(account.updatedAt)) === localDay(clock) && account.status !== 'disconnected');
        const cached = Boolean(error || account.message || account.status === 'error' || (account.updatedAt && clock.getTime() - account.updatedAt > 600000));
        const status = account.status === 'connecting' ? '正在更新' : hasToday ? (cached ? '缓存数据' : '今日消耗') : account.status === 'error' ? '读取失败' : '暂无今日数据';
        return <li key={account.id} className="home-quota-account" data-stale={cached || undefined}>
          <div className="home-quota-copy">
            <b>{account.label}</b>
            <span>{status}{account.updatedAt ? ` · ${new Date(account.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新` : ''}</span>
            {account.message && <small role="status">{account.message}</small>}
          </div>
          <div className="home-quota-amount" aria-label={hasToday ? `今日消耗 ${account.todayQuota.toLocaleString('en-US')} Tokens` : '暂无今日用量'}>
            <strong title={hasToday ? `${account.todayQuota.toLocaleString('en-US')} Tokens` : undefined}>{hasToday ? formatQuota(account.todayQuota) : '—'}</strong>
            <span>Tokens</span>
          </div>
        </li>;
      })}
    </ul>}
    {error && <p className="error home-quota-error" role="alert">读取失败：{error}</p>}
  </section>;
}
