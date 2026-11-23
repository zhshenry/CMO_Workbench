import { useEffect, useState } from 'react';
import { WelinkReminderSettingsSchema, type WelinkMessageStatus, type WelinkReminderSettings } from '../../shared/welink-reminders';
import { errorText } from '../ui/controls';

const api = window.workbench.island;
export function WelinkMessageSettings({ authenticated }: { authenticated: boolean }) {
  const [settings, setSettings] = useState<WelinkReminderSettings | null>(null);
  const [status, setStatus] = useState<WelinkMessageStatus | null>(null);
  const [keywords, setKeywords] = useState(''), [hours, setHours] = useState('4');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void Promise.all([window.workbench.settings.get(), api.welinkMessagesStatus()]).then(([saved, next]) => {
      if (!active) return;
      const value = saved?.welinkMessages ?? WelinkReminderSettingsSchema.parse({});
      setSettings(value); setKeywords(value.keywords.join('，')); setHours(String(value.waitHours)); setStatus(next);
    }, cause => { if (active) setError(errorText(cause)); });
    const off = api.onWelinkMessagesChanged(next => { if (active) setStatus(next); });
    return () => { active = false; off(); };
  }, []);
  useEffect(() => {
    const reveal = () => {
      if (sessionStorage.getItem('island-settings-section') !== 'welink-messages') return;
      requestAnimationFrame(() => document.getElementById('welink-messages')?.scrollIntoView({ block: 'start' }));
      sessionStorage.removeItem('island-settings-section');
    };
    reveal(); window.addEventListener('island-settings-section', reveal);
    return () => window.removeEventListener('island-settings-section', reveal);
  }, []);
  async function save(value: WelinkReminderSettings) {
    const parsed = WelinkReminderSettingsSchema.safeParse(value);
    if (!parsed.success) { setError('等待时间需为 1–24 小时；关注词最多 20 个，每个不超过 30 字。'); return; }
    setBusy(true); setError('');
    try { const saved = await window.workbench.settings.patch({ welinkMessages: parsed.data }); setSettings(saved.welinkMessages); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  async function refresh() {
    setBusy(true); setError('');
    try { setStatus(await api.welinkMessagesRefresh()); }
    catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  return <section id="welink-messages" className="set-rows ai-config-section welink-card" aria-label="WeLink 消息提醒">
    <div className="ai-config-heading"><h2>消息提醒</h2></div>
    <div className="set-row"><div className="txt"><b>消息驱动提醒</b><span>检查可能待回复的问题、本人带日期的承诺和关注词。只读消息，近 36 小时材料保存在本机，不自动发送或创建待办。</span></div>
      <div className="ctl"><button type="button" className="toggle" role="switch" aria-label="WeLink 消息驱动提醒" aria-checked={settings?.enabled ?? false} disabled={busy || !settings || !authenticated && !settings.enabled} onClick={() => settings && void save({ ...settings, enabled: !settings.enabled })} /></div></div>
    {settings?.enabled && <>
      <div className="set-row"><div className="txt"><b>等待回复</b><span>明确问题等待多久后提醒；已回应的消息会在下次检查时移出。</span></div><div className="ctl"><label className="welink-poll-field"><input type="number" min="1" max="24" aria-label="等待回复小时数" value={hours} disabled={busy} onChange={event => setHours(event.target.value)} onBlur={() => void save({ ...settings, waitHours: Number(hours) })} /><span>小时</span></label></div></div>
      <div className="set-row"><div className="txt"><b>关注词</b><span>用逗号分隔；只提醒别人发来的命中消息。</span></div><div className="ctl"><input type="text" aria-label="WeLink 关注词" value={keywords} disabled={busy} onChange={event => setKeywords(event.target.value)} onBlur={() => void save({ ...settings, keywords: [...new Set(keywords.split(/[,，\n]/).map(word => word.trim()).filter(Boolean))] })} /></div></div>
      <div className="set-row"><div className="txt"><b>检查消息</b><span role="status">{status?.syncing ? '正在检查消息…' : status?.lastSuccessAt ? `已读取 ${status.conversations} 个会话、${status.messages} 条消息 · ${new Date(status.lastSuccessAt).toLocaleString('zh-CN')}。` : '尚未完成首次检查。'}每 10 分钟更新；每小时最多提醒 3 条。</span></div><div className="ctl"><button type="button" className="set-btn" aria-busy={busy || status?.syncing} disabled={busy || status?.syncing || !authenticated} onClick={() => void refresh()}>立即检查</button></div></div>
      <p className="help">在近期发现的会话中轮转，每轮最多检查 20 个会话，每会话最多读取 100 条。群聊中仅 @你的问题进入待回复候选。承诺日期由原话中的今天、明天、星期或日期识别，未明确日期的不推断到期。</p>
      {status?.error && <p className="error" role="status">{status.error}</p>}
      {status && status.reminders.length > 20 && <p className="help">显示前 20 条，共 {status.reminders.length} 条；处理后可继续查看。</p>}
      {status?.reminders.length ? <ul className="welink-reminder-list" aria-label="待核对的消息">{status.reminders.slice(0, 20).map(item => <li key={item.id}><details><summary>{item.title}</summary><small>{item.source.conversationName} · {item.source.mine ? '我' : item.source.sender} · {new Date(item.source.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</small><p>{item.source.text}</p><small>来源编号：{item.source.id}{item.due ? ` · 约定日期 ${item.due}，具体时间待核对` : ''}</small><button type="button" className="set-btn" disabled={busy} onClick={() => {
        setBusy(true); setError(''); void api.welinkMessagesDismiss(item.id).then(setStatus, cause => setError(errorText(cause))).finally(() => setBusy(false));
      }}>已处理</button></details></li>)}</ul> : <p className="help">{status?.lastSuccessAt ? '已取得的消息中暂无待核对提醒。' : '检查完成后，可在这里展开原话和来源。'}</p>}
    </>}
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}
