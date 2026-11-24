import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { writeJsonAtomic } from '../modules/storage/json-file';
import { taskDateSchema } from '../shared/todo-date';
import { officeAutomationSchema, officeBriefSections, officeIdSchema, type OfficeAutomation, type OfficeBriefEntry, type OfficeBriefSection, type OfficeCommitment, type OfficeDailyBrief, type OfficeNotice, type OfficeRef, type OfficeScene } from '../shared/office-workbench';

const reviewFields = { id: officeIdSchema, reason: z.string().trim().min(1).max(140) };
const reviewSchema = z.discriminatedUnion('verdict', [
  z.object({ ...reviewFields, verdict: z.literal('action'), nextStep: z.string().trim().min(1).max(100), evidence: z.string().trim().min(2).max(240),
    title: z.string().trim().min(1).max(100).optional(),
    deadline: z.unknown().transform(value => taskDateSchema.safeParse(value).data ?? null).optional() }),
  z.object({ ...reviewFields, verdict: z.enum(['maybe', 'no']) }),
]);
const briefEntrySchema = z.object({ source: officeIdSchema, text: z.string().trim().min(1).max(260), guess: z.boolean().optional(),
  evidence: z.array(officeIdSchema).max(4).optional(), deadlineSource: officeIdSchema.optional() });
const preparationSchema = z.object({ source: officeIdSchema, preparation: z.string().trim().min(1).max(260) });
export const briefMeetingPromptLimit = 40;
export type OfficeReview = z.infer<typeof reviewSchema>;
export type OfficeModel = (prompt: string, jpegImages?: string[]) => Promise<string | null>;
export type StoredOfficeCommitment = OfficeCommitment & { reminderId?: string; recognized?: boolean };

export const officeSceneLabels: Record<OfficeScene['kind'], string> = { prep: '会前准备', group: '群讨论摘要', mail: '邮件分拣', weekly: '周报草稿', draft: '起草回复' };
export const officeSceneDirections: Record<OfficeScene['kind'], string> = {
  prep: '先列出会议时间和主题，再分列背景、待确认问题和会前行动。行动只使用资料支持的内容。',
  group: '归纳已确定事项、仍有分歧、未解问题和行动项。明确负责人或日期只用原文已有的信息。',
  mail: '逐封按「要处理」「知会」「可忽略」分组，写明理由及已确认的期限。标题不足以判断的先读取正文，再标注待核对。',
  weekly: '按工作主题归纳已完成、进行中、风险及下周行动。材料缺失的地方留待补充，不把问询或排期写成成果。',
  draft: '结合来信或消息及上下文，提供可编辑回复草稿。标注未知承诺与待确认信息。不要发送。',
};

export function officeModelList<T extends z.ZodType>(text: string, schema: T): z.infer<T>[] {
  try {
    const body = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? text.trim();
    return z.array(schema).max(40).parse(JSON.parse(body));
  } catch { return []; }
}

export type OfficeBriefProof = OfficeRef & { deadline?: string };

