import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AiStore } from '../electron/ai-store';
import { BotStore, legacyBotOwner, nextScheduleAt } from '../electron/bot-store';
import { BotHost, type BotExecutor } from '../electron/bot-host';
import type { MemoryChange } from '../electron/bot-memory';
import { botService } from '../electron/bot-service';
import { configurationSections, type BotArtifact, type BotProfile, type BotSchedule, type BotSubmit, type BotTask } from '../shared/bot-contracts';

const main = { id: 'main:1', kind: 'main' as const }, island = { id: 'island:2', kind: 'island' as const };
function fixture(executor: BotExecutor = { run: async () => ({ reply: '已处理' }), apply: async () => ({ saved: true }) }) {
  const dir = mkdtempSync(join(tmpdir(), 'ono-bot-test-')), ai = new AiStore(dir, { recover: false }), store = new BotStore(ai, dir), host = new BotHost(store, executor);
  return { dir, ai, store, host, close: async () => { await host.stop(); ai.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(dir.includes('ono-bot-')); rmSync(dir, { recursive: true, force: true }); } };
}
test('unifies the built-in agenda description once and preserves custom wording', async () => {
  const f = fixture();
  try {
    const card = f.store.cards().find(bot => bot.seedKey === 'schedule')!;
    const original = f.store.profile(card.id);
    assert.equal(original.description, '日程待办');
    const setDescription = f.ai.db.prepare("UPDATE bots SET payload=json_set(payload, '$.description', ?) WHERE id=?");
    const resetMigration = () => f.ai.db.prepare('DELETE FROM settings WHERE key=?').run('bot.scheduleDescription.2026-11-22');
    resetMigration();
    setDescription.run('日程和待办', card.id);
    const migrated = new BotStore(f.ai, f.dir).profile(card.id);
    assert.equal(migrated.description, '日程待办');
    assert.equal(migrated.mainChatId, original.mainChatId);
    assert.equal(migrated.revision, original.revision + 1);
    resetMigration();
    setDescription.run('自定义提醒工作区', card.id);
    const customized = new BotStore(f.ai, f.dir).profile(card.id);
    assert.equal(customized.description, '自定义提醒工作区');
    assert.equal(customized.revision, migrated.revision);
    setDescription.run('日程和待办', card.id);
    assert.equal(new BotStore(f.ai, f.dir).profile(card.id).description, '日程和待办');
  } finally { await f.close(); }
});

test('renames the existing default schedule Bot once and preserves a customized name', async () => {
  const f = fixture();
  try {
    const card = f.store.cards().find(bot => bot.seedKey === 'schedule')!;
    assert.equal(card.name, '日程助理');
    const original = f.store.profile(card.id);
    const setName = f.ai.db.prepare("UPDATE bots SET payload=json_set(payload, '$.name', ?) WHERE id=?");
    const resetMigration = () => f.ai.db.prepare('DELETE FROM settings WHERE key=?').run('bot.scheduleName.2026-11-23');
    resetMigration();
    setName.run('助理', card.id);
    const upgraded = new BotStore(f.ai, f.dir).profile(card.id);
    assert.deepEqual(upgraded, { ...original, revision: original.revision + 1, updatedAt: upgraded.updatedAt });
    assert.deepEqual(new BotStore(f.ai, f.dir).profile(card.id), upgraded);
    resetMigration();
    setName.run('日程与提醒', card.id);
    assert.deepEqual(new BotStore(f.ai, f.dir).profile(card.id), { ...upgraded, name: '日程与提醒' });
  } finally { await f.close(); }
});

function submission(f: ReturnType<typeof fixture>, text = '整理文章', key = 'coordinator'): BotSubmit {
  const bot = f.store.cards().find(b => b.seedKey === key)!;
  const state = f.host.getDraft(bot.mainChatId, main);
  const draft = f.host.saveDraft(bot.mainChatId, state.revision, { text, replyToTaskId: null, resources: [] }, main);
  return { botId: bot.id, chatId: bot.mainChatId, expectedDraftRevision: draft.revision, clientRequestId: randomUUID(), text, replyToTaskId: null, resources: [] };
}
async function until(check: () => boolean) { const deadline = Date.now() + 5000; while (!check()) { if (Date.now() > deadline) throw new Error('状态未到达'); await new Promise(r => setTimeout(r, 10)); } }

