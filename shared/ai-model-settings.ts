export interface AiModelSettings {
  contextWindow?: number;
  maxOutputTokens?: number;
}

export const DEFAULT_CONTEXT_WINDOW = 128000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 16384;
export const CONTEXT_SAFETY_TOKENS = 4096;

export function resolveModelSettings(settings: AiModelSettings) {
  const contextWindow = settings.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  const maxOutputTokens = settings.maxOutputTokens ?? Math.min(DEFAULT_MAX_OUTPUT_TOKENS, contextWindow - CONTEXT_SAFETY_TOKENS);
  if (!Number.isSafeInteger(contextWindow) || !Number.isSafeInteger(maxOutputTokens)
    || maxOutputTokens < 1 || contextWindow < maxOutputTokens + CONTEXT_SAFETY_TOKENS) {
    throw new Error('模型上下文窗口须至少大于输出预算 4096 tokens，请按服务支持的限额填写整数');
  }
  return { contextWindow, maxOutputTokens };
}

export interface AiGenerationResult {
  reply: string;
  stopReason?: string;
  usage?: { input: number; output: number; totalTokens: number };
}

export class AiOutputLimitError extends Error {
  readonly code = 'MODEL_OUTPUT_TRUNCATED';
  constructor(readonly result: AiGenerationResult) {
    super('模型输出被截断，或剩余上下文不足。已保留处理记录，请继续处理；若反复出现，请核对该模型的输出预算与上下文限额');
    this.name = 'AiOutputLimitError';
  }
}
