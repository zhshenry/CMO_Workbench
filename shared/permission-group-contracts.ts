import { z } from 'zod';

export const GROUP_PREFIXES = ['CSI', 'HIS', 'TC', 'TTELab', 'CHEI', 'CRI', 'CMTI', 'RCC', 'APRI', 'SED', 'ERI'] as const;
export const GROUP_APPLICATIONS = ['DBOX群组', 'SVN群组', '海思群组', '域群组', 'PDM群组', 'PMS群组', '运营商ALM群组', 'JDC群组'] as const;
export const GROUP_FIELDS = {
  ownership: '产品或部门归属', offering: '明确的 Offering 名称或编号', name: '群组名称',
  owner: 'Owner 工号', members: '成员工号', administrator: '管理员工号', applications: '应用类型',
} as const;
export const groupNeedsDomain = (applications: readonly string[]) => applications.includes('DBOX群组') || applications.includes('SVN群组');
const employee = z.string().trim().regex(/^[a-zA-Z]?\d{5,10}$/, '人员请填写工号字符串，保留前导零');
export const groupInputSchema = z.object({
  ownership: z.enum(['product', 'department']).optional(), offering: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200).optional(), prefix: z.enum(GROUP_PREFIXES).optional(),
  description: z.string().max(4000).optional(), owner: employee.optional(), members: z.array(employee).min(1).max(200).optional(),
  administrator: employee.optional(), applications: z.array(z.enum(GROUP_APPLICATIONS)).min(1).max(8).optional(),
  years: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
}).strict();
export type GroupInput = z.infer<typeof groupInputSchema>;
type GroupField = keyof typeof GROUP_FIELDS;
const groupFields = Object.keys(GROUP_FIELDS) as GroupField[];
export const groupQuestionSchema = z.object({
  fields: z.array(z.enum(groupFields)).min(1).max(groupFields.length),
  values: groupInputSchema,
  tabId: z.string().optional(),
  browserTaskId: z.string().optional(),
  offeringOptions: z.array(z.string().max(200)).max(5).optional(),
}).strict();
export type GroupQuestion = z.infer<typeof groupQuestionSchema>;
export interface GroupDraft {
  offering: string; name: string; prefix: string; description: string; owner: string; members: string[];
  administrator: string; applications: string[]; years: 1 | 2 | 3;
}
export interface GroupWorkflowState {
  draft: GroupDraft; tabId: string;
  phase: 'prepared' | 'filling' | 'ready' | 'blocked' | 'submitting' | 'unknown' | 'submitted';
  rowRequested?: boolean; completed: string[]; field?: string; error?: string; receipt?: string;
  offeringLabel?: string;
  rejectedName?: string;
}
export function prepareGroup(raw: unknown): { draft?: GroupDraft; missing?: string[]; error?: string; groupQuestion?: GroupQuestion } {
  const parsed = groupInputSchema.safeParse(raw);
  if (!parsed.success) {
    const error = parsed.error.issues.map(issue => issue.path.join('.') + ': ' + issue.message).join('；');
    const invalid = parsed.error.issues.map(issue => issue.path[0]);
    if (!invalid.every(key => typeof key === 'string' && Object.hasOwn(GROUP_FIELDS, key))) return { error };
    const partial = groupInputSchema.safeParse(Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([key]) => !invalid.includes(key))));
    if (!partial.success) return { error };
    return { error, groupQuestion: { fields: groupFields.filter(key => partial.data[key] === undefined), values: partial.data } };
  }
  const value = parsed.data;
  if (value.ownership === 'department') return { error: '部门选择器尚未校准，请在原群组创建页使用通用浏览器流程。' };
  const fields = groupFields.filter(key => value[key] === undefined);
  if (fields.length) return { missing: fields.map(key => GROUP_FIELDS[key]), groupQuestion: { fields, values: value } };
  const match = value.name!.match(new RegExp(`^(${GROUP_PREFIXES.join('|')})-(.+)$`, 'i'));
  const prefix = value.prefix ?? (match ? GROUP_PREFIXES.find(item => item.toLowerCase() === match[1].toLowerCase())! : 'HIS');
  if (match && match[1].toLowerCase() !== prefix.toLowerCase()) return { error: '完整群组名的前缀与 prefix 不一致，请先确认名称。' };
  const name = (match?.[2] ?? value.name!).trim();
  if (!name || GROUP_PREFIXES.some(item => value.name!.toLowerCase() === `${item.toLowerCase()}-`)) return { error: '群组名称缺少主体，请先补齐名称。' };
  const applications = [...new Set(value.applications!)];
  if (groupNeedsDomain(applications) && !applications.includes('域群组')) applications.push('域群组');
  return { draft: { offering: value.offering!, name, prefix, description: value.description ?? '', owner: value.owner!, members: [...new Map(value.members!.map(id => [id.toLowerCase(), id])).values()], administrator: value.administrator!, applications, years: value.years ?? 2 } };
}

export function resolveGroupAnswer(question: GroupQuestion, answer: unknown): { input: GroupInput } | { error: string; field?: GroupField } {
  const parsed = groupInputSchema.safeParse(answer);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0] as GroupField | undefined;
    return field && Object.hasOwn(GROUP_FIELDS, field) ? { field, error: '请核对' + GROUP_FIELDS[field] + '。' } : { error: '请核对建群字段。' };
  }
  if (Object.keys(parsed.data).some(key => !question.fields.includes(key as GroupField))) return { error: '请只填写卡片列出的字段。' };
  const combined = { ...question.values, ...parsed.data };
  if (combined.ownership === 'department') {
    delete combined.offering;
    return { input: combined };
  }
  if (question.offeringOptions?.length && (!parsed.data.offering || !question.offeringOptions.includes(parsed.data.offering))) return { field: 'offering', error: '请选择页面列出的 Offering。' };
  const prepared = prepareGroup(combined);
  if (prepared.draft) return { input: combined };
  return { error: prepared.error ?? '请补齐' + prepared.missing!.join('、') + '。', field: prepared.groupQuestion?.fields[0] };
}
