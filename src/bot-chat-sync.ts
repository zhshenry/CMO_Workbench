import type { BotBridge, BotChatUpdate } from '../shared/bot-contracts';
import type { ChatSession } from '../shared/todo-contracts';

/** Snapshot watermarks and sequence gaps are reconciled before accepting newer records. */
export class BotChatSynchronizer {
  private chat?: ChatSession;
  private sequence?: number;
  private epoch?: string;
  private received = 0;
  private resync = false;
  private request?: Promise<void>;
  private readonly buffered = new Map<number, BotChatUpdate>();
  private live = true;
  constructor(private readonly chatId: string, private readonly api: Pick<BotBridge, 'syncChat'>, private readonly changed: (chat: ChatSession) => void, private readonly failed: (error: unknown) => void) {}
  receive(update: BotChatUpdate): void {
    if (!this.live || update.chatId !== this.chatId) return;
    if (this.epoch !== undefined && update.epoch !== this.epoch) { this.resync = true; void this.refresh(); return; }
    if (update.sequence <= (this.sequence ?? -1)) return;
    this.received++;
    this.buffered.set(update.sequence, update);
    if (!this.request && this.sequence !== undefined && update.sequence === this.sequence + 1) this.drain();
    else void this.refresh();
  }
  refresh(): Promise<void> {
    if (this.request) return this.request;
    this.resync = false;
    let recovered = false;
    const beforeSequence = this.sequence, beforeReceived = this.received;
    this.request = this.api.syncChat(this.chatId, this.sequence, this.epoch).then(result => {
      if (!this.live) return;
      for (const [sequence, update] of this.buffered) if (update.epoch !== result.epoch) this.buffered.delete(sequence);
      this.epoch = result.epoch;
      if ('chat' in result) { this.chat = result.chat; this.sequence = result.sequence; }
      else for (const update of result.updates) this.apply(update);
      this.drain(); recovered = true;
    }).catch(error => { if (this.live) this.failed(error); }).finally(() => {
      this.request = undefined;
      if (this.live && recovered && (this.resync || this.buffered.size && (beforeSequence !== this.sequence || beforeReceived !== this.received))) queueMicrotask(() => { if (this.live) void this.refresh(); });
    });
    return this.request;
  }
  private apply(update: BotChatUpdate): void {
    if (!this.chat || update.sequence !== (this.sequence ?? 0) + 1) return;
    this.chat = { ...this.chat, updatedAt: update.updatedAt, entries: this.chat.entries.map(entry => entry.id === update.entry.id ? update.entry : entry) };
    this.sequence = update.sequence;
  }
  private drain(): void {
    for (const sequence of [...this.buffered.keys()].sort((a, b) => a - b)) {
      if (sequence > (this.sequence ?? 0) + 1) break;
      const update = this.buffered.get(sequence)!; this.buffered.delete(sequence); this.apply(update);
    }
    if (this.chat) this.changed(this.chat);
  }
  stop(): void { this.live = false; this.buffered.clear(); }
}
