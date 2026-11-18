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
}
export interface OfficeItem {
  id: string;
  kind: 'awaiting' | 'commitment' | 'mail';
  title: string;
  deadline: string | null;
  reason: string;
  source: OfficeRef;
  related?: OfficeRef & { title: string; at: number | null };
}
export interface OfficeCoverage {
  state: 'unread' | 'fresh' | 'partial' | 'cached' | 'unavailable';
  lastSuccessAt: number | null;
  scope: string;
  detail?: string;
}
export interface OfficeSnapshot {
  day: string;
  connected: boolean;
  coverage: Record<OfficeSourceKind, OfficeCoverage>;
  materials: OfficeMaterialRow[];
  items: OfficeItem[];
  brief: { priorities: string[]; meetings: string[] };
}

export const officeTodoSchema = z.object({
  itemId: officeIdSchema,
  title: z.string().trim().min(1).max(200),
  dateAt: taskDateSchema,
  source: z.object({ id: officeIdSchema, label: z.string().trim().min(1).max(120) }).strict(),
}).strict();
export type OfficeTodo = z.infer<typeof officeTodoSchema>;
