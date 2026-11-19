import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppSettingsStore } from '../electron/app-settings';
import { DEFAULT_APP_SETTINGS, UiThemeSchema } from '../shared/contracts';

test('外观升级逐字段恢复，八主题重启保持且不覆盖 CMO 账号和通知设置', () => {
  const dir = tempDir();
  try {
    const legacy = { profile: { name: '外观验证', avatarColor: 'teal' }, w3Uid: '00123456',
      launchAtLogin: true, closeAction: 'exit', language: 'zh-CN', remindersEnabled: false,
      welink: { enabled: true, pollMinutes: 27 }, uiTheme: 'cool', windowLight: 'dusk' };
    writeFileSync(join(dir, 'app-settings.json'), JSON.stringify(legacy));
    const store = new AppSettingsStore(dir);
    assert.equal(store.read().navigationStyle, 'classic');
    assert.equal(store.read().glassIntensity, 'normal');
    assert.equal(store.read().uiTheme, 'mist');
    for (const uiTheme of UiThemeSchema.options) {
      store.patch({ uiTheme, navigationStyle: 'floating', glassIntensity: 'strong' });
      const saved = new AppSettingsStore(dir).read();
      assert.equal(saved.uiTheme, uiTheme);
      assert.equal(saved.navigationStyle, 'floating');
      assert.equal(saved.glassIntensity, 'strong');
      for (const key of ['profile', 'w3Uid', 'welink', 'launchAtLogin', 'closeAction', 'language', 'remindersEnabled'] as const) assert.deepEqual(saved[key], legacy[key]);
      assert.equal('windowLight' in saved, false, 'light is derived rather than persisted');
    }
    const valid = store.read();
    writeFileSync(join(dir, 'app-settings.json'), JSON.stringify({ ...valid, glassIntensity: 'invalid', uiTheme: 'invalid' }));
    const recovered = new AppSettingsStore(dir).read();
    assert.equal(recovered.uiTheme, 'mist');
    assert.equal(recovered.glassIntensity, 'normal');
    assert.equal(recovered.navigationStyle, 'floating');
    assert.deepEqual(recovered.welink, legacy.welink);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'workbench-settings-'));
}

