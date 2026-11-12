import { z } from 'zod';

export const GROUP_PREFIXES = ['CSI', 'HIS', 'TC', 'TTELab', 'CHEI', 'CRI', 'CMTI', 'RCC', 'APRI', 'SED', 'ERI'] as const;
export const GROUP_APPLICATIONS = ['DBOX群组', 'SVN群组', '海思群组', '域群组', 'PDM群组', 'PMS群组', '运营商ALM群组', 'JDC群组'] as const;
const employee = z.string().trim().regex(/^[a-zA-Z]?\d{5,10}$/, '人员请填写工号字符串，保留前导零');
export const groupInputSchema = z.object({
  ownership: z.enum(['product', 'department']).optional(), offering: z.string().trim().min(1).max(200).optional(),
  name: z.string().trim().min(1).max(200).optional(), prefix: z.enum(GROUP_PREFIXES).optional(),
  description: z.string().max(4000).optional(), owner: employee.optional(), members: z.array(employee).min(1).max(200).optional(),
  administrator: employee.optional(), applications: z.array(z.enum(GROUP_APPLICATIONS)).min(1).max(8).optional(),
  years: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
}).strict();
export type GroupInput = z.infer<typeof groupInputSchema>;
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
export function prepareGroup(raw: unknown): { draft?: GroupDraft; missing?: string[]; error?: string } {
  const parsed = groupInputSchema.safeParse(raw);
  if (!parsed.success) return { error: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('；') };
  const value = parsed.data;
  const labels = { ownership: '产品或部门归属', offering: '明确的 Offering 名称或编号', name: '群组名称', owner: 'Owner 工号', members: '成员工号', administrator: '管理员工号', applications: '应用类型' };
  const missing = Object.entries(labels).filter(([key]) => value[key as keyof GroupInput] === undefined).map(([, label]) => label);
  if (missing.length) return { missing };
  if (value.ownership !== 'product') return { error: '部门选择器尚未校准，请使用现有浏览器流程；本工具只自动处理产品归属。' };
  const match = value.name!.match(new RegExp(`^(${GROUP_PREFIXES.join('|')})-(.+)$`, 'i'));
  const prefix = value.prefix ?? (match ? GROUP_PREFIXES.find(item => item.toLowerCase() === match[1].toLowerCase())! : 'HIS');
  if (match && match[1].toLowerCase() !== prefix.toLowerCase()) return { error: '完整群组名的前缀与 prefix 不一致，请先确认名称。' };
  const name = (match?.[2] ?? value.name!).trim();
  if (!name || GROUP_PREFIXES.some(item => value.name!.toLowerCase() === `${item.toLowerCase()}-`)) return { error: '群组名称缺少主体，请先补齐名称。' };
  const applications = [...new Set(value.applications!)];
  if (applications.some(item => item === 'DBOX群组' || item === 'SVN群组') && !applications.includes('域群组')) applications.push('域群组');
  return { draft: { offering: value.offering!, name, prefix, description: value.description ?? '', owner: value.owner!, members: [...new Map(value.members!.map(id => [id.toLowerCase(), id])).values()], administrator: value.administrator!, applications, years: value.years ?? 2 } };
}
