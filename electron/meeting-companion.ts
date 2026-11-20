import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { validateSpeechWave } from '../shared/speech-audio';
import { meetingNoteKind, type MeetingRecording, type MeetingRecordingInput, type MeetingRecordingSummary } from '../shared/meeting-companion';
import { officeModelList, type OfficeModel } from './office-analysis';

const uuid = z.string().uuid();
const noteSchema = z.object({ id: z.string().max(48).optional(), kind: meetingNoteKind,
  text: z.string().trim().min(1).max(1000), sources: z.array(uuid).min(1).max(12) });
const errorText = (error: unknown) => String(error instanceof Error ? error.message : error).slice(0, 200);
const elapsed = (ms: number) => [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60].map(value => String(value).padStart(2, '0')).join(':');

export class MeetingCompanion {
  private queue = Promise.resolve();
  private readonly queued = new Set<string>();
  private readonly organizing = new Map<string, Promise<MeetingRecording>>();
  private readonly active = new Set<string>();
  private readonly path: string;
  constructor(directory: string, private readonly deps: { transcribe(bytes: Uint8Array): Promise<string>; model: OfficeModel;
    createTask(title: string, key: string): string; changed(id: string): void; now?: () => number }) {
    this.path = join(directory, 'meeting-companion');
    for (const row of this.list()) if (row.status === 'recording') {
      const record = this.get(row.id);
      this.save({ ...record, status: 'interrupted', endedAt: this.now() });
    }
  }

  private now() { return (this.deps.now ?? Date.now)(); }
  private index() { return join(this.path, 'index.json'); }
  private directory(id: string) { return join(this.path, uuid.parse(id)); }
  private file(id: string) { return join(this.directory(id), 'meeting.json'); }
  private mediaFile(id: string, itemId: string, kind: 'audio' | 'frame') {
    return join(this.directory(id), uuid.parse(itemId) + (kind === 'audio' ? '.wav' : '.jpg'));
  }
  list(): MeetingRecordingSummary[] {
    return existsSync(this.index()) ? JSON.parse(readFileSync(this.index(), 'utf8')) as MeetingRecordingSummary[] : [];
  }
  get(id: string): MeetingRecording {
    const file = this.file(id);
    if (!existsSync(file)) throw new Error('该会议记录已不存在。');
    return JSON.parse(readFileSync(file, 'utf8')) as MeetingRecording;
  }
  private save(record: MeetingRecording) {
    const { id, title, taskId, startedAt, endedAt, status } = record;
    mkdirSync(this.directory(id), { recursive: true });
    writeJsonAtomic(this.file(id), record);
    const index = this.list(), row = { id, title, taskId, startedAt, endedAt, status };
    writeJsonAtomic(this.index(), [row, ...index.filter(item => item.id !== id)].sort((a, b) => b.startedAt - a.startedAt));
    this.deps.changed(id);
    return record;
  }

  start(input: MeetingRecordingInput) {
    if (this.active.size) throw new Error('已有会议正在录制。');
    const id = randomUUID();
    const record = this.save({ id, title: input.title, taskId: input.taskId, autoNotes: input.autoNotes, useFrames: input.useFrames, startedAt: this.now(),
      status: 'recording', transcript: [], frames: [], minutes: [] });
    this.active.add(id);
    return record;
  }
  stop(id: string, interrupted = false) {
    const record = this.get(id);
    this.active.delete(id);
    if (record.status !== 'recording') return record;
    const stopped = this.save({ ...record, endedAt: this.now(), status: interrupted ? 'interrupted' : 'stopped' });
    if (record.autoNotes && !record.transcript.some(row => row.status === 'queued')) this.scheduleMinutes(id);
    return stopped;
  }