test('设置:缺省文件返回默认值', () => {
  const dir = tempDir();
  try {
    const store = new AppSettingsStore(dir);
    assert.deepEqual(store.read(), DEFAULT_APP_SETTINGS);
    assert.equal(store.read().launchAtLogin, false);
    assert.equal(store.read().closeAction, 'minimize');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('设置:patch 合并并落盘,未知键被忽略', () => {
  const dir = tempDir();
  try {
    const store = new AppSettingsStore(dir);
    const next = store.patch({ launchAtLogin: true, evilKey: 'x' } as Record<string, unknown>);
    assert.equal(next.launchAtLogin, true);
    assert.equal(next.closeAction, 'minimize');
    // 新实例读到同一份落盘数据
    const reloaded = new AppSettingsStore(dir).read();
    assert.equal(reloaded.launchAtLogin, true);
    const onDisk = JSON.parse(readFileSync(join(dir, 'app-settings.json'), 'utf8')) as Record<string, unknown>;
    assert.equal('evilKey' in onDisk, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('设置:损坏文件整体回落默认值', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'app-settings.json'), '{ not json', 'utf8');
    const store = new AppSettingsStore(dir);
    assert.deepEqual(store.read(), DEFAULT_APP_SETTINGS);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('设置:非法字段值丢弃,合法字段照常生效', () => {
  const dir = tempDir();
  try {
    writeFileSync(
      join(dir, 'app-settings.json'),
      JSON.stringify({ launchAtLogin: 'yes', closeAction: 'explode', language: 'fr', snavDefaultCollapsed: true, uiTheme: 'rainbow' }),
      'utf8',
    );
    const store = new AppSettingsStore(dir);
    const s = store.read();
    assert.equal(s.launchAtLogin, false);
    assert.equal(s.closeAction, 'minimize');
    assert.equal(s.language, 'zh-CN');
    // snavDefaultCollapsed 已被产品移除:遗留文件中的旧键按未知键丢弃
    assert.equal('snavDefaultCollapsed' in s, false);
    assert.equal(s.uiTheme, 'mist');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('设置:patch 非法值不生效且不写坏文件', () => {
  const dir = tempDir();
  try {
    const store = new AppSettingsStore(dir);
    store.patch({ launchAtLogin: true });
    const next = store.patch({ closeAction: 'boom' } as Record<string, unknown>);
    assert.equal(next.closeAction, 'minimize');
    assert.equal(next.launchAtLogin, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('设置:缺失字段保留默认值，旧开关映射为实际生效的提醒范围', () => {
  const dir = tempDir();
  try {
    writeFileSync(
      join(dir, 'app-settings.json'),
      JSON.stringify({ launchAtLogin: true, closeAction: 'exit', language: 'zh-CN', snavDefaultCollapsed: false }),
      'utf8',
    );
    const store = new AppSettingsStore(dir);
    const s = store.read();
    assert.equal(s.reminderRange, 'all');
    assert.equal(s.launchAtLogin, true);
    assert.equal(s.closeAction, 'exit');
    for (const [remindersEnabled, scheduleReminders, todoReminders, expected] of [
      [true, true, true, 'all'], [true, true, false, 'schedule'], [true, false, true, 'todo'],
      [true, false, false, 'off'], [false, true, true, 'off'],
    ] as const) {
      writeFileSync(join(dir, 'app-settings.json'), JSON.stringify({ remindersEnabled }));
      writeFileSync(join(dir, 'desktop-island.json'), JSON.stringify({ settings: { scheduleReminders, todoReminders } }));
      assert.equal(new AppSettingsStore(dir).read().reminderRange, expected);
    }
    const upgraded = new AppSettingsStore(dir);
    for (const reminderRange of ['all', 'schedule', 'todo', 'off'] as const) {
      assert.equal(upgraded.patch({ reminderRange }).reminderRange, reminderRange);
      assert.equal(new AppSettingsStore(dir).read().reminderRange, reminderRange);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('设置:uiTheme 默认雾珀,新主题可持久化,旧冷灰和晴蓝迁移为雾珀', () => {
  const dir = tempDir();
  try {
    const store = new AppSettingsStore(dir);
    // 旧版设置文件(无 uiTheme 字段)自动落默认
    writeFileSync(join(dir, 'app-settings.json'), JSON.stringify({ launchAtLogin: true }), 'utf8');
    assert.equal(store.read().uiTheme, 'mist');
    // 合法切换持久化,新实例可读回
    store.patch({ uiTheme: 'celadon' });
    assert.equal(new AppSettingsStore(dir).read().uiTheme, 'celadon');
    store.patch({ uiTheme: 'warm' });
    assert.equal(new AppSettingsStore(dir).read().uiTheme, 'warm');
    // 非法值被丢弃
    const next = store.patch({ uiTheme: 'dark' } as Record<string, unknown>);
    assert.equal(next.uiTheme, 'warm');
    for (const uiTheme of ['cool', 'sunny']) {
      writeFileSync(join(dir, 'app-settings.json'), JSON.stringify({ uiTheme }), 'utf8');
      assert.equal(new AppSettingsStore(dir).read().uiTheme, 'mist');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('设置:profile 旧文件缺省落 Ono,非法昵称整字段回落', () => {
  const dir = tempDir();
  try {
    // 个人资料上线前的旧文件没有 profile 字段 → 默认 Ono
    writeFileSync(join(dir, 'app-settings.json'), JSON.stringify({ launchAtLogin: true }), 'utf8');
    const store = new AppSettingsStore(dir);
    assert.equal(store.read().profile.name, 'Ono');
    // 合法昵称可保存并持久化
    const next = store.patch({ profile: { name: '小野' } });
    assert.equal(next.profile.name, '小野');
    assert.equal(new AppSettingsStore(dir).read().profile.name, '小野');
    // 非法(空)昵称:patch 丢弃,旧值保留;文件里坏了则整字段回落默认
    const kept = store.patch({ profile: { name: '' } });
    assert.equal(kept.profile.name, '小野');
    writeFileSync(join(dir, 'app-settings.json'), JSON.stringify({ profile: { name: 'x'.repeat(30) } }), 'utf8');
    assert.equal(new AppSettingsStore(dir).read().profile.name, 'Ono');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
