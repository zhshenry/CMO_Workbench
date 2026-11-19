import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { z } from 'zod';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { roomPlanSchema, type RoomBookingState, type RoomCommand, type RoomPlan } from '../shared/room-booking';

// Local protocol published by AI Hub's MIT-licensed meeting-room adapter. Booking and result
// verification stay in the compatible Secretary Terminator component the user connects.
const helperSchema = z.object({
  protocol: z.literal(1), at: z.number(), pid: z.number().int().positive().optional(), running: z.boolean().optional(),
  mode: z.string().nullable().optional(), loginNeeded: z.boolean().optional(), loginState: z.string().nullable().optional(), controlBusy: z.string().nullable().optional(),
  capabilities: z.array(z.string()).optional(), serverNow: z.string().nullable().optional(), nextOpen: z.string().nullable().optional(), targetDate: z.string().nullable().optional(),
  roomRead: z.object({ names: z.array(z.string()).optional(), error: z.string().nullable().optional() }).nullable().optional(),
  history: z.array(z.record(z.string(), z.unknown())).optional(), logs: z.string().optional(),
});
const replySchema = z.object({ requestId: z.string().uuid(), ok: z.boolean(), error: z.string().optional() });
const savedSchema = z.object({ executable: z.string(), directory: z.string(), armed: z.boolean(), plan: roomPlanSchema.optional() });
const string = (value: unknown) => typeof value === 'string' ? value : '';

