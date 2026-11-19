import { useEffect, useId, useRef, useState } from 'react';
import { ArrowClockwise, ArrowSquareOut, CaretDown, CaretRight, Code, Eye, EyeSlash, HardDrives, Plugs, Plus } from '@phosphor-icons/react';
import { agentProjectKey, type AgentConnectResult, type DiscoveredProject } from '../../shared/agent-message-contracts';
import type { NewApiAccount } from '../../shared/island-contracts';
import { errorText, IconButton, Modal, Segmented } from '../ui/controls';
import { GameOptionsMenu } from './GameOptionsMenu';
import { useIslandState } from './island-state';

const quotaStatuses = { disconnected: '未连接', connecting: '连接中', ready: '已连接', error: '连接异常', stale: '刷新失败' } as const;
const quotaCheckTime = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const DEFAULT_BASE = 'http://aiserver.hisi.huawei.com';

export function AgentConnectionSettings({ query, resetSearch }: { query: string; resetSearch?(): void }) {
  const { state, error, setError } = useIslandState();
  const [connectionSource, setConnectionSource] = useState('new-api');
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [accounts, setAccounts] = useState<NewApiAccount[]>([]), [quotaLoading, setQuotaLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null), [showForm, setShowForm] = useState(false);
  const [expandedAccountId, setExpandedAccountId] = useState<string | null>(null);
  const [label, setLabel] = useState(''), [baseUrl, setBaseUrl] = useState(DEFAULT_BASE), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [showPwd, setShowPwd] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredProject[] | null>(null), [enabled, setEnabled] = useState<string[]>([]), [connectError, setConnectError] = useState<Record<string, string>>({});
  const [manualPath, setManualPath] = useState('');
  const [manualOpen, setManualOpen] = useState(false), [manualError, setManualError] = useState('');
  const [addError, setAddError] = useState('');
  const addNameInput = useRef<HTMLInputElement>(null);
  const manualInput = useRef<HTMLInputElement>(null);
  const manualComplete = useRef(false);
  const tabBar = useRef<HTMLDivElement>(null), fieldId = useId();
  const [reveal, setReveal] = useState(false);
  const term = query.trim();
  const showQuotaCard = Boolean(term) || connectionSource === 'new-api';
  const addingAccount = showForm && editingId === null;
  const canAdd = Boolean(label.trim() && baseUrl.trim() && username.trim() && password);
  const api = window.workbench.island;
  const run = async (action: () => Promise<unknown>, reportError = setError) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { reportError(errorText(e)); } finally { busyRef.current = false; setBusy(false); }
  };
  useEffect(() => {
    const showSection = (section: unknown) => {
      if (section !== 'quota' && section !== 'agents') return;
      setConnectionSource(section === 'agents' ? 'codeai' : 'new-api');
      setReveal(true);
      resetSearch?.();
      sessionStorage.removeItem('island-settings-section');
    };
    showSection(sessionStorage.getItem('island-settings-section'));
    const listener = (event: Event) => showSection((event as CustomEvent).detail);
    window.addEventListener('island-settings-section', listener);
    return () => window.removeEventListener('island-settings-section', listener);
  }, [resetSearch]);
  const refreshAgents = () => { void api.agentProjects().then(value => { setDiscovered(value.discovered); setEnabled(value.enabled); }).catch(e => { setDiscovered([]); setError(errorText(e)); }); };
  useEffect(refreshAgents, []);
  useEffect(() => {
    let alive = true;
    void api.quotas().then(value => { if (alive) setAccounts(value); }).catch(e => { if (alive) setError(errorText(e)); }).finally(() => { if (alive) setQuotaLoading(false); });
    return () => { alive = false; };
  }, [state]);
  useEffect(() => {
    if (!reveal || !tabBar.current) return;
    tabBar.current.scrollIntoView({ block: 'nearest' });
    setReveal(false);
  }, [reveal, term]);
  useEffect(() => setShowPwd(false), [connectionSource, query, editingId, showForm]);
  useEffect(() => {
    if (addingAccount && showQuotaCard) addNameInput.current?.focus();
  }, [addingAccount, showQuotaCard]);
  useEffect(() => {
    if (!manualOpen || busy) return;
    // Clear the busy state before closing so Modal can restore focus to the enabled trigger.
    if (manualComplete.current) { manualComplete.current = false; setManualOpen(false); setManualPath(''); }
    else manualInput.current?.focus();
  }, [manualOpen, busy]);

  const enabledKeys = new Set(enabled.map(agentProjectKey));
  const projects = discovered && [...discovered, ...[...new Map([...enabled, ...Object.keys(connectError)].map(path => [agentProjectKey(path), path])).values()]
    .filter(path => !discovered.some(project => agentProjectKey(project.cwd) === agentProjectKey(path)))
    .map(path => ({ dir: path, cwd: path, lastActive: 0, sessionCount: 0, source: 'manual' as const, available: enabledKeys.has(agentProjectKey(path)) }))];
  const currentProjects = projects?.filter(project => project.source !== 'history' || enabledKeys.has(agentProjectKey(project.cwd))) ?? [];
  const historicalProjects = projects?.filter(project => project.source === 'history' && !enabledKeys.has(agentProjectKey(project.cwd))) ?? [];
  const tabs = !term && <div className="settings-agent-tabs" ref={tabBar}>
    <Segmented variant="content" aria-label="Agent连接分区" value={connectionSource} options={[
      { value: 'new-api', label: 'New API 连接', icon: <HardDrives size={16} aria-hidden="true" /> },
      { value: 'codeai', label: 'CodeAI 连接', icon: <Code size={16} aria-hidden="true" /> },
    ]} onChange={setConnectionSource} />
  </div>;
  if (!state) return <>{tabs}<p role={error ? 'alert' : 'status'}>{error || '正在读取连接设置…'}</p></>;
  const showAgentsCard = Boolean(term) || connectionSource === 'codeai';
  const lastActiveText = (ts: number) => !ts ? '无会话' : Date.now() - ts < 86400000 ? `${Math.floor((Date.now() - ts) / 3600000)} 小时前` : new Date(ts).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  const toggleProject = async (path: string, on: boolean) => {
    const next: AgentConnectResult = await api.agentConnect(on ? [...new Set([...enabled, path])] : enabled.filter(p => agentProjectKey(p) !== agentProjectKey(path)));
    setEnabled(next.enabled);
    const errMap: Record<string, string> = {};
    for (const fail of next.failed) errMap[fail.path] = fail.error;
    setConnectError(errMap);
    void api.agentProjects().then(v => { setDiscovered(v.discovered); setEnabled(v.enabled); }).catch(e => setError(errorText(e)));
    return next;
  };
  const addManual = () => {
    const path = manualPath.trim(); if (!path) return;
    setManualError('');
    void run(async () => {
      try {
        const next = await toggleProject(path, true);
        const failure = next.failed.find(item => agentProjectKey(item.path) === agentProjectKey(path));
        if (failure) setManualError(failure.error);
        else manualComplete.current = true;
      } catch (cause) { setManualError(errorText(cause)); }
    });
  };
  const projectRow = (project: DiscoveredProject) => {
    const key = project.cwd || project.dir, on = enabledKeys.has(agentProjectKey(key));
    const name = key.split(/[\\/]/).filter(Boolean).pop() || key;
    const failure = Object.entries(connectError).find(([path]) => agentProjectKey(path) === agentProjectKey(key))?.[1];
    const source = project.source === 'manual' ? '手动添加' : '自动扫描';
    return <div className="island-agent-project" key={project.dir} data-enabled={on}>
      <div className="island-agent-project-copy">
        <div className="island-agent-project-title"><b title={key}>{name}</b><small data-source={project.source === 'manual' ? 'manual' : 'scan'}>{source}</small></div>
        <small className="island-agent-project-path" title={project.cwd || '路径未知'}>{project.cwd || '路径未知，需手动填'}</small>
        {project.problem && project.cwd && !failure && <small className="island-muted">{project.problem}</small>}
        {failure && <small className="island-agent-project-error" role="alert">{failure}</small>}
      </div>
      <span className="island-agent-project-meta">{project.sessionCount ? `${project.sessionCount} 个会话 · ` : ''}{project.lastActive ? `${project.source === 'recent' ? '最近打开 ' : ''}${lastActiveText(project.lastActive)}` : '尚无会话'}</span>
      <button type="button" className="toggle" role="switch" aria-label={`监听 ${key}`} aria-checked={on} disabled={busy || !project.cwd || !project.available && !on} onClick={() => project.cwd && void run(() => toggleProject(project.cwd, !on))} />
    </div>;
  };
  const startAdd = () => { setEditingId(null); setLabel(''); setBaseUrl(DEFAULT_BASE); setUsername(''); setPassword(''); setAddError(''); setShowForm(true); };
  const startEdit = (account: NewApiAccount) => {
    setEditingId(account.id); setExpandedAccountId(account.id); setLabel(account.label); setBaseUrl(account.baseUrl); setUsername(account.account); setPassword(''); setShowForm(true);
  };
  const cancelForm = () => { setShowForm(false); setEditingId(null); setPassword(''); };
  const submit = () => {
    if (busy || (addingAccount && !canAdd)) return;
    if (addingAccount) setAddError('');
    void run(async () => {
      const next = editingId ? await api.quotaUpdate(editingId, label, baseUrl, username, password) : await api.quotaConnect(label, baseUrl, username, password);
      setAccounts(next);
      const saved = editingId ? next.find(account => account.id === editingId) : next.at(-1);
      if (saved) setExpandedAccountId(saved.id);
      cancelForm();
    }, addingAccount ? setAddError : setError);
  };
  const remove = (id: string) => {
    void run(async () => {
      setAccounts(await api.quotaRemove(id));
      setExpandedAccountId(current => current === id ? null : current);
      if (editingId === id) cancelForm();
    });
  };

  return <>
    {tabs}
    <div className="island-settings">
      {error && <p className="island-settings-error" role="alert">{error}</p>}
      {term && <p className="island-settings-search-result" role="status">找到 2 项相关设置</p>}
      <div className="set-rows island-ai-connections">
        {showQuotaCard && <section className="island-connection-manager" aria-labelledby={`${fieldId}-connections`}>
          <header>
            <div className="island-quota-heading">
              <h2 id={`${fieldId}-connections`}>New API 连接</h2>
              <small>仅用于额度查询</small>
              {quotaLoading && <small role="status">读取中</small>}
            </div>
            <div className="island-agent-actions">
              <button type="button" className="island-settings-link" disabled={busy} onClick={() => void run(async () => setAccounts(await api.quotaRefresh()))}><ArrowClockwise size={15} />刷新额度</button>
              <button type="button" className="set-btn island-settings-primary" disabled={Boolean(editingId) || (busy && !addingAccount)} onClick={startAdd}><Plus size={15} aria-hidden="true" />添加账号</button>
            </div>
          </header>
          {accounts.length > 0 && <div className="island-quota-table" role="table" aria-label="额度账号">
            <div className="island-quota-row island-quota-columns" role="row">
              <span role="columnheader">账号</span>
              <span role="columnheader">连接状态</span>
              <span role="columnheader">最近检查</span>
              <span role="columnheader">操作</span>
            </div>
            {accounts.map(account => {
              const editing = editingId === account.id;
              const expanded = editing || expandedAccountId === account.id;
              const detailId = `${fieldId}-quota-${account.id}`;
              const status = account.status === 'ready' && account.message ? 'stale' : account.status;
              const checkedAt = account.checkedAt ?? (status === 'stale' ? null : account.updatedAt);
              const failed = status === 'error' || status === 'stale';
              const feedback = status === 'stale' ? '额度刷新失败，保留上次读数' : '额度服务请求失败';
              return <div key={account.id} className="island-quota-account" role="rowgroup">
                <div className="island-quota-row" role="row">
                  <div role="rowheader">
                    <button type="button" className="island-quota-toggle" aria-expanded={expanded} aria-controls={expanded ? detailId : undefined} disabled={editing}
                      onClick={() => setExpandedAccountId(current => current === account.id ? null : account.id)}>
                      {expanded ? <CaretDown size={14} aria-hidden="true" /> : <CaretRight size={14} aria-hidden="true" />}
                      <span title={account.label}>{account.label}</span>
                    </button>
                  </div>
                  <div role="cell"><span className="island-provider-status" data-status={status}>{quotaStatuses[status]}</span></div>
                  <div className="island-quota-time" role="cell">
                    <span className="island-quota-time-label" aria-hidden="true">最近检查</span>
                    {checkedAt === null ? '—' : <time dateTime={new Date(checkedAt).toISOString()}>{quotaCheckTime.format(checkedAt)}</time>}
                  </div>
                  <div className="island-quota-actions" role="cell">
                    <button type="button" className="island-settings-link" aria-label={`编辑 ${account.label}`} disabled={busy || editingId !== null} onClick={() => startEdit(account)}>编辑</button>
                    <button type="button" className="island-settings-link island-quota-console" aria-label={`打开 ${account.label} 控制台`} disabled={busy} onClick={() => void run(() => api.quotaOfficial(account.id))}><ArrowSquareOut size={14} aria-hidden="true" />控制台</button>
                    <div className="island-provider-menu"><GameOptionsMenu kind="project" active={showQuotaCard} context={`${expanded}:${editing}:${status}`} label={`${account.label} 更多操作`} disabled={busy}>{close =>
                      <button type="button" role="menuitem" className="danger" aria-label={`删除 ${account.label}`} onClick={() => { close(); remove(account.id); }}><Plugs size={16} aria-hidden="true" />删除账号</button>
                    }</GameOptionsMenu></div>
                  </div>
                </div>
                {expanded && <div className="island-quota-details" role="row" id={detailId}>
                  <div className="island-quota-detail-body" role="cell" aria-colspan={4}>
                    {failed && (account.message ? <details className="island-quota-feedback">
                      <summary><span>{feedback}</span><span>技术详情</span></summary>
                      <p>{account.message}</p>
                    </details> : <p className="island-quota-feedback">{feedback}</p>)}
                    {editing ? <form className="island-key-editor" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
                      <h4>编辑账号{<button type="button" className="island-settings-link" disabled={busy} onClick={cancelForm}>取消</button>}</h4>
                      <div className="island-key-field"><label htmlFor={`${fieldId}-label`}>名称</label><div><input autoFocus id={`${fieldId}-label`} type="text" autoComplete="off" spellCheck={false} maxLength={40} disabled={busy} value={label} onChange={event => setLabel(event.target.value)} placeholder="如：主力账号" /></div></div>
                      <div className="island-key-field"><label htmlFor={`${fieldId}-base`}>New API 地址</label><div><input id={`${fieldId}-base`} type="text" autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="http://aiserver.hisi.huawei.com" /></div></div>
                      <div className="island-key-field"><label htmlFor={`${fieldId}-user`}>用户名</label><div><input id={`${fieldId}-user`} type="text" autoComplete="off" spellCheck={false} maxLength={100} disabled={busy} value={username} onChange={event => setUsername(event.target.value)} placeholder="New API 登录用户名" /></div></div>
                      <div className="island-key-field"><label htmlFor={`${fieldId}-pwd`}>密码（留空不改）</label><div><input id={`${fieldId}-pwd`} type={showPwd ? 'text' : 'password'} autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} placeholder="New API 登录密码" /><IconButton label={showPwd ? '隐藏密码' : '显示密码'} disabled={busy} onClick={() => setShowPwd(!showPwd)}>{showPwd ? <EyeSlash size={18} /> : <Eye size={18} />}</IconButton></div><small>本机加密保存，仅用于查询额度消耗</small></div>
                      <div className="island-provider-actions"><button type="submit" className="set-btn island-settings-primary" disabled={busy || !label.trim() || !baseUrl.trim() || !username.trim()}>{busy ? '处理中…' : '保存'}</button></div>
                    </form> : (!failed || account.account !== account.label) &&
                      <p className="island-quota-username">登录用户名 <strong>{account.account || '—'}</strong></p>}
                  </div>
                </div>}
              </div>;
            })}
          </div>}
          {addingAccount && <Modal title="添加账号" className="ai-config-dialog ai-provider-add-dialog" dirty={Boolean(label || baseUrl !== DEFAULT_BASE || username || password)} busy={busy} close={cancelForm}>
            <form noValidate aria-busy={busy || undefined} onSubmit={event => { event.preventDefault(); submit(); }} onKeyDown={event => { if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault(); }}>
              <div className="ai-config-fields">
                <div className="ai-config-field">
                  <label htmlFor={`${fieldId}-label`}>名称</label>
                  <input ref={addNameInput} id={`${fieldId}-label`} value={label} maxLength={40} autoComplete="off" spellCheck={false} disabled={busy} placeholder="如：主力账号" onChange={event => setLabel(event.target.value)} />
                </div>
                <div className="ai-config-field">
                  <label htmlFor={`${fieldId}-user`}>用户名</label>
                  <input id={`${fieldId}-user`} value={username} maxLength={100} autoComplete="off" spellCheck={false} disabled={busy} placeholder="New API 登录用户名" onChange={event => setUsername(event.target.value)} />
                </div>
                <div className="ai-config-field full">
                  <label htmlFor={`${fieldId}-base`}>New API 地址</label>
                  <input id={`${fieldId}-base`} type="url" value={baseUrl} maxLength={200} autoComplete="off" spellCheck={false} disabled={busy} placeholder="http://aiserver.hisi.huawei.com" onChange={event => setBaseUrl(event.target.value)} />
                </div>
                <div className="ai-config-field full">
                  <label htmlFor={`${fieldId}-pwd`}>密码</label>
                  <div className="ai-config-secret">
                    <input id={`${fieldId}-pwd`} type={showPwd ? 'text' : 'password'} value={password} maxLength={200} autoComplete="new-password" spellCheck={false} disabled={busy} placeholder="New API 登录密码" onChange={event => setPassword(event.target.value)} />
                    <IconButton label={showPwd ? '隐藏密码' : '显示密码'} aria-pressed={showPwd} disabled={busy || !password} onClick={() => setShowPwd(!showPwd)}>{showPwd ? <EyeSlash size={18} /> : <Eye size={18} />}</IconButton>
                  </div>
                  <small className="field-help">本机加密保存，仅用于查询额度消耗</small>
                </div>
              </div>
              <div className="ai-config-feedback" role="alert">{addError}</div>
              <footer className="ai-config-footer"><button className="ai-config-button primary" type="submit" disabled={busy || !canAdd}>{busy ? '保存中…' : '保存账号'}</button></footer>
            </form>
          </Modal>}
        </section>}
        {showAgentsCard && <section className="island-setting-card island-card-wide island-agent-settings" aria-labelledby={`${fieldId}-agents`}>
          <header><div><h2 id={`${fieldId}-agents`}>CodeAI 消息提醒</h2></div><div className="island-agent-actions"><button type="button" className="island-settings-link" disabled={busy || !discovered} onClick={() => { setDiscovered(null); refreshAgents(); }}><ArrowClockwise size={15} />重新扫描</button><button type="button" className="set-btn island-settings-primary" disabled={busy} onClick={() => { setManualError(''); setManualOpen(true); }}><Plus size={15} />手动添加</button></div></header>
          <div className="island-agent-project-list">
            {projects === null ? <p className="island-muted" role="status">正在扫描 CodeAI 项目…</p>
              : !currentProjects.length ? <p className="island-muted">暂无 CodeAI 最近项目，可重新扫描或点击“手动添加”。</p>
              : currentProjects.map(projectRow)}
          </div>
          {!!historicalProjects.length && <details className="island-agent-history"><summary>历史会话（{historicalProjects.length}）</summary><div className="island-agent-project-list">{historicalProjects.map(projectRow)}</div></details>}
        </section>}
      </div>
      {manualOpen && <Modal title="手动添加项目" className="island-agent-manual-dialog" busy={busy} close={() => setManualOpen(false)}>
        <form className="form-body" noValidate aria-busy={busy} onSubmit={event => { event.preventDefault(); addManual(); }} onKeyDown={event => { if (event.key === 'Enter' && (event.nativeEvent.isComposing || event.keyCode === 229)) event.preventDefault(); }}>
          <p className="field-help" id={`${fieldId}-manual-help`}>填写本机项目文件夹的绝对路径，添加后开启该项目的消息提醒。</p>
          <label htmlFor={`${fieldId}-manual-path`}>项目路径</label>
          <input ref={manualInput} id={`${fieldId}-manual-path`} type="text" aria-label="手动添加项目路径" spellCheck={false} autoComplete="off" maxLength={4096} disabled={busy} value={manualPath} aria-invalid={Boolean(manualError)} aria-describedby={`${fieldId}-manual-help${manualError ? ` ${fieldId}-manual-error` : ''}`} onChange={event => { setManualPath(event.target.value); setManualError(''); }} placeholder="如 D:\Projects\MyProject" />
          {manualError && <p className="error" id={`${fieldId}-manual-error`} role="alert">{manualError}</p>}
          <div className="actions"><button type="button" className="btn btn-sec" disabled={busy} onClick={() => setManualOpen(false)}>取消</button><button type="submit" className="btn primary" disabled={busy || !manualPath.trim()}>{busy ? '添加中…' : '添加'}</button></div>
        </form>
      </Modal>}
    </div>
  </>;
}