export function enrichOfficeBrief(base: OfficeDailyBrief, response: string, extra?: {
  candidates: Partial<Record<OfficeBriefSection, OfficeBriefEntry[]>>;
  evidence: ReadonlyMap<string, ReadonlyMap<string, OfficeBriefProof>>;
}): OfficeDailyBrief {
  const fallback = { ...base, organizing: false, note: '模型未返回可核对的内容，已保留按规则排的简报。' };
  if (!base.sections) return fallback;
  let parsed: Record<string, unknown>;
  try {
    const content = response.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1] ?? response.trim();
    parsed = z.record(z.string(), z.unknown()).parse(JSON.parse(content));
  } catch { return fallback; }

  const sections = { ...base.sections }, suggestions = new Map<string, string>();
  let dropped = 0, accepted = 0;
  for (const key of officeBriefSections) {
    const offered = new Map([...sections[key], ...(extra?.candidates[key] ?? [])].map(entry => [entry.source.id, entry]));
    const picked: OfficeBriefEntry[] = [], used = new Set<string>();
    const rows = parsed[key];
    for (const row of Array.isArray(rows) ? rows.slice(0, 40) : []) {
      const checked = briefEntrySchema.safeParse(row);
      const entry = checked.success ? offered.get(checked.data.source) : undefined;
      if (!checked.success || !entry) { dropped++; continue; }
      const proof = [...new Set(checked.data.evidence ?? [])].map(id => extra?.evidence.get(entry.source.id)?.get(id));
      if (proof.some(source => !source)) { dropped++; continue; }
      const deadline = proof.find(source => source?.id === checked.data.deadlineSource)?.deadline;
      if (checked.data.deadlineSource && !deadline) { dropped++; continue; }
      if (used.has(entry.source.id)) continue;
      used.add(entry.source.id); accepted++;
      picked.push({ ...entry, text: checked.data.text, guess: checked.data.guess, ...(deadline && { deadline }),
        ...(proof.length && { evidence: proof.flatMap(source => source ? [{ id: source.id, label: source.label }] : []) }) });
      if (entry.itemId) suggestions.set(entry.itemId, checked.data.text);
    }
    if (picked.length) sections[key] = key === 'awaiting' || key === 'commitments'
      ? [...picked, ...sections[key].filter(entry => !used.has(entry.source.id))] : picked;
  }

  const meetings = new Set(base.meetings.slice(0, briefMeetingPromptLimit).map(row => row.id)), preparation = new Map<string, string>();
  const rows = parsed.meetings;
  for (const row of Array.isArray(rows) ? rows.slice(0, 40) : []) {
    const checked = preparationSchema.safeParse(row);
    if (!checked.success || !meetings.has(checked.data.source)) { dropped++; continue; }
    if (!preparation.has(checked.data.source)) { preparation.set(checked.data.source, checked.data.preparation); accepted++; }
  }
  const skipped = dropped ? `已忽略 ${dropped} 条无法按本次资料核对的内容。` : '';
  if (!accepted) return skipped ? { ...fallback, note: skipped + '已保留按规则排的简报。' } : fallback;
  return { ...base, organizing: false, model: true, sections, note: skipped || undefined,
    items: base.items.map(item => suggestions.has(item.id) ? { ...item, why: suggestions.get(item.id) } : item),
    meetings: base.meetings.map(row => ({ ...row, preparation: preparation.get(row.id) })) };
}

export function parseOfficeReview(response: string, offered: ReadonlyMap<string, string[]>): OfficeReview[] {
  const reviews = officeModelList(response, z.unknown()).flatMap(value => {
    const parsed = reviewSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
  const counts = new Map<string, number>();
  for (const item of reviews) counts.set(item.id, (counts.get(item.id) ?? 0) + 1);
  return reviews.filter(item => counts.get(item.id) === 1 && offered.get(item.id)?.some(text => item.verdict !== 'action' || text.includes(item.evidence)));
}

type State = {
  briefs: Record<string, OfficeDailyBrief>; reviews: Record<string, OfficeReview & { fingerprint: string }>;
  commitments: Record<string, StoredOfficeCommitment>; notices: OfficeNotice[]; lastReviewAt?: number; archiveDay?: string;
  archiveDetail?: string; archiveAt?: number;
};
const empty = (): State => ({ briefs: {}, reviews: {}, commitments: {}, notices: [] });

export class OfficeAnalysisStore {
  constructor(private readonly directory: string) {}
  private path(key: string) { return join(this.directory, `office-analysis-${key}.json`); }
  read(key: string): State {
    const path = this.path(key);
    return existsSync(path) ? { ...empty(), ...JSON.parse(readFileSync(path, 'utf8')) } as State : empty();
  }
  update<T>(key: string, operation: (state: State) => T): T {
    const state = this.read(key), result = operation(state);
    writeJsonAtomic(this.path(key), state);
    return result;
  }
  settings(key?: string): { key?: string; settings: OfficeAutomation } {
    const path = join(this.directory, 'office-automation.json');
    const saved = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as { key?: string; settings?: OfficeAutomation } : {};
    return key && key !== saved.key ? { settings: officeAutomationSchema.parse({}) } : { key: saved.key, settings: officeAutomationSchema.parse(saved.settings ?? {}) };
  }
  saveSettings(key: string, settings: OfficeAutomation) {
    writeJsonAtomic(join(this.directory, 'office-automation.json'), { key, settings });
    return settings;
  }
}
