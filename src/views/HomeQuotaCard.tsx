import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowRight } from '@phosphor-icons/react';
import type { NewApiAccount } from '../../shared/island-contracts';
import { formatQuota } from '../../shared/island-quota';
import { dashboardQuotaEntry } from '../../shared/dashboard-summary';
import { errorText, IconButton } from '../ui/controls';

const api = window.workbench.island;

export function useHomeQuota() {
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
    void api.navigate({ view: 'settings-agents', section: 'quota' }).catch(cause => {
      if (alive.current) setError(errorText(cause));
    });
  };

  return { accounts, error, refreshing, refresh: () => { void load(true); }, openConnections };
}

export function HomeQuotaContent({ clock, accounts, error, refreshing, refresh, openConnections }: { clock: Date } & ReturnType<typeof useHomeQuota>) {
  return <div className="home-quota dashboard-quotas" aria-busy={refreshing}>
    {accounts && accounts.length > 0 && <p className="home-quota-caption">New API · 今日 Token 用量</p>}
    {accounts === null && !error && <p className="home-quota-empty" role="status">正在读取额度消耗…</p>}
    {accounts?.length === 0 && <div className="home-quota-empty"><p>尚未连接 New API 账号，连接后可查看今日消耗。</p></div>}
    {accounts && accounts.length > 0 && <ul className="home-quota-accounts">
      {accounts.map(account => {
        const { todayTokens, cached, statusLabel } = dashboardQuotaEntry(account, clock, Boolean(error));
        const tokens = todayTokens?.toLocaleString('en-US');
        return <li key={account.id} className="home-quota-account" data-stale={cached || undefined}>
          <div className="home-quota-copy">
            <b>{account.label}</b>
            <span>{statusLabel}{account.updatedAt ? ` · ${new Date(account.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新` : ''}</span>
            {account.message && <small role="status">{account.message}</small>}
          </div>
          <div className="home-quota-amount" aria-label={tokens === undefined ? '暂无今日用量' : `今日消耗 ${tokens} Tokens`}>
            <strong title={tokens === undefined ? undefined : `${tokens} Tokens`}>{todayTokens === null ? '—' : formatQuota(todayTokens)}</strong>
            <span>Tokens</span>
          </div>
        </li>;
      })}
    </ul>}
    {error && <p className="error home-quota-error" role="alert">读取失败：{error}</p>}
    <footer><span>{accounts === null ? error ? '未读取账号信息' : '正在读取账号…' : accounts.length ? `${accounts.length} 个账号已接入` : '账号未连接'}</span><div className="home-quota-actions">
      <IconButton label="刷新 AI 额度" disabled={refreshing || (accounts === null && !error)} onClick={refresh}><ArrowClockwise size={16} />刷新额度</IconButton>
      <button type="button" className="dashboard-link" onClick={openConnections}>{accounts?.length ? '管理账号' : '去连接'}<ArrowRight size={15} /></button>
    </div></footer>
  </div>;
}

export function HomeQuotaCard({ clock }: { clock: Date }) {
  return <HomeQuotaContent clock={clock} {...useHomeQuota()} />;
}
