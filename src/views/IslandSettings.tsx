import { useEffect, useId, useRef, useState } from 'react';
import { ArrowClockwise, ArrowSquareOut, CalendarBlank, Code, Eye, EyeSlash, Folder, HardDrives, Monitor, Plugs, Plus, Sparkle, SquaresFour } from '@phosphor-icons/react';
import { ISLAND_DOCKS, ISLAND_DOCK_LABELS, ISLAND_LABELS, ISLAND_PAGES, type IslandDock, type IslandSettingsPatch, type NewApiAccount } from '../../shared/island-contracts';
import { agentProjectKey, type AgentConnectResult, type DiscoveredProject } from '../../shared/agent-message-contracts';
import { errorText, IconButton, Modal, Segmented, Select, TimePicker } from '../ui/controls';
import { Rows, type RowSpec } from './SettingsView';
import { useIslandState } from './island-state';
import { GameOptionsMenu } from './GameOptionsMenu';


const sections = [
  { value: 'display', label: '显示与交互' },
  { value: 'pages', label: '页面' },
  { value: 'reminders', label: '提醒' },
  { value: 'quota', label: 'AI 连接' },
  { value: 'tools', label: '小工具' },
] as const;
type Section = typeof sections[number]['value'];
const pageIcons = { schedule: CalendarBlank, files: Folder, quota: Sparkle, tools: SquaresFour };
const pageDescriptions = { schedule: '月历、日程与待办', files: '文件与文件夹引用', quota: 'New API 消耗统计', tools: '专注、喝水与圆环伙伴' };
const quotaStatuses = { disconnected: '未连接', connecting: '连接中', ready: '已连接', error: '连接异常' } as const;
const DEFAULT_BASE = 'http://aiserver.hisi.huawei.com';

function NumberSetting({ label, value, min, max, unit, disabled, save }: {
  label: string; value: number; min: number; max: number; unit: string; disabled: boolean; save(value: number): void;
}) {
  const [draft, setDraft] = useState(String(value));
  const errorId = useId();
  useEffect(() => setDraft(String(value)), [value]);
  const valid = draft !== '' && Number.isInteger(Number(draft)) && Number(draft) >= min && Number(draft) <= max;
  return <label className="island-setting-number">
    <span className="island-number-input"><input type="number" aria-label={label} min={min} max={max} disabled={disabled} value={draft} aria-invalid={!valid} aria-describedby={!valid ? errorId : undefined} onChange={e => setDraft(e.target.value)} onBlur={() => { if (valid && Number(draft) !== value) { save(Number(draft)); setDraft(String(value)); } }} /><span>{unit}</span></span>
    {!valid && <small id={errorId} role="alert">请输入 {min}–{max} 的整数</small>}
  </label>;
}

