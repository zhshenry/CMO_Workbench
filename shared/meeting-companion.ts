import { z } from 'zod';

export const meetingRecordingInput = z.object({ title: z.string().trim().min(1).max(200), taskId: z.string().max(256).optional(),
  autoNotes: z.boolean(), useFrames: z.boolean().optional(), sourceId: z.string().max(256).optional(), systemAudio: z.boolean() }).strict();
export type MeetingRecordingInput = z.infer<typeof meetingRecordingInput>;
export const meetingAudioInput = z.object({ id: z.string().uuid(), chunk: z.string().uuid(), at: z.number().int().nonnegative(),
  bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength > 44 && bytes.byteLength <= 4 * 1024 * 1024) }).strict();
export const meetingFrameInput = z.object({ id: z.string().uuid(), frame: z.string().uuid(), at: z.number().int().nonnegative(),
  bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength > 0 && bytes.byteLength <= 1024 * 1024) }).strict();
export const meetingNoteKind = z.enum(['topic', 'fact', 'decision', 'action', 'question']);
export interface MeetingTranscript { id: string; at: number; text: string; status: 'queued' | 'ready' | 'failed'; error?: string; }
export interface MeetingMinute { id: string; kind: z.infer<typeof meetingNoteKind>; text: string; sources: string[]; taskId?: string; }
export interface MeetingRecording {
  id: string; title: string; taskId?: string; startedAt: number; endedAt?: number; autoNotes: boolean; useFrames?: boolean;
  status: 'recording' | 'stopped' | 'interrupted'; transcript: MeetingTranscript[];
  frames: { id: string; at: number }[]; minutes: MeetingMinute[]; noteError?: string; organizedSources?: string[]; organizedThrough?: string;
}
export type MeetingRecordingSummary = Pick<MeetingRecording, 'id' | 'title' | 'taskId' | 'startedAt' | 'endedAt' | 'status'>;
export interface MeetingCompanionBridge {
  sources(): Promise<{ id: string; label: string }[]>;
  list(): Promise<MeetingRecordingSummary[]>;
  get(id: string): Promise<MeetingRecording>;
  start(input: MeetingRecordingInput): Promise<MeetingRecording>;
  audio(input: z.infer<typeof meetingAudioInput>): Promise<void>;
  frame(input: z.infer<typeof meetingFrameInput>): Promise<void>;
  stop(id: string): Promise<MeetingRecording>;
  retry(id: string): Promise<void>;
  organize(id: string): Promise<MeetingRecording>;
  ask(id: string, question: string): Promise<string>;
  media(id: string, itemId: string, kind: 'audio' | 'frame'): Promise<Uint8Array>;
  export(id: string): Promise<boolean>;
  action(id: string, noteId: string): Promise<string>;
  onChanged(callback: (id: string) => void): () => void;
}