test('reports live automatic memory work and only committed results', async () => {
  const checks: { resolve(changes: MemoryChange[]): void; reject(error: Error): void }[] = [];
  const f = fixture({
    run: async (task, host) => ({ reply: '收到', memoryMessageIds: host.store.memoryInputs(task.id).map(input => input.messageId) }),
    reviewMemories: () => new Promise((resolve, reject) => checks.push({ resolve, reject })),
    apply: async () => null,
  });
  const status = () => f.host.automaticMemoryStatus();
  try {
    assert.deepEqual(botService(f.host, 'getAutomaticMemoryStatus', [], main), { enabled: false, pending: 0 });
    assert.throws(() => botService(f.host, 'getAutomaticMemoryStatus', [], island), { code: 'SURFACE_FORBIDDEN' });
    f.host.setAutomaticMemory(true);
    const input = submission(f, '我习惯周报先列风险');
    const receipt = f.host.submit(input, main);
    await until(() => status().activeBotId === input.botId);
    assert.equal(status().pending, 0);
    assert.equal(status().lastResult, undefined);
    const peer = submission(f, '这一轮临时确认一下', 'schedule');
    f.host.submit(peer, main);
    await until(() => status().pending === 1);
    checks[0].resolve([{ action: 'add', title: '周报顺序', text: '周报先列风险。', evidence: [{ messageId: receipt.messageId, quote: input.text }] }]);
    await until(() => status().lastResult?.added === 1 && status().activeBotId === peer.botId);
    const saved = status().lastResult!;
    assert.equal(saved.destination?.title, '周报顺序');
    assert.equal(saved.destination?.memoryId, f.store.memories(input.botId)[0].id);
    assert.deepEqual(new BotStore(f.ai, f.dir).lastMemoryReview(f.store.memoryEpoch()), saved);
    checks[1].resolve([]);
    await until(() => status().lastResult?.botId === peer.botId && !status().activeBotId);
    const unchanged = status().lastResult!;
    assert.equal(unchanged.added + unchanged.updated, 0);
    assert.equal(unchanged.destination, undefined);
    f.host.submit(submission(f, '再确认一个问题', 'schedule'), main);
    await until(() => checks.length === 3);
    checks[2].reject(new Error('检查失败'));
    await until(() => status().retryBotId === peer.botId);
    assert.equal(status().pending, 1);
    assert.deepEqual(status().lastResult, unchanged);
    f.host.setAutomaticMemory(false);
    assert.deepEqual(status(), { enabled: false, pending: 0 });
    f.host.setAutomaticMemory(true);
    assert.equal(status().pending, 0);
    assert.equal(status().lastResult, undefined);
  } finally { for (const check of checks) check.resolve([]); await f.close(); }
});

test('removes only the library listing and keeps the original artifact available after reopening', async () => {
  const f = fixture();
  try {
    const task = f.host.submit(submission(f, '生成资料'), main).task;
    const id = randomUUID();
    const artifact: BotArtifact = {
      id, producerBotId: task.botId, taskId: task.id, rootTaskId: task.rootTaskId, chatId: task.chatId,
      title: '需要删除的资料', mediaType: 'text/markdown', resource: { kind: 'artifact', id }, content: '保留的原正文', createdAt: task.createdAt,
    };
    const keepId = randomUUID();
    const keep: BotArtifact = { ...artifact, id: keepId, title: '仍在资料库的资料', resource: { kind: 'artifact', id: keepId } };
    f.store.artifact(artifact, 'removed');
    f.store.artifact(keep, 'kept');
    const list = (host: BotHost) => (botService(host, 'listArtifacts', [task.botId], main) as BotArtifact[]).map(item => item.id);
    assert.deepEqual(new Set(list(f.host)), new Set([id, keepId]));
    assert.throws(() => botService(f.host, 'removeArtifactFromLibrary', [id], island), { code: 'SURFACE_FORBIDDEN' });

    let notifications = 0;
    f.host.on('changed', event => { if (event.kind === 'artifact') notifications++; });
    botService(f.host, 'removeArtifactFromLibrary', [id], main);
    botService(f.host, 'removeArtifactFromLibrary', [id], main);
    assert.equal(notifications, 1);
    assert.deepEqual(list(f.host), [keepId]);

    const reopenedAi = new AiStore(f.dir, { recover: false });
    try {
      const reopenedStore = new BotStore(reopenedAi, f.dir);
      const reopened = new BotHost(reopenedStore, { run: async () => ({ reply: '' }), apply: async () => null });
      const { libraryRemovedAt, ...original } = botService(reopened, 'openArtifact', [id], main) as BotArtifact;
      assert.ok(libraryRemovedAt);
      assert.deepEqual(original, artifact);
      reopenedStore.artifact(artifact, 'removed');
      assert.deepEqual(list(reopened), [keepId]);
    } finally { reopenedAi.close(); }
  } finally { await f.close(); }
});

test('upgrade repairs skipped model bindings once and preserves explicit Bot selections', async () => {
  const f = fixture();
  try {
    const providerId = randomUUID(), first = randomUUID(), previousDefault = randomUUID();
    const config = {
      ...f.ai.readConfig(), aiEnabled: true, activeModelId: previousDefault,
      providers: [{ id: providerId, kind: 'custom' as const, name: 'fixture', endpoint: 'http://127.0.0.1:9/v1', protocol: 'openai-chat' as const, apiKey: '' }],
      models: [{ id: first, providerId, name: 'first' }, { id: previousDefault, providerId, name: 'previous-default' }],
    };
    f.ai.writeConfig(config);
    const clean = new BotStore(f.ai, f.dir);
    const coordinator = clean.cards().find(bot => bot.seedKey === 'coordinator')!;
    const schedule = clean.cards().find(bot => bot.seedKey === 'schedule')!;
    assert.equal(clean.profile(schedule.id).modelId, undefined, 'saving a model does not assign it to new Bots');
    const explicit = clean.updateProfile(coordinator.id, coordinator.revision, { ...clean.profile(coordinator.id), modelId: first });
    clean.updateProfile(schedule.id, schedule.revision, { ...clean.profile(schedule.id), modelId: null });

    const another = clean.cards().find(bot => bot.id !== coordinator.id && bot.id !== schedule.id)!;
    const removed = clean.updateProfile(another.id, another.revision, { ...clean.profile(another.id), modelId: randomUUID() });

    // Older releases could leave blank bindings even when the migration flag was true.
    f.ai.setSetting('bot.modelSelectionsMigrated', true);
    f.ai.writeConfig({ ...config, models: [config.models[0]] });
    assert.equal(new BotStore(f.ai, f.dir).profile(schedule.id).modelId, null, 'wait for the previously used model to be available');
    assert.equal(f.ai.setting<unknown>('bot.modelSelectionsMigrated', null), true);

    f.ai.writeConfig(config);
    const migrated = new BotStore(f.ai, f.dir);
    assert.deepEqual(migrated.profile(coordinator.id), explicit);
    assert.deepEqual(migrated.profile(removed.id), removed);
    const adopted = migrated.profile(schedule.id);
    assert.equal(adopted.modelId, previousDefault);
    assert.equal(adopted.revision, schedule.revision + 2);
    assert.ok(migrated.cards().every(bot => bot.modelId), 'fill every eligible inherited binding');
    assert.equal(f.ai.setting<unknown>('bot.modelSelectionsMigrated', null), 2);

    f.ai.writeConfig({ ...config, activeModelId: first, models: [config.models[0]] });
    assert.deepEqual(new BotStore(f.ai, f.dir).profile(schedule.id), adopted);
  } finally { await f.close(); }
});

