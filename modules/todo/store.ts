import { taskDay } from '../../shared/todo-date';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import type { ChatSession, ChatSummary } from '../../shared/todo-contracts';
import { aiPlanSchema, categoryInputSchema, localDay, taskInputSchema, taskPatchSchema, type AIPlan, type Category, type Task, type TaskInput } from '../../shared/todo-contracts';
import { meetingEndAt, scheduleStamp } from '../../shared/todo-format';
import { migrateTaskDate } from '../../shared/todo-date';
import { migrateTaskDates } from './date-migration';
import { welinkMeetingPeer, welinkMeetingPeers } from '../../shared/welink-display';

const peerClaims = Symbol('peerClaims');
type ReminderClaim = Task & { [peerClaims]?: Pick<Task, 'id' | 'remindAt'> };

export class Store {
  readonly db: DatabaseSync;
  constructor(file: string, mode: 'standalone' | 'shared-tasks' = 'standalone', legacyFile?: string) {
    this.db = new DatabaseSync(file);
    if (mode === 'shared-tasks') {
      try {
        this.db.exec('PRAGMA busy_timeout=5000;');
        // 两端首次启动也只初始化一次，共享库通过版本号记录提交结果。
        this.transaction(() => {
          const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
          const tables = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(row => row.name);
          if (version === 0 && tables.length === 0) {
            this.db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
              CREATE TABLE categories (id TEXT PRIMARY KEY, payload TEXT NOT NULL);`);
            if (legacyFile && statSync(legacyFile, { throwIfNoEntry: false })) this.importLegacyTasks(legacyFile);
            this.db.exec('PRAGMA user_version=4;');
          } else if ((version !== 3 && version !== 4) || !tables.includes('tasks') || !tables.includes('categories')) {
            throw new Error(`待办共享库结构不兼容(版本 ${version}),请同步升级 OnO 和 CMO`);
          }
        });
        this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
        migrateTaskDates(this.db);
      } catch (error) {
        this.db.close();
        throw error;
      }
      return;
    }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chats (id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      `);
    const version = (this.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
    if (version === 0) this.db.exec('PRAGMA user_version=4;');
    else migrateTaskDates(this.db);
    this.recoverChats();
  }
  private importLegacyTasks(file: string): void {
    const source = new DatabaseSync(file, { readOnly: true, timeout: 5000 });
    try {
      source.exec('BEGIN');
      const version = source.prepare('PRAGMA user_version').get()?.user_version;
      if (version !== 3 && version !== 4) throw new Error(`无法导入原待办库(版本 ${version})`);
      for (const table of ['tasks', 'categories']) {
        const insert = this.db.prepare(`INSERT INTO ${table}(id,payload) VALUES (?,?)`);
        const rows = source.prepare(`SELECT id,payload FROM ${table}`).iterate() as Iterable<{ id: string; payload: string }>;
        for (const { id, payload } of rows) {
          const value = version === 3 && table === 'tasks' ? JSON.stringify(migrateTaskDate(JSON.parse(payload))) : payload;
          insert.run(id, value);
        }
      }
      source.exec('COMMIT');
    } finally { source.close(); }
  }
  chats(): ChatSummary[] {
    return (this.db.prepare('SELECT payload FROM chats').all() as { payload: string }[])
      .map(row => { const { id, title, updatedAt } = JSON.parse(row.payload) as ChatSession; return { id, title, updatedAt }; })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  chat(id: string): ChatSession {
    const row = this.db.prepare('SELECT payload FROM chats WHERE id=?').get(id) as { payload: string } | undefined;
    if (!row) throw new Error('对话不存在，请重新选择');
    return JSON.parse(row.payload) as ChatSession;
  }
  saveChat(chat: ChatSession): ChatSession {
    const next = { ...chat, updatedAt: new Date().toISOString() };
    this.db.prepare('INSERT OR REPLACE INTO chats(id,payload) VALUES (?,?)').run(next.id, JSON.stringify(next));
    return next;
  }
  newChat(): ChatSession {
    const chat = this.saveChat({ id: randomUUID(), title: '新对话', updatedAt: new Date().toISOString(), entries: [], draft: '' });
    this.setSetting('activeChatId', chat.id);
    return chat;
  }
  deleteChat(id: string): ChatSession {
    const all = this.chats();
    const index = all.findIndex(item => item.id === id);
    if (index < 0) throw new Error('对话不存在，请重新选择');
    this.db.prepare('DELETE FROM chats WHERE id=?').run(id);
    const active = this.setting('activeChatId', '');
    if (active && active !== id) return this.chat(active);
    const remaining = all.filter(item => item.id !== id);
    const next = remaining[Math.min(index, remaining.length - 1)];
    if (next) { this.setSetting('activeChatId', next.id); return this.chat(next.id); }
    return this.newChat();
  }
  resolveChatProposal(token: string, state: 'applied' | 'discarded' | 'expired' | 'revised'): ChatSession | undefined {
    for (const summary of this.chats()) {
      const chat = this.chat(summary.id);
      const entry = chat.entries.find(item => item.proposal?.token === token && item.actionState === 'pending');
      if (!entry) continue;
      entry.actionState = state;
      return this.saveChat(chat);
    }
  }
  updateChatProposal(token: string, actions: AIPlan['actions']): ChatSession {
    for (const summary of this.chats()) {
      const chat = this.chat(summary.id);
      const entry = chat.entries.find(item => item.proposal?.token === token && item.actionState === 'pending');
      if (!entry?.proposal) continue;
      entry.proposal = { ...entry.proposal, actions };
      return this.saveChat(chat);
    }
    throw new Error('建议已应用或已过期，请重新生成');
  }
  recoverChats(): void {
    this.transaction(() => {
      for (const summary of this.chats()) {
        const chat = this.chat(summary.id);
        let changed = false;
        for (const entry of chat.entries) {
          if (entry.streaming) {
            entry.streaming = false; entry.error = '上次回复因应用退出而中断，可以重新发送。'; changed = true;
            for (const tool of entry.tools ?? []) if (tool.status === 'running') tool.status = 'interrupted';
            chat.draft ||= [...chat.entries].reverse().find(item => item.role === 'user')?.content ?? '';
          }
          if (entry.actionState === 'pending') { entry.actionState = 'expired'; changed = true; }
        }
        if (changed) this.saveChat(chat);
      }
    });
  }
  all(includeDeleted = false): Task[] {
    return (this.db.prepare('SELECT payload FROM tasks').all() as { payload: string }[])
      .map(row => this.normalizeTask(JSON.parse(row.payload) as Task)).filter(t => includeDeleted || !t.deletedAt);
  }
  get(id: string): Task {
    const row = this.db.prepare('SELECT payload FROM tasks WHERE id=?').get(id) as { payload: string } | undefined;
    if (!row) throw new Error('事项不存在，请刷新后重试');
    return this.normalizeTask(JSON.parse(row.payload));
  }
  normalizeTask(task: Task): Task {
    task = migrateTaskDate(task);
    return { ...task, endAt: task.kind === 'meeting' && !task.external ? task.endAt ?? meetingEndAt(task) : task.endAt ?? null, categoryId: task.categoryId ?? null, progress: typeof task.progress === 'number' ? task.progress : null, priority: task.priority === 'high' || task.priority === 'low' ? task.priority : 'medium', source: task.source ?? 'local', welinkMeetingId: task.welinkMeetingId ?? null };
  }
  put(task: Task): Task {
    task = this.normalizeTask(task);
    this.db.prepare('INSERT OR REPLACE INTO tasks(id,payload) VALUES (?,?)').run(task.id, JSON.stringify(task));
    return task;
  }
  create(input: unknown): Task {
    const data = taskInputSchema.parse(input);
    if (data.kind === 'meeting' && !data.dateAt) throw new Error('请设置日程时间');
    this.assertCategory(data.categoryId);
    const now = new Date().toISOString();
    return this.put({ ...data, id: randomUUID(), createdAt: now, updatedAt: now,
      completedAt: data.status === 'done' ? now : null, notifiedFor: null, deletedAt: null });
  }
  update(id: string, patch: unknown, revision?: string): Task {
    return this.db.isTransaction ? this.updateTask(id, patch, revision) : this.transaction(() => this.updateTask(id, patch, revision));
  }
  private updateTask(id: string, patch: unknown, revision?: string): Task {
    const old = this.get(id);
    if (old.deletedAt) throw new Error('这条事项已删除');
    if (revision && old.updatedAt !== revision) throw new Error('事项已在其他操作中更新，请重新打开后修改');
    // WeLink 会议信息保持只读，完成仅记在本地，保留原始来源与会议内容。
    if (old.source === 'welink') {
      const completion = taskPatchSchema.pick({ status: true }).required().safeParse(patch);
      if (!completion.success || completion.data.status !== 'done') throw new Error(`${old.external?.provider === 'calendar' ? '邮箱日历' : 'WeLink'} 同步的日程不能在 CMO 编辑会议信息，仅支持在本地标记完成`);
      const peer = welinkMeetingPeer(old, this.all());
      const now = new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1, peer ? Date.parse(peer.updatedAt) + 1 : 0)).toISOString();
      const completedAt = old.completedAt ?? peer?.completedAt ?? now;
      if (peer && peer.status !== 'done') this.put({ ...peer, status: 'done', completedAt, updatedAt: now });
      return this.put({ ...old, status: 'done', completedAt, updatedAt: now });
    }
    const next = taskInputSchema.parse({ ...this.fields(old), ...taskPatchSchema.parse(patch) });
    if (next.kind === 'meeting' && old.kind !== 'meeting' && !next.dateAt) throw new Error('请设置日程时间');
    this.assertCategory(next.categoryId);
    const now = new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1)).toISOString();
    return this.put({ ...old, ...next, updatedAt: now,
      completedAt: next.status === 'done' ? old.completedAt ?? now : null,
      notifiedFor: next.remindAt !== old.remindAt || (old.status === 'done' && next.status !== 'done') ? null : old.notifiedFor });
  }
  fields(task: Task): TaskInput {
    const { title, kind, status, priority, dateAt, endAt, scheduledTime, remindAt, categoryId, progress, note, attendees, location, meetingUrl, source, welinkMeetingId } = task;
    return { title, kind, status, priority, dateAt, endAt: endAt ?? null, scheduledTime, remindAt, categoryId, progress, note, attendees, location, meetingUrl, source, welinkMeetingId: welinkMeetingId ?? null };
  }
  categories(): Category[] {
    return (this.db.prepare('SELECT payload FROM categories').all() as { payload: string }[])
      .map(row => JSON.parse(row.payload) as Category)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  getCategory(id: string): Category {
    const row = this.db.prepare('SELECT payload FROM categories WHERE id=?').get(id) as { payload: string } | undefined;
    if (!row) throw new Error('标签不存在，请刷新后重试');
    return JSON.parse(row.payload);
  }
  putCategory(category: Category): Category {
    this.db.prepare('INSERT OR REPLACE INTO categories(id,payload) VALUES (?,?)').run(category.id, JSON.stringify(category));
    return category;
  }
  hasCategory(id: string): boolean {
    return !!(this.db.prepare('SELECT 1 FROM categories WHERE id=?').get(id));
  }
  assertCategory(id: string | null): void { if (id) this.getCategory(id); }
  assertUniqueCategory(name: string, exceptId?: string, ignoreIds: Set<string> = new Set()): void {
    const normalized = name.trim().toLocaleLowerCase('zh-CN');
    if (this.categories().some(category => category.id !== exceptId && !ignoreIds.has(category.id) && category.name.toLocaleLowerCase('zh-CN') === normalized)) {
      throw new Error('已有同名标签');
    }
  }
  createCategory(input: unknown): Category {
    const data = categoryInputSchema.parse(input);
    this.assertUniqueCategory(data.name);
    const now = new Date().toISOString();
    return this.putCategory({ ...data, id: randomUUID(), createdAt: now, updatedAt: now });
  }
  updateCategory(id: string, input: unknown, revision: string): Category {
    const old = this.getCategory(id);
    if (old.updatedAt !== revision) throw new Error('标签已在其他操作中更新，请刷新后重试');
    const data = categoryInputSchema.parse(input);
    this.assertUniqueCategory(data.name, id);
    const updatedAt = new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1)).toISOString();
    return this.putCategory({ ...old, ...data, updatedAt });
  }
  dropCategory(id: string): void {
    for (const task of this.all(true).filter(item => item.categoryId === id)) {
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1)).toISOString();
      this.put({ ...task, categoryId: null, updatedAt });
    }
    this.db.prepare('DELETE FROM categories WHERE id=?').run(id);
  }
  removeCategory(id: string, revision: string): void {
    const category = this.getCategory(id);
    if (category.updatedAt !== revision) throw new Error('标签已在其他操作中更新，请刷新后重试');
    this.transaction(() => this.dropCategory(id));
  }
  remove(id: string, revision: string): void {
    const task = this.get(id);
    // WeLink 同步来的事项不可在 CMO 删除;轮询同步会按 WeLink 侧状态自动软删。
    if (task.source === 'welink') throw new Error(task.external?.provider === 'calendar' ? '邮箱日历同步的日程不能在 CMO 删除，请在原邮箱日历中取消。' : 'WeLink 同步的日程不能在 CMO 删除，请在 WeLink 客户端取消会议');
    if (task.updatedAt !== revision) throw new Error('事项已更新，请重新打开后删除');
    const now = new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1)).toISOString();
    this.put({ ...task, deletedAt: now, updatedAt: now });
  }
  restore(id: string): void {
    const task = this.get(id);
    this.put({ ...task, deletedAt: null, updatedAt: new Date(Math.max(Date.now(), Date.parse(task.updatedAt) + 1)).toISOString() });
  }
  snooze(id: string, now = new Date()): Task {
    return this.transaction(() => {
      const old = this.get(id);
      const peer = old.source === 'welink' && old.external ? welinkMeetingPeer(old, this.all()) : undefined;
      if (old.deletedAt || old.status === 'done' || peer?.status === 'done') throw new Error('已完成或已删除的事项不能稍后提醒');
      // A snooze deliberately may be later than the due time; it must not change the deadline.
      const remindAt = new Date(now.getTime() + 600000).toISOString();
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1, peer ? Date.parse(peer.updatedAt) + 1 : 0)).toISOString();
      if (peer) this.put({ ...peer, remindAt, notifiedFor: null, updatedAt });
      return this.put({ ...old, remindAt, notifiedFor: null, updatedAt });
    });
  }
  private dueGroups(now: Date, visible: (task: Task) => boolean): ReminderClaim[] {
    const tasks = this.all(), grouped = new Set<string>(), peers = welinkMeetingPeers(tasks);
    const due = tasks.filter(task => task.status !== 'done' && task.remindAt && Date.parse(task.remindAt) <= now.getTime() && task.notifiedFor !== task.remindAt && visible(task));
    due.sort((a, b) => Date.parse(a.remindAt!) - Date.parse(b.remindAt!));
    return due.flatMap(task => {
      if (grouped.has(task.id)) return [];
      const peer = peers.get(task);
      if (!peer) return [task];
      if (peer.status === 'done' || peer.remindAt && peer.notifiedFor === peer.remindAt) return [];
      const primary = peer.external?.provider === 'calendar' && peer.remindAt && visible(peer) ? peer : task;
      if (Date.parse(primary.remindAt!) > now.getTime()) return [];
      const other = primary === peer ? task : peer;
      grouped.add(task.id); grouped.add(peer.id);
      return [{ ...primary, [peerClaims]: { id: other.id, remindAt: other.remindAt } }];
    });
  }
  due(now = new Date()): Task[] { return this.dueGroups(now, () => true); }
  // 主窗口和独立 Bot Host 共用同一个认领事务；能明确匹配的两条记录只发一份提醒。
  claimDue(now = new Date(), visible: (task: Task) => boolean = () => true): Task[] {
    return this.transaction(() => {
      const claimed = this.dueGroups(now, visible);
      for (const task of claimed) {
        const peer = task[peerClaims];
        // Do not serialize the transient claim pointer into the shared tasks table.
        this.put({ ...task, notifiedFor: task.remindAt });
        if (peer?.remindAt) this.put({ ...this.get(peer.id), notifiedFor: peer.remindAt });
      }
      return claimed;
    });
  }
  unclaim(task: ReminderClaim): void {
    this.transaction(() => {
      for (const claim of [task, task[peerClaims]]) {
        if (!claim?.remindAt) continue;
        const current = this.get(claim.id);
        if (current.remindAt === claim.remindAt && current.notifiedFor === claim.remindAt) this.put({ ...current, notifiedFor: null });
      }
    });
  }
  markNotified(tasks: Task[]): void {
    this.transaction(() => { for (const task of tasks) {
      const current = this.get(task.id);
      if (current.remindAt === task.remindAt) this.put({ ...current, notifiedFor: task.remindAt });
    } });
  }
  setting<T>(key: string, fallback: T): T {
    const row = this.db.prepare('SELECT value FROM settings WHERE key=?').get(key) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : fallback;
  }
  setSetting(key: string, value: unknown): void {
    this.db.prepare('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)').run(key, JSON.stringify(value));
  }
  transaction<T>(run: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = run(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  applyPlan(input: AIPlan, revisions: Map<string, string>, proposalToken?: string) {
    const plan = aiPlanSchema.parse(input);
    return this.transaction(() => {
      const removing = new Set(plan.actions.filter(action => action.type === 'remove_category').map(action => action.id));
      for (const action of plan.actions) {
        if ((action.type === 'update' || action.type === 'remove') && this.get(action.id).updatedAt !== revisions.get(action.id)) throw new Error('AI 建议中的事项已变化，请重新生成建议');
        if ((action.type === 'update_category' || action.type === 'remove_category') && this.getCategory(action.id).updatedAt !== revisions.get(action.id)) {
          throw new Error('AI 建议中的标签已变化，请重新生成建议');
        }
        if ((action.type === 'create' && action.task.categoryId && removing.has(action.task.categoryId))
          || (action.type === 'update' && action.patch.categoryId && removing.has(action.patch.categoryId))) {
          throw new Error('不能把事项挂到将要删除的标签');
        }
      }
      const createdNames = new Set<string>();
      for (const action of plan.actions) {
        if (action.type !== 'create_category') continue;
        if (this.hasCategory(action.category.id)) throw new Error('标签已存在');
        const normalized = action.category.name.trim().toLocaleLowerCase('zh-CN');
        if (createdNames.has(normalized)) throw new Error('已有同名标签');
        createdNames.add(normalized);
        this.assertUniqueCategory(action.category.name, undefined, removing);
        const now = new Date().toISOString();
        this.putCategory({ ...action.category, createdAt: now, updatedAt: now });
      }
      for (const action of plan.actions) {
        if (action.type !== 'update_category') continue;
        const old = this.getCategory(action.id);
        const data = categoryInputSchema.parse({ name: old.name, color: old.color, ...action.patch });
        this.assertUniqueCategory(data.name, old.id, removing);
        const updatedAt = new Date(Math.max(Date.now(), Date.parse(old.updatedAt) + 1)).toISOString();
        this.putCategory({ ...old, ...data, updatedAt });
      }
      const createdIds: string[] = [], updatedIds = new Set<string>();
      for (const action of plan.actions) {
        if (action.type === 'create') createdIds.push(this.create(action.task).id);
        else if (action.type === 'update') updatedIds.add(this.update(action.id, action.patch).id);
        else if (action.type === 'remove') {
          const revision = revisions.get(action.id);
          if (revision === undefined) throw new Error('AI 建议缺少版本信息，请重新生成');
          this.remove(action.id, revision);
        }
      }
      for (const action of plan.actions) {
        if (action.type === 'remove_category') this.dropCategory(action.id);
      }
      if (proposalToken) this.resolveChatProposal(proposalToken, 'applied');
      return { created: createdIds.map(id => this.get(id)), updated: [...updatedIds].map(id => this.get(id)) };
    });
  }
  review(today = localDay()): string {
    const tasks = this.all();
    const completed = tasks.filter(t => t.completedAt && localDay(new Date(t.completedAt)) === today);
    const pending = tasks.filter(t => !t.deletedAt && t.status !== 'done' && (t.kind === 'task' || Boolean(taskDay(t) && taskDay(t)! <= today)));
    return `# ${today} 每日复盘\n\n## 已完成 · ${completed.length} 项\n${completed.map(t => `- ${t.title}${t.note ? `\n  ${t.note}` : ''}`).join('\n') || '今天还没有完成的事项。'}\n\n## 待继续 · ${pending.length} 项\n${pending.map(t => `- ${t.title}${t.dateAt ? `（${scheduleStamp(t)}）` : ''}`).join('\n') || '今天的事项都已处理。'}`;
  }
  close(): void { this.db.close(); }
}
