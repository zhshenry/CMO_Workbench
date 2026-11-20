import { z } from 'zod';

export const meetingMaterialSchema = z.enum(['minutes', 'transcript', 'notes']);
export type MeetingMaterial = z.infer<typeof meetingMaterialSchema>;

export const meetingContentQuerySchema = z.object({
  taskId: z.string().trim().min(1).max(4096).optional(),
  subject: z.string().trim().min(1).max(200).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  material: meetingMaterialSchema.optional(),
  candidate: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  refresh: z.boolean().optional(),
}).strict().refine(query => query.taskId ? !query.subject && !query.date : !!query.subject && !!query.date,
  '请指定日程事项，或同时提供会议主题和日期。');
export type MeetingContentQuery = z.infer<typeof meetingContentQuerySchema>;

export const meetingTranscriptQuerySchema = z.object({
  meetingId: z.union([z.string().regex(/^[1-9]\d{0,19}$/), z.number().int().positive().safe()]),
  expectedStart: z.string().datetime({ offset: true }),
}).strict();
export type MeetingTranscriptQuery = z.infer<typeof meetingTranscriptQuerySchema>;

export interface MeetingContentCandidate {
  id: string;
  subject: string;
  start: string;
  end?: string;
  meetingId?: string;
}

export interface MeetingTranscriptSegment {
  text: string;
  speaker?: string;
  time?: string;
}

export type MeetingContentError = 'generating' | 'no-recording' | 'no-permission' | 'not-logged-in' |
  'request-failed' | 'unverified' | 'unlinked';
export type MeetingMaterialResult =
  | { status: 'ready'; start: string; fetchedAt: number; format: 'text' | 'json'; text: string; segments?: MeetingTranscriptSegment[] }
  | { status: 'candidates'; candidates: MeetingContentCandidate[] }
  | { status: 'wrong-session'; actualTime: string }
  | { status: MeetingContentError; message: string };
export type MeetingContent = Partial<Record<MeetingMaterial, MeetingMaterialResult>>;

export interface MeetingContentApi {
  meetingContent(query: MeetingContentQuery, signal?: AbortSignal): Promise<MeetingContent>;
  meetingTranscript(query: MeetingTranscriptQuery, signal?: AbortSignal): Promise<MeetingMaterialResult>;
}

export const normalizeMeetingTitle = (value: string) => value.normalize('NFKC')
  .replace(/^\s*(?:\[|【)(?:会议通知|会议邀请)(?:\]|】)\s*/u, '').trim();