test('contact activity follows actual execution, independently of waiting badges and delegation', async () => {
  const f = fixture();
  try {
    const parent = f.store.submit(submission(f), () => {}).task;
    const media = f.store.cards().find(bot => bot.seedKey === 'permission')!;
    const child = f.host.delegate(parent.id, randomUUID(), media.id, '协作处理', []);
    const card = (id: string) => f.store.cards().find(bot => bot.id === id)!;
    assert.equal(card(parent.botId).runningCount, 0, 'delegating does not pretend the parent is executing');
    assert.equal(card(parent.botId).activity, 'waiting_bot');
    assert.equal(card(media.id).activity, 'queued');
    assert.equal(card(media.id).runningCount, 0, 'queued work is not executing');
    f.store.updateTask(child.id, { status: 'running' });
    assert.equal(card(media.id).runningCount, 1);
    assert.equal(card(media.id).activity, 'thinking');
    const revision = f.store.task(child.id).revision, events: string[] = [];
    f.host.on('changed', event => events.push(event.kind));
    f.host.activity(child.id, 'searching'); f.host.activity(child.id, 'searching');
    assert.equal(card(media.id).activity, 'searching');
    assert.equal(f.store.task(child.id).revision, revision, 'visual stages must not invalidate task actions');
    assert.deepEqual(events, ['activity'], 'streamed tool updates do not repeatedly refresh the roster');
    assert.equal(card(parent.botId).runningCount, 0, 'another Bot can work while this one waits');
    for (const status of ['waiting_user', 'waiting_bot', 'waiting_resource', 'interrupted', 'completed', 'failed', 'cancelled'] as const) {
      f.store.updateTask(child.id, { status });
      assert.equal(card(media.id).runningCount, 0, status);
      assert.equal(card(media.id).waitingCount, status === 'waiting_user' ? 1 : 0, status);
      f.host.activity(child.id, 'working');
      assert.equal(card(media.id).activity, ['completed', 'failed', 'cancelled'].includes(status) ? 'idle' : status, 'late tool updates cannot revive waiting/finished work');
    }
    f.store.updateTask(parent.id, { status: 'running' });
    assert.equal(card(parent.botId).runningCount, 1, 'resumed work starts the indicator again');
    assert.equal(card(parent.botId).activity, 'thinking');
  } finally { await f.close(); }
});

test('running activity wins over old waits and only successful work changes the completion marker', async () => {
  const f = fixture();
  try {
    const waiting = f.store.submit(submission(f, '等待确认'), () => {}).task;
    f.store.updateTask(waiting.id, { status: 'waiting_user' });
    const active = f.store.submit(submission(f, '另一项正在执行'), () => {}).task;
    const card = () => f.store.cards().find(bot => bot.id === active.botId)!;
    f.store.updateTask(active.id, { status: 'running' }); f.host.activity(active.id, 'sending');
    assert.equal(card().activity, 'sending'); assert.equal(card().waitingCount, 1);
    f.store.updateTask(active.id, { status: 'completed' });
    const completion = card().completion;
    assert.ok(completion?.startsWith(active.id)); assert.equal(card().activity, 'waiting_user');
    const next = f.store.submit(submission(f, '失败或取消'), () => {}).task;
    for (const status of ['failed', 'cancelled', 'interrupted'] as const) {
      f.store.updateTask(next.id, { status }); assert.equal(card().completion, completion);
    }
    f.store.updateTask(waiting.id, { status: 'cancelled' });
    f.store.updateTask(next.id, { status: 'running' });
    assert.equal(card().activity, 'thinking', 'retry cannot inherit a stale tool phase');
    f.store.recover(); assert.equal(card().activity, 'interrupted');
    assert.equal(card().completion, completion);
  } finally { await f.close(); }
});

