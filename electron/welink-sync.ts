import type { Task } from '../shared/todo-contracts';
import { runWelink, welinkAuthStatus } from './welink-cli';
import { WelinkAgendaClient, welinkConnectionFailure, welinkError } from './welink-agenda';
import type { Store } from '../modules/todo/store';
import { welinkMeetingPeers } from '../shared/welink-display';
import { calendarMeetingNumber, calendarRevision, recheckWelinkLinks, taskOccurrence } from './welink-link';
import type { WelinkWeekStatus, WelinkSyncStatus } from '../shared/island-contracts';
import { agendaRange, chinaDay, dayMillis, nextDay, welinkAccount, welinkMeetingNumber, welinkOccurrenceMatches, welinkSourceName, type WelinkAgenda, type WelinkConnection, type WelinkEvent, type WelinkEventDetails, type WelinkEventIdentity, type WelinkSource, type WelinkSourceStatus } from '../shared/welink-agenda';

export interface WelinkSyncResult { added: number; updated: number; removed: number; error?: string; }
const identity = (event: WelinkEventIdentity): string => `welink:${event.provider}:${encodeURIComponent(welinkAccount(event))}:${encodeURIComponent(event.id)}`;
const eventFromTask = (task: Task): WelinkEvent => ({ taskId: task.id, external: task.external!, title: task.title, start: task.dateAt!, end: task.endAt!, location: task.note, cancelled: false, meetingId: task.welinkMeetingId ?? undefined, meetingNo: task.welinkMeetingNo, welinkLinkedTo: task.welinkLinkedTo });
const sourceRevision = (task: Task) => JSON.stringify([task.external, task.dateAt, task.endAt, task.title, task.note, task.welinkMeetingNo, task.welinkMeetingId, task.deletedAt]);

const providers = ['calendar', 'meeting'] as const;
const RANGE_REUSE_MS = 30_000;
const sourceStates = (make: (provider: WelinkSource) => WelinkSourceStatus) => ({ calendar: make('calendar'), meeting: make('meeting') });

/** One shared owner for polling, calendar windows, AI agenda queries and lazy details. */
export class WelinkSync {
  private syncStatus: WelinkSyncStatus = { syncing: false, lastSuccessAt: null, error: '' };
  private pending: Promise<WelinkSyncResult> | null = null;
  private recovery?: Promise<void>;
  private client: WelinkAgendaClient;
  private account = '';
  private readQueue: Promise<unknown> = Promise.resolve();
  private lastRefreshAt: number | null = null;
  private failures = 0;
  private retryAt = 0;
  private weeks = new Map<string, { at: number; sources: WelinkAgenda['sources'] }>();
  private weekPending = new Map<string, Promise<Omit<WelinkWeekStatus, 'automatic'>>>();
  private deferredWeek: { start: string; end: string; manual: boolean } | null = null;
  private lastAgenda: WelinkAgenda | null = null;
  private detailsCache = new Map<string, { at: number; value: WelinkEventDetails }>();
  private detailsPending = new Map<string, Promise<WelinkEventDetails>>();
  private linkEvidence = new Map<string, { at: number; number?: string | null }>();
  constructor(private todo: Store, private now = Date.now, private changed: (status: WelinkSyncStatus) => void = () => {}, private email: (account: string) => string = () => '', private recordsChanged: () => void = () => {}) {
    this.client = new WelinkAgendaClient(runWelink, now, undefined, welinkAuthStatus);
  }

  status(): WelinkSyncStatus { return structuredClone(this.syncStatus); }
  statusForAccount(uid: string): WelinkSyncStatus {
    return uid && this.account === uid.toLowerCase() ? this.status() : { syncing: false, lastSuccessAt: null, error: '' };
  }

  visibleTasks(tasks: Task[]): Task[] {
    if (!this.account) return tasks;
    return tasks.filter(task => task.source !== 'welink' || !task.external || welinkAccount(task.external) === this.account);
  }

  poll(intervalMs: number): void {
    if (this.pending || (this.retryAt ? this.now() < this.retryAt : this.lastRefreshAt !== null && this.now() - this.lastRefreshAt < intervalMs)) return;
    void this.refresh().then(() => this.retryWeek(true));
  }

  loginRecovered(automatic: boolean): Promise<void> {
    return this.recovery ??= (async () => {
      if (!this.pending || (await this.pending).error) await this.refresh();
      await this.retryWeek(automatic);
    })().finally(() => { this.recovery = undefined; });
  }

