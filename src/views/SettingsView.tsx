import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ArrowClockwise, CalendarBlank, CaretDown, Warning, WechatLogo } from '@phosphor-icons/react';
import { AppSettingsSchema, welinkEmailForAccount, type AppSettings, type AppSettingsPatch, type AvatarColor, type ReminderRange, type TodoDbInfo, type UpdateStatus, type ViewId } from '../../shared/contracts';
import type { WelinkStatus } from '../../shared/island-contracts';
import type { WelinkSourceStatus } from '../../shared/welink-agenda';
import { errorText, Select as TodoSelect, TimePicker } from '../ui/controls';
import type { AppearanceController } from '../appearance';
import { AppearanceSettings } from './AppearanceSettings';
import { AiSettings } from './AiSettings';
import { IslandSettingsSection } from './IslandSettings';
import { useIslandSettingsEditor } from './island-state';
import { AgentConnectionSettings } from './AgentConnectionSettings';
import { WelinkMessageSettings } from './WelinkMessageSettings';
import { resolveView } from '../nav';

const wb = window.workbench;

// ---------- 分区元信息(页头标题) ----------
const SECTION_META: Partial<Record<ViewId, { title: string }>> = {
  'settings-profile': { title: '个人资料' },
  'settings-welink': { title: 'W3和Welink接入' },
  'settings-general': { title: '通用' },
  'settings-appearance': { title: '个性化' },
  'settings-island': { title: '桌面灵动岛' },
  'settings-ai': { title: '模型配置' },
  'settings-bots': { title: 'Bot 管理' },
  'settings-agents': { title: 'Agent连接' },
  'settings-data': { title: '待办与日程' },
  'settings-about': { title: '关于' },
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
            {row.desc && <span>{row.desc}</span>}
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

  const apply = (patch: AppSettingsPatch, sideEffect?: (next: AppSettings) => void) => {
    if (!settings) return;
    const prev = settings;
    setError('');
    setSettings({
      ...settings,
      ...patch,
      profile: patch.profile ? { ...settings.profile, ...patch.profile } : settings.profile,
    });
    return wb.settings.patch(patch).then(
      (next) => sideEffect?.(next),
      (e) => {
        setSettings(prev);
        setError(errorText(e));
      },
    );
  };

  return { settings, error, apply };
}

// ---------- 通用 ----------
function GeneralSection({ query }: { query: string }) {
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
  ] : [];

  return (
    <>
      <Rows rows={rows} query={query} />
      {error && <p className="error" role="alert">{error}</p>}
      {!settings && !error && <p className="help" role="status">正在读取设置…</p>}
      <NotificationSettingsSection query={query} />
    </>
  );
}

function NotificationSettingsSection({ query }: { query: string }) {
  const { state, busy, patch, error } = useIslandSettingsEditor();
  const id = useId();
  const settings = state?.settings;
  const rows: RowSpec[] = settings ? [
    { key: 'sound', title: '提醒声音', desc: '控制灵动岛提示音和系统通知声音',
      control: <button type="button" className="toggle" role="switch" aria-label="提醒声音" aria-checked={settings.sound} disabled={busy} onClick={() => patch({ sound: !settings.sound })} /> },
    { key: 'dnd', title: '定时勿扰', desc: '在设定时段静默，提醒留待处理',
      control: <button type="button" className="toggle" role="switch" aria-label="定时勿扰" aria-checked={settings.dnd} disabled={busy} onClick={() => patch({ dnd: !settings.dnd })} /> },
  ] : [];
  if (settings?.dnd) rows.push({ key: 'dndTime', title: '勿扰时段', desc: '',
    control: <fieldset className="island-setting-period" aria-label="勿扰时段" disabled={busy}>
      <div><label htmlFor={`${id}-dnd-start`}>开始</label><TimePicker id={`${id}-dnd-start`} value={settings.dndStart} onChange={dndStart => patch({ dndStart })} /></div>
      <span aria-hidden="true">—</span>
      <div><label htmlFor={`${id}-dnd-end`}>结束</label><TimePicker id={`${id}-dnd-end`} value={settings.dndEnd} onChange={dndEnd => patch({ dndEnd })} /></div>
    </fieldset>,
  });
  return <section className="settings-group settings-notifications" aria-labelledby={`${id}-notifications`}>
    <h2 id={`${id}-notifications`}>通知与勿扰</h2>
    {settings && <Rows rows={rows} query={query} />}
    {error && <p className="error" role="alert">{error}</p>}
    {!settings && !error && <p className="help" role="status">正在读取通知设置…</p>}
  </section>;
}