test('migration preserves original ownership, object histories, drafts and stable identities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ono-bot-migrate-'));
  let ai = new AiStore(dir, { recover: false });
  try {
    const todo = ai.newChat({ module: 'todo' }); todo.draft = '旧灵动岛输入'; ai.saveChat(todo);
    const object = ai.newChat({ module: 'reading', profileId: 'book-1' }); object.draft = '原稿意见'; ai.saveChat(object);
    const general = ai.newChat({ module: 'workbench', viewId: 'workspace:permission' });
    const pbi = ai.newChat({ module: 'workbench', viewId: 'pbi-modules' });
    const mixed = ai.newChat({ module: 'workbench', viewId: 'workspace:life' }); mixed.contextScope = { module: 'todo' }; ai.saveChat(mixed);
    const settings = ai.newChat({ module: 'workbench', viewId: 'settings-ai' });
    ai.db.prepare('INSERT INTO chats VALUES(?,?)').run('damaged', '{broken');
    const providerId = randomUUID(), priorModelId = randomUUID();
    ai.writeConfig({
      ...ai.readConfig(), activeModelId: priorModelId,
      providers: [{ id: providerId, kind: 'custom', name: 'fixture', endpoint: 'http://127.0.0.1:9/v1', protocol: 'openai-chat', apiKey: '' }],
      models: [{ id: priorModelId, providerId, name: 'old-model' }],
    });
    const store = new BotStore(ai, dir), ids = store.cards().map(b => b.id);
    assert.ok(store.cards().every(bot => bot.modelId === priorModelId), 'preserve the configured model when creating profiles from older data');
    assert.equal(store.cards().length, 4);
    assert.equal(store.cards().find(b => b.seedKey === 'schedule')!.mainChatId, todo.id);
    assert.equal(store.cards().find(b => b.seedKey === 'permission')!.mainChatId, general.id);
    assert.equal(store.link(pbi.id)?.role, 'history');
    assert.ok(store.open(store.cards().find(b => b.seedKey === 'permission')!.id).history.some(item => item.chatId === pbi.id));
    assert.equal(store.link(object.id)?.role, 'history');
    assert.equal(store.link(mixed.id)?.role, 'history');
    assert.equal(store.link(settings.id)?.bot_id, null);
    assert.match(store.link('damaged')!.reason!, /损坏/);
    assert.equal(store.draft(todo.id).text, '旧灵动岛输入');
    assert.equal(ai.chat(object.id).draft, '原稿意见');
    assert.equal(readdirSync(dir).filter(p => p.startsWith('chats-before-bots')).length, 1);
    ai.close(); ai = new AiStore(dir);
    assert.deepEqual(new BotStore(ai, dir).cards().map(b => b.id), ids);
    assert.equal(readdirSync(dir).filter(p => p.startsWith('chats-before-bots')).length, 1);
    ai.db.exec('PRAGMA user_version=999'); ai.close();
    assert.throws(() => new AiStore(dir), /更新版本/);
    ai = undefined as unknown as AiStore;
  } finally { ai?.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(dir.includes('ono-bot-')); rmSync(dir, { recursive: true, force: true }); }
});

test('new names apply to fresh Bots and upgrade the old defaults once without replacing profiles or drafts', () => {
  const names = {
    coordinator: ['总助理', '总管'], permission: ['权限助理', '配置管理管家'],
  } as const;
  const dir = mkdtempSync(join(tmpdir(), 'ono-bot-names-'));
  const ai = new AiStore(dir, { recover: false });
  try {
    const fresh = new BotStore(ai, dir);
    const previous = fresh.cards().map(card => {
      const profile = fresh.profile(card.id);
      if (card.seedKey === 'office') { assert.equal(profile.name, '办公助理'); return profile; }
      if (card.seedKey === 'schedule') { assert.equal(profile.name, '日程助理'); return profile; }
      const [oldName, newName] = names[card.seedKey];
      assert.equal(profile.name, newName);
      return fresh.updateProfile(card.id, card.revision, { ...profile, name: oldName, instructions: '已有的工作说明' });
    });
    const coordinator = previous.find(profile => profile.seedKey === 'coordinator')!;
    const draft = fresh.saveDraft(coordinator.mainChatId, fresh.draft(coordinator.mainChatId).revision, { text: '已有草稿', replyToTaskId: null, resources: [] });
    ai.db.prepare('DELETE FROM settings WHERE key=?').run('bot.defaultNames.2026-11-18');

    const upgraded = new BotStore(ai, dir);
    for (const profile of previous) {
      const actual = upgraded.profile(profile.id);
      if (profile.seedKey === 'office' || profile.seedKey === 'schedule') assert.deepEqual(actual, profile);
      else assert.deepEqual(actual, { ...profile, name: names[profile.seedKey][1], revision: profile.revision + 1, updatedAt: actual.updatedAt });
    }
    assert.deepEqual(upgraded.draft(coordinator.mainChatId), draft);
    const renamed = upgraded.profile(coordinator.id);
    upgraded.updateProfile(renamed.id, renamed.revision, { ...renamed, name: names.coordinator[0] });
    assert.equal(new BotStore(ai, dir).profile(renamed.id).name, names.coordinator[0]);
  } finally {
    ai.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); rmSync(dir, { recursive: true, force: true });
  }
});

