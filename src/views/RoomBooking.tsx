import { useEffect, useState } from 'react';
import type { RoomBookingState, RoomCommand, RoomPlan } from '../../shared/room-booking';
import { errorText, Modal, TimePicker } from '../ui/controls';
import './meeting-workspace.css';

const defaults: RoomPlan = { title: '', start: '10:00', duration: 60, weekdays: [1, 2, 3, 4, 5], rooms: [], openTime: '08:00', advanceDays: 7 };

export function RoomBooking({ close }: { close(): void }) {
  const api = window.workbench.roomBooking;
  const [state, setState] = useState<RoomBookingState>(), [plan, setPlan] = useState(defaults);
  const [rooms, setRooms] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(''), [notice, setNotice] = useState('');
  const [confirmation, setConfirmation] = useState<'once' | 'start'>();

  useEffect(() => {
    let active = true;
    const refresh = () => void api.state().then(value => { if (active) setState(value); }, cause => { if (active) setError(errorText(cause)); });
    void api.state().then(value => {
      if (active) { setState(value); if (value.plan) { setPlan(value.plan); setRooms(value.plan.rooms.join('\n')); } }
    }, cause => { if (active) setError(errorText(cause)); });
    const timer = setInterval(refresh, 2200);
    return () => { active = false; clearInterval(timer); };
  }, [api]);

  async function run(label: string, action: () => Promise<RoomBookingState>, completed?: string) {
    if (busy) return;
    setError(''); setNotice(''); setBusy(label);
    try { setState(await action()); if (completed) setNotice(completed); }
    catch (cause) { setError(errorText(cause)); }
    finally { setBusy(''); }
  }
  function command(value: RoomCommand) {
    const success = value === 'once' ? '组件已接收预约请求，结果见预约历史。'
      : value === 'test' ? '组件已接收填表测试。' : value === 'start' ? '组件已接收定时抢订请求。'
        : value === 'pause' ? '已发出停止命令。' : value === 'read-rooms' ? '正在读取站点会议室，读取结果会自动显示。' : '已打开组件的登录流程。';
    void run('正在处理预约操作', () => api.command(value), success);
  }
  const blocked = !!busy || !!state?.running;
  return <Modal title="会议室预约" close={close} className="meeting-workspace" closeText="返回日程">
    <div className="meeting-controls"><strong>{state?.connected ? '组件已连接' : '组件待连接'}</strong>
      {state?.running && <span>预约运行中{state.mode && ' · ' + state.mode}</span>}
      {state?.needsLogin && <span className="meeting-error">需要登录会议室站点</span>}
      {!state?.connected && <button className="btn btn-sec btn-sm" type="button" disabled={!!busy} onClick={() => void run('选择组件', api.chooseExecutable)}>选择已安装组件</button>}
      <button className="text-button" type="button" disabled={blocked} onClick={() => void run('选择数据目录', api.chooseDirectory)}>选择已有数据目录</button>
      {!state?.connected && <button className="btn btn-sec btn-sm" type="button" disabled={!!busy} onClick={() => void run('正在连接组件', api.connect)}>连接</button>}
      <button className="text-button" type="button" disabled={blocked || !state?.connected} onClick={() => command('login')}>登录站点</button>
    </div>
    {state?.executable && <p className="office-byline">{state.executable.split(/[\\/]/).at(-1)} · {state.directory}</p>}
    {!state?.connected && <p className="office-byline">可接入已运行的秘书终结者数据目录，或选择支持 Hub 控制的已安装程序。</p>}
    {[busy, error || state?.error, notice].filter(Boolean).map((value, index) => <p key={index} role={value === (error || state?.error) ? 'alert' : 'status'}>{value}</p>)}
    <form onSubmit={event => { event.preventDefault(); void run('正在保存预约计划', () => api.save({ ...plan, rooms: rooms.split(/\r?\n/).map(text => text.trim()).filter(Boolean) }), '预约计划已保存。'); }}>
      <h3>预约计划</h3>
      <div className="meeting-form-grid">
        <label>会议主题<input required maxLength={150} disabled={blocked} value={plan.title} onChange={event => setPlan({ ...plan, title: event.target.value })} /></label>
        <div className="meeting-field">
          <label id="room-start-time-label" htmlFor="room-start-time">会议开始时间</label>
          <TimePicker id="room-start-time" aria-labelledby="room-start-time-label room-start-time" disabled={blocked} value={plan.start} onChange={start => setPlan(current => ({ ...current, start }))} />
        </div>
        <label>会议分钟数<input required type="number" min={30} max={720} value={plan.duration} disabled={blocked} onChange={event => setPlan({ ...plan, duration: Number(event.target.value) })} /></label>
        <div className="meeting-field">
          <label id="room-open-time-label" htmlFor="room-open-time">园区放号时刻</label>
          <TimePicker id="room-open-time" aria-labelledby="room-open-time-label room-open-time" disabled={blocked} value={plan.openTime} onChange={openTime => setPlan(current => ({ ...current, openTime }))} />
        </div>
        <label>提前预约天数<input required type="number" min={1} max={30} value={plan.advanceDays} disabled={blocked} onChange={event => setPlan({ ...plan, advanceDays: Number(event.target.value) })} /></label>
      </div>
      <fieldset disabled={blocked} className="meeting-weekdays"><legend>会议安排在星期</legend>{'一二三四五六日'.split('').map((day, index) => <label key={day}><input type="checkbox" checked={plan.weekdays.includes(index + 1)} onChange={event => setPlan({ ...plan, weekdays: event.target.checked ? [...plan.weekdays, index + 1] : plan.weekdays.filter(value => value !== index + 1) })} />周{day}</label>)}</fieldset>
      <label className="meeting-field">优先会议室，按顺序每行一间<textarea value={rooms} rows={3} disabled={blocked} onChange={event => setRooms(event.target.value)} required /></label>
      <div className="meeting-controls"><button type="button" className="text-button" disabled={blocked || !state?.connected} onClick={() => command('read-rooms')}>读取可用会议室</button>
        <button type="submit" className="btn btn-pri btn-sm" disabled={blocked || !state?.connected}>保存计划</button></div>
      {!!state?.roomReadError && <p role="alert">{state.roomReadError}</p>}
      {!!state?.roomNames.length && <div className="meeting-controls">{state.roomNames.slice(0, 80).map(room => <button type="button" className="text-button" key={room} disabled={blocked || rooms.split(/\r?\n/).includes(room)} onClick={() => setRooms([rooms, room].filter(Boolean).join('\n'))}>{room} ＋</button>)}</div>}
    </form>
    <div className="meeting-controls"><button type="button" className="btn btn-sec btn-sm" disabled={blocked || !state?.plan} onClick={() => command('test')}>测试填表</button>
      <button type="button" className="btn btn-sec btn-sm" disabled={blocked || !state?.plan} onClick={() => setConfirmation('once')}>预约一次</button>
      <button type="button" className="btn btn-sec btn-sm" disabled={blocked || !state?.plan} onClick={() => setConfirmation('start')}>启动定时抢订</button>
      <button type="button" className="text-button" disabled={!!busy || (!state?.running && !state?.armed)} onClick={() => command('pause')}>暂停预约</button></div>
    {confirmation && <div className="meeting-note" role="group" aria-label="确认预约"><p>{confirmation === 'once' ? '按已保存计划提交一次真实预约。' : '按已保存计划在放号时自动提交预约。'}</p>
      <button type="button" className="btn btn-pri btn-sm" disabled={!!busy} onClick={() => { command(confirmation); setConfirmation(undefined); }}>确认执行</button>
      <button type="button" className="text-button" onClick={() => setConfirmation(undefined)}>取消</button></div>}
    {state?.nextOpen && <p className="office-byline">下次放号 {state.nextOpen.replace('T', ' ').slice(0, 19)}{state.targetDate && ' · 目标日期 ' + state.targetDate}{state.serverTime && ' · 服务器时间 ' + state.serverTime.replace('T', ' ').slice(0, 19)}</p>}
    <h3>预约历史</h3>
    {!!state?.history.length ? <ul className="meeting-room-history">{state.history.map((entry, i) => <li key={`${entry.day}-${entry.room}-${i}`}>
      <strong>{entry.state || '结果待确认'}</strong> {entry.day} {entry.time} {entry.room} {entry.title}{entry.detail && <p>{entry.detail}</p>}
    </li>)}</ul> : <p className="office-empty">暂无预约回执。</p>}
    {!!state?.logs && <details><summary>运行日志</summary><pre className="meeting-room-log">{state.logs}</pre></details>}
  </Modal>;
}