  audio(id: string, chunk: string, at: number, bytes: Uint8Array) {
    const record = this.get(id);
    if (!this.active.has(id)) throw new Error('录制已停止。');
    if (record.transcript.some(row => row.id === chunk)) return;
    const durationMs = validateSpeechWave(bytes) * 1000;
    writeFileSync(this.mediaFile(id, chunk, 'audio'), bytes);
    this.save({ ...record, transcript: [...record.transcript, { id: chunk, at, durationMs, status: 'queued', text: '' }] });
    this.enqueue(id, chunk);
  }
  frame(id: string, frame: string, at: number, bytes: Uint8Array) {
    const record = this.get(id);
    if (!this.active.has(id) || record.frames.some(row => row.id === frame)) return;
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error('截图格式无效。');
    writeFileSync(this.mediaFile(id, frame, 'frame'), bytes);
    this.save({ ...record, frames: [...record.frames, { id: frame, at }] });
  }
  private enqueue(id: string, chunk: string) {
    if (this.queued.has(chunk)) return;
    this.queued.add(chunk);
    this.queue = this.queue.catch(() => {}).then(async () => {
      const data = readFileSync(this.mediaFile(id, chunk, 'audio'));
      let text = '', error: string | undefined;
      try { text = await this.deps.transcribe(data); } catch (cause) { error = errorText(cause); }
      const record = this.get(id);
      this.save({ ...record, transcript: record.transcript.map(row => row.id === chunk ? { ...row, text, status: error ? 'failed' : 'ready', error } : row) });
      const complete = record.transcript.filter(row => row.status === 'ready').length + Number(!error);
      if (record.autoNotes && (record.status !== 'recording' && record.transcript.every(row => row.id === chunk || row.status !== 'queued') || !error && complete % 5 === 0))
        this.scheduleMinutes(id);
    }).catch(cause => {
      const record = this.get(id);
      this.save({ ...record, transcript: record.transcript.map(row => row.id === chunk ? { ...row, status: 'failed', error: errorText(cause) } : row) });
    }).finally(() => this.queued.delete(chunk));
  }
  retry(id: string) {
    const record = this.get(id), pending = record.transcript.filter(row => row.status !== 'ready');
    if (!pending.length) return;
    this.save({ ...record, transcript: record.transcript.map(row => row.status === 'ready' ? row : { ...row, status: 'queued', error: undefined }) });
    for (const row of pending) this.enqueue(id, row.id);
  }

  private scheduleMinutes(id: string) {
    void Promise.resolve(this.organizing.get(id)).then(() => this.organize(id)).catch(() => {});
  }
  organize(id: string): Promise<MeetingRecording> {
    const pending = this.organizing.get(id);
    if (pending) return pending;
    const result = this.updateMinutes(id).finally(() => this.organizing.delete(id));
    this.organizing.set(id, result);
    return result;
  }
  private async updateMinutes(id: string): Promise<MeetingRecording> {
    let current = this.get(id);
    const words = current.transcript.filter(row => row.status === 'ready' && row.text.trim());
    const oldBoundary = words.findIndex(row => row.id === current.organizedThrough);
    const processed = new Set(current.organizedSources ?? words.slice(0, oldBoundary + 1).map(row => row.id));
    const remaining = [...words, ...(current.useFrames ? current.frames : [])].filter(row => !processed.has(row.id)).sort((a, b) => a.at - b.at);
    while (remaining.length) {
      let wordCount = 0, imageCount = 0, count = 0;
      for (const row of remaining) {
        if ('text' in row ? ++wordCount > 45 : ++imageCount > 4) break;
        count++;
      }
      current = await this.updateMinutesBatch(current, remaining.splice(0, count), processed);
      if (current.noteError) break;
    }
    return current;
  }

  private async updateMinutesBatch(start: MeetingRecording, batch: { id: string; at: number; text?: string }[], processed: Set<string>) {
    const { id } = start;
    try {
      const frames = batch.filter(row => row.text === undefined);
      const reply = await this.deps.model('增量整理会议。只返回 JSON 数组，每项含 id（修订现有条目时填原 ID，新增可省略）、kind(topic|fact|decision|action|question)、text、sources（本轮原话或图片的 UUID）。只添加或修订确定的信息。无更新时返回 []。\n' + JSON.stringify({
        previous: start.minutes.slice(-60).map(({ id, kind, text }) => ({ id, kind, text: text.slice(0, 450) })),
        additions: batch.flatMap(row => row.text === undefined ? [] : [{ id: row.id, time: elapsed(row.at), text: row.text.slice(0, 1400) }]),
        images: frames.map((frame, index) => ({ number: index + 1, ...frame, time: elapsed(frame.at) })),
      }), this.images(id, frames));
      if (reply == null) throw new Error('启用对话模型后可整理纪要。');
      const raw = reply.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? reply.trim();
      const parsed: unknown = JSON.parse(raw);
      const updates = officeModelList(reply, noteSchema);
      if (!Array.isArray(parsed) || parsed.length && !updates.length) throw new Error('模型未返回可核对的纪要格式。');
      const current = this.get(id), minutes = new Map(current.minutes.map(note => [note.id, note])), sources = new Set(batch.map(row => row.id));
      let valid = 0;
      for (const item of updates) {
        if (item.sources.some(source => !sources.has(source))) continue;
        const prior = item.id ? minutes.get(item.id) : undefined;
        if (item.id && !prior) continue;
        const noteId = prior?.id ?? createHash('sha256').update(item.kind + item.text + item.sources.join(',')).digest('hex').slice(0, 24);
        minutes.set(noteId, { ...prior, ...item, id: noteId, sources: [...new Set([...(prior?.sources ?? []), ...item.sources])] });
        valid++;
      }
      if (updates.length && !valid) throw new Error('本轮纪要的出处无法核对。');
      for (const source of sources) processed.add(source);
      return this.save({ ...current, minutes: [...minutes.values()], organizedSources: [...processed], noteError: undefined });
    } catch (error) { return this.save({ ...this.get(id), noteError: errorText(error) }); }
  }