test('configuration merge preserves the main chat, archives legacy drafts and keeps original work accessible', async () => {
  const f = fixture();
  try {
    const card = f.store.cards().find(bot => bot.seedKey === 'permission')!;
    const profile = f.store.updateProfile(card.id, card.revision, { ...f.store.profile(card.id), name: '权限管家', description: '权限管理', instructions: '既有工作说明', modelId: randomUUID() });
    const mainDraft = f.store.saveDraft(profile.mainChatId, 0, { text: '权限草稿', replyToTaskId: null, resources: [] });
    const archived = configurationSections.slice(1).map(section => {
      const chat = f.ai.newChat({ module: 'workbench', viewId: `workspace:${section.id}` });
      const old: BotProfile = { ...profile, id: randomUUID(), seedKey: section.id, workspaceId: section.id, name: section.label, mainChatId: chat.id };
      f.ai.db.prepare('INSERT INTO bots VALUES(?,?,?,?)').run(old.id, old.seedKey, old.workspaceId, JSON.stringify(old));
      f.ai.db.prepare("INSERT INTO bot_chat_links(chat_id,bot_id,role) VALUES(?,?,'main')").run(chat.id, old.id);
      return old;
    });
    const pbi = archived.find(bot => bot.seedKey === 'pbi')!;
    const previousDraft = f.store.saveDraft(pbi.mainChatId, 0, { text: '旧 PBI 核对', replyToTaskId: null, resources: [] });
    const { task: source, draft: clearedDraft } = f.store.submit({ botId: pbi.id, chatId: pbi.mainChatId, text: previousDraft.text, expectedDraftRevision: previousDraft.revision, clientRequestId: randomUUID(), replyToTaskId: null, resources: [] }, () => {});
    f.store.updateTask(source.id, { status: 'waiting_user' });
    f.store.saveDraft(pbi.mainChatId, clearedDraft.revision, { text: '尚未发送的 PBI 草稿', replyToTaskId: null, resources: [] });
    const artifactId = randomUUID(), scheduleId = randomUUID();
    f.store.artifact({ id: artifactId, producerBotId: pbi.id, taskId: source.id, rootTaskId: source.id, chatId: pbi.mainChatId, title: '旧产物', mediaType: 'text/markdown', resource: { kind: 'artifact', id: artifactId }, createdAt: source.createdAt }, 'fixture');
    f.store.saveSchedule({ id: scheduleId, botId: pbi.id, revision: 0, title: '旧日常工作', prompt: '核对 PBI', enabled: false, spec: { kind: 'interval', minutes: 60 } });
    f.ai.db.prepare('DELETE FROM settings WHERE key=?').run('bot.configurationManagementMerged');

    const store = new BotStore(f.ai, f.dir);
    const host = new BotHost(store, { run: async () => ({ reply: '' }), apply: async () => ({}) });
    const merged = store.cards().find(bot => bot.id === profile.id)!;
    assert.equal(store.cards().length, 4);
    assert.equal(merged.name, '配置管理管家');
    assert.equal(merged.mainChatId, profile.mainChatId);
    assert.equal(merged.modelId, profile.modelId);
    assert.equal(store.profile(merged.id).instructions, profile.instructions);
    assert.equal(merged.waitingCount, 1);
    assert.deepEqual(store.draft(merged.mainChatId), mainDraft);
    const history = store.open(merged.id).history;
    assert.deepEqual(new Set(history.map(item => item.chatId)), new Set(archived.map(bot => bot.mainChatId)));
    assert.ok(history.every(item => item.canReference));
    assert.equal(f.ai.chat(pbi.mainChatId).draft, '尚未发送的 PBI 草稿');
    assert.throws(() => host.getDraft(pbi.mainChatId, main), /历史对话仅供查阅/);
    assert.equal((botService(host, 'listTasks', [merged.id], main) as BotTask[])[0].id, source.id);
    assert.equal((botService(host, 'listArtifacts', [merged.id], main) as BotArtifact[])[0].id, artifactId);
    assert.equal((botService(host, 'listSchedules', [merged.id], main) as BotSchedule[])[0].id, scheduleId);
    assert.deepEqual(botService(host, 'getConversationEntries', [source.id], main), store.conversationEntries(source));
    for (const section of configurationSections) for (const viewId of section.views) {
      const scope = { module: 'workbench' as const, viewId };
      host.validateContext(merged.id, { scope, pageScope: scope }, []);
    }
    host.validateContext(merged.id, undefined, [{ kind: 'chat', id: pbi.mainChatId }, { kind: 'artifact', id: artifactId }]);
    assert.throws(() => host.validateContext(merged.id, { scope: { module: 'workbench', viewId: 'office' } }, []), /不属于这个 Bot/);
    assert.throws(() => host.sendMessage(merged.id, 'new-message', pbi.id, '核对', 'query'), /请选择配置管理管家/);
    assert.deepEqual(new BotStore(f.ai, f.dir).profile(merged.id), store.profile(merged.id));
  } finally { await f.close(); }
});

test('unknown and malformed scopes never silently become todo', () => {
  assert.equal(legacyBotOwner({ module: 'unknown' }).key, undefined);
  assert.equal(legacyBotOwner({ module: 'copy' }).key, undefined);
  assert.equal(legacyBotOwner({ module: null }).key, undefined);
  assert.equal(legacyBotOwner({}).key, 'schedule');
  assert.equal(legacyBotOwner({ module: 'workbench', viewId: 'bazi' }).key, undefined);
  assert.equal(legacyBotOwner({ module: 'todo', contextScope: { module: 'copy', draftId: 'private' } }).main, false);
  assert.equal(legacyBotOwner({ module: 'workbench', viewId: 'workspace:permission', entries: [{ contextScope: { module: 'copy', draftId: 'private' } }] }).main, false);
});

test('migration failure rolls back schema and bindings without losing legacy rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ono-bot-rollback-')), ai = new AiStore(dir, { recover: false });
  try {
    const old = ai.newChat();
    ai.db.exec("CREATE TRIGGER reject_chat BEFORE INSERT ON chats BEGIN SELECT RAISE(FAIL,'injected storage failure'); END");
    assert.throws(() => new BotStore(ai, dir), /injected/);
    assert.equal((ai.db.prepare('PRAGMA user_version').get() as any).user_version, 1);
    assert.equal(ai.chats().length, 1); assert.equal(ai.chat(old.id).id, old.id);
    assert.equal(ai.db.prepare("SELECT name FROM sqlite_master WHERE name='bots'").get(), undefined);
    ai.db.exec('DROP TRIGGER reject_chat'); assert.equal(new BotStore(ai, dir).cards().length, 4);
  } finally { ai.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(dir.includes('ono-bot-')); rmSync(dir, { recursive: true, force: true }); }
});