// ---------- 事项提醒 ----------
const REMINDER_RANGE_OPTIONS: { value: ReminderRange; label: string }[] = [
  { value: 'all', label: '日程和待办' },
  { value: 'schedule', label: '仅日程' },
  { value: 'todo', label: '仅待办' },
  { value: 'off', label: '关闭' },
];

function ReminderSection({ query }: { query: string }) {
  const { settings, error, apply } = useAppSettings();
  const [saving, setSaving] = useState(false);
  const id = useId();
  const rows: RowSpec[] = settings ? [{
    key: 'reminderRange',
    title: '提醒范围',
    desc: '',
    control: <TodoSelect className="reminder-range-select" aria-label="提醒范围" value={settings.reminderRange}
      options={REMINDER_RANGE_OPTIONS} disabled={saving} onChange={async value => {
        if (value === settings.reminderRange) return;
        setSaving(true);
        await apply({ reminderRange: value as ReminderRange });
        setSaving(false);
      }} />,
  }] : [];

  return <section className="settings-group" aria-labelledby={`${id}-reminders`}>
    <h2 id={`${id}-reminders`}>事项提醒</h2>
    {settings && <Rows rows={rows} query={query} />}
    {error && <p className="error" role="alert">{error}</p>}
    {!settings && !error && <p className="help" role="status">正在读取提醒设置…</p>}
  </section>;
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
  ] : [];

  return (
    <>
      <Rows rows={rows} query={query} />
      {error && <p className="error" role="alert">{error}</p>}
      {!settings && !error && <p className="help" role="status">正在读取设置…</p>}
    </>
  );
}

// ---------- WeLink 账号与接入 ----------
function welinkSourceText(status?: WelinkSourceStatus): string {
  const text = status?.state === 'success' ? `已同步 ${status.count} 条` : status?.state === 'partial' ? `结果不完整，已获取 ${status.count} 条` : status?.state === 'error' ? '暂时不可用，保留已有日程' : '尚未同步';
  return status?.lastSuccessAt ? `${text} · 上次成功 ${new Date(status.lastSuccessAt).toLocaleString('zh-CN')}` : text;
}

