// welink AI 贡献:让 AI 通过 welink_run 工具调用 welink-cli 操作 WeLink(IM/会议/邮件/日历/云空间/搜索)。
// 写操作(发消息/建会议/发邮件/删除)前必须先调 declare_write 声明意图,等用户确认。
// 确认机制复用浏览器模块的 onConfirmWrite 模式(ai-ipc.ts 注入 pendingAsks + ai:ask 弹窗)。
import { Type } from 'typebox';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { runWelink } from '../../electron/welink-cli';
import type { AiModuleContribution } from '../../electron/ai-core';

export type ConfirmWrite = (ask: { intent: string; target: string }) => Promise<'confirmed' | 'cancelled'>;

function toolText(text: string) { return { content: [{ type: 'text' as const, text }], details: {} }; }

// 会改变 WeLink 状态的子命令:发消息/建群/会议增改删/发邮件/云空间删除/外链修改。查询单独放行。
const WRITE_SUBCOMMANDS = new Set([
  // im
  'send-to-user', 'send-to-group', 'create-group', 'add-group-member',
  // meeting
  'create', 'update', 'cancel', 'topic-create', 'topic-update', 'topic-delete',
  // mail
  'send', 'reply', 'reply-all', 'forward', 'move', 'delete', 'mark',
  // calendar
  'create',
  // onebox
  'file-remove', 'folder-remove', 'file-share-link-edit', 'file-share-link-remove',
  // contact
  'add_favorite', 'del_favorite',
]);

function isWrite(_service: string, subcommand: string): boolean {
  // search/auth/version/config/onebox file-upload 等查询/上传不在硬拦截列表;其余按 WRITE_SUBCOMMANDS 判定。
  return WRITE_SUBCOMMANDS.has(subcommand);
}

export function buildWelinkContribution(onConfirmWrite?: ConfirmWrite): AiModuleContribution {
  return {
    toolNames: onConfirmWrite ? ['welink_run', 'declare_write'] : ['welink_run'],
    labels: { welink_run: '执行 WeLink 操作', declare_write: '确认 WeLink 写操作' },
    systemPrompt: () => `你可以通过 welink_run 工具调用 welink-cli 操作 WeLink(发消息/建会议/发邮件/查日程/搜联系人/云空间)。
welink_run 接收 { service, subcommand, args }:service 是 welink-cli 的 service(im/meeting/mail/calendar/onebox/search/contact/auth),subcommand 是子命令,args 是传给 welink-cli 的参数数组(如 ['--receiver','z00123456','--text','你好'])。
执行写操作(发消息/建群/会议增改删/发邮件/删除文件)前必须先调 declare_write 声明意图,等用户确认后再调 welink_run 执行。
查日程用 meeting query-list --type 1;搜联系人用 search person --text。详细命令参数与易错点见已加载的 welink skill 的 references。
账号用 search person 结果里的 w3account(如 z00123456),不要用纯工号;meetingId 是会议主键不是视频会议号。`,
    buildTools: () => [
      defineTool({
        name: 'welink_run', label: '执行 WeLink 操作',
        description: '调用 welink-cli 执行一条命令(service subcommand + args),返回 stdout。写操作需先调 declare_write。',
        parameters: Type.Object({
          service: Type.String({ minLength: 1 }),
          subcommand: Type.String({ minLength: 1 }),
          args: Type.Array(Type.String()),
        }, { additionalProperties: false }),
        execute: async (_id, params) => {
          const { service, subcommand, args } = params;
          // 兜底:AI 没先调 declare_write 就直接 welink_run 写操作,这里补确认
          if (isWrite(service, subcommand) && onConfirmWrite) {
            const decision = await onConfirmWrite({ intent: `${service} ${subcommand}`, target: args.join(' ') });
            if (decision !== 'confirmed') return toolText('用户取消了该写操作');
          }
          try {
            const out = await runWelink([service, subcommand, ...args], 30000);
            return toolText(out || '(无输出)');
          } catch (error) {
            return toolText(`welink-cli 执行失败:${error instanceof Error ? error.message : String(error)}`);
          }
        },
      }),
      ...(onConfirmWrite ? [defineTool({
        name: 'declare_write', label: '确认写操作',
        description: '执行 WeLink 写操作(发消息/建会议/发邮件/删除等)前必须先调用本工具声明意图,等用户确认。',
        parameters: Type.Object({
          intent: Type.String({ minLength: 1, maxLength: 80 }),
          target: Type.String({ minLength: 1, maxLength: 200 }),
        }, { additionalProperties: false }),
        execute: async (_id, params) => {
          const decision = await onConfirmWrite({ intent: params.intent, target: params.target });
          if (decision !== 'confirmed') {
            throw new Error(JSON.stringify({ ok: false, code: 'write-cancelled', message: '用户取消了写操作,勿执行' }));
          }
          return toolText(`用户已确认写操作:${params.intent}(${params.target}),可继续调 welink_run 执行。`);
        },
      })] : []),
    ],
  };
}