test('main and island drafts are isolated while stale writes within one entry are rejected', async () => {
  const f = fixture();
  try {
    const id = f.host.coordinator().mainChatId;
    const draft = f.host.saveDraft(id, 0, { text: '主窗口输入', replyToTaskId: null, resources: [] }, main);
    assert.throws(() => f.host.saveDraft(id, 0, { text: '旧防抖', replyToTaskId: null, resources: [] }, main), /草稿已更新/);
    const second = f.host.saveDraft(id, 0, { text: '灵动岛输入', replyToTaskId: null, resources: [] }, island);
    assert.equal(f.host.getDraft(id, main).text, draft.text); assert.equal(f.host.getDraft(id, island).text, second.text);
    const media = f.store.cards().find(b => b.seedKey === 'permission')!;
    f.host.getDraft(media.mainChatId, main);
    assert.throws(() => f.host.getDraft(media.mainChatId, island), /只连接总 Bot/);
    assert.throws(() => botService(f.host, 'saveDraft', [media.mainChatId, 0, { text: '跨域', replyToTaskId: null, resources: [] }], island), /只连接总 Bot/);
    assert.equal((botService(f.host, 'getDraft', [id, 'main'], island) as any).surface, 'island', 'draft origin comes from the authenticated window');
  } finally { await f.close(); }
});

test('suspend, resume and a new window identity never require a draft lease', async () => {
  const f = fixture(); let time = 100;
  const host = new BotHost(f.store, { run: async () => ({ reply: '' }), apply: async () => null }, () => time);
  try {
    const id = host.coordinator().mainChatId;
    host.saveDraft(id, 0, { text: '休眠前的主窗口输入', replyToTaskId: null, resources: [] }, main);
    host.suspend(); time += 86400000; host.resume();
    const restored = host.getDraft(id, { id: 'main:reopened', kind: 'main' });
    const next = host.saveDraft(id, restored.revision, { text: '唤醒后直接输入', replyToTaskId: null, resources: [] }, main);
    assert.equal(next.text, '唤醒后直接输入'); assert.equal(host.getDraft(id, island).text, '');
  } finally { await host.stop(); await f.close(); }
});

test('submit clears only its origin draft and deduplicates even after another entry saves', async () => {
  const f = fixture({ run: async () => new Promise(() => {}), apply: async () => null });
  try {
    const input = submission(f);
    const other = f.host.saveDraft(input.chatId, 0, { text: '灵动岛尚未发送', replyToTaskId: null, resources: [] }, island);
    const result = f.store.submit(input, () => {});
    assert.equal(result.draft.text, ''); assert.equal(result.draft.revision, input.expectedDraftRevision + 1);
    const again = f.store.submit(input, () => { throw new Error('must dedupe before submission validation'); });
    assert.equal(again.task.id, result.task.id); assert.equal(again.duplicate, true);
    assert.equal(f.ai.chat(input.chatId).entries.filter(e => e.role === 'user').length, 1);
    assert.deepEqual(f.host.getDraft(input.chatId, island), other);
    assert.throws(() => f.store.submit(input, () => {}, 'island'), /同一个发送标识/);
    assert.throws(() => f.store.submit({ ...input, text: '不同请求' }, () => {}), /同一个发送标识/);
    const second = submission(f, '原样保留');
    f.store.db.exec("CREATE TRIGGER reject_task BEFORE INSERT ON bot_tasks BEGIN SELECT RAISE(FAIL,'no disk space'); END");
    assert.throws(() => f.store.submit(second, () => {}), /no disk/);
    assert.equal(f.store.draft(input.chatId).text, '原样保留');
    assert.equal(f.ai.chat(input.chatId).entries.filter(e => e.role === 'user').length, 1);
  } finally { await f.close(); }
});

test('peer delegation returns to the original task after restart and never resurrects cancellation', async () => {
  const f = fixture();
  try {
    const input = submission(f), parent = f.store.submit(input, () => {}).task;
    const media = f.store.cards().find(b => b.seedKey === 'permission')!;
    const operation = randomUUID(), child = f.host.delegate(parent.id, operation, media.id, '整理内容', []);
    assert.equal(f.host.delegate(parent.id, operation, media.id, '整理内容', []).id, child.id);
    assert.throws(() => f.host.delegate(child.id, randomUUID(), parent.botId, '循环请求', []), /循环/);
    f.host.finish(child.id, 'completed', '文章已整理');
    await until(() => f.store.task(parent.id).status === 'completed');
    assert.equal(f.store.all<any>('bot_messages').filter(m => m.kind === 'result').length, 1);
    assert.equal(f.ai.chat(parent.chatId).entries.filter(e => e.content.includes('文章已整理')).length, 0);
    assert.ok(f.store.exchange(parent.botId, media.id).messages.some(message => message.kind === 'result' && message.content.includes('文章已整理')));
    const p2 = f.store.submit(submission(f, '另一件事'), () => {}).task;
    const c2 = f.host.delegate(p2.id, randomUUID(), media.id, '子工作', []);
    f.host.cancelTask(p2.id, f.store.task(p2.id).revision);
    f.host.finish(c2.id, 'completed', '迟到结果');
    assert.equal(f.store.task(p2.id).status, 'cancelled'); assert.equal(f.store.task(c2.id).status, 'cancelled');
  } finally { await f.close(); }
});

test('waiting actions release execution slots and double approval has one business effect', async () => {
  let writes = 0; const active: string[] = [];
  const f = fixture({ run: async (task, host) => { active.push(task.id); host.waitForAction(task.id, `${task.id}:approval`, 'todo', { actions: [] }); return { reply: '等待确认' }; }, apply: async () => { writes++; return { count: 1 }; } });
  try {
    f.host.start();
    const tasks = ['coordinator', 'schedule', 'permission'].map(key => f.host.submit(submission(f, `任务-${key}`, key), main).task);
    await until(() => active.length === 3);
    assert.equal(f.host.state().activeTasks, 0);
    const action = f.store.actions(tasks[0].id)[0];
    const receipt = await f.host.answerAction(action.id, action.revision, { approved: true });
    assert.equal(receipt.status, 'applied');
    await f.host.answerAction(action.id, action.revision, { approved: true }); assert.equal(writes, 1);
  } finally { await f.close(); }
});

