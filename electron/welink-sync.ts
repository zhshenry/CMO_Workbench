import { localDay, type Task } from '../shared/todo-contracts';
import { runWelink } from './welink-cli';
import type { Store } from '../modules/todo/store';
import type { WelinkSyncStatus } from '../shared/island-contracts';

// WeLink 会议同步:轮询 meeting query-list --type 1(待参加),把未来 7 天的会议 upsert 进 tasks.db,
// source='welink' 标记,稳定 id=welink:{meetingId}。WeLink 侧取消/超窗的会议软删。
// 同步通过 store.put 更新会议信息；本地完成状态独立保留。
const SYNC_DAYS = 7;
// WeLink 接口 size 上限 30(传 50 返回 code:400 BAD_REQUEST),7 天会议单页足够;
// 若超 30(周期会议密集)需下期加翻页,这里先按上限拉。
const PAGE_SIZE = 30;

interface WelinkMeeting {
  meetingId: number;
  subject: string;
  meetingStartTime: number | string;
  meetingEndTime: number | string;
  location?: string | null;
  meetingNo?: string | null;
}

interface QueryListResponse { code: number; data?: { data?: WelinkMeeting[] }; message?: string | { message?: string }; }

export interface WelinkSyncResult { added: number; updated: number; removed: number; error?: string; }

export class WelinkSync {
  private syncStatus: WelinkSyncStatus = { syncing: false, lastSuccessAt: null, error: '' };
  private pending: Promise<WelinkSyncResult> | null = null;
  constructor(private todo: Store, private now = Date.now, private changed: (status: WelinkSyncStatus) => void = () => {}) {}

  status(): WelinkSyncStatus { return { ...this.syncStatus }; }

  refresh(): Promise<WelinkSyncResult> {
    if (this.pending) return this.pending;
    this.syncStatus = { ...this.syncStatus, syncing: true };
    this.changed(this.status());
    this.pending = this.syncMeetings().catch(error => ({ added: 0, updated: 0, removed: 0, error: error instanceof Error ? error.message : String(error) })).then(result => {
      this.syncStatus = { syncing: false, lastSuccessAt: result.error ? this.syncStatus.lastSuccessAt : this.now(), error: result.error || '' };
      this.changed(this.status());
      return result;
    }).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async syncMeetings(): Promise<WelinkSyncResult> {
    const start = this.dayStart(this.now());
    const end = this.dayStart(this.now() + SYNC_DAYS * 24 * 60 * 60 * 1000);
    let response: QueryListResponse;
    try {
      const raw = await runWelink([
        'meeting', 'query-list',
        '--page', '1', '--size', String(PAGE_SIZE),
        '--meeting-start-time', String(start), '--meeting-end-time', String(end),
        '--type', '1', '--meeting-sort', 'asc',
      ], 30000);
      response = JSON.parse(raw) as QueryListResponse;
    } catch (error) {
      return { added: 0, updated: 0, removed: 0, error: error instanceof Error ? error.message : String(error) };
    }
    if (response.code !== 200) {
      // message 可能是字符串或 {message} 对象(如 size 超限返回 {code:3, message:'BAD_REQUEST'}),统一取出可读文案
      const msg = typeof response.message === 'string' ? response.message : response.message?.message ?? `code ${response.code}`;
      return { added: 0, updated: 0, removed: 0, error: `WeLink 查询失败:${msg}` };
    }
    const meetings = response.data?.data ?? [];
    const seen = new Set<string>();
    let added = 0, updated = 0;
    for (const meeting of meetings) {
      if (typeof meeting.meetingId !== 'number' || !meeting.subject) continue;
      const id = `welink:${meeting.meetingId}`;
      seen.add(id);
      const startMs = Number(meeting.meetingStartTime);
      const endMs = Number(meeting.meetingEndTime);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      const task = this.toTask(id, meeting, startMs, endMs);
      const existing = this.findWelink(id);
      if (!existing) { this.todo.put(task); added++; }
      else if (this.hasChanged(existing, task)) { this.todo.put({ ...task, status: existing.status, completedAt: existing.completedAt, createdAt: existing.createdAt, deletedAt: null }); updated++; }
    }
    // 软删:库里 source='welink' 且未软删,但本轮没拉到(会议取消/超窗)
    let removed = 0;
    const nowIso = new Date(this.now()).toISOString();
    for (const existing of this.todo.all(true)) {
      if (existing.source !== 'welink' || existing.deletedAt) continue;
      if (seen.has(existing.id)) continue;
      this.todo.put({ ...existing, deletedAt: nowIso, updatedAt: nowIso });
      removed++;
    }
    return { added, updated, removed };
  }

  private dayStart(ms: number): number {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  private findWelink(id: string): Task | undefined {
    return this.todo.all(true).find(task => task.id === id && task.source === 'welink');
  }

  private hasChanged(existing: Task, next: Task): boolean {
    return existing.title !== next.title || existing.dueAt !== next.dueAt || existing.endAt !== next.endAt || existing.note !== next.note || existing.deletedAt !== null;
  }

  private toTask(id: string, meeting: WelinkMeeting, startMs: number, endMs: number): Task {
    const dueAt = new Date(startMs).toISOString();
    const endAt = new Date(endMs).toISOString();
    const nowIso = new Date(this.now()).toISOString();
    const note = [meeting.location, meeting.meetingNo ? `会议号 ${meeting.meetingNo}` : ''].filter(Boolean).join('\n');
    return {
      title: meeting.subject, kind: 'meeting', status: 'todo', priority: 'medium',
      plannedDate: localDay(new Date(startMs)), dueAt, endAt, remindAt: dueAt,
      categoryId: null, progress: null, note,
      source: 'welink', welinkMeetingId: meeting.meetingId,
      id, createdAt: nowIso, updatedAt: nowIso,
      completedAt: null, notifiedFor: null, deletedAt: null,
    };
  }
}