export class RoomBooking {
  private pending?: Promise<RoomBookingState>;
  private helper?: ChildProcess;
  private lastRecovery = 0;
  private issue = '';
  constructor(private root: string, private deps: {
    launch?(file: string, home: string): ChildProcess; now?: () => number; timeoutMs?: number; checkProcess?(pid: number): boolean;
  } = {}) {}
  private now() { return (this.deps.now ?? Date.now)(); }
  private preferences() {
    const file = join(this.root, 'room-booking.json');
    return existsSync(file) ? savedSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) : { executable: '', directory: join(this.root, 'meeting-room'), armed: false, plan: undefined };
  }
  private save(value: ReturnType<RoomBooking['preferences']>) { writeJsonAtomic(join(this.root, 'room-booking.json'), value); }
  private processAlive(pid: number) {
    if (this.deps.checkProcess) return this.deps.checkProcess(pid);
    try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
  }

  state(): RoomBookingState {
    const saved = this.preferences(), root = join(saved.directory, 'hub-control'), file = join(root, 'status.json');
    let error = this.issue;
    let status: z.infer<typeof helperSchema> | undefined;
    if (existsSync(file)) {
      try { status = helperSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { error = '会议室组件的状态格式不兼容。'; }
    }
    const historyFile = join(saved.directory, 'booking_history.json');
    let history = status?.history ?? [];
    if (!status?.history && existsSync(historyFile)) try { history = z.array(z.record(z.string(), z.unknown())).parse(JSON.parse(readFileSync(historyFile, 'utf8'))); } catch { error = '预约历史暂无法读取。'; }
    const connected = !!status && status.at <= this.now() + 5000 && this.now() - status.at < 30000 && (!status.pid || this.processAlive(status.pid));
    return { ...saved, connected, running: !!(connected && status?.running), mode: status?.mode ?? undefined, loginState: status?.loginState ?? undefined,
      needsLogin: !!status?.loginNeeded, advancedDays: !!status?.capabilities?.includes('advance-days'), operation: status?.controlBusy ?? undefined,
      serverTime: status?.serverNow ?? undefined, nextOpen: status?.nextOpen ?? undefined, targetDate: status?.targetDate ?? undefined,
      roomNames: status?.roomRead?.names ?? [], roomReadError: status?.roomRead?.error ?? undefined, logs: status?.logs?.slice(-30000) ?? '', error: error || undefined,
      history: history.slice(-50).reverse().map(item => ({ day: string(item['日期']), time: string(item['时间']), room: string(item['会议室']), state: string(item['状态']), detail: string(item['备注']), title: string(item['主题']) })) };
  }

  selectExecutable(executable: string) {
    if (!isAbsolute(executable) || !/\.exe$/i.test(executable) || !existsSync(executable) || !statSync(executable).isFile()) throw new Error('请选择已安装的秘书终结者程序。');
    this.assertIdle();
    if (executable !== this.preferences().executable) this.releaseHelper();
    this.save({ ...this.preferences(), executable, armed: false }); return this.state();
  }
  selectDirectory(directory: string) {
    if (!isAbsolute(directory) || !existsSync(directory) || !statSync(directory).isDirectory()) throw new Error('该组件数据目录不可用。');
    this.assertIdle();
    if (directory !== this.preferences().directory) this.releaseHelper();
    this.save({ ...this.preferences(), directory, armed: false, plan: undefined }); return this.state();
  }
  private assertIdle() {
    if (this.pending || this.state().running) throw new Error('请先停止预约任务。');
  }
  private releaseHelper() {
    if (this.helper?.exitCode === null && !this.helper.killed) this.helper.kill();
    this.helper = undefined;
  }

  private async connectHelper() {
    const state = this.state(); if (state.connected) return;
    if (!state.executable || !existsSync(state.executable)) throw new Error('请选择支持 Hub 控制的秘书终结者程序。');
    mkdirSync(state.directory, { recursive: true });
    const spawnHelper = this.deps.launch ?? ((file, home) => spawn(file, ['--hub-control'], { cwd: dirname(file), windowsHide: true, stdio: 'ignore',
      env: { ...process.env, MSZ_HOME: home, MSZ_NO_TRAY: '1', QT_QPA_PLATFORM: 'offscreen' } }));
    const child = this.helper = this.helper?.exitCode === null && !this.helper.killed ? this.helper : spawnHelper(state.executable, state.directory);
    child.unref();
    let error: Error | undefined;
    child.once('error', cause => { error = cause; });
    const deadline = Date.now() + (this.deps.timeoutMs ?? 35000);
    while (Date.now() < deadline) {
      if (error) throw error;
      if (this.state().connected) return;
      if (child.exitCode !== null) throw new Error('会议室组件已退出。请核对版本和是否已有另一实例运行。');
      await wait(200);
    }
    if (child.exitCode === null) child.kill();
    throw new Error('会议室组件未返回状态，请确认选用的版本支持 Hub 控制。');
  }

  private async request(operation: RoomCommand | 'configure', args: Record<string, unknown> = {}) {
    const state = this.state(), root = join(state.directory, 'hub-control');
    if (!state.connected) throw new Error('会议室组件已断开。');
    const id = randomUUID(), path = join(root, 'requests', id + '.json'), result = join(root, 'replies', id + '.json');
    mkdirSync(dirname(path), { recursive: true });
    writeJsonAtomic(path, { id, op: operation, args, at: this.now() });
    const deadline = Date.now() + (this.deps.timeoutMs ?? 25000);
    while (Date.now() < deadline) {
      if (existsSync(result)) {
        const receipt = replySchema.parse(JSON.parse(readFileSync(result, 'utf8')));
        if (receipt.requestId !== id) throw new Error('组件回执编号不一致，请核对运行记录。');
        if (!receipt.ok) throw new Error(receipt.error || '组件拒绝了操作。');
        return;
      }
      await wait(150);
    }
    try { rmSync(path, { force: true }); } catch { /* The helper can be consuming this request. */ }
    throw new Error('组件尚未确认结果。请查看状态和预约历史后再决定是否重试。');
  }

  private run(fn: () => Promise<void>) {
    if (this.pending) return Promise.reject(new Error('请等待当前会议室操作完成。'));
    this.issue = '';
    const pending = fn().then(() => this.state()).catch(error => { this.issue = error instanceof Error ? error.message : '会议室操作失败。'; throw error; })
      .finally(() => { this.pending = undefined; });
    this.pending = pending;
    return pending;
  }
  connect() { return this.run(() => this.connectHelper()); }

  private async applyPlan(plan: RoomPlan) {
    const live = this.state();
    if (!live.advancedDays && plan.advanceDays !== 7) throw new Error('当前组件仅支持提前 7 天，请升级后再使用其他园区规则。');
    await this.request('configure', { 主题: plan.title, 开始时间: plan.start, 时长小时: Math.floor(plan.duration / 60), 时长分钟: plan.duration % 60,
      优先会议室: [...new Set(plan.rooms)], 抢订日: [...new Set(plan.weekdays)], 抢订设置: {
        开放时间: plan.openTime + ':00', ...(live.advancedDays && { 提前天数: plan.advanceDays }),
      } });
  }
  savePlan(plan: RoomPlan) {
    return this.run(async () => {
      await this.connectHelper();
      await this.applyPlan(plan);
      this.save({ ...this.preferences(), plan });
    });
  }
  command(operation: RoomCommand) {
    return this.run(async () => {
      const saved = this.preferences();
      if (operation === 'pause') {
        this.save({ ...saved, armed: false });
        if (this.state().connected) await this.request(operation);
        else if (saved.armed) throw new Error('组件暂时离线，尚无法核实暂停结果。');
        return;
      }
      if (['test', 'start', 'once'].includes(operation) && !saved.plan) throw new Error('请先保存预约计划。');
      await this.connectHelper();
      if (['test', 'start', 'once'].includes(operation) && this.state().needsLogin) throw new Error('会议室站点需要重新登录。');
      if (saved.plan && ['test', 'start', 'once'].includes(operation)) {
        if (this.state().running) throw new Error('请先停止预约任务。');
        await this.applyPlan(saved.plan);
      }
      await this.request(operation);
      if (operation === 'start') this.save({ ...this.preferences(), armed: true });
    });
  }

  async recover() {
    const state = this.state();
    if (!state.armed || state.connected || this.pending || this.now() - this.lastRecovery < 10 * 60000) return;
    this.lastRecovery = this.now();
    await this.command('start').catch(() => {});
  }
}