test('recovery retains waits, marks in-flight work interrupted and uncertain writes for reconciliation', async () => {
  const f = fixture();
  try {
    const task = f.store.submit(submission(f), () => {}).task;
    f.store.updateTask(task.id, { status: 'running' });
    f.store.insertAction({ id: randomUUID(), taskId: task.id, botId: task.botId, kind: 'reading', status: 'executing', revision: 0, payload: {}, createdAt: '', updatedAt: '' });
    f.store.recover();
    assert.equal(f.store.task(task.id).status, 'waiting_user'); assert.equal(f.store.actions(task.id)[0].status, 'unknown');
    assert.throws(() => f.host.retryTask(task.id, f.store.task(task.id).revision), /不能重试/);
  } finally { await f.close(); }
});

test('schedule edits preserve cadence and deletion rejects stale writes without removing past work', async () => {
  const f = fixture();
  try {
    const botId = f.host.coordinator().id;
    const first = f.store.saveSchedule({ id: randomUUID(), botId, title: '复盘', prompt: '整理今天', spec: { kind: 'interval', minutes: 30 }, enabled: true, revision: 0 });
    const [pastWork] = f.store.fireSchedules(first.nextRunAt);
    const next = f.store.get<typeof first>('bot_schedules', first.id);
    const edited = f.store.saveSchedule({ ...next, title: '每半小时复盘', prompt: '汇总最新进展' });
    assert.equal(edited.nextRunAt, next.nextRunAt);
    assert.equal(edited.revision, next.revision + 1);
    assert.throws(() => botService(f.host, 'removeSchedule', [first.id, edited.revision], island), /主窗口/);
    assert.throws(() => botService(f.host, 'removeSchedule', [first.id, next.revision], main), /已更新/);
    botService(f.host, 'removeSchedule', [first.id, edited.revision], main);
    assert.deepEqual(botService(f.host, 'listSchedules', [botId], main), []);
    assert.throws(() => f.store.saveSchedule(edited), /已移除/);
    assert.deepEqual(f.store.fireSchedules(next.nextRunAt), []);
    assert.equal(f.store.task(pastWork.id).id, pastWork.id);
  } finally { await f.close(); }
});

