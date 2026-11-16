import type { Task } from '../shared/todo-contracts';
import { runWelink } from './welink-cli';
import { WelinkAgendaClient, welinkError } from './welink-agenda';
import type { Store } from '../modules/todo/store';
import type { WelinkSyncStatus } from '../shared/island-contracts';
import { agendaRange, chinaDay, dayMillis, nextDay, welinkAccount, welinkSourceName, type WelinkAgenda, type WelinkCalendarDetails, type WelinkEvent, type WelinkEventIdentity, type WelinkSourceStatus } from '../shared/welink-agenda';

export interface WelinkSyncResult { added: number; updated: number; removed: number; error?: string; }
const identity = (event: WelinkEventIdentity): string => `welink:${event.provider}:${encodeURIComponent(welinkAccount(event))}:${encodeURIComponent(event.id)}`;
const eventFromTask = (task: Task): WelinkEvent => ({ taskId: task.id, external: task.external!, title: task.title, start: task.dueAt!, end: task.endAt!, location: task.note, cancelled: false, meetingId: task.welinkMeetingId ?? undefined });

/** One shared owner for polling, manual refresh, AI agenda queries and lazy details. */
export class WelinkSync {
  private syncStatus: WelinkSyncStatus = { syncing: false, lastSuccessAt: null, error: '' };
  private pending: Promise<WelinkSyncResult> | null = null;
  private client: WelinkAgendaClient;
  private account = '';
  private scope = '';
  private lastAgenda: WelinkAgenda | null = null;
  private detailsCache = new Map<string, { at: number; value: WelinkCalendarDetails }>();
  private detailsPending = new Map<string, Promise<WelinkCalendarDetails>>();
  constructor(private todo: Store, private now = Date.now, private changed: (status: WelinkSyncStatus) => void = () => {}, private email: () => string = () => '', private recordsChanged: () => void = () => {}) {
    this.client = new WelinkAgendaClient(runWelink, now);
  }

  status(): WelinkSyncStatus { return structuredClone(this.syncStatus); }

  visibleTasks(tasks: Task[]): Task[] {
    if (!this.account) return tasks;
    return tasks.filter(task => task.source !== 'welink' || !task.external || welinkAccount(task.external) === this.account);
  }

  refresh(): Promise<WelinkSyncResult> {
    if (this.pending) return this.pending;
    this.syncStatus = { ...this.syncStatus, syncing: true }; this.changed(this.status());
    const start = chinaDay(this.now()), end = nextDay(start, 7);
    this.pending = this.fetch(start, end, true).then(({ changes, result }) => {
      this.lastAgenda = result;
      const error = this.summaryError(result);
      const previous = this.syncStatus.sources;
      for (const provider of ['calendar', 'meeting'] as const) if (result.sources[provider].state !== 'success') result.sources[provider].lastSuccessAt = previous?.[provider].lastSuccessAt ?? null;
      this.syncStatus = { syncing: false, lastSuccessAt: error ? this.syncStatus.lastSuccessAt : this.now(), error, sources: result.sources };
      return error ? { ...changes, error } : changes;
    }).catch(error => {
      const message = welinkError(error);
      const sources = {} as Record<'calendar' | 'meeting', WelinkSourceStatus>;
      for (const provider of ['calendar', 'meeting'] as const) sources[provider] = { count: 0, lastSuccessAt: null, ...this.syncStatus.sources?.[provider], state: 'error', error: message };
      this.syncStatus = { ...this.syncStatus, syncing: false, error: message, sources };
      return { added: 0, updated: 0, removed: 0, error: this.syncStatus.error };
    }).finally(() => { this.pending = null; this.changed(this.status()); });
    return this.pending;
  }

  async agenda(start: string, end: string): Promise<WelinkAgenda> {
    agendaRange(start, end);
    const today = chinaDay(this.now());
    if (start >= today && end <= nextDay(today, 7)) {
      await this.refresh();
      if (!this.account || !this.syncStatus.sources) throw new Error(this.syncStatus.error || '尚未连接日程来源。');
      return this.cachedAgenda({ start, end, account: this.account, events: this.lastAgenda?.events ?? [], sources: structuredClone(this.syncStatus.sources) });
    }
    // An explicit historical query can add records, but never prunes the polling window.
    const { result } = await this.fetch(start, end, false);
    return this.cachedAgenda(result);
  }

  private cachedAgenda(result: WelinkAgenda): WelinkAgenda {
    const fresh = new Set(result.events.filter(e => !e.cancelled).map(e => identity(e.external)));
    const events = this.visibleTasks(this.todo.all()).filter(t => t.external && t.dueAt && t.endAt && Date.parse(t.endAt) > dayMillis(result.start) && Date.parse(t.dueAt) < dayMillis(result.end)
      && (result.sources[t.external.provider].state !== 'success' || fresh.has(identity(t.external))))
      .map(t => ({ ...eventFromTask(t), cached: result.sources[t.external!.provider].state !== 'success' }));
    for (const provider of ['calendar', 'meeting'] as const) result.sources[provider].count = events.filter(e => e.external.provider === provider).length;
    return { ...result, events: events.sort((a, b) => a.start.localeCompare(b.start)) };
  }

