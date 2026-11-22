# Bot 会话、协作与同步

适用产品为 CMO，归属跨工作台能力。[本项进度与任务](../../../../../../onosan_workbench/docs/requirements/README.md#bot-与-ai-工作区)

## 业务目标

每个 Bot 有一条持续主对话。用户在这条对话中发起工作、补充、确认或续做。历史消息在原对话内分页查看和收起，双方都能追踪协作结果。

## 验收条件

- 发送补充后原任务收到更新，确认结果和委派回执回到当前对话，重开能查到已保存的记录。

## 交付进展

回执与续答已验收，运行控制和缓存等续项保留

## 实施资料

- [原方案与资料](../bot-architecture/qa.md#协作回执与续答v8)
- [单主对话与历史显示](../../../../../../onosan_workbench/docs/requirements/shared/ai-assistant/rel004-bot-conversation-delegation-and-sync/plan.md#127-聊天历史管理与长对话)
- [计划](../../../../../../onosan_workbench/docs/design/cmo-bot-workbench-implementation-2026-11-15.md#12-逐文件改造与实施顺序)