test('durable schedules coalesce missed intervals and use explicit timezone through DST', async () => {
  const f = fixture();
  try {
    const bot = f.host.coordinator();
    const schedule = f.store.saveSchedule({ id: randomUUID(), botId: bot.id, title: '复盘', prompt: '整理今天', spec: { kind: 'interval', minutes: 5 }, enabled: true, revision: 0 });
    const late = new Date(Date.parse(schedule.nextRunAt) + 86400000).toISOString();
    assert.equal(f.store.fireSchedules(late).length, 1); assert.equal(f.store.fireSchedules(late).length, 0);
    assert.equal(f.store.all<BotTask>('bot_tasks').length, 1);
    assert.equal(nextScheduleAt({ kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' }, '2026-11-16T00:00:00Z'), '2026-11-16T01:00:00Z');
    assert.equal(nextScheduleAt({ kind: 'daily', time: '02:30', timeZone: 'America/New_York' }, '2026-03-08T06:00:00Z'), '2026-03-08T07:30:00Z');
    assert.throws(() => nextScheduleAt({ kind: 'daily', time: '09:00', timeZone: 'bad-zone' }, late));
  } finally { await f.close(); }
});

test('invalid resource validation preserves draft and creates no accepted task', async () => {
  const f = fixture({ run: async () => ({ reply: '' }), apply: async () => ({}), validateSubmission: () => { throw new Error('引用对象已删除'); } });
  try { const input = submission(f); assert.throws(() => f.host.submit(input, main), /已删除/); assert.equal(f.store.draft(input.chatId).text, input.text); assert.equal(f.store.tasks().length, 0); } finally { await f.close(); }
});

test('island may inspect coordinator descendants but cannot inspect another root', async () => {
  const f = fixture();
  try {
    const root = f.store.submit(submission(f), () => {}).task, media = f.store.cards().find(b => b.seedKey === 'permission')!;
    const child = f.host.delegate(root.id, randomUUID(), media.id, '整理', []);
    assert.equal((botService(f.host, 'getTask', [child.id], island) as any).task.id, child.id);
    const other = f.store.submit(submission(f, '其他私人工作', 'permission'), () => {}).task;
    assert.throws(() => botService(f.host, 'getTask', [other.id], island), /原负责人/);
    assert.throws(() => botService(f.host, 'listTasks', [media.id], island), /总 Bot/);
    assert.throws(() => botService(f.host, 'updateMemory', [{ id: randomUUID(), botId: media.id, scope: 'shared', text: '测试', source: '', revision: 1 }], main), /不绑定/);
  } finally { await f.close(); }
});

test('confirming one action does not complete a parent that still awaits a child', async () => {
  const f = fixture({ run: async (task, host) => { host.waitForAction(task.id, randomUUID(), 'question', { question: '等待补充' }); return { reply: '等待' }; }, apply: async () => ({ saved: true }) });
  try {
    const parent = f.store.submit(submission(f), () => {}).task, media = f.store.cards().find(b => b.seedKey === 'permission')!;
    f.host.delegate(parent.id, randomUUID(), media.id, '继续工作', []);
    const action = f.host.waitForAction(parent.id, randomUUID(), 'external', {});
    await f.host.answerAction(action.id, action.revision, { approved: true });
    assert.equal(f.store.task(parent.id).status, 'waiting_bot');
  } finally { await f.close(); }
});

test('browser approval releases global and per-Bot slots then reacquires before execution', async () => {
  let firstId = '', release: (() => void) | undefined;
  const f = fixture({ run: async (task, host) => {
    if (!firstId) { firstId = task.id; host.waitForResourceApproval(task.id); await new Promise<void>(resolve => { release = resolve; }); await host.resumeResourceExecution(task.id); }
    return { reply: '完成' };
  }, apply: async () => ({}) });
  try {
    f.host.start(); const first = f.host.submit(submission(f, '浏览器等待'), main).task;
    await until(() => f.store.task(first.id).status === 'waiting_user'); assert.equal(f.host.state().activeTasks, 0);
    const next = f.host.submit(submission(f, '同 Bot 的另一项工作'), main).task;
    await until(() => f.store.task(next.id).status === 'completed'); release!();
    await until(() => f.store.task(first.id).status === 'completed'); assert.equal(f.host.state().activeTasks, 0);
  } finally { release?.(); await f.close(); }
});

test('undo crash is reconciled even after the original task completed', async () => {
  const f = fixture();
  try {
    const task = f.store.submit(submission(f), () => {}).task;
    const action = f.host.waitForAction(task.id, randomUUID(), 'external', {});
    await f.host.answerAction(action.id, action.revision, { approved: true });
    f.store.updateAction(action.id, { status: 'executing', payload: { undoing: true } }); f.store.recover();
    const recovered = f.store.action(action.id); assert.equal(recovered.status, 'unknown');
    assert.equal(f.host.reconcileAction(recovered.id, recovered.revision, 'applied', '原稿已恢复').status, 'undone');
    assert.equal(f.store.task(task.id).status, 'completed');
  } finally { await f.close(); }
});

test('v3 shared drafts migrate to main only and both entries survive reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ono-bot-migrate-'));
  let ai = new AiStore(dir, { recover: false });
  try {
    const old = new BotStore(ai, dir), bot = old.cards().find(card => card.seedKey === 'coordinator')!;
    const chat = ai.chat(bot.mainChatId); chat.draft = '升级前的共享草稿'; ai.saveChat(chat);
    ai.db.prepare('UPDATE bot_chat_links SET draft_revision=?,draft_context=? WHERE chat_id=?').run(7, JSON.stringify({ replyToTaskId: null, resources: [{ kind: 'reading', id: 'original-article', label: '参考文章' }] }), bot.mainChatId);
    ai.db.exec('DROP TABLE bot_drafts; PRAGMA user_version=3'); ai.close();
    ai = new AiStore(dir, { recover: false }); const store = new BotStore(ai, dir);
    assert.equal(store.cards().find(card => card.seedKey === 'coordinator')!.id, bot.id);
    const mainDraft = store.draft(bot.mainChatId);
    assert.equal(mainDraft.text, chat.draft); assert.equal(mainDraft.revision, 7); assert.equal(mainDraft.resources[0].id, 'original-article');
    assert.equal(store.draft(bot.mainChatId, 'island').text, '');
    store.saveDraft(bot.mainChatId, 0, { text: '灵动岛自己的草稿', replyToTaskId: null, resources: [] }, 'island');
    ai.close(); ai = new AiStore(dir, { recover: false }); const reopened = new BotStore(ai, dir);
    assert.deepEqual(reopened.draft(bot.mainChatId), mainDraft); assert.equal(reopened.draft(bot.mainChatId, 'island').text, '灵动岛自己的草稿');
    assert.equal((ai.db.prepare('PRAGMA user_version').get() as any).user_version, 6);
    assert.equal(readdirSync(dir).filter(file => file.startsWith('chats-before-bots')).length, 2);
  } finally { ai.close(); assert.equal(dirname(resolve(dir)), resolve(tmpdir())); assert.ok(dir.includes('ono-bot-')); rmSync(dir, { recursive: true, force: true }); }
});

test('main and island requests enter one serial execution queue for their Bot', async () => {
  const started: string[] = [], gates = new Map<string, () => void>(); let executing = 0, maxExecuting = 0;
  const f = fixture({ run: async task => {
    started.push(task.id); executing++; maxExecuting = Math.max(maxExecuting, executing);
    await new Promise<void>(resolve => { gates.set(task.id, resolve); }); executing--; return { reply: '已处理' };
  }, apply: async () => null });
  try {
    const first = f.host.submit(submission(f, '主窗口发起'), main).task;
    await until(() => started.length === 1);
    const bot = f.host.coordinator(), draft = f.host.saveDraft(bot.mainChatId, 0, { text: '灵动岛发起', replyToTaskId: null, resources: [] }, island);
    const second = f.host.submit({ botId: bot.id, chatId: bot.mainChatId, text: draft.text, replyToTaskId: null, resources: [], expectedDraftRevision: draft.revision, clientRequestId: randomUUID() }, island).task;
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(f.store.task(second.id).status, 'queued'); assert.deepEqual(started, [first.id]);
    gates.get(first.id)!(); await until(() => started.length === 2);
    assert.deepEqual(started, [first.id, second.id]); assert.equal(maxExecuting, 1);
    gates.get(second.id)!(); await until(() => f.store.task(second.id).status === 'completed');
    assert.equal(f.ai.chat(bot.mainChatId).entries.filter(entry => entry.role === 'user').length, 2);
  } finally { for (const release of gates.values()) release(); await f.close(); }
});
