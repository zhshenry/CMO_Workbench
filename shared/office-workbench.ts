import { z } from 'zod';
import { taskDateSchema } from './todo-date';

export const officeIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
export type OfficeMaterialKind = 'direct' | 'group' | 'mail' | 'meeting';
export type OfficeSourceKind = 'messages' | 'mail' | 'agenda';
export interface OfficeRef { id: string; label: string; }
export interface OfficeMaterialRow extends OfficeRef {
  kind: OfficeMaterialKind;
  title: string;
  byline: string;
  at: number | null;
  preview?: string;
}
export interface OfficeMaterial extends OfficeMaterialRow {
  text: string;
  capturedAt: number | null;
  context?: { at: number; sender: string; text: string }[];
  meeting?: { taskId: string; dateAt: string; endAt: string | null; providers: string[] };
  note?: string;
  scope?: string;
  preserved?: boolean;
  originalId?: string;
}
export interface OfficeItem {
  id: string;
  kind: 'awaiting' | 'commitment' | 'mail';
  title: string;
  deadline: string | null;
  reason: string;
  needsReplyReview?: boolean;
  review?: { verdict: 'reply' | 'maybe' | 'no'; reason: string };
  source: OfficeRef;
  related?: OfficeRef & { title: string; at: number | null };
}
export interface OfficeCoverage {
  state: 'unread' | 'fresh' | 'partial' | 'cached' | 'unavailable';
  lastSuccessAt: number | null;
  scope: string;
  detail?: string;
  retryAt?: number;
}
export interface OfficeSnapshot {
  day: string;
  connected: boolean;
  coverage: Record<OfficeSourceKind, OfficeCoverage>;
  unreadMail: OfficeCoverage;
  materials: OfficeMaterialRow[];
  items: OfficeItem[];
  brief: { priorities: string[]; meetings: string[]; sources?: Record<string, OfficeRef> };
}

export const officeAutomationSchema = z.object({
  brief: z.boolean().default(false), briefTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/).default('08:30'),
  review: z.boolean().default(false), archive: z.boolean().default(false), reminders: z.boolean().default(false),
}).strict();
export type OfficeAutomation = z.infer<typeof officeAutomationSchema>;
export const officeBriefSections = ['awaiting', 'commitments', 'groups', 'mail'] as const;
export type OfficeBriefSection = typeof officeBriefSections[number];
export interface OfficeBriefEntry {
  source: OfficeRef;
  evidence?: OfficeRef[];
  title: string;
  text?: string;
  deadline?: string | null;
  itemId?: string;
  reminderId?: string;
  guess?: boolean;
}
export const officeBriefReadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), section: z.enum(officeBriefSections), offset: z.number().int().nonnegative().max(500).optional() }).strict(),
  z.object({ kind: z.literal('original'), source: officeIdSchema, offset: z.number().int().nonnegative().max(100000).optional() }).strict(),
  z.object({ kind: z.literal('messages'), source: officeIdSchema, offset: z.number().int().nonnegative().max(500).optional(), live: z.boolean().optional() }).strict(),
]);
export type OfficeBriefRead = z.infer<typeof officeBriefReadSchema>;
export type OfficeBriefReader = (input: OfficeBriefRead) => Promise<unknown>;
export type OfficeBriefMeeting = OfficeMaterialRow & { meeting?: OfficeMaterial['meeting']; preparation?: string };
export interface OfficeDailyBrief {
  day: string;
  generatedAt: number;
  items: (OfficeItem & { why?: string })[];
  meetings: OfficeBriefMeeting[];
  model: boolean;
  note?: string;
  organizing?: boolean;
  sections?: Record<OfficeBriefSection, OfficeBriefEntry[]>;
  coverage?: Record<OfficeSourceKind, OfficeCoverage>;
}
export interface OfficeCommitment extends OfficeItem {
  recordedAt: number;
  status: 'open' | 'handled' | 'linked' | 'done';
  taskId?: string;
}
export interface OfficeNotice { id: string; title: string; text: string; at: number; source?: OfficeRef; }
export interface OfficeWorkflow {
  settings: OfficeAutomation;
  days: string[];
  commitments: OfficeCommitment[];
  notices: OfficeNotice[];
  archiveDetail?: string;
  archiveAt?: number;
  connected: boolean;
}

export const officeDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(value + 'T00:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '请选择有效日期。');
export const officeConversationKey = z.string().max(128).regex(/^(?:group:\d+|user:[a-z0-9_.@-]+)$/i);
export const officeSearchSchema = z.object({
  keyword: z.string().trim().max(160).optional(), person: z.string().trim().max(100).optional(), group: z.string().trim().max(100).optional(),
  kind: z.enum(['direct', 'group', 'mail', 'meeting']).optional(), mailbox: z.enum(['recent', 'unread']).optional(),
  conversation: officeConversationKey.optional(), from: officeDay.optional(), to: officeDay.optional(), live: z.boolean().optional(), preserved: z.boolean().optional(), archive: z.boolean().optional(),
  offset: z.number().int().min(0).optional(), limit: z.number().int().min(1).max(100).optional(),
}).strict().refine(query => !query.from || !query.to || query.from <= query.to, '开始日期应早于或等于结束日期。')
  .refine(query => !query.live || !query.preserved && !query.archive && !!query.from && !!query.to && query.kind !== 'mail' && query.kind !== 'meeting', '补查消息需要选择开始和结束日期。');
export type OfficeSearch = z.infer<typeof officeSearchSchema>;
export interface OfficeConversation { key: string; name: string; }
export interface OfficeSearchResult {
  rows: OfficeMaterialRow[];
  total: number;
  conversations: OfficeConversation[];
  scope: string;
  live?: { checked: number; partial: boolean; incomplete: string[] };
}
export const officeSceneSchema = z.object({
  kind: z.enum(['prep', 'group', 'mail', 'weekly', 'draft']), sourceId: officeIdSchema.optional(), keyword: z.string().trim().max(160).optional(),
  conversation: officeConversationKey.optional(), from: officeDay.optional(), to: officeDay.optional(),
}).strict().refine(input => !input.from || !input.to || input.from <= input.to, '开始日期应早于或等于结束日期。');
export type OfficeScene = z.infer<typeof officeSceneSchema>;
export const officeReadRequestSchema = z.object({ sourceId: officeIdSchema.optional(), search: officeSearchSchema.optional(), scene: officeSceneSchema.optional(), scope: z.string().max(2000).optional() }).strict()
  .refine(input => [input.sourceId, input.search, input.scene].filter(Boolean).length <= 1, '请一次选择一种取材方式。');
export type OfficeReadRequest = z.infer<typeof officeReadRequestSchema>;

export function officeCitationText(text: string, sources: ReadonlyMap<string, OfficeRef>, citations: OfficeRef[]): string {
  return text.replace(/【资料[:：]([a-f0-9]{32})】/gi, (_match, id: string) => {
    const source = sources.get(id.toLowerCase());
    if (!source) return '';
    const index = citations.findIndex(ref => ref.id === source.id);
    if (index >= 0) return `[${index + 1}]`;
    citations.push(source);
    return `[${citations.length}]`;
  });
}

export const officeTodoSchema = z.object({
  itemId: officeIdSchema,
  title: z.string().trim().min(1).max(200),
  dateAt: taskDateSchema,
  source: z.object({ id: officeIdSchema, label: z.string().trim().min(1).max(120) }).strict(),
}).strict();
export type OfficeTodo = z.infer<typeof officeTodoSchema>;
