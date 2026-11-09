import type { QuotaUsage, QuotaModelStat, QuotaPeriod } from './island-contracts';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const toNum = (value: unknown): number => finite(value) && value >= 0 ? Math.floor(value) : 0;

// 解析 /api/user/self —— 累计消耗 used_quota + 剩余 quota
export function parseNewApiSelf(data: unknown): { usedQuota: number; quota: number; account: string } {
  const user = object(object(data).data);
  return {
    usedQuota: toNum(user.used_quota),
    quota: toNum(user.quota),
    account: typeof user.username === 'string' ? user.username : (typeof user.display_name === 'string' ? user.display_name : ''),
  };
}

// 解析 /api/log/self/stat —— 实时速率 tpm/rpm（quota 字段时间过滤失效，弃用）
export function parseNewApiStat(data: unknown): { tpm: number; rpm: number } {
  const stat = object(object(data).data);
  return { tpm: toNum(stat.tpm), rpm: toNum(stat.rpm) };
}

// 日志单条结构
interface LogItem { createdAt: number; modelName: string; quota: number; promptTokens: number; completionTokens: number; }
const parseLogItem = (raw: unknown): LogItem | null => {
  const item = object(raw);
  const createdAt = toNum(item.created_at);
  if (!createdAt) return null;
  return {
    createdAt,
    modelName: typeof item.model_name === 'string' ? item.model_name : '未知模型',
    quota: toNum(item.quota),
    promptTokens: toNum(item.prompt_tokens),
    completionTokens: toNum(item.completion_tokens),
  };
};

// 时间边界（秒级戳）
export function dayStartSec(now = Date.now()): number { const d = new Date(now); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000); }
export function weekStartSec(now = Date.now()): number {
  const d = new Date(now); d.setHours(0, 0, 0, 0);
  const dow = d.getDay() || 7; // 周日=0 → 7
  d.setDate(d.getDate() - dow + 1);
  return Math.floor(d.getTime() / 1000);
}
export function monthStartSec(now = Date.now()): number { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(1); return Math.floor(d.getTime() / 1000); }
export function nowSec(now = Date.now()): number { return Math.floor(now / 1000); }

// 解析日志明细 → 按时间段聚合 + 按模型聚合（今日）
export function parseNewApiLogs(items: unknown[], todayStart: number, weekStart: number, monthStart: number): { usage: QuotaUsage[]; models: QuotaModelStat[] } {
  const period: Record<QuotaPeriod, { quota: number; tokens: number }> = {
    today: { quota: 0, tokens: 0 }, week: { quota: 0, tokens: 0 }, month: { quota: 0, tokens: 0 }, total: { quota: 0, tokens: 0 }, remaining: { quota: 0, tokens: 0 },
  };
  const modelMap = new Map<string, { quota: number; tokens: number }>();
  for (const raw of Array.isArray(items) ? items : []) {
    const item = parseLogItem(raw);
    if (!item) continue;
    const tokens = item.promptTokens + item.completionTokens;
    period.total.quota += item.quota;
    period.total.tokens += tokens;
    if (item.createdAt >= todayStart) {
      period.today.quota += item.quota; period.today.tokens += tokens;
      const m = modelMap.get(item.modelName) ?? { quota: 0, tokens: 0 };
      m.quota += item.quota; m.tokens += tokens; modelMap.set(item.modelName, m);
    }
    if (item.createdAt >= weekStart) { period.week.quota += item.quota; period.week.tokens += tokens; }
    if (item.createdAt >= monthStart) { period.month.quota += item.quota; period.month.tokens += tokens; }
  }
  const usage: QuotaUsage[] = [
    { period: 'today', ...period.today },
    { period: 'week', ...period.week },
    { period: 'month', ...period.month },
  ];
  const models = [...modelMap.entries()].map(([name, v]) => ({ name, ...v })).sort((a, b) => b.quota - a.quota).slice(0, 20);
  return { usage, models };
}

// 千分位格式化
export function formatQuota(value: number): string {
  // 额度数过大，统一用百万（M）换算：>= 1M 显示如 4,888.0M，否则千分位
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}M`;
  return value.toLocaleString('en-US');
}
// token 缩写：K/M
export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}
