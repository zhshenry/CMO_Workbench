import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from '@phosphor-icons/react';
import type { AppSettings, AppSettingsPatch, AvatarColor, TodoDbInfo, UiTheme, UpdateStatus, ViewId } from '../../shared/contracts';
import { errorText, IconButton, Select as TodoSelect } from '../ui/controls';
import { AiSettings } from './AiSettings';
import { IslandSettingsSection } from './IslandSettings';

const wb = window.workbench;

// ---------- 分区元信息(页头标题) ----------
const SECTION_META: Partial<Record<ViewId, { title: string; sub: string }>> = {
  'settings-profile': { title: '个人资料', sub: '称呼与头像,只用于界面展示,存在本机' },
  'settings-general': { title: '通用与外观', sub: '应用行为与启动选项 · 界面主题与观感' },
  'settings-island': { title: '桌面灵动岛', sub: '设置桌面窗口、页面与提醒' },
  'settings-ai': { title: 'AI 助手', sub: '管理对话模型与决策模型配置' },
  'settings-data': { title: '待办与数据', sub: '与 To-Do-List 的共享库状态(只读展示)' },
  'settings-notifications': { title: '通知', sub: '提醒与系统通知' },
  'settings-about': { title: '关于', sub: '版本与数据位置' },
};

export interface RowSpec {
  key: string;
  title: string;
  desc: string;
  /** 状态展示行可不挂控件 */
  control?: ReactNode;
  heading?: ReactNode;
  content?: ReactNode;
  className?: string;
}

const matches = (query: string, row: { title: string; desc: string }): boolean =>
  !query.trim() || row.title.includes(query.trim()) || row.desc.includes(query.trim());

export function Rows({ rows, query }: { rows: RowSpec[]; query: string }) {
  const visible = rows.filter((r) => matches(query, r));
  if (!visible.length) return <p className="set-empty" role="status">没有匹配的设置</p>;
  return (
    <div className="set-rows">
      {visible.map((row) => (
        <div key={row.key} className={row.className ? `set-row ${row.className}` : 'set-row'} data-setting-key={row.key}>
          <div className="txt">
            {row.heading ?? <b>{row.title}</b>}
            {row.content}
            <span>{row.desc}</span>
          </div>
          {row.control != null && <div className="ctl">{row.control}</div>}
        </div>
      ))}
    </div>
  );
}

// ---------- 应用设置读写(通用/通知分区共用) ----------
function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void wb.settings.get().then((raw) => setSettings(raw), (e) => setError(errorText(e)));
  }, []);

  const apply = (patch: AppSettingsPatch, sideEffect?: (next: AppSettings) => void): void => {
    if (!settings) return;
    const prev = settings;
    setSettings({
      ...settings,
      ...patch,
      profile: patch.profile ? { ...settings.profile, ...patch.profile } : settings.profile,
    });
    void wb.settings.patch(patch).then(
      (next) => sideEffect?.(next),
      (e) => {
        setSettings(prev);
        setError(errorText(e));
      },
    );
  };

  return { settings, error, apply };
}