function WelinkSection({ query }: { query: string }) {
  const { settings, error, apply } = useAppSettings();
  const island = wb.island;
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

  const [welink, setWelink] = useState<WelinkStatus | null>(null);
  const lastSyncConnection = useRef<WelinkStatus['connection']>(undefined);
  const [welinkBusy, setWelinkBusy] = useState(false);
  const [welinkError, setWelinkError] = useState('');
  const [welinkSuccess, setWelinkSuccess] = useState('');
  const [welinkPoll, setWelinkPoll] = useState(10);
  const [mailboxError, setMailboxError] = useState('');
  const savedMailbox = useRef<AppSettings | null>(null);
  const [qrAscii, setQrAscii] = useState<string | null>(null);
  const [welinkLoginPending, setWelinkLoginPending] = useState(false);

  // WeLink 登录态 + 同步开关:首次加载读一次,扫码完成后刷新
  const refreshWelink = () => { void island.welinkStatus().then(setWelink, cause => setWelinkError(errorText(cause))); };
  useEffect(() => {
    refreshWelink();
    void wb.settings.get().then(s => { if (s) setWelinkPoll(s.welink.pollMinutes); });
    const off = island.onWelinkLoginEvent(event => {
      if (event.qrAscii) { setQrAscii(event.qrAscii); setWelinkLoginPending(false); }
      if (event.done) {
        setWelinkLoginPending(false); setQrAscii(null);
        if (event.error) { setWelinkError(event.error === '已取消' ? '' : event.error); return; }
        void island.welinkStatus().then(setWelink, cause => setWelinkError(errorText(cause)));
      }
    });
    const offSync = island.onWelinkSyncChanged?.(sync => {
      setWelink(current => {
        if (!current) return current;
        const issue = !sync.syncing && (sync.connection === 'needs-login' || sync.connection === 'client-closed') ? sync.connection : undefined;
        const account = !sync.syncing && sync.connection === 'ready' ? sync.mailbox?.account : undefined;
        return { ...current, sync, ...(account ? { uid: account } : {}), ...(issue ? { authenticated: false, connection: issue } : {}) };
      });
      if (!sync.syncing && sync.connection) {
        if (sync.connection === 'ready' && lastSyncConnection.current !== 'ready') refreshWelink();
        lastSyncConnection.current = sync.connection;
      }
      setWelinkSuccess('');
    });
    return () => { off(); offSync?.(); };
  }, []);

  const startWelinkLogin = () => {
    if (welinkLoginPending || qrAscii) return;
    setWelinkError(''); setWelinkSuccess(''); setQrAscii(null); setWelinkLoginPending(true);
    void island.welinkLogin().catch(cause => { setWelinkLoginPending(false); setQrAscii(null); setWelinkError(errorText(cause)); });
  };
  const cancelWelinkLogin = () => {
    void island.welinkCancelLogin().then(() => { setWelinkLoginPending(false); setQrAscii(null); }, cause => setWelinkError(errorText(cause)));
  };

  const w3AccountNote = '（可选,用于后续内网功能;密码经系统加密存本机,不显示不回传）';
  const rows: RowSpec[] = settings ? [
    {
      key: 'w3Account',
      title: `W3 账号 ${w3AccountNote}`,
      desc: '',
      heading: <div className="w3-account-heading"><b>W3 账号</b>{' '}<span>{w3AccountNote}</span></div>,
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
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0, whiteSpace: 'nowrap' }}>
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
          {w3Error && <span style={{ color: 'var(--danger)', fontSize: 'var(--type-caption)' }}>{w3Error}</span>}
        </div>
      ),
    },
  ] : [];
  const showW3 = rows.some(row => matches(query, row));
  const showWelink = matches(query, { title: 'WeLink 接入', desc: 'WeLink 登录、会议日程同步、轮询间隔、立即同步' });
  const showMailbox = matches(query, { title: '邮箱日历', desc: '企业邮箱、手动配置邮箱' });
  const syncStatus = welink?.sync;
  const needsLogin = welink?.connection === 'needs-login';
  const desktopUnavailable = welink?.connection === 'client-closed';
  const connectionUnknown = welink?.connection === 'temporary';
  const welinkAuthenticated = welink?.authenticated;
  const account = welink?.uid?.toLowerCase() ?? '';
  const mailboxStatus = syncStatus?.mailbox?.account === account ? syncStatus.mailbox.source : undefined;
  const mailboxNeedsSetup = !!(welinkAuthenticated && mailboxStatus?.mailboxNeedsSetup);
  const syncBusy = welinkBusy || !!syncStatus?.syncing;
  const syncError = syncStatus?.error || '';
  const showSyncWarning = syncError && !(mailboxNeedsSetup && syncStatus?.sources?.calendar.mailboxNeedsSetup && syncStatus.sources.meeting.state === 'success');
  const syncReason = /timeout|timed?\s*out|超时/i.test(syncError) ? '连接超时，请稍后重试。'
    : /Cannot connect to WeLink PC/i.test(syncError) ? '无法连接 WeLink PC，请先打开桌面客户端后重试。'
    : /^Command failed|^spawn /i.test(syncError) ? '本次同步未完成，请查看详情后重试。'
    : syncError.split(/[\r\n]/, 1)[0].replace(/^WeLink 查询失败[:：]\s*/, '').slice(0, 120);
  const lastSyncSuccess = syncStatus?.lastSuccessAt ? new Date(syncStatus.lastSuccessAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '暂无记录';

  const syncWelink = async (mailbox?: string) => {
    if (syncBusy || !welinkAuthenticated) return;
    setWelinkBusy(true); setWelinkError(''); setMailboxError(''); setWelinkSuccess('');
    try {
      if (mailbox !== undefined) {
        const parsed = AppSettingsSchema.shape.welinkEmail.safeParse(mailbox.trim());
        if (!parsed.success) throw new Error('请填写有效的企业邮箱，或留空后重试自动识别。');
        const current = await island.welinkStatus();
        if (!account || !current.authenticated || current.uid?.toLowerCase() !== account) {
          setWelink(current);
          throw new Error('WeLink 登录账号已变化，请核对当前账号后再试。');
        }
        savedMailbox.current = await wb.settings.patch({ welinkEmail: parsed.data, welinkEmailAccount: parsed.data ? account : '' });
      }
      const result = await island.welinkRefresh();
      if (!result.error) setWelinkSuccess(`已同步：新增 ${result.added}、更新 ${result.updated}、移除 ${result.removed}`);
    } catch (cause) {
      (mailbox === undefined ? setWelinkError : setMailboxError)(errorText(cause));
    } finally {
      setWelinkBusy(false);
    }
  };

  return (
    <>
      {showW3 && <Rows rows={rows} query={query} />}
      {showWelink && (
      <section className="set-rows ai-config-section welink-card" aria-label="WeLink 接入">
        <div className="ai-config-heading"><div><h2><WechatLogo size={16} /><span>WeLink 接入</span></h2></div></div>
        <div className="set-row">
          <div className="txt"><b>WeLink 登录</b><span role="status">{welinkLoginPending ? '正在获取登录二维码，请稍候…' : qrAscii ? '二维码已就绪，请用 WeLink 手机端扫码确认。' : needsLogin ? '登录已失效，重新扫码后会补读日程。' : desktopUnavailable ? '请打开 WeLink 桌面客户端，连接恢复后会继续同步。' : welink ? welinkAuthenticated ? `已登录${welink.uid ? `（${welink.uid}）` : ''}` : welink.reason ?? '未登录' : '正在读取…'}</span></div>
          <div className="ctl welink-login-actions">
            {welinkAuthenticated
              ? <button type="button" className="set-btn" disabled={welinkBusy} onClick={() => { setWelinkBusy(true); void island.welinkLogout().then(() => { void island.welinkStatus().then(s => setWelink(s)); }, cause => setWelinkError(errorText(cause))).finally(() => setWelinkBusy(false)); }}>登出</button>
              : <button type="button" className="set-btn island-settings-primary welink-login-button" aria-busy={welinkLoginPending} disabled={welinkBusy || welinkLoginPending || !!qrAscii} onClick={desktopUnavailable || connectionUnknown ? refreshWelink : startWelinkLogin}>{welinkLoginPending && <ArrowClockwise size={14} className="welink-login-spinner" aria-hidden="true" />}{welinkLoginPending ? '获取中…' : qrAscii ? '等待扫码' : desktopUnavailable ? '已打开客户端，检查连接' : needsLogin ? '重新扫码登录' : connectionUnknown ? '重试连接' : '扫码登录'}</button>}
            {(welinkLoginPending || qrAscii) && <button type="button" className="set-btn" disabled={welinkBusy} onClick={cancelWelinkLogin}>取消</button>}
          </div>
        </div>
        {qrAscii && <div className="welink-qr"><pre className="welink-qr-ascii">{qrAscii}</pre><p>用 WeLink 手机端扫码登录。需 WeLink PC 客户端在运行。</p></div>}
        <div className="set-row">
          <div className="txt"><b>会议日程同步</b><span>每 {welinkPoll} 分钟汇总未来 7 天的邮箱日历与 WeLink 会议；来源内容只读，可在本地标记完成。</span></div>
          <div className="ctl"><button type="button" className="toggle" role="switch" aria-label="WeLink 会议同步" aria-checked={welink?.enabled ?? false} disabled={welinkBusy || !welinkAuthenticated}
            onClick={() => { if (!welink) return; setWelinkBusy(true); void wb.settings.patch({ welink: { enabled: !welink.enabled, pollMinutes: welinkPoll } }).then(s => { setWelinkPoll(s.welink.pollMinutes); void island.welinkStatus().then(st => setWelink(st)); }, cause => setWelinkError(errorText(cause))).finally(() => setWelinkBusy(false)); }} /></div>
        </div>
        {syncStatus?.sources && <div className="set-row"><div className="txt"><b>WeLink 会议</b><span role="status">{welinkSourceText(syncStatus.sources.meeting)}</span></div></div>}
        {showSyncWarning && <div className="welink-sync-notice" role="status">
          <details className="welink-sync-warning">
            <summary><Warning size={20} aria-hidden="true" /><span className="welink-sync-copy"><strong>{syncStatus?.sources && Object.values(syncStatus.sources).some(status => status.state === 'success') ? '部分日程来源未同步' : '上次同步未成功'}</strong><span>{syncReason}</span><small>上次成功：{lastSyncSuccess} · 已保留现有日程</small></span><span className="welink-sync-disclosure">查看详情<CaretDown size={14} aria-hidden="true" /></span></summary>
            <pre className="welink-sync-details">{syncError}</pre>
          </details>
        </div>}
        {welink?.enabled && <div className="set-row">
          <div className="txt"><b>轮询间隔</b><span>分钟（1–60）</span></div>
          <div className="ctl"><label className="welink-poll-field"><input type="number" aria-label="WeLink 轮询间隔（分钟）" min={1} max={60} value={welinkPoll} disabled={welinkBusy} onChange={e => setWelinkPoll(Number(e.target.value))} onBlur={() => { const v = Math.max(1, Math.min(60, Math.round(welinkPoll) || 10)); setWelinkPoll(v); if (welink?.enabled) void wb.settings.patch({ welink: { enabled: true, pollMinutes: v } }); }} /><span aria-hidden="true">分钟</span></label></div>
        </div>}
        <div className="set-row">
          <div className="txt"><b>立即同步</b><span>手动刷新邮箱日历和 WeLink 会议。</span></div>
          <div className="ctl"><button type="button" className="set-btn welink-sync-button" aria-busy={syncBusy} disabled={syncBusy || !welinkAuthenticated} onClick={() => void syncWelink()}><ArrowClockwise size={16} aria-hidden="true" />同步</button></div>
        </div>
        {welinkError && <p className="error" role="alert">{welinkError}</p>}
        {welinkSuccess && <p className="ai-config-success" role="status">{welinkSuccess}</p>}
      </section>
      )}
      {showMailbox && <section className="set-rows ai-config-section welink-mailbox-card" aria-label="邮箱日历">
        <div className="ai-config-heading"><div><h2><CalendarBlank size={16} aria-hidden="true" /><span>邮箱日历</span></h2></div></div>
        <div className="set-row">
          <div className="txt">
            <b role="status">{!welink ? '正在检查连接…' : !welinkAuthenticated ? '请先连接 WeLink' : syncStatus?.syncing ? '正在同步邮箱日历…' : mailboxNeedsSetup ? '需要配置邮箱' : welinkSourceText(mailboxStatus)}</b>
            <span>默认读取当前 WeLink 账号的邮箱日历。邮箱服务未配置时，会先用当前账号已保存的地址，或从 WeLink 读取邮箱地址。</span>
            {mailboxNeedsSetup && <span>{mailboxStatus?.error}</span>}
          </div>
        </div>
        {mailboxNeedsSetup && <details className="welink-mailbox-options" key={account}>
          <summary>手动配置邮箱</summary>
          <form className="set-row welink-mailbox-row" noValidate onSubmit={event => {
            event.preventDefault();
            void syncWelink(String(new FormData(event.currentTarget).get('email') ?? ''));
          }}>
            <div className="txt"><b>企业邮箱</b><span>留空可重试自动识别。</span></div>
            <div className="ctl welink-mailbox-control">
              <label><input type="email" name="email" aria-label="企业邮箱" placeholder="name@example.com" defaultValue={welinkEmailForAccount(savedMailbox.current ?? settings, account)} disabled={syncBusy} /></label>
              <button type="submit" className="set-btn" disabled={syncBusy}>保存并重试</button>
            </div>
          </form>
        </details>}
        {mailboxError && <p className="error" role="alert">{mailboxError}</p>}
      </section>}
      {showWelink && <WelinkMessageSettings authenticated={welink?.authenticated ?? false} />}
      {settings && !showW3 && !showWelink && !showMailbox && <p className="set-empty" role="status">没有匹配的设置</p>}
      {error && <p className="error" role="alert">{error}</p>}
      {!settings && !error && <p className="help" role="status">正在读取设置…</p>}
    </>
  );
}