  private summaryError(result: WelinkAgenda): string {
    return (['calendar', 'meeting'] as const).filter(p => result.sources[p].state !== 'success').map(p => `${welinkSourceName(p)}：${result.sources[p].error}`).join('\n');
  }

  private async fetch(start: string, end: string, prune: boolean): Promise<{ result: WelinkAgenda; changes: WelinkSyncResult }> {
    const email = this.email().trim().toLowerCase();
    const result = await this.client.query(start, end, email);
    if (email !== this.email().trim().toLowerCase() || await this.client.account() !== result.account) throw new Error('同步期间账号发生变化，请重新同步；已保留原有日程。');
    const previousAccount = this.account;
    const changes: WelinkSyncResult = { added: 0, updated: 0, removed: 0 };
    this.todo.transaction(() => {
      const seen = new Set<string>();
      for (const event of result.events) {
        const id = identity(event.external);
        seen.add(id);
        const records = this.todo.all(true);
        const existing = records.find(t => t.id === id || t.external && identity(t.external) === id) ?? (event.external.provider === 'meeting' ? records.find(t => t.id === `welink:${event.meetingId}` && t.source === 'welink' && !t.external) : undefined);
        if (event.cancelled) {
          if (existing && !existing.deletedAt) { this.todo.put({ ...existing, deletedAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() }); changes.removed++; }
          continue;
        }
        const task = this.toTask(existing?.id ?? id, event, existing);
        if (!existing) { this.todo.put(task); changes.added++; }
        else if (existing.title !== task.title || existing.dueAt !== task.dueAt || existing.endAt !== task.endAt || existing.note !== task.note || existing.deletedAt || JSON.stringify(existing.external) !== JSON.stringify(task.external)) {
          this.todo.put(task); changes.updated++;
        }
      }
      if (prune) for (const existing of this.todo.all(true)) {
        const source = existing.external;
        if (!source || existing.deletedAt || existing.source !== 'welink' || welinkAccount(source) !== result.account) continue;
        // Only a complete snapshot of this source/account/window may remove an absent record.
        if (result.sources[source.provider].state !== 'success' || seen.has(identity(source)) || !existing.dueAt || !existing.endAt) continue;
        if (Date.parse(existing.dueAt) < dayMillis(start) || Date.parse(existing.endAt) > dayMillis(end)) continue;
        this.todo.put({ ...existing, deletedAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() }); changes.removed++;
      }
    });
    this.account = result.account;
    const scope = this.account;
    if (this.scope && this.scope !== scope) { this.syncStatus = { syncing: this.syncStatus.syncing, lastSuccessAt: null, error: '' }; this.lastAgenda = null; this.detailsCache.clear(); }
    this.scope = scope;
    if (changes.added || changes.updated || changes.removed || previousAccount !== this.account) this.recordsChanged();
    return { result, changes };
  }

  private toTask(id: string, event: WelinkEvent, existing?: Task): Task {
    const now = new Date(this.now()).toISOString();
    return { id, title: event.title.slice(0, 200), kind: 'meeting', status: existing?.status ?? 'todo', priority: 'medium', plannedDate: chinaDay(Date.parse(event.start)), dueAt: event.start, endAt: event.end,
      remindAt: existing?.dueAt === event.start ? existing.remindAt : event.external.isAllDay ? null : event.start,
      categoryId: null, progress: null, note: [event.location, event.meetingNo ? `会议号 ${event.meetingNo}` : ''].filter(Boolean).join('\n').slice(0, 5000),
      source: 'welink', welinkMeetingId: event.meetingId ?? null, external: event.external,
      createdAt: existing?.createdAt ?? now, updatedAt: now, completedAt: existing?.completedAt ?? null, notifiedFor: existing?.dueAt === event.start ? existing.notifiedFor : null, deletedAt: null };
  }

  async details(taskId: string): Promise<WelinkCalendarDetails> {
    const task = this.todo.get(taskId);
    if (task.source !== 'welink' || task.external?.provider !== 'calendar') throw new Error('该事项没有邮箱日历详情。');
    if (welinkAccount(task.external) !== await this.client.account()) throw new Error('日程所属邮箱与当前账号不一致，请重新同步。');
    const key = `${identity(task.external)}:${task.external.changeKey ?? ''}`;
    const cached = this.detailsCache.get(key);
    if (cached && this.now() - cached.at < 600000) return cached.value;
    const pending = this.detailsPending.get(key);
    if (pending) return pending;
    const request = this.client.details(eventFromTask(task), this.email()).then(value => {
      if (this.detailsCache.size >= 100) this.detailsCache.clear();
      this.detailsCache.set(key, { at: this.now(), value }); return value;
    }).finally(() => { this.detailsPending.delete(key); });
    this.detailsPending.set(key, request); return request;
  }
}