  loggedOut(): void {
    this.weeks.clear(); this.detailsCache.clear(); this.linkEvidence.clear();
    delete this.syncStatus.mailbox;
    this.setConnection('needs-login'); this.changed(this.status());
  }

  private async retryWeek(automatic: boolean): Promise<void> {
    const week = this.deferredWeek;
    if (this.syncStatus.connection !== 'ready' || !week || (!automatic && !week.manual)) return;
    this.deferredWeek = null;
    await this.week(week.start, week.end, automatic, week.manual);
  }

  private setConnection(connection: WelinkConnection): void {
    this.syncStatus.connection = connection;
    if (connection === 'ready') { this.failures = 0; this.retryAt = 0; }
    else {
      // Keep last-success metadata, but a recovered connection must reread the range.
      for (const range of this.weeks.values()) range.at = -Infinity;
      // Failed automatic reads do not repeatedly invoke either provider or launch a login.
      const delay = (connection === 'temporary' ? 30_000 : 60_000) * 2 ** Math.min(this.failures++, 5);
      this.retryAt = this.now() + Math.min(delay, 600_000);
    }
  }

  private sourceConnection(result: WelinkAgenda): WelinkConnection {
    if (providers.some(provider => result.sources[provider].state === 'success')) return 'ready';
    const failures = providers.map(provider => welinkConnectionFailure(result.sources[provider].error).connection);
    return failures.includes('needs-login') ? 'needs-login' : failures.includes('client-closed') ? 'client-closed' : 'temporary';
  }

  refresh(retryMailbox = false): Promise<WelinkSyncResult> {
    if (this.pending) return retryMailbox ? this.pending.then(result => result.error ? (this.pending ?? this.refresh(true)) : result) : this.pending;
    this.lastRefreshAt = this.now();
    this.syncStatus = { ...this.syncStatus, syncing: true }; this.changed(this.status());
    const start = chinaDay(this.now()), end = nextDay(start, 7);
    this.pending = this.fetch(start, end, true, retryMailbox).then(({ changes, result }) => {
      this.lastAgenda = result;
      const error = this.summaryError(result);
      const previous = this.syncStatus.sources;
      for (const provider of providers) if (result.sources[provider].state !== 'success') result.sources[provider].lastSuccessAt = previous?.[provider].lastSuccessAt ?? null;
      this.syncStatus = { ...this.syncStatus, syncing: false, lastSuccessAt: error ? this.syncStatus.lastSuccessAt : this.now(), error, sources: result.sources };
      this.setConnection(this.sourceConnection(result));
      return error ? { ...changes, error } : changes;
    }).catch(error => {
      const message = welinkError(error);
      const sources = sourceStates(provider => ({ count: this.syncStatus.sources?.[provider].count ?? 0, lastSuccessAt: this.syncStatus.sources?.[provider].lastSuccessAt ?? null, state: 'error', error: message }));
      const mailbox = this.syncStatus.mailbox;
      this.syncStatus = { ...this.syncStatus, syncing: false, error: message, sources };
      if (mailbox) this.syncStatus.mailbox = { account: mailbox.account, source: { ...sources.calendar, lastSuccessAt: mailbox.source.lastSuccessAt } };
      this.setConnection(welinkConnectionFailure(error).connection);
      return { added: 0, updated: 0, removed: 0, error: message };
    }).finally(() => { this.pending = null; this.changed(this.status()); });
    return this.pending;
  }

