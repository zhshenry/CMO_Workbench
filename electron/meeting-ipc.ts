import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { desktopCapturer, dialog, ipcMain, session, type BrowserWindow } from 'electron';
import { z } from 'zod';
import { newTask } from '../shared/todo-contracts';
import { meetingAudioInput, meetingFrameInput, meetingRecordingInput } from '../shared/meeting-companion';
import { speechAppUrl } from '../shared/speech-contracts';
import type { Store } from '../modules/todo/store';
import type { OfficeModel } from './office-analysis';
import { MeetingCompanion } from './meeting-companion';
import { SpeechService } from './speech';

export function registerMeetingIpc(directory: string, speechRoot: string, main: () => BrowserWindow | null,
  appUrl: string, store: Store, model: OfficeModel, todoChanged: () => void) {
  const speech = new SpeechService(speechRoot);
  let choice: { meetingId: string; source: Electron.DesktopCapturerSource; audio: boolean; expiresAt: number } | undefined;
  let releaseRecording: (() => void) | undefined;
  const canRequestDisplay = () => !!choice && Date.now() <= choice.expiresAt;
  const trusted = (frame: Electron.WebFrameMain | null) => !!frame && frame === main()?.webContents.mainFrame && speechAppUrl(frame.url, appUrl);
  const sources = () => desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
  const service = new MeetingCompanion(directory, {
    async transcribe(bytes) { const id = randomUUID(); await speech.prepare(id); return (await speech.transcribe(id, bytes, 'auto')).text; },
    model, changed: id => { const window = main(); if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('meeting-companion:changed', id); },
    createTask: (title, key) => {
      const bytes = createHash('sha256').update(key).digest().subarray(0, 16);
      bytes[6] = 0x40 | bytes[6] & 0x0f; bytes[8] = 0x80 | bytes[8] & 0x3f;
      const id = bytes.toString('hex').replace(/^(........)(....)(....)(....)/, '$1-$2-$3-$4-');
      const existing = store.all(true).find(item => item.id === id);
      if (existing?.deletedAt) throw new Error('关联待办已删除，请到全部事项中恢复。');
      if (!existing) {
        const now = new Date().toISOString();
        store.put({ ...newTask(title.slice(0, 200)), id, createdAt: now, updatedAt: now, deletedAt: null, completedAt: null, notifiedFor: null });
      }
      todoChanged(); return id;
    },
  });
  session.defaultSession.setDisplayMediaRequestHandler((request, reply) => {
    if (!choice || !canRequestDisplay() || !request.userGesture || !trusted(request.frame) || !request.videoRequested) { reply(null); return; }
    const selected = choice;
    choice = undefined;
    reply({ video: selected.source, ...(selected.audio && request.audioRequested ? { audio: 'loopback' as const } : {}) });
  });
  const uuid = z.string().uuid();
  const methods = {
    sources: async () => (await sources()).map(item => ({ id: item.id, label: item.name })),
    list: () => service.list(),
    get: (input: unknown) => service.get(uuid.parse(input)),
    start: async (input: unknown) => {
      const data = meetingRecordingInput.parse(input);
      const contents = main()?.webContents, frame = contents?.mainFrame;
      const source = data.sourceId ? (await sources()).find(item => item.id === data.sourceId) : undefined;
      if (data.sourceId && !source) throw new Error('所选窗口或屏幕已关闭。');
      if (data.systemAudio && (!source || process.platform !== 'win32')) throw new Error('采集系统声音需要 Windows 和已选画面。');
      if (!contents || contents.isDestroyed() || !frame || !trusted(frame)) throw new Error('录制窗口已关闭。');
      const record = service.start({ ...data, useFrames: !!source && data.useFrames });
      choice = source ? { meetingId: record.id, source, audio: data.systemAudio, expiresAt: Date.now() + 15000 } : undefined;
      const detach = () => {
        contents.removeListener('render-process-gone', lost);
        contents.removeListener('destroyed', lost);
        contents.removeListener('did-start-navigation', navigation);
        if (choice?.meetingId === record.id) choice = undefined;
        releaseRecording = undefined;
      };
      const lost = () => { detach(); service.stop(record.id, true); };
      const navigation = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
        if (event.isMainFrame && !event.isSameDocument) lost();
      };
      contents.once('render-process-gone', lost);
      contents.once('destroyed', lost);
      contents.on('did-start-navigation', navigation);
      releaseRecording = detach;
      return record;
    },
    audio: (input: unknown) => { const data = meetingAudioInput.parse(input); service.audio(data.id, data.chunk, data.at, data.bytes); },
    frame: (input: unknown) => { const data = meetingFrameInput.parse(input); service.frame(data.id, data.frame, data.at, data.bytes); },
    stop: (input: unknown) => {
      const id = uuid.parse(input), active = service.get(id).status === 'recording';
      if (active) releaseRecording?.();
      return service.stop(id);
    },
    retry: (input: unknown) => service.retry(uuid.parse(input)),
    organize: (input: unknown) => service.organize(uuid.parse(input)),
    ask: (input: unknown) => { const data = z.object({ id: uuid, question: z.string().trim().min(1).max(2000) }).strict().parse(input); return service.ask(data.id, data.question); },
    media: (input: unknown) => { const data = z.object({ id: uuid, itemId: uuid, kind: z.enum(['audio', 'frame']) }).strict().parse(input); return service.media(data.id, data.itemId, data.kind); },
    action: (input: unknown) => { const data = z.object({ id: uuid, noteId: z.string().max(48) }).strict().parse(input); return service.action(data.id, data.noteId); },
    export: async (input: unknown) => {
      const id = uuid.parse(input), record = service.get(id), window = main();
      if (!window || window.isDestroyed()) return false;
      const file = await dialog.showSaveDialog(window, { title: '导出会议纪要', defaultPath: record.title.replace(/[\\/:*?"<>|]/g, '-') + '.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!file.filePath || file.canceled) return false;
      writeFileSync(file.filePath, service.markdown(id), 'utf8'); return true;
    },
  };
  for (const [name, fn] of Object.entries(methods)) ipcMain.handle('meeting-companion:' + name, (event, input: unknown) => {
    if (!trusted(event.senderFrame)) throw new Error('仅 CMO 主窗口可以使用会议伴侣。');
    return fn(input);
  });
  return {
    canRequestDisplay,
    dispose() { session.defaultSession.setDisplayMediaRequestHandler(null); releaseRecording?.(); speech.dispose(); },
  };
}
