import { useEffect, useId, useRef, useState } from 'react';
import { ArrowClockwise, ArrowSquareOut, CalendarBlank, Eye, EyeSlash, Folder, Monitor, Plugs, Sparkle, SquaresFour } from '@phosphor-icons/react';
import { ISLAND_DOCKS, ISLAND_DOCK_LABELS, ISLAND_LABELS, ISLAND_PAGES, type IslandDock, type IslandSettingsPatch, type NewApiAccount } from '../../shared/island-contracts';
import { errorText, IconButton, Segmented, Select, TimePicker } from '../ui/controls';
import { Rows, type RowSpec } from './SettingsView';
import { useIslandState } from './island-state';


const sections = [
  { value: 'display', label: '显示与交互' },
  { value: 'pages', label: '页面' },
  { value: 'reminders', label: '提醒' },
  { value: 'quota', label: 'AI 额度' },
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
  const [busy, setBusy] = useState(false), busyRef = useRef(false);
  const [displays, setDisplays] = useState<{ id: number; label: string }[]>([]);
  const [accounts, setAccounts] = useState<NewApiAccount[]>([]), [quotaLoading, setQuotaLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null), [showForm, setShowForm] = useState(false);
  const [label, setLabel] = useState(''), [baseUrl, setBaseUrl] = useState(DEFAULT_BASE), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [showPwd, setShowPwd] = useState(false);
  const [clear, setClear] = useState(false);
  const quotaGroup = useRef<HTMLDivElement>(null), revealQuota = useRef(false), fieldId = useId();
  const api = window.workbench.island;
  const run = async (action: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError('');
    try { await action(); } catch (e) { setError(errorText(e)); } finally { busyRef.current = false; setBusy(false); }
  };
  const patch = (value: IslandSettingsPatch) => { void run(async () => { setState(await api.patch(value)); }); };
  useEffect(() => {
    void api.displays().then(setDisplays).catch(e => setError(errorText(e)));
  }, []);
  useEffect(() => {
    const showQuota = () => { revealQuota.current = true; setActive('quota'); resetSearch(); sessionStorage.removeItem('island-settings-section'); };
    if (sessionStorage.getItem('island-settings-section') === 'quota') showQuota();
    const listener = (event: Event) => { if ((event as CustomEvent).detail === 'quota') showQuota(); };
    window.addEventListener('island-settings-section', listener);
    return () => window.removeEventListener('island-settings-section', listener);
  }, [resetSearch]);
  useEffect(() => {
    let alive = true;
    void api.quotas().then(value => { if (alive) setAccounts(value); }).catch(e => { if (alive) setError(errorText(e)); }).finally(() => { if (alive) setQuotaLoading(false); });
    if (state && active === 'quota' && revealQuota.current && quotaGroup.current) {
      quotaGroup.current.scrollIntoView({ block: 'nearest' }); revealQuota.current = false;
    }
    return () => { alive = false; };
  }, [state, active]);
  useEffect(() => setShowPwd(false), [active, query, editingId, showForm]);
  if (!state) return <p role={error ? 'alert' : 'status'}>{error || '正在读取灵动岛设置…'}</p>;
  const settings = state.settings;
  const toggle = (field: keyof IslandSettingsPatch, label: string) => <button type="button" className="toggle" role="switch" aria-checked={Boolean(settings[field as keyof typeof settings])} aria-label={label} disabled={busy} onClick={() => patch({ [field]: !settings[field as keyof typeof settings] })} />;
  const number = (field: 'topOffset' | 'focusMinutes' | 'waterMinutes' | 'sedentaryMinutes', label: string, min: number, max: number, unit: string) => <NumberSetting label={label} value={settings[field]} min={min} max={max} unit={unit} disabled={busy} save={value => patch({ [field]: value })} />;
  const period = (start: 'dndStart' | 'waterStart', end: 'dndEnd' | 'waterEnd', label: string) => <fieldset className="island-setting-period" aria-label={label} disabled={busy}>
    <div><label htmlFor={`${fieldId}-${start}`}>开始</label><TimePicker id={`${fieldId}-${start}`} value={settings[start]} onChange={value => patch({ [start]: value })} /></div><span>—</span>
    <div><label htmlFor={`${fieldId}-${end}`}>结束</label><TimePicker id={`${fieldId}-${end}`} value={settings[end]} onChange={value => patch({ [end]: value })} /></div>
  </fieldset>;
  const groups: { id: string; section: Section; title: string; rows: RowSpec[] }[] = [
    { id: 'position', section: 'display', title: '窗口位置', rows: [
      { key: 'display', title: '显示器', desc: '在所选工作区边缘居中', control: <Select value={String(settings.displayId ?? '')} onChange={value => patch({ displayId: value ? Number(value) : null })} aria-label="灵动岛显示器" disabled={busy} options={[{ value: '', label: '主显示器' }, ...displays.map(d => ({ value: String(d.id), label: d.label }))]} /> },
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
      { key: 'schedule', title: '日程提醒', desc: '按事项已设置的时间提醒', control: toggle('scheduleReminders', '日程提醒') },
      { key: 'todo', title: '待办提醒', desc: '岛隐藏时，使用系统通知', control: toggle('todoReminders', '灵动岛待办提醒') },
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
    ] },
  ];
  const term = query.trim().toLowerCase().replace(/\s+/g, '');
  const matches = (value: string) => !term || value.toLowerCase().replace(/\s+/g, '').includes(term);
  const selectedGroups = groups.filter(group => term || group.section === active).map(group => ({ ...group, rows: group.rows.filter(row => matches(`${sections.find(s => s.value === group.section)?.label} ${group.title} ${row.title} ${row.desc}`)) })).filter(group => group.rows.length);
  const visiblePages = (term || active === 'pages') ? ISLAND_PAGES.filter(page => matches(`页面 ${ISLAND_LABELS[page]} ${pageDescriptions[page]}`)) : [];
  const showQuotaCard = term || active === 'quota';
  const startAdd = () => { setEditingId(null); setLabel(''); setBaseUrl(DEFAULT_BASE); setUsername(''); setPassword(''); setShowForm(true); };
  const startEdit = (account: NewApiAccount) => {
    setEditingId(account.id); setLabel(account.label); setBaseUrl(account.baseUrl); setUsername(account.account); setPassword(''); setShowForm(true);
  };
  const cancelForm = () => { setShowForm(false); setEditingId(null); };
  const submit = () => {
    if (busy) return;
    void run(async () => {
      const next = editingId ? await api.quotaUpdate(editingId, label, baseUrl, username, password) : await api.quotaConnect(label, baseUrl, username, password);
      setAccounts(next);
      if (next.some(a => a.id === (editingId ?? next[next.length - 1]?.id) && (a.status === 'ready' || a.status === 'error'))) cancelForm();
    });
  };
  const remove = (id: string) => { void run(async () => setAccounts(await api.quotaRemove(id))); };
  const count = (term && matches('显示灵动岛 桌面显示 启用') ? 1 : 0) + selectedGroups.reduce((total, group) => total + group.rows.length, 0) + visiblePages.length + (showQuotaCard ? 1 : 0);
  const toolsEnabled = settings.focusEnabled || settings.waterEnabled || settings.sedentaryEnabled || settings.mascotEnabled;
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
      {showQuotaCard && <section className="island-connection-manager" aria-labelledby={`${fieldId}-connections`}>
        <header><h2 id={`${fieldId}-connections`}>New API 连接</h2><button type="button" className="island-settings-link" disabled={busy} onClick={() => void run(async () => setAccounts(await api.quotaRefresh()))}><ArrowClockwise size={15} />刷新额度</button></header>
        <div className="island-connection-detail" data-status={accounts[0]?.status}>
          {accounts.length === 0 && !showForm ? <div className="island-provider-content"><p className="island-provider-description">{quotaLoading ? '正在读取…' : '尚未配置账号，添加后灵动岛额度页可查看今日消耗。'}</p><div className="island-provider-actions"><button type="button" className="set-btn island-settings-primary" disabled={busy} onClick={startAdd}>+ 添加账号</button></div></div>
            : <>
            {accounts.length > 0 && <div className="island-account-list">{accounts.map(account => (
              <div className="island-account-row" key={account.id} data-status={account.status}>
                <div className="island-account-copy">
                  <strong>{account.label}</strong>
                  <span className="island-provider-status" data-status={account.status}>{quotaStatuses[account.status]}</span>
                  <small>{account.account || '未连接'}{account.updatedAt ? ` · ${new Date(account.updatedAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新` : ''}</small>
                </div>
                <div className="island-account-actions">
                  <button type="button" className="set-btn" disabled={busy} aria-label={`打开 ${account.label} 控制台`} onClick={() => void run(() => api.quotaOfficial(account.id))}><ArrowSquareOut size={15} /></button>
                  <button type="button" className="set-btn" disabled={busy} onClick={() => startEdit(account)}>编辑</button>
                  <button type="button" className="set-btn" disabled={busy} aria-label={`删除 ${account.label}`} onClick={() => remove(account.id)}><Plugs size={15} /></button>
                </div>
              </div>
            ))}</div>}
            {showForm && <form className="island-key-editor" noValidate onSubmit={event => { event.preventDefault(); submit(); }}>
              <h4>{editingId ? '编辑账号' : '添加账号'}{editingId && <button type="button" className="island-settings-link" disabled={busy} onClick={cancelForm}>取消</button>}</h4>
              <div className="island-key-field"><label htmlFor={`${fieldId}-label`}>名称</label><div><input id={`${fieldId}-label`} type="text" autoComplete="off" spellCheck={false} maxLength={40} disabled={busy} value={label} onChange={event => setLabel(event.target.value)} placeholder="如：主力账号" /></div></div>
              <div className="island-key-field"><label htmlFor={`${fieldId}-base`}>New API 地址</label><div><input id={`${fieldId}-base`} type="text" autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="http://aiserver.hisi.huawei.com" /></div></div>
              <div className="island-key-field"><label htmlFor={`${fieldId}-user`}>用户名</label><div><input id={`${fieldId}-user`} type="text" autoComplete="off" spellCheck={false} maxLength={100} disabled={busy} value={username} onChange={event => setUsername(event.target.value)} placeholder="New API 登录用户名" /></div></div>
              <div className="island-key-field"><label htmlFor={`${fieldId}-pwd`}>密码{editingId && '（留空不改）'}</label><div><input id={`${fieldId}-pwd`} type={showPwd ? 'text' : 'password'} autoComplete="off" spellCheck={false} maxLength={200} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} placeholder="New API 登录密码" /><IconButton label={showPwd ? '隐藏密码' : '显示密码'} disabled={busy} onClick={() => setShowPwd(!showPwd)}>{showPwd ? <EyeSlash size={18} /> : <Eye size={18} />}</IconButton></div><small>本机加密保存，仅用于查询额度消耗</small></div>
              <div className="island-provider-actions"><button type="submit" className="set-btn island-settings-primary" disabled={busy || !label.trim() || !baseUrl.trim() || !username.trim() || (!editingId && !password)}>{busy ? '处理中…' : editingId ? '保存' : '添加'}</button>{!editingId && <button type="button" className="island-settings-link" disabled={busy} onClick={cancelForm}>取消</button>}</div>
            </form>}
            {!showForm && accounts.length > 0 && <div className="island-provider-actions"><button type="button" className="set-btn" disabled={busy} onClick={startAdd}>+ 添加账号</button></div>}
            </>
          }
        </div>
      </section>}
      {selectedGroups.map(group => <section className={`island-setting-card${group.id === 'files' ? ' island-card-wide' : ''}`} key={group.id} data-group={group.id} aria-labelledby={`${fieldId}-${group.id}`}><header><h2 id={`${fieldId}-${group.id}`}>{group.title}</h2></header><Rows rows={group.rows} query="" /></section>)}
    </div>
  </div>;
}