  async week(start: string, end: string, automatic: boolean, manual = false): Promise<WelinkWeekStatus> {
    agendaRange(start, end);
    const key = [this.email(this.account).trim().toLowerCase(), start, end].join(':');
    const pending = this.weekPending.get(key);
    if (pending) return { ...await pending, automatic };
    const cached = this.weeks.get(key);
    const connection = this.syncStatus.connection;
    if (!manual && connection === 'ready' && cached && this.now() - cached.at < RANGE_REUSE_MS) {
      return { automatic, sources: cached.sources, connection, error: '' };
    }
    if (!manual && this.now() < this.retryAt) {
      if (automatic && (this.deferredWeek?.start !== start || this.deferredWeek.end !== end)) this.deferredWeek = { start, end, manual };
      return { ...this.weekFallback(key, start, end, this.syncStatus.error || '连接暂未恢复，请稍后重试。'), automatic };
    }
    if (!automatic && !manual) return { automatic, error: '', connection };
    const read = this.fetch(start, end, true).then(({ result }) => {
      const connection = this.sourceConnection(result), changed = this.syncStatus.connection !== connection;
      this.setConnection(connection);
      if (changed) this.changed(this.status());
      if (connection !== 'ready') this.deferredWeek = { start, end, manual };
      else if (this.deferredWeek?.start === start && this.deferredWeek.end === end) this.deferredWeek = null;
      const sources = this.cachedAgenda(result).sources;
      for (const provider of providers) sources[provider].lastSuccessAt ??= this.weeks.get(key)?.sources[provider].lastSuccessAt ?? null;
      if (this.weeks.size >= 16) this.weeks.delete(this.weeks.keys().next().value!);
      this.weeks.set(key, { at: providers.every(provider => sources[provider].state === 'success') ? this.now() : -Infinity, sources });
      return { sources, connection, error: this.summaryError(result) };
    }).catch(error => {
      const connection = welinkConnectionFailure(error).connection, changed = this.syncStatus.connection !== connection;
      this.setConnection(connection);
      if (changed) this.changed(this.status());
      this.deferredWeek = { start, end, manual };
      return this.weekFallback(key, start, end, welinkError(error));
    }).finally(() => { this.weekPending.delete(key); });
    this.weekPending.set(key, read);
    return { ...await read, automatic };
  }

  private weekFallback(key: string, start: string, end: string, error: string): Omit<WelinkWeekStatus, 'automatic'> {
    const sources = sourceStates(provider => ({ state: 'error', error, count: 0, lastSuccessAt: this.weeks.get(key)?.sources[provider].lastSuccessAt ?? null }));
    if (this.account) this.cachedAgenda({ start, end, account: this.account, events: [], sources });
    return { sources, connection: this.syncStatus.connection, error };
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
    const events = this.visibleTasks(this.todo.all()).filter(t => t.external && t.dateAt && t.endAt && Date.parse(t.endAt) > dayMillis(result.start) && Date.parse(t.dateAt) < dayMillis(result.end)
      && (result.sources[t.external.provider].state !== 'success' || fresh.has(identity(t.external))))
      .map(t => ({ ...eventFromTask(t), cached: result.sources[t.external!.provider].state !== 'success' }));
    for (const provider of ['calendar', 'meeting'] as const) result.sources[provider].count = events.filter(e => e.external.provider === provider).length;
    return { ...result, events: events.sort((a, b) => a.start.localeCompare(b.start)) };
  }

  private summaryError(result: WelinkAgenda): string {
    return (['calendar', 'meeting'] as const).filter(p => result.sources[p].state !== 'success').map(p => `${welinkSourceName(p)}：${result.sources[p].error}`).join('\n');
  }

  private fetch(start: string, end: string, prune: boolean, retryMailbox = false): Promise<{ result: WelinkAgenda; changes: WelinkSyncResult }> {
    const read = this.readQueue.then(() => this.readRange(start, end, prune, retryMailbox));
    this.readQueue = read.catch(() => {});
    return read;
  }

  private async prefetchLinkEvidence(result: WelinkAgenda, email: string, before: Task[]): Promise<Map<string, string | null> | undefined> {
    if (result.sources.calendar.state !== 'success' || result.sources.meeting.state !== 'success') return;
    const proofs = new Map<string, string | null>();
    const meetings = result.events.filter(event => !event.cancelled && event.external.provider === 'meeting' && welinkMeetingNumber(event.meetingNo));
    const today = chinaDay(this.now()), from = dayMillis(today), to = dayMillis(nextDay(today, 2));
    const persisted = new Map(before.filter(task => !task.deletedAt && task.external?.provider === 'calendar' && task.welinkLinkedTo)
      .map(task => [calendarRevision(taskOccurrence(task)), task.welinkLinkedTo!]));
    const pending: { event: WelinkEvent; revision: string; key: string; lastAttempt: number }[] = [];
    for (const event of result.events) {
      if (event.cancelled || event.external.provider !== 'calendar' || !meetings.some(meeting => welinkOccurrenceMatches(event, meeting))) continue;
      const revision = calendarRevision(event), key = JSON.stringify([revision, email]), prior = this.linkEvidence.get(key);
      const saved = persisted.get(revision);
      if (prior?.number !== undefined && (event.external.changeKey || this.now() - prior.at < 20 * 60000)) proofs.set(revision, prior.number);
      else if (saved?.calendarChangeKey && saved.calendarChangeKey === event.external.changeKey) proofs.set(revision, saved.meetingNo);
      else if (Date.parse(event.start) < to && Date.parse(event.end) > from) pending.push({ event, revision, key, lastAttempt: prior?.at ?? -Infinity });
    }
    pending.sort((a, b) => a.lastAttempt - b.lastAttempt);
    for (const { event, revision, key } of pending.slice(0, 5)) {
      let number: string | null | undefined;
      try {
        number = calendarMeetingNumber(await this.eventDetails(event, revision, email));
        proofs.set(revision, number);
      } catch { /* Keep syncing when one optional detail cannot be verified. */ }
      if (this.linkEvidence.size >= 512) this.linkEvidence.delete(this.linkEvidence.keys().next().value!);
      this.linkEvidence.set(key, { at: this.now(), number });
    }
    return proofs;
  }

