import type { AiModuleContribution } from '../electron/ai-core';
import { workbenchForScope, type AiScope } from '../shared/ai-scope';
import { browserWorkspaceForView } from '../shared/browser-contracts';
import type { WorkbenchId } from '../shared/contracts';
import { configurationBotSeed, configurationSectionForView } from '../shared/bot-contracts';

const workbenchNames: Record<WorkbenchId, string> = { home: '首页', todo: '待办', office: '办公助理', permission: configurationBotSeed.name, delivery: '交付件管理', pbi: 'PBI系统', dts: 'DTS系统', life: '小工具', settings: '设置', web: '网页工作台' };
const pageNames: Record<string, string> = {
  browser: '浏览器',
  home: '我的看板', todo: '日程待办', office: '办公助理',
  'permission-query': '权限查询', 'permission-groups': '群组创建',
  'delivery-projects': '项目交付件管理',
  'pbi-features': '特性管理', 'pbi-modules': '子系统&模块',
  'dts-query': 'DTS查询',
  'settings-profile': '个人资料', 'settings-general': '通用与外观', 'settings-ai': 'AI 助手',
  'settings-data': '待办与数据', 'settings-notifications': '通知', 'settings-about': '关于',
};

export function describeAiScope(scope: AiScope): string {
  if (scope.module === 'reading') return `书目（ID ${scope.profileId}）`;
  if (scope.module === 'todo') return '待办与日程';
  if (scope.viewId.startsWith('workspace:')) {
    const section = configurationSectionForView(scope.viewId);
    if (section && section.id !== configurationBotSeed.workspaceId) return `工作台「${section.label}」`;
    const workbench = workbenchForScope(scope);
    if (workbench) return `工作台「${workbenchNames[workbench]}」`;
  }
  return `页面「${pageNames[scope.viewId] ?? scope.viewId}」`;
}

export function withWorkbenchContext(contribution: AiModuleContribution, scope: AiScope, objectName?: string, pageScope: AiScope = scope): AiModuleContribution {
  const workbench = workbenchForScope(scope);
  const workspaceOnly = scope.module === 'workbench' && scope.viewId.startsWith('workspace:');
  const pageIsWorkspaceOnly = pageScope.module === 'workbench' && pageScope.viewId.startsWith('workspace:');
  const location = workspaceOnly ? describeAiScope(scope) : `${workbench ? workbenchNames[workbench] : '工作台'} / ${describeAiScope(scope)}${objectName ? ` / ${objectName}` : ''}`;
  const pageKind = pageIsWorkspaceOnly ? '工作台范围' : '页面';
  const page = `用户明确关联的${pageKind}：${describeAiScope(pageScope)}。${pageScope.module === 'workbench' && !contribution.directBrowserOperations ? `此${pageIsWorkspaceOnly ? '范围' : '页面'}没有提供业务数据或专用工具，不要声称已读取其内容。` : ''}`;
  return {
    ...contribution,
    systemPrompt: now => `这条对话按工作台归类，可在同一工作台的不同页面继续。当前这一轮的业务对象：${location}。${page}历史对话可用于延续话题，但当前可核实的业务数据和可用工具仅限本轮提供的内容；历史消息可能关联其他页面或对象，不要把历史对象当成本轮对象，也不要声称已读取未提供的页面内容。${contribution.directBrowserOperations ? '本轮浏览器操作按用户已授权任务的站点与标签范围执行。' : '写入建议只能针对当前工具明确指定的对象，仍需用户确认。'}\n\n${contribution.systemPrompt(now)}`,
  };
}

export function buildWorkbenchContribution(viewId: string): AiModuleContribution {
  const workspaceOnly = viewId.startsWith('workspace:');
  return {
    toolNames: [], labels: {}, buildTools: () => [],
    systemPrompt: () => `你是 CMO Workbench 的通用助手。当前关联${describeAiScope({ module: 'workbench', viewId })}。只回答用户的问题和工作台使用上的一般问题；你没有${workspaceOnly ? '具体页面或业务对象的' : '此页面的'}业务数据或写入工具，不要声称已经查看或修改其内容。${browserWorkspaceForView(viewId) !== null ? '当前没有可操作的网页。请用户先在浏览器打开网页，再直接在右侧对话提出操作要求。' : ''}`,
  };
}