// ---------- 数据存储 ----------
function DataStorageSection({ query }: { query: string }) {
  const [info, setInfo] = useState<TodoDbInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    void wb.todo.info().then(setInfo, (e) => setError(errorText(e)));
  }, []);

  const rows: RowSpec[] = [
    ...(info ? [
      {
        key: 'dbPath',
        title: '共享库路径',
        desc: info.path,
        control: <button className="set-btn" aria-label="打开待办共享库目录" onClick={() => void wb.appInfo.openTodoDir().catch(e => setError(`待办共享库：${errorText(e)}`))}>打开目录</button>,
      },
      {
        key: 'scale',
        title: '数据规模',
        desc: `${info.taskCount} 项事项(含日程与待办)· ${info.categoryCount} 个标签`,
      },
    ] : []),
    {
      key: 'userData',
      title: '应用数据目录',
      desc: 'AI配置、对话库都在这里',
      control: <button className="set-btn" aria-label="打开应用数据目录" onClick={() => void wb.appInfo.openUserDataDir().catch(e => setError(`应用数据目录：${errorText(e)}`))}>打开</button>,
    },
  ];

  return (
    <section className="settings-storage" aria-labelledby="settings-storage-title">
      <h2 id="settings-storage-title">数据存储</h2>
      <Rows rows={rows} query={query} />
      {error && <p className="error" role="alert">{error}</p>}
      {info && <p className="help">待办数据以上游 To-Do-List 为单一事实源:工作台不做上游没有的私有功能,上游发版后按固定清单同步移植;工作台不写此库的 settings/chats 表。</p>}
      {!info && !error && <p className="help" role="status">正在读取共享库状态…</p>}
    </section>
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
  ] : [];

  return (
    <>
      <Rows rows={rows} query={query} />
      {error && <p className="error" role="alert">{error}</p>}
      {!info && !error && <p className="help" role="status">正在读取应用信息…</p>}
      <DataStorageSection query={query} />
    </>
  );
}