  private async readRange(start: string, end: string, prune: boolean, retryMailbox: boolean): Promise<{ result: WelinkAgenda; changes: WelinkSyncResult }> {
    let email = '';
    const before = this.todo.all(true);
    const observed = new Map(before.filter(task => task.external).map(task => [task.id, sourceRevision(task)]));
    const changedDuringFetch = (task: Task) => !!task.external && observed.get(task.id) !== sourceRevision(task);
    const result = await this.client.query(start, end, account => (email = this.email(account).trim().toLowerCase()), retryMailbox);
    const proofs = await this.prefetchLinkEvidence(result, email, before);
    if (await this.client.account() !== result.account) throw new Error('同步期间账号发生变化，请重新同步；已保留原有日程。');
    if (email !== this.email(result.account).trim().toLowerCase()) throw new Error('同步期间邮箱配置发生变化，请重新同步；已保留原有日程。');
    const previousAccount = this.account;
    const changes: WelinkSyncResult = { added: 0, updated: 0, removed: 0 };
    this.todo.transaction(() => {
      const seen = new Set<string>(), touched = new Set<string>();
      const records = this.todo.all(true);
      for (const event of result.events) {
        const id = identity(event.external);
        seen.add(id);
        const existing = records.find(t => t.id === id || t.external && identity(t.external) === id) ?? (event.external.provider === 'meeting' ? records.find(t => t.id === `welink:${event.meetingId}` && t.source === 'welink' && !t.external) : undefined);
        if (existing && changedDuringFetch(existing)) continue;
        if (event.cancelled) {
          if (existing && !existing.deletedAt) { this.todo.put({ ...existing, deletedAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() }); changes.removed++; }
          continue;
        }
        const task = this.toTask(existing?.id ?? id, event, existing);
        touched.add(task.id);
        if (!existing) { this.todo.put(task); changes.added++; }
        else if (sourceRevision(existing) !== sourceRevision(task)) {
          this.todo.put(task); changes.updated++;
        }
      }
      // A provider may no longer list old meetings. Absence only prunes fully covered current/future rows.
      const pruneFrom = dayMillis(start < chinaDay(this.now()) ? chinaDay(this.now()) : start);
      if (prune) for (const existing of records) {
        const source = existing.external;
        if (!source || existing.deletedAt || existing.source !== 'welink' || welinkAccount(source) !== result.account || changedDuringFetch(existing)) continue;
        // Only a complete snapshot of this source/account/window may remove an absent record.
        if (result.sources[source.provider].state !== 'success' || seen.has(identity(source)) || !existing.dateAt || !existing.endAt) continue;
        if (Date.parse(existing.dateAt) < pruneFrom || Date.parse(existing.endAt) > dayMillis(end)) continue;
        this.todo.put({ ...existing, deletedAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString() }); changes.removed++;
      }
      const date = new Date(this.now()).toISOString();
      const accountRows = this.todo.all().filter(task => task.source === 'welink' && task.external && welinkAccount(task.external) === result.account);
      const links = recheckWelinkLinks(accountRows, touched, proofs, date);
      const rows = accountRows.map(task => {
        if (!links.has(task)) return task;
        touched.add(task.id);
        this.todo.put(task = { ...task, welinkLinkedTo: links.get(task), updatedAt: new Date(Math.max(this.now(), Date.parse(task.updatedAt) + 1)).toISOString() });
        changes.updated++;
        return task;
      });
      // The second source can appear after the user has already processed the first.
      const peers = welinkMeetingPeers(rows), paired = new Set<string>();
      for (const task of rows) {
        if (!touched.has(task.id) || paired.has(task.id)) continue;
        const peer = peers.get(task);
        if (!peer) continue;
        paired.add(peer.id);
        const pair = [task, peer];
        const completed = pair.find(row => row.status === 'done');
        const snoozed = pair.filter(row => row.remindAt && row.remindAt !== row.dateAt).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
        const notified = pair.some(row => row.remindAt && row.notifiedFor === row.remindAt);
        for (const row of pair) {
          const remindAt = snoozed?.remindAt ?? row.remindAt;
          const notifiedFor = snoozed ? snoozed.notifiedFor : notified ? remindAt : row.notifiedFor;
          const status = completed ? 'done' : row.status;
          const completedAt = row.completedAt ?? completed?.completedAt ?? null;
          if (status === row.status && completedAt === row.completedAt && remindAt === row.remindAt && notifiedFor === row.notifiedFor) continue;
          this.todo.put({ ...row, status, completedAt, remindAt, notifiedFor,
            updatedAt: new Date(Math.max(this.now(), Date.parse(row.updatedAt) + 1)).toISOString() });
          changes.updated++;
        }
      }
    });
    this.account = result.account;
    const previousMailbox = this.syncStatus.mailbox;
    if (previousAccount && previousAccount !== this.account) {
      this.syncStatus = { syncing: this.syncStatus.syncing, lastSuccessAt: null, error: '' }; this.lastAgenda = null; this.weeks.clear(); this.detailsCache.clear(); this.linkEvidence.clear();
    }
    const calendar = result.sources.calendar;
    this.syncStatus.mailbox = { account: result.account, source: { ...calendar, lastSuccessAt: calendar.lastSuccessAt ?? (previousMailbox?.account === result.account ? previousMailbox.source.lastSuccessAt : null) } };
    if (!this.syncStatus.syncing) this.changed(this.status());
    if (changes.added || changes.updated || changes.removed || previousAccount !== this.account) this.recordsChanged();
    return { result, changes };
  }