  private images(id: string, frames: { id: string }[]) {
    return frames.length ? frames.map(row => readFileSync(this.mediaFile(id, row.id, 'frame')).toString('base64')) : undefined;
  }

  async ask(id: string, question: string): Promise<string> {
    const record = this.get(id), rows = record.transcript.filter(row => row.text.trim());
    const stamp = question.match(/\b\d{1,2}:\d{2}(?::\d{2})?\b/)?.[0];
    const at = stamp?.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    const byTime = <T extends { at: number }>(list: T[]) => at === undefined ? list.slice().reverse()
      : list.slice().sort((a, b) => Math.abs(a.at / 1000 - at) - Math.abs(b.at / 1000 - at));
    const frames = record.useFrames ? byTime(record.frames).slice(0, 4) : [];
    if (!rows.length && !frames.length) throw new Error('采集到原话或可分析截图后可以提问。');
    const words = Array.from(new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(question.toLowerCase())).filter(part => part.isWordLike && part.segment.length >= 2).map(part => part.segment);
    const relevant = rows.filter(row => words.some(word => row.text.toLowerCase().includes(word))).slice(-30);
    const selected = [...new Map([...byTime(rows).slice(0, 32), ...relevant].map(row => [row.id, row])).values()].sort((a, b) => a.at - b.at);
    const answer = await this.deps.model('根据这场会议的原话和提供的截图回答。引用材料中准确的 HH:MM:SS 时间。复核时和现有纪要对照。缺少依据时写待核对。\n' + JSON.stringify({
      question, minutes: record.minutes.slice(-60).map(note => note.text.slice(0, 600)),
      transcript: selected.map(row => ({ time: elapsed(row.at), text: row.text.slice(0, 1400) })),
      images: frames.map((frame, index) => ({ number: index + 1, time: elapsed(frame.at) })),
    }), this.images(id, frames));
    if (!answer) throw new Error('启用对话模型后可进行会议问答。');
    return answer;
  }
  media(id: string, itemId: string, kind: 'audio' | 'frame'): Uint8Array {
    const record = this.get(id);
    if (!(kind === 'audio' ? record.transcript : record.frames).some(row => row.id === itemId)) throw new Error('材料不在该会议中。');
    return new Uint8Array(readFileSync(this.mediaFile(id, itemId, kind)));
  }
  action(id: string, noteId: string): string {
    const record = this.get(id), note = record.minutes.find(row => row.id === noteId && row.kind === 'action');
    if (!note) throw new Error('该纪要没有对应行动项。');
    if (note.taskId) return note.taskId;
    const taskId = this.deps.createTask(note.text, `meeting:${id}:${noteId}`);
    this.save({ ...record, minutes: record.minutes.map(row => row.id === noteId ? { ...row, taskId } : row) });
    return taskId;
  }
  markdown(id: string): string {
    const record = this.get(id), times = new Map([...record.transcript, ...record.frames].map(row => [row.id, elapsed(row.at)]));
    return [`# ${record.title}`, '', ...record.minutes.map(row => `- ${row.text} (${row.sources.map(source => times.get(source)).filter(Boolean).join(', ')})`), '', '## 会议原话', '',
      ...record.transcript.map(row => `${elapsed(row.at)} ${row.text || (row.status === 'ready' ? '' : '待转写')}`)].join('\n');
  }
}
