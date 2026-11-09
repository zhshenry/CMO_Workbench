// New API 日志解析：今日消耗（按今日范围拉日志明细聚合）
import type { QuotaModelStat } from './island-contracts';

const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const toNum = (value: unknown): number => finite(value) && value >= 0 ? Math.floor(value) : 0;

// 日志单条结构
interface LogItem { createdAt: number; modelName: string; tokens: number; }
const parseLogItem = (raw: unknown): LogItem | null => {
  const item = object(raw);
  const createdAt = toNum(item.created_at);
  if (!createdAt) return null;
  const prompt = toNum(item.prompt_tokens);
  const completion = toNum(item.completion_tokens);
  return {
    createdAt,
    modelName: typeof item.model_name === 'string' ? item.model_name : '未知模型',
    tokens: prompt + completion,
  };
};

// 今日 0 点（秒级戳）
export function dayStartSec(now = Date.now()): number { const d = new Date(now); d.setHours(0, 0, 0, 0); return Math.floor(d.getTime() / 1000); }
export function nowSec(now = Date.now()): number { return Math.floor(now / 1000); }

// 解�析今日日志明细 → 今日 token + 按模型聚合（今日）
export function parseNewApiLogs(items: unknown[], todayStart: number): { todayQuota: number; models: QuotaModelStat[] } {
  let todayQuota = 0;
  const modelMap = new Map<string, number>();
  for (const raw of Array.isArray(items) ? items : []) {
    const item = parseLogItem(raw);
    if (!item || item.createdAt < todayStart) continue;
    todayQuota += item.tokens;
    modelMap.set(item.modelName, (modelMap.get(item.modelName) ?? 0) + item.tokens);
  }
  const models = [...modelMap.entries()].map(([name, quota]) => ({ name, quota })).sort((a, b) => b.quota - a.quota).slice(0, 20);
  return { todayQuota, models };
}

// 解析 /api/log/self/stat —— 服务器聚合的今日 token（与数据看板口径一致）
export function parseNewApiStat(data: unknown): number {
  const stat = object(object(data).data);
  return toNum(stat.token);
}
export function formatQuota(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 })}M`;
  return value.toLocaleString('en-US');
}