  private toTask(id: string, event: WelinkEvent, existing?: Task): Task {
    const now = new Date(Math.max(this.now(), existing ? Date.parse(existing.updatedAt) + 1 : 0)).toISOString();
    const sameCalendarRevision = existing?.external?.provider === 'calendar' && event.external.provider === 'calendar'
      && !existing.deletedAt && calendarRevision(taskOccurrence(existing)) === calendarRevision(event);
    return { id, title: event.title.slice(0, 200), kind: 'meeting', status: existing?.status ?? 'todo', priority: 'medium', dateAt: event.start, endAt: event.end,
      remindAt: existing?.dateAt === event.start ? existing.remindAt : event.external.isAllDay ? null : event.start,
      categoryId: null, progress: null, note: [event.location, event.meetingNo ? `会议号 ${event.meetingNo}` : ''].filter(Boolean).join('\n').slice(0, 5000),
      source: 'welink', welinkMeetingId: event.meetingId ?? null, welinkMeetingNo: event.meetingNo || undefined, external: event.external,
      welinkLinkedTo: sameCalendarRevision ? existing?.welinkLinkedTo : existing?.welinkLinkedTo ? null : undefined,
      createdAt: existing?.createdAt ?? now, updatedAt: now, completedAt: existing?.completedAt ?? null, notifiedFor: existing?.dateAt === event.start ? existing.notifiedFor : null, deletedAt: null };
  }

  async details(taskId: string): Promise<WelinkEventDetails> {
    const task = this.todo.get(taskId);
    if (task.deletedAt || task.source !== 'welink' || !task.external) throw new Error('该事项没有外部日程详情。');
    const event = eventFromTask(task);
    const version = task.external.provider === 'calendar' ? calendarRevision(event) : task.updatedAt;
    return this.eventDetails(event, version, this.email(welinkAccount(task.external)));
  }

  private async eventDetails(event: WelinkEvent, version: string, email: string): Promise<WelinkEventDetails> {
    const account = welinkAccount(event.external);
    const key = JSON.stringify([identity(event.external), version, email.trim().toLowerCase()]);
    const cached = this.detailsCache.get(key);
    const pending = this.detailsPending.get(key);
    const reusable = cached && this.now() - cached.at < 600000;
    if (reusable || pending) {
      if (account !== await this.client.account()) throw new Error('日程所属账号与当前账号不一致，请重新同步。');
      if (reusable) return cached.value;
      if (pending) return pending;
    }
    const request = this.client.details(event, email).then(value => {
      if (this.detailsCache.size >= 100) this.detailsCache.clear();
      this.detailsCache.set(key, { at: this.now(), value }); return value;
    }).finally(() => { this.detailsPending.delete(key); });
    this.detailsPending.set(key, request); return request;
  }
}