// ---------- 入口 ----------
export function SettingsView({ view, appearance, onAvatarColorChange, botManagement }: {
  view: ViewId;
  appearance: AppearanceController;
  botManagement?: ReactNode;
  onAvatarColorChange(color: AvatarColor): void;
}) {
  view = resolveView(view);
  const meta = SECTION_META[view] ?? { title: '设置' };

  return (
    <div className={view === 'settings-ai' ? 'settings-page settings-ai-page' : view === 'settings-about' ? 'settings-page settings-about-page' : view === 'settings-island' ? 'settings-page settings-island-page' : view === 'settings-agents' ? 'settings-page settings-agent-page' : 'settings-page'}>
      <div className="page-head">
        <div>
          <h1>{meta.title}</h1>
        </div>
      </div>
      {view === 'settings-profile' && <ProfileSection query="" onAvatarColorChange={onAvatarColorChange} />}
      {view === 'settings-welink' && <WelinkSection query="" />}
      {view === 'settings-general' && <GeneralSection query="" />}
      {view === 'settings-appearance' && <AppearanceSettings controller={appearance} />}
      {view === 'settings-island' && <IslandSettingsSection query="" />}
      {view === 'settings-ai' && <AiSettings query="" />}
      {view === 'settings-bots' && botManagement}
      {view === 'settings-agents' && <AgentConnectionSettings query="" />}
      {view === 'settings-data' && <ReminderSection query="" />}
      {view === 'settings-about' && <AboutSection query="" />}
    </div>
  );
}
