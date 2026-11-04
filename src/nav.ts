import type { ViewId, WorkbenchId } from '../shared/contracts';

export type { WorkbenchId };

export interface NavSub {
  label: string;
  /** 已上线且有界面的子页 */
  view?: ViewId;
  /** 规划中(仅占位) */
  pending?: boolean;
  /** 不在二级目录显示(页面保留,从首页等其他入口进入) */
  navHidden?: boolean;
}

export interface WorkbenchDef {
  id: WorkbenchId;
  title: string;
  /** 首页「更多工作台」卡片的简介 */
  desc?: string;
  pending?: boolean;
  /** 不在一级图标栏显示(功能保留,从首页等其他入口进入) */
  railHidden?: boolean;
  subs: NavSub[];
}

export const NAV: WorkbenchDef[] = [
  {
    id: 'home',
    title: '首页',
    subs: [
      { label: '今日概览', view: 'home' },
      { label: '事项库', pending: true },
      { label: '本周回顾', pending: true },
    ],
  },
  {
    id: 'permission',
    title: '权限管理',
    desc: '权限查询与群组创建',
    subs: [
      { label: '权限查询', view: 'permission-query' },
      { label: '群组创建', view: 'permission-groups' },
    ],
  },
  {
    id: 'delivery',
    title: '交付件管理',
    desc: '项目交付件管理',
    subs: [
      { label: '项目交付件管理', view: 'delivery-projects' },
    ],
  },
  {
    id: 'pbi',
    title: 'PBI管理',
    desc: '特性管理与子系统模块',
    subs: [
      { label: '特性管理', view: 'pbi-features' },
      { label: '子系统&模块', view: 'pbi-modules' },
    ],
  },
  {
    id: 'dts',
    title: 'DTS管理',
    desc: 'DTS查询',
    subs: [
      { label: 'DTS查询', view: 'dts-query' },
    ],
  },
  {
    id: 'life',
    title: '小工具',
    desc: '阅读清单',
    subs: [
      { label: '阅读清单', view: 'reading' },
    ],
  },
  {
    // 2026-09-24 定稿方案 C:设置作为第六个大工作台,复用「图标栏 + 二级目录」导航
    id: 'settings',
    title: '设置',
    desc: '个人资料、通用、外观等',
    subs: [
      { label: '个人资料', view: 'settings-profile' },
      { label: '通用与外观', view: 'settings-general' },
      { label: 'AI 助手', view: 'settings-ai' },
      { label: '待办与数据', view: 'settings-data' },
      { label: '通知', view: 'settings-notifications' },
      { label: '关于', view: 'settings-about' },
    ],
  },
];

export const workbenchById = (id: WorkbenchId): WorkbenchDef => {
  const wb = NAV.find((w) => w.id === id);
  if (!wb) throw new Error(`unknown workbench: ${id}`);
  return wb;
};

/** 页面归属的大工作台(用于从内容区链接跳转时联动一级导航) */
export const ownerOfWorkbench = (view: ViewId): WorkbenchId | undefined =>
  NAV.find((w) => w.subs.some((s) => s.view === view))?.id;

/** 工作台的默认路由(第一个已上线子页;全未上线时由内容区显示规划占位页) */
export const defaultViewOfWorkbench = (id: WorkbenchId): ViewId =>
  NAV.find((w) => w.id === id)?.subs.find((s) => s.view && !s.navHidden)?.view ?? 'home';

/**
 * 工作台范围的助手上下文。主标签是当前大工作台名，对象行是当前子页名。
 * `workspace:` 没有对应子页，对象行沿用工作台名，避免套到某个具体子页上。
 */
export function workbenchAiContext(viewId: string): { label: string; object: string } {
  if (viewId.startsWith('workspace:')) {
    const workbench = NAV.find((item) => item.id === viewId.slice('workspace:'.length));
    const title = workbench?.title ?? '当前工作台';
    return { label: title, object: title };
  }
  const workbench = NAV.find((item) => item.subs.some((sub) => sub.view === viewId));
  const sub = workbench?.subs.find((item) => item.view === viewId);
  return { label: workbench?.title ?? '当前工作台', object: sub?.label ?? viewId };
}