export function IslandSettingsSection({ query, resetSearch }: { query: string; resetSearch(): void }) {
  const { state, setState, error, setError } = useIslandState();
  const [active, setActive] = useState<Section>('display');
  const [connectionSource, setConnectionSource] = useState<'new-api' | 'codeai'>('new-api');
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [displays, setDisplays] = useState<{ id: number; label: string }[] | null>(null);
  const [accounts, setAccounts] = useState<NewApiAccount[]>([]), [quotaLoading, setQuotaLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null), [showForm, setShowForm] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [label, setLabel] = useState(''), [baseUrl, setBaseUrl] = useState(DEFAULT_BASE), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [showPwd, setShowPwd] = useState(false);
  const [clear, setClear] = useState(false);
  const [discovered, setDiscovered] = useState<DiscoveredProject[] | null>(null), [enabled, setEnabled] = useState<string[]>([]), [connectError, setConnectError] = useState<Record<string, string>>({});
  const [manualPath, setManualPath] = useState('');
  const [manualOpen, setManualOpen] = useState(false), [manualError, setManualError] = useState('');
  const manualInput = useRef<HTMLInputElement>(null);
  const manualComplete = useRef(false);
  const quotaGroup = useRef<HTMLDivElement>(null), revealQuota = useRef(false), agentsGroup = useRef<HTMLDivElement>(null), revealAgents = useRef(false), fieldId = useId();
  const api = window.workbench.island;
  const run = async (action: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(errorText(e)); } finally { busyRef.current = false; setBusy(false); }
  };
  const patch = (value: IslandSettingsPatch) => { void run(async () => { setState(await api.patch(value)); }); };
  useEffect(() => {
    let alive = true, version = 0;
    const load = () => {
      const request = ++version;
      void api.displays().then(value => { if (alive && request === version) setDisplays(value); }).catch(e => { if (alive && request === version) { setDisplays([]); setError(errorText(e)); } });
    };
    load(); const off = api.onChanged(load);
    window.addEventListener('focus', load);
    return () => { alive = false; off(); window.removeEventListener('focus', load); };
  }, []);
  useEffect(() => {
    const showQuota = () => { revealQuota.current = true; setActive('quota'); setConnectionSource('new-api'); resetSearch(); sessionStorage.removeItem('island-settings-section'); };
    const showAgents = () => { revealAgents.current = true; setActive('quota'); setConnectionSource('codeai'); resetSearch(); sessionStorage.removeItem('island-settings-section'); };
    const initialSection = sessionStorage.getItem('island-settings-section');
    if (initialSection === 'quota') showQuota(); else if (initialSection === 'agents') showAgents();
    const listener = (event: Event) => { const detail = (event as CustomEvent).detail; if (detail === 'quota') showQuota(); else if (detail === 'agents') showAgents(); };
    window.addEventListener('island-settings-section', listener);
    return () => window.removeEventListener('island-settings-section', listener);
  }, [resetSearch]);
  const refreshAgents = () => { void api.agentProjects().then(value => { setDiscovered(value.discovered); setEnabled(value.enabled); }).catch(e => { setDiscovered([]); setError(errorText(e)); }); };
  useEffect(refreshAgents, []);
  useEffect(() => {
    let alive = true;
    void api.quotas().then(value => { if (alive) setAccounts(value); }).catch(e => { if (alive) setError(errorText(e)); }).finally(() => { if (alive) setQuotaLoading(false); });
    if (state && active === 'quota' && revealQuota.current && quotaGroup.current) {
      quotaGroup.current.scrollIntoView({ block: 'nearest' }); revealQuota.current = false;
    }
    if (state && revealAgents.current && agentsGroup.current) {
      agentsGroup.current.scrollIntoView({ block: 'nearest' }); revealAgents.current = false;
    }
    return () => { alive = false; };
  }, [state, active]);
  useEffect(() => setShowPwd(false), [active, connectionSource, query, editingId, showForm]);
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
  if (!state) return <p role={error ? 'alert' : 'status'}>{error || '正在读取灵动岛设置…'}</p>;
  const settings = state.settings;
  const selectedDisplay = displays?.find(display => display.id === settings.displayId);
  const missingDisplay = settings.displayId !== null && Boolean(displays?.length) && !selectedDisplay;
  const toggle = (field: keyof IslandSettingsPatch, label: string) => <button type="button" className="toggle" role="switch" aria-checked={Boolean(settings[field as keyof typeof settings])} aria-label={label} disabled={busy} onClick={() => patch({ [field]: !settings[field as keyof typeof settings] })} />;
  const number = (field: 'topOffset' | 'focusMinutes' | 'waterMinutes' | 'sedentaryMinutes', label: string, min: number, max: number, unit: string) => <NumberSetting label={label} value={settings[field]} min={min} max={max} unit={unit} disabled={busy} save={value => patch({ [field]: value })} />;
  const period = (start: 'dndStart' | 'waterStart' | 'sedentaryStart', end: 'dndEnd' | 'waterEnd' | 'sedentaryEnd', label: string) => <fieldset className="island-setting-period" aria-label={label} disabled={busy}>
    <div><label htmlFor={`${fieldId}-${start}`}>开始</label><TimePicker id={`${fieldId}-${start}`} value={settings[start]} onChange={value => patch({ [start]: value })} /></div><span>—</span>
    <div><label htmlFor={`${fieldId}-${end}`}>结束</label><TimePicker id={`${fieldId}-${end}`} value={settings[end]} onChange={value => patch({ [end]: value })} /></div>
  </fieldset>;
  const groups: { id: string; section: Section; title: string; rows: RowSpec[] }[] = [
    { id: 'position', section: 'display', title: '窗口位置', rows: [
      { key: 'display', title: '显示器', desc: missingDisplay ? '已选显示器已断开，暂用主屏' : '在所选工作区边缘居中', control: displays === null ? <span className="island-display-value" role="status">正在读取显示器…</span> : displays.length <= 1 ? <span className="island-display-value" title={displays[0]?.label}>{displays[0]?.label || '未读取到显示器'}</span> : <Select value={selectedDisplay ? String(selectedDisplay.id) : ''} onChange={value => patch({ displayId: value ? Number(value) : null })} aria-label="灵动岛显示器" disabled={busy} options={[{ value: '', label: '自动跟随主屏' }, ...displays.map(d => ({ value: String(d.id), label: d.label }))]} /> },
      { key: 'dock', title: '停靠位置', desc: '顶部向下展开，侧边向屏幕内展开', control: <Select value={settings.dock} onChange={value => patch({ dock: value as IslandDock })} aria-label="停靠位置" disabled={busy} options={ISLAND_DOCKS.map(value => ({ value, label: ISLAND_DOCK_LABELS[value] }))} /> },
      { key: 'offset', title: settings.dock === 'top' ? '顶部间距' : '边缘间距', desc: `相对工作区${ISLAND_DOCK_LABELS[settings.dock]}`, control: number('topOffset', settings.dock === 'top' ? '顶部偏移' : '停靠边缘偏移', 0, 300, 'px') },
    ] },
    { id: 'interaction', section: 'display', title: '展开与外观', rows: [
      { key: 'hover', title: '悬停展开', desc: '停留片刻，直接打开完整面板', control: toggle('hoverPreview', '悬停展开') },
      { key: 'fullscreen', title: '全屏时隐藏', desc: state.fullscreenDetection ? '退出全屏后恢复' : '系统检测暂不可用，可手动隐藏', control: toggle('hideFullscreen', '全屏时隐藏') },
      { key: 'motion', title: '减少动态效果', desc: '即时切换尺寸，伙伴保持静止', control: toggle('reducedMotion', '减少动态效果') },
    ] },
    { id: 'files', section: 'pages', title: '文件暂存', rows: [
      { key: 'retention', title: '退出时清空文件记录', desc: '原文件与文字记录保留', control: toggle('clearFilesOnExit', '退出时清空文件记录') },
      { key: 'clear', title: `${state.files.length} 条暂存记录`, desc: clear ? '确认清空所有引用？原文件不受影响。' : '默认保留，直到手动移除', control: clear ? <div className="island-setting-actions"><button className="set-btn" disabled={busy} onClick={() => void run(async () => { setState(await api.filesRemove()); setClear(false); })}>确认清空记录</button><button className="set-btn" onClick={() => setClear(false)}>取消</button></div> : <button className="set-btn" disabled={!state.files.length || busy} onClick={() => setClear(true)}>清空记录</button> },
    ] },
    { id: 'reminders', section: 'reminders', title: '事项提醒', rows: [
      { key: 'schedule', title: '日程提醒', desc: '按日程已设置的时间提醒', control: toggle('scheduleReminders', '日程提醒') },
      { key: 'todo', title: '待办提醒', desc: '按待办已设置的时间提醒', control: toggle('todoReminders', '灵动岛待办提醒') },
      { key: 'sound', title: '提醒声音', desc: '勿扰期间保持安静', control: toggle('sound', '提醒声音') },
    ] },
    { id: 'quiet', section: 'reminders', title: '勿扰时段', rows: [
      { key: 'dnd', title: '定时勿扰', desc: '不弹开、不播放声音，提醒留待处理', control: toggle('dnd', '勿扰时段') },
      { key: 'dndTime', title: '勿扰时间', desc: '', className: 'island-period-row', control: period('dndStart', 'dndEnd', '勿扰时间') },
    ] },
    { id: 'focus', section: 'tools', title: '专注计时', rows: [
      { key: 'focus', title: '启用专注', desc: '结束时提醒，不自动完成待办', control: toggle('focusEnabled', '专注计时') },
      { key: 'duration', title: '默认时长', desc: '也可在岛内临时调整', control: number('focusMinutes', '默认专注时长', 1, 180, '分钟') },
    ] },
    { id: 'mascot', section: 'tools', title: '圆环伙伴', rows: [
      { key: 'mascot', title: '显示伙伴', desc: '在收起顶栏与小工具页中陪伴', control: toggle('mascotEnabled', '显示圆环伙伴') },
      { key: 'blink', title: '轻微动作', desc: '勿扰或减少动态效果时静止', control: toggle('mascotMotion', '伙伴轻微动作') },
    ] },
    { id: 'water', section: 'tools', title: '喝水提醒', rows: [
      { key: 'water', title: '启用喝水提醒', desc: '只统计主动确认的次数', control: toggle('waterEnabled', '喝水提醒') },
      { key: 'interval', title: '提醒间隔', desc: '休眠后不连续补弹', control: number('waterMinutes', '喝水间隔', 10, 240, '分钟') },
      { key: 'waterTime', title: '提醒时间', desc: '', className: 'island-period-row', control: period('waterStart', 'waterEnd', '喝水时间段') },
    ] },
    { id: 'sedentary', section: 'tools', title: '久坐提醒', rows: [
      { key: 'enabled', title: '启用久坐提醒', desc: '按使用时长提醒，不识别坐姿或离座', control: toggle('sedentaryEnabled', '久坐提醒') },
      { key: 'interval', title: '提醒间隔', desc: '锁屏、睡眠和勿扰时暂停，恢复后重新计时', control: number('sedentaryMinutes', '久坐间隔', 10, 240, '分钟') },
      { key: 'sedentaryTime', title: '提醒时间', desc: '', className: 'island-period-row', control: period('sedentaryStart', 'sedentaryEnd', '久坐时间段') },
    ] },
  ];
  const term = query.trim().toLowerCase().replace(/\s+/g, '');
  const matches = (value: string) => !term || value.toLowerCase().replace(/\s+/g, '').includes(term);
  const selectedGroups = groups.filter(group => term || group.section === active).map(group => ({ ...group, rows: group.rows.filter(row => matches(`${sections.find(s => s.value === group.section)?.label} ${group.title} ${row.title} ${row.desc}`)) })).filter(group => group.rows.length);
  const visiblePages = (term || active === 'pages') ? ISLAND_PAGES.filter(page => matches(`页面 ${ISLAND_LABELS[page]} ${pageDescriptions[page]}`)) : [];
  const showConnections = Boolean(term) || active === 'quota';
  const showQuotaCard = showConnections && (Boolean(term) || connectionSource === 'new-api');
  const showAgentsCard = showConnections && (Boolean(term) || connectionSource === 'codeai');
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
  const startAdd = () => { setEditingId(null); setLabel(''); setBaseUrl(DEFAULT_BASE); setUsername(''); setPassword(''); setShowForm(true); };
  const startEdit = (account: NewApiAccount) => {
    setEditingId(account.id); setSelectedAccountId(account.id); setLabel(account.label); setBaseUrl(account.baseUrl); setUsername(account.account); setPassword(''); setShowForm(true);
  };
  const cancelForm = () => { setShowForm(false); setEditingId(null); };
  const submit = () => {
    if (busy) return;
    void run(async () => {
      const next = editingId ? await api.quotaUpdate(editingId, label, baseUrl, username, password) : await api.quotaConnect(label, baseUrl, username, password);
      setAccounts(next);
      const done = next.find(a => a.id === (editingId ?? next[next.length - 1]?.id));
      if (done && (done.status === 'ready' || done.status === 'error')) { setSelectedAccountId(done.id); cancelForm(); }
    });
  };
  const remove = (id: string) => { void run(async () => { const next = await api.quotaRemove(id); setAccounts(next); if (selectedAccountId === id) setSelectedAccountId(next[0]?.id ?? null); }); };
  const count = (term && matches('显示灵动岛 桌面显示 启用') ? 1 : 0) + selectedGroups.reduce((total, group) => total + group.rows.length, 0) + visiblePages.length + (showQuotaCard ? 1 : 0) + (showAgentsCard ? 1 : 0);
  const toolsEnabled = settings.focusEnabled || settings.waterEnabled || settings.sedentaryEnabled || settings.mascotEnabled;
  const selectedAccount = accounts.find(a => a.id === (selectedAccountId ?? accounts[0]?.id)) ?? null;
  const sourceStatus = quotaLoading ? 'loading' : (['error', 'connecting', 'ready'] as const).find(status => accounts.some(account => account.status === status)) ?? 'disconnected';
  return <div className="island-settings">
    <div className="island-settings-overview">
      <span className="island-settings-symbol"><Monitor size={18} /></span>
      <div className="island-settings-overview-copy"><div><b>桌面显示</b><span className="island-enabled-status" data-enabled={settings.enabled}>{settings.enabled ? '已启用' : '未启用'}</span></div><p title={settings.enabled ? `${ISLAND_DOCK_LABELS[settings.dock]}居中 · 偏移 ${settings.topOffset} px` : '开启后，在桌面边缘查看日程与快捷工具'}>{settings.enabled ? `${ISLAND_DOCK_LABELS[settings.dock]}居中 · 偏移 ${settings.topOffset} px` : '开启后，在桌面边缘查看日程与快捷工具'}</p></div>
      {toggle('enabled', '显示灵动岛')}
    </div>
    {error && <p className="island-settings-error" role="alert">{error}</p>}
    {term ? <p className="island-settings-search-result" role="status">{count ? `找到 ${count} 项相关设置 · 已搜索所有分区` : '没有匹配的设置'}</p> : <div className="island-settings-tabs"><Segmented value={active} onChange={value => setActive(value as Section)} options={[...sections]} aria-label="灵动岛设置分区" /></div>}
    <div ref={quotaGroup} className={`island-settings-layout${!term && active === 'tools' ? ' island-settings-tools' : ''}`} aria-label={term ? '设置搜索结果' : sections.find(section => section.value === active)?.label}>
      {visiblePages.length > 0 && <section className="island-setting-card island-card-wide" aria-labelledby={`${fieldId}-pages`}><header><h2 id={`${fieldId}-pages`}>显示的页面</h2><p>隐藏页面会保留数据，底栏按固定顺序排列。</p></header><div className="island-page-options">{visiblePages.map(page => {
        const PageIcon = pageIcons[page];
        return <div className="island-page-option" key={page} data-enabled={settings.pages[page]}><div><PageIcon size={21} /><button type="button" className="toggle" role="switch" aria-label={`显示${ISLAND_LABELS[page]}页`} aria-checked={settings.pages[page]} disabled={busy} onClick={() => patch({ pages: { [page]: !settings.pages[page] } })} /></div><b>{ISLAND_LABELS[page]}</b><small>{page === 'tools' && !toolsEnabled ? '启用任一工具后显示' : pageDescriptions[page]}</small></div>;
      })}</div></section>}
      {showConnections && <section className="set-rows island-ai-connections" aria-label="AI 连接">
        <div className="island-ai-layout" data-search={Boolean(term)}>
          {!term && <nav className="island-connection-sources island-ai-sources" aria-label="连接来源">
            <h3>连接来源</h3>
            <button type="button" aria-pressed={connectionSource === 'new-api'} onClick={() => setConnectionSource('new-api')}><HardDrives className="island-ai-source-icon" size={20} /><span className="island-source-copy"><strong>New API</strong><small className="island-provider-status" data-status={sourceStatus}>{sourceStatus === 'loading' ? '读取中' : quotaStatuses[sourceStatus]}</small></span></button>
            <button type="button" aria-pressed={connectionSource === 'codeai'} onClick={() => setConnectionSource('codeai')}><Code className="island-ai-source-icon" size={20} /><span className="island-source-copy"><strong>CodeAI</strong><small>项目消息提醒</small></span></button>
          </nav>}
          <div className="island-ai-details">
      {showQuotaCard && <section className="island-connection-manager" aria-labelledby={`${fieldId}-connections`}>
        <header><h2 id={`${fieldId}-connections`}>New API 连接</h2><button type="button" className="island-settings-link" disabled={busy} onClick={() => void run(async () => setAccounts(await api.quotaRefresh()))}><ArrowClockwise size={15} />刷新额度</button></header>
        {accounts.length === 0 && !showForm ? <div className="island-connection-detail" data-status={undefined}><div className="island-provider-content"><p className="island-provider-description">{quotaLoading ? '正在读取…' : '尚未配置账号，添加后灵动岛额度页可查看今日消耗。'}</p><div className="island-provider-actions"><button type="button" className="set-btn island-settings-primary" disabled={busy} onClick={startAdd}>+ 添加账号</button></div></div></div>
          : <div className="island-connection-layout">
            {accounts.length > 0 && <nav className="island-connection-sources" aria-label="额度账号">{accounts.map(account => (
              <button type="button" key={account.id} aria-label={`查看 ${account.label} 连接`} aria-pressed={account.id === (selectedAccount?.id ?? account.id)} onClick={() => { setSelectedAccountId(account.id); if (showForm) cancelForm(); }}>
                <span className="island-provider-symbol"><Sparkle size={16} /></span>
                <span className="island-source-copy"><strong>{account.label}</strong><small>{account.account || '未连接'}</small></span>
                <span className="island-provider-status" data-status={account.status}>{quotaStatuses[account.status]}</span>
              </button>
            ))}</nav>}
            {selectedAccount && <section className="island-connection-detail" data-status={selectedAccount.status} aria-label={`${selectedAccount.label} 账号详情`}>
              <header>
                <span className="island-provider-symbol"><Sparkle size={18} /></span>
                <div className="island-provider-heading"><div><h3>{selectedAccount.label}</h3><span className="island-provider-status" data-status={selectedAccount.status}>{quotaStatuses[selectedAccount.status]}</span></div><p>{[selectedAccount.account || null, selectedAccount.updatedAt ? `${new Date(selectedAccount.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新` : null].filter(Boolean).join(' · ')}</p></div>
                <div className="island-provider-menu" inert={busy}><GameOptionsMenu kind="project" active={active === 'quota'} context={`${selectedAccount.id}:${showForm}:${selectedAccount.status}`} label={`${selectedAccount.label} 更多操作`}>{close => <>
                  <button type="button" role="menuitem" disabled={busy} aria-label={`打开 ${selectedAccount.label} 控制台`} onClick={() => { close(); void run(() => api.quotaOfficial(selectedAccount.id)); }}><ArrowSquareOut size={16} />打开控制台</button>
                  <button type="button" role="menuitem" disabled={busy} onClick={() => { close(); startEdit(selectedAccount); }}>编辑账号</button>
                  <button type="button" role="menuitem" className="danger" disabled={busy} aria-label={`删除 ${selectedAccount.label}`} onClick={() => { close(); remove(selectedAccount.id); }}><Plugs size={16} />删除账号</button>
                </>}</GameOptionsMenu></div>
              </header>
              <div className="island-provider-content">
                {selectedAccount.message && !['ready'].includes(selectedAccount.status) && <p className="island-provider-message" data-status={selectedAccount.status} role="status">{selectedAccount.message}</p>}
                {showForm && editingId === selectedAccount.id ? <form className="island-key-editor" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
                  <h4>编辑账号{<button type="button" className="island-settings-link" disabled={busy} onClick={cancelForm}>取消</button>}</h4>
                  <div className="island-key-field"><label htmlFor={`${fieldId}-label`}>名称</label><div><input id={`${fieldId}-label`} type="text" autoComplete="off" spellCheck={false} maxLength={40} disabled={busy} value={label} onChange={event => setLabel(event.target.value)} placeholder="如：主力账号" /></div></div>
                  <div className="island-key-field"><label htmlFor={`${fieldId}-base`}>New API 地址</label><div><input id={`${fieldId}-base`} type="text" autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="http://aiserver.hisi.huawei.com" /></div></div>
                  <div className="island-key-field"><label htmlFor={`${fieldId}-user`}>用户名</label><div><input id={`${fieldId}-user`} type="text" autoComplete="off" spellCheck={false} maxLength={100} disabled={busy} value={username} onChange={event => setUsername(event.target.value)} placeholder="New API 登录用户名" /></div></div>
                  <div className="island-key-field"><label htmlFor={`${fieldId}-pwd`}>密码（留空不改）</label><div><input id={`${fieldId}-pwd`} type={showPwd ? 'text' : 'password'} autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} placeholder="New API 登录密码" /><IconButton label={showPwd ? '隐藏密码' : '显示密码'} disabled={busy} onClick={() => setShowPwd(!showPwd)}>{showPwd ? <EyeSlash size={18} /> : <Eye size={18} />}</IconButton></div><small>本机加密保存，仅用于查询额度消耗</small></div>
                  <div className="island-provider-actions"><button type="submit" className="set-btn island-settings-primary" disabled={busy || !label.trim() || !baseUrl.trim() || !username.trim()}>{busy ? '处理中…' : '保存'}</button></div>
                </form> : <div className="island-provider-actions"><button type="button" className="set-btn island-settings-primary" disabled={busy} onClick={() => startEdit(selectedAccount)}>编辑账号</button><button type="button" className="set-btn" disabled={busy} aria-label={`打开 ${selectedAccount.label} 控制台`} onClick={() => void run(() => api.quotaOfficial(selectedAccount.id))}><ArrowSquareOut size={15} />控制台</button></div>}
              </div>
            </section>}
            {showForm && !editingId && <section className="island-connection-detail" aria-label="添加账号"><div className="island-provider-content"><form className="island-key-editor" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
              <h4>添加账号{<button type="button" className="island-settings-link" disabled={busy} onClick={cancelForm}>取消</button>}</h4>
              <div className="island-key-field"><label htmlFor={`${fieldId}-label`}>名称</label><div><input id={`${fieldId}-label`} type="text" autoComplete="off" spellCheck={false} maxLength={40} disabled={busy} value={label} onChange={event => setLabel(event.target.value)} placeholder="如：主力账号" /></div></div>
              <div className="island-key-field"><label htmlFor={`${fieldId}-base`}>New API 地址</label><div><input id={`${fieldId}-base`} type="text" autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="http://aiserver.hisi.huawei.com" /></div></div>
              <div className="island-key-field"><label htmlFor={`${fieldId}-user`}>用户名</label><div><input id={`${fieldId}-user`} type="text" autoComplete="off" spellCheck={false} maxLength={100} disabled={busy} value={username} onChange={event => setUsername(event.target.value)} placeholder="New API 登录用户名" /></div></div>
              <div className="island-key-field"><label htmlFor={`${fieldId}-pwd`}>密码</label><div><input id={`${fieldId}-pwd`} type={showPwd ? 'text' : 'password'} autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} placeholder="New API 登录密码" /><IconButton label={showPwd ? '隐藏密码' : '显示密码'} disabled={busy} onClick={() => setShowPwd(!showPwd)}>{showPwd ? <EyeSlash size={18} /> : <Eye size={18} />}</IconButton></div><small>本机加密保存，仅用于查询额度消耗</small></div>
              <div className="island-provider-actions"><button type="submit" className="set-btn island-settings-primary" disabled={busy || !label.trim() || !baseUrl.trim() || !username.trim() || !password}>{busy ? '处理中…' : '添加'}</button></div>
            </form></div></section>}
            {!showForm && <div className="island-provider-actions island-connection-add"><button type="button" className="set-btn" disabled={busy} onClick={startAdd}>+ 添加账号</button></div>}
          </div>}
      </section>}
      {showAgentsCard && <section ref={agentsGroup} className="island-setting-card island-card-wide island-agent-settings" aria-labelledby={`${fieldId}-agents`}>
        <header><div><h2 id={`${fieldId}-agents`}>CodeAI 消息提醒</h2></div><div className="island-agent-actions"><button type="button" className="island-settings-link" disabled={busy || !discovered} onClick={() => { setDiscovered(null); refreshAgents(); }}><ArrowClockwise size={15} />重新扫描</button><button type="button" className="set-btn island-settings-primary" disabled={busy} onClick={() => { setManualError(''); setManualOpen(true); }}><Plus size={15} />手动添加</button></div></header>
        <div className="island-agent-project-list">
          {projects === null ? <p className="island-muted" role="status">正在扫描 CodeAI 项目…</p>
            : !currentProjects.length ? <p className="island-muted">暂无 CodeAI 最近项目，可重新扫描或点击“手动添加”。</p>
            : currentProjects.map(projectRow)}
        </div>
        {!!historicalProjects.length && <details className="island-agent-history"><summary>历史会话（{historicalProjects.length}）</summary><div className="island-agent-project-list">{historicalProjects.map(projectRow)}</div></details>}
      </section>}
          </div>
        </div>
      </section>}
      {selectedGroups.map(group => <section className={`island-setting-card${group.id === 'files' ? ' island-card-wide' : ''}`} key={group.id} data-group={group.id} aria-labelledby={`${fieldId}-${group.id}`}><header><h2 id={`${fieldId}-${group.id}`}>{group.title}</h2></header><Rows rows={group.rows} query="" /></section>)}
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
  </div>;
}