// ---------- 通用与外观 ----------
function GeneralSection({ query, uiTheme, onUiThemeChange }: {
  query: string;
  uiTheme: UiTheme;
  onUiThemeChange(theme: UiTheme): void;
}) {
  const { settings, error, apply } = useAppSettings();

  const rows: RowSpec[] = settings ? [
    {
      key: 'launchAtLogin',
      title: '开机自启',
      desc: '登录 Windows 后自动启动,并驻留系统托盘',
      control: (
        <button type="button" className="toggle" role="switch" aria-checked={settings.launchAtLogin} aria-label="开机自启"
          onClick={() => apply({ launchAtLogin: !settings.launchAtLogin })} />
      ),
    },
    {
      key: 'closeAction',
      title: '关闭主窗口时',
      desc: '点击窗口 ✕ 不退出应用,待办提醒与后台任务继续运行',
      control: (
        <div className="seg" role="radiogroup" aria-label="关闭主窗口时">
          <button className={settings.closeAction === 'minimize' ? 'on' : ''} aria-pressed={settings.closeAction === 'minimize'}
            onClick={() => apply({ closeAction: 'minimize' })}>最小化到托盘</button>
          <button className={settings.closeAction === 'exit' ? 'on' : ''} aria-pressed={settings.closeAction === 'exit'}
            onClick={() => apply({ closeAction: 'exit' })}>退出应用</button>
        </div>
      ),
    },
    {
      key: 'language',
      title: '界面语言',
      desc: '界面显示语言,更多语言包规划中',
      control: <span className="set-value">简体中文</span>,
    },
    {
      key: 'uiTheme',
      title: '界面主题',
      desc: '全局色场与玻璃质感,即时生效;布局与按钮位置不受影响',
      control: (
        <div className="theme-pick" role="radiogroup" aria-label="界面主题">
          {THEME_OPTIONS.map((t) => (
            <button key={t.value} type="button" className={uiTheme === t.value ? 'theme-card on' : 'theme-card'}
              role="radio" aria-checked={uiTheme === t.value} aria-label={t.label}
              onClick={() => { if (uiTheme !== t.value) apply({ uiTheme: t.value }, () => onUiThemeChange(t.value)); }}>
              <span className="sw">{t.swatches.map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              <b>{t.label}</b>
              <span>{t.desc}</span>
            </button>
          ))}
        </div>
      ),
    },
  ] : [];

  return (
    <>
      <Rows rows={rows} query={query} />
      {error && <p className="error" role="alert">{error}</p>}
      {settings && <p className="help">设置即时生效并自动保存。关闭行为中的「退出应用」仍会保留托盘提醒开关,需从托盘菜单彻底退出。三款主题共用布局、圆角与字体;背景色场、玻璃白度和内层表面随主题切换。</p>}
      {!settings && !error && <p className="help" role="status">正在读取设置…</p>}
    </>
  );
}

// ---------- 个人资料(方案 A:设置分区;昵称驱动首页问候与头像首字) ----------
const AVATAR_COLOR_OPTIONS: { value: AvatarColor; label: string }[] = [
  { value: 'blue', label: '海蓝' },
  { value: 'teal', label: '青绿' },
  { value: 'violet', label: '紫藤' },
  { value: 'rose', label: '莓红' },
  { value: 'amber', label: '琥珀' },
];

const greetWord = (d: Date): string => {
  const h = d.getHours();
  return h < 5 ? '夜深了' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
};

function ProfileSection({ query, onAvatarColorChange }: {
  query: string;
  onAvatarColorChange(color: AvatarColor): void;
}) {
  const { settings, error, apply } = useAppSettings();
  // null = 未在编辑;编辑中草稿存这里,失焦/回车保存,空值拒存
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const name = settings?.profile.name ?? '';
  const initial = (name.trim()[0] ?? 'O').toUpperCase();

  // W3 凭据(可选,供后续内网功能使用;密码加密存本机)
  const [w3Uid, setW3Uid] = useState('');
  const [w3Password, setW3Password] = useState('');
  const [w3Saved, setW3Saved] = useState(false);
  const [w3Busy, setW3Busy] = useState(false);
  const [w3Error, setW3Error] = useState('');

  useEffect(() => {
    void window.workbench.auth.hasCredentials().then(setW3Saved);
  }, []);

  useEffect(() => {
    if (settings) setW3Uid(settings.w3Uid);
  }, [settings]);

  const saveW3Credentials = async (): Promise<void> => {
    if (!w3Uid.trim() || !w3Password) {
      setW3Error('请输入 W3 账号和密码');
      return;
    }
    setW3Error('');
    setW3Busy(true);
    try {
      await window.workbench.auth.saveCredentials({ uid: w3Uid.trim(), password: w3Password });
      apply({ w3Uid: w3Uid.trim() });
      setW3Saved(true);
      setW3Password('');
    } catch (e) {
      setW3Error(e instanceof Error ? e.message : '保存失败');
    } finally {
      setW3Busy(false);
    }
  };

  const clearW3Credentials = async (): Promise<void> => {
    setW3Error('');
    setW3Busy(true);
    try {
      await window.workbench.auth.clearCredentials();
      apply({ w3Uid: '' });
      setW3Uid('');
      setW3Password('');
      setW3Saved(false);
    } catch (e) {
      setW3Error(e instanceof Error ? e.message : '清除失败');
    } finally {
      setW3Busy(false);
    }
  };

  const saveName = (): void => {
    if (nameDraft == null || !settings) return;
    const next = nameDraft.trim().slice(0, 20);
    setNameDraft(null);
    if (!next || next === name) return;
    apply({ profile: { ...settings.profile, name: next } });
  };

  const rows: RowSpec[] = settings ? [
    {
      key: 'name',
      title: '昵称',
      desc: '首页问候与头像取首字显示',
      control: (
        <input className="name-input" value={nameDraft ?? name} maxLength={20} aria-label="昵称" placeholder="怎么称呼你"
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={saveName}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      ),
    },
    {
      key: 'avatar',
      title: '头像',
      desc: '自动取昵称首字,可更改头像颜色',
      control: (
        <div className="avatar-settings-control">
          <span className="avatar-preview" data-avatar-color={settings.profile.avatarColor}>{initial}</span>
          <TodoSelect className="avatar-color-select" aria-label="头像颜色" value={settings.profile.avatarColor}
            onChange={(value) => apply({ profile: { ...settings.profile, avatarColor: value as AvatarColor } }, (next) => onAvatarColorChange(next.profile.avatarColor))}
            options={AVATAR_COLOR_OPTIONS}
            renderOption={(option) => (
              <span className="avatar-color-choice">
                <span className="avatar-color-indicator" data-avatar-color={option.value} aria-hidden="true" />
                <span>{option.label}</span>
              </span>
            )} />
        </div>
      ),
    },
    {
      key: 'greet',
      title: '问候预览',
      desc: '首页顶部将这样称呼你',
      control: <span className="greet-chip">{greetWord(new Date())},<em>{name}</em></span>,
    },
    {
      key: 'w3Account',
      title: 'W3 账号',
      desc: '可选,用于后续内网功能;密码经系统加密存本机,不显示不回传',
      content: (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              placeholder="W3账号"
              aria-label="W3账号"
              value={w3Uid}
              onChange={(e) => setW3Uid(e.target.value)}
              disabled={w3Busy}
              style={{ flex: 1, minWidth: 0, height: 32, padding: '0 10px', border: '1px solid var(--hairline)', borderRadius: 'var(--r-ctl)', fontSize: 'var(--type-control)', background: 'var(--glass-lo)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
            />
            <input
              type="password"
              placeholder="密码"
              aria-label="W3密码"
              value={w3Password}
              onChange={(e) => setW3Password(e.target.value)}
              disabled={w3Busy}
              style={{ flex: 1, minWidth: 0, height: 32, padding: '0 10px', border: '1px solid var(--hairline)', borderRadius: 'var(--r-ctl)', fontSize: 'var(--type-control)', background: 'var(--glass-lo)', color: 'var(--ink)', outline: 'none', boxSizing: 'border-box' }}
            />
          </div>
          {w3Error && <span style={{ color: 'var(--danger)', fontSize: 'var(--type-caption)' }}>{w3Error}</span>}
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="set-btn" disabled={w3Busy} onClick={() => void saveW3Credentials()}>
              {w3Busy ? '保存中…' : w3Saved ? '更新' : '保存'}
            </button>
            {w3Saved && (
              <button className="set-btn" disabled={w3Busy} onClick={() => void clearW3Credentials()}>
                清除
              </button>
            )}
            {w3Saved && <span style={{ color: 'var(--ink-3)', fontSize: 'var(--type-caption)' }}>已保存</span>}
          </div>
        </div>
      ),
    },
  ] : [];

  return (
    <>
      <Rows rows={rows} query={query} />
      {error && <p className="error" role="alert">{error}</p>}
      {!settings && !error && <p className="help" role="status">正在读取设置…</p>}
    </>
  );
}

// ---------- 外观主题选项(雾灰轻雾默认,冷灰凝霜与暖砂柔雾可选) ----------
const THEME_OPTIONS: { value: UiTheme; label: string; desc: string; swatches: string[] }[] = [
  { value: 'mist', label: '雾灰 · 轻雾', desc: '默认 · 中性珍珠灰', swatches: ['#e9eaee', '#f7f8fa', '#dce2e9', '#232529'] },
  { value: 'cool', label: '冷灰 · 凝霜', desc: '冷灰蓝 · 清透分层', swatches: ['#b5c9e6', '#e5eefb', '#8ea9d1', '#232529'] },
  { value: 'warm', label: '暖砂 · 柔雾', desc: '暖砂灰 · 乳白玻璃', swatches: ['#eee8e3', '#fffaf5', '#e8cfc4', '#232529'] },
];

// ---------- 待办与数据(只读状态页,策略上游为源) ----------
function DataSection({ query }: { query: string }) {
  const [info, setInfo] = useState<TodoDbInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void wb.todo.info().then(setInfo, (e) => setError(errorText(e)));
  }, []);

  const rows: RowSpec[] = info ? [
    {
      key: 'dbPath',
      title: '共享库路径',
      desc: info.path,
      control: <button className="set-btn" onClick={() => void wb.appInfo.openTodoDir()}>打开目录</button>,
    },
    {
      key: 'scale',
      title: '数据规模',
      desc: `${info.taskCount} 项事项(含日程与待办)· ${info.categoryCount} 个标签`,
    },
  ] : [];

  return (
    <>
      <Rows rows={rows} query={query} />
      {error && <p className="error" role="alert">{error}</p>}
      {info && <p className="help">待办数据以上游 To-Do-List 为单一事实源:工作台不做上游没有的私有功能,上游发版后按固定清单同步移植;工作台不写此库的 settings/chats 表。</p>}
      {!info && !error && <p className="help" role="status">正在读取共享库状态…</p>}
    </>
  );
}

// ---------- 通知 ----------
function NotificationsSection({ query }: { query: string }) {
  const { settings, error, apply } = useAppSettings();

  const rows: RowSpec[] = settings ? [
    {
      key: 'remindersEnabled',
      title: '待办提醒',
      desc: '到提醒时间弹系统通知,点击通知打开工作台处理',
      control: (
        <button type="button" className="toggle" role="switch" aria-checked={settings.remindersEnabled} aria-label="待办提醒"
          onClick={() => apply({ remindersEnabled: !settings.remindersEnabled })} />
      ),
    },
  ] : [];

  return (
    <>
      <Rows rows={rows} query={query} />
      {error && <p className="error" role="alert">{error}</p>}
      {settings && <p className="help">提醒由常驻托盘的轮询驱动,关闭后不再弹窗;更改在下一轮询周期(约 15 秒)内生效。</p>}
      {!settings && !error && <p className="help" role="status">正在读取设置…</p>}
    </>
  );
}

// ---------- 关于 ----------
interface AboutInfo {
  name: string;
  version: string;
  electron: string;
  chrome: string;
  userDataPath: string;
  todoDbPath: string;
}

function AboutSection({ query }: { query: string }) {
  const [info, setInfo] = useState<AboutInfo | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [error, setError] = useState('');
  const [updateError, setUpdateError] = useState('');
  const [acting, setActing] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const actionPending = useRef(false);
  const updateRevision = useRef(0);
  const detailsButton = useRef<HTMLButtonElement>(null);
  const detailsId = useId();

  useEffect(() => {
    let active = true;
    let receivedStatus = false;
    const off = wb.updater.onStatus(status => {
      receivedStatus = true;
      updateRevision.current++;
      if (active) { setUpdate(status); setUpdateError(''); }
    });
    void wb.appInfo.about().then(value => { if (active) setInfo(value); }, e => { if (active) setError(errorText(e)); });
    void wb.updater.status().then(status => {
      if (active && !receivedStatus) setUpdate(status);
    }, e => { if (active && !receivedStatus) setUpdateError(errorText(e)); });
    return () => { active = false; off(); };
  }, []);

  const fullError = updateError || (update?.phase === 'error' ? update.message : '');
  useEffect(() => setShowDetails(false), [fullError]);
  const busy = acting || update?.phase === 'checking' || update?.phase === 'downloading';
  const updateAction = (): void => {
    if (!update?.enabled || busy || actionPending.current) return;
    actionPending.current = true;
    setActing(true);
    setUpdateError('');
    const revision = updateRevision.current;
    void (update?.phase === 'ready' ? wb.updater.install() : wb.updater.check())
      .catch(e => { if (updateRevision.current === revision) setUpdateError(errorText(e)); })
      .finally(() => { actionPending.current = false; setActing(false); });
  };
  const statusLabel = fullError ? (update ? '更新失败' : '读取失败') : !update ? '读取中…' : !update.enabled ? '不可自动更新'
    : update.phase === 'latest' ? '当前已是最新版本' : update.phase === 'checking' ? '正在检查更新…'
      : update.phase === 'downloading' ? `正在下载 ${update.progress}%` : update.phase === 'ready' ? '已下载，待重启' : '待检查';
  const compactLabel = fullError || !update?.enabled ? statusLabel : update.phase === 'latest' ? '已是最新版本'
    : update.phase === 'checking' ? '检查中…' : update.phase === 'downloading' ? `下载 ${update.progress}%`
      : update.phase === 'ready' ? '待重启' : statusLabel;
  const rows: RowSpec[] = info ? [
    {
      key: 'version',
      title: `${info.name} v${info.version}`,
      desc: `Electron ${info.electron} · Chromium ${info.chrome}`,
    },
    {
      key: 'update',
      title: '应用更新',
      className: 'set-update-row',
      heading: <div className="set-update-heading">
        <b>应用更新</b>
        <span className="set-update-status" role={fullError ? 'alert' : 'status'} aria-atomic="true">
          <span className="set-update-status-full">{statusLabel}</span>
          <span className="set-update-status-compact">{compactLabel}</span>
        </span>
        {fullError && <button ref={detailsButton} type="button" className="set-update-details-toggle" aria-expanded={showDetails} aria-controls={detailsId}
          onClick={() => setShowDetails(value => !value)} onKeyDown={event => { if (event.key === 'Escape' && showDetails) { event.preventDefault(); setShowDetails(false); } }}>
          {showDetails ? '收起详情' : '详情'}
        </button>}
      </div>,
      desc: update?.enabled ? '自动检查并后台下载，下载完成后点击“重启并安装”更新。' : update?.message ?? (updateError ? '无法读取更新状态，请稍后重新打开此页。' : '正在读取更新状态…'),
      content: <>
        {update?.phase === 'downloading' && <progress className="set-update-progress" aria-label="更新下载进度" value={update.progress} max={100} />}
        {fullError && <p id={detailsId} className="set-update-details" hidden={!showDetails}>{fullError}</p>}
      </>,
      control: <button type="button" className="set-btn set-update-action" disabled={!update?.enabled || busy} aria-busy={busy} onClick={updateAction}>
        {update?.phase === 'ready' ? '重启并安装' : update?.phase === 'checking' ? '检查中…' : update?.phase === 'downloading' ? '下载中…' : '检查更新'}
      </button>,
    },
    {
      key: 'userData',
      title: '应用数据目录',
      desc: 'AI配置、对话库都在这里',
      control: <button className="set-btn" onClick={() => void wb.appInfo.openUserDataDir().catch(e => setError(`应用数据目录：${errorText(e)}`))}>打开</button>,
    },
  ] : [];

  return (
    <>
      <Rows rows={rows} query={query} />
      {error && <p className="error" role="alert">{error}</p>}
      {!info && !error && <p className="help" role="status">正在读取应用信息…</p>}
    </>
  );
}

// ---------- 入口 ----------
export function SettingsView({ view, uiTheme, onUiThemeChange, onAvatarColorChange }: {
  view: ViewId;
  uiTheme: UiTheme;
  onUiThemeChange(theme: UiTheme): void;
  onAvatarColorChange(color: AvatarColor): void;
}) {
  const [query, setQuery] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  // 切换分区时清空搜索,避免"看起来没内容"的错觉
  useEffect(() => setQuery(''), [view]);
  const meta = SECTION_META[view] ?? { title: '设置', sub: '' };

  return (
    <div className={view === 'settings-ai' ? 'settings-page settings-ai-page' : view === 'settings-about' ? 'settings-page settings-about-page' : view === 'settings-island' ? 'settings-page settings-island-page' : 'settings-page'}>
      <div className="page-head">
        <div>
          <h1>{meta.title}</h1>
          <div className="sub">{meta.sub}</div>
        </div>
        <span className="spacer" />
        <div className="set-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.8-3.8" /></svg>
          <input ref={searchInput} value={query} aria-label="搜索当前页设置" placeholder={view === 'settings-ai' ? '搜索供应商或模型' : '搜索当前页设置'} onChange={(e) => setQuery(e.target.value)} />
          {query && <IconButton label="清空设置搜索" onClick={() => { setQuery(''); searchInput.current?.focus(); }}><X size={14} /></IconButton>}
        </div>
      </div>
      {view === 'settings-profile' && <ProfileSection query={query} onAvatarColorChange={onAvatarColorChange} />}
      {view === 'settings-general' && <GeneralSection query={query} uiTheme={uiTheme} onUiThemeChange={onUiThemeChange} />}
      {view === 'settings-island' && <IslandSettingsSection query={query} resetSearch={() => setQuery('')} />}
      {view === 'settings-ai' && <AiSettings query={query} />}
      {view === 'settings-data' && <DataSection query={query} />}
      {view === 'settings-notifications' && <NotificationsSection query={query} />}
      {view === 'settings-about' && <AboutSection query={query} />}
    </div>
  );
}
