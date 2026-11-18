# 常驻 AI 助手

所属：跨工作台能力。资料状态：正式方案。

当前规范：[视觉](../../../../DESIGN.md) · [行为](../../../../UX-CONTRACT.md)。整理目录不代表新增实施或重新验收。

## 方案与验收文字

- [spec.md](spec.md)
- [Bot 架构落地与验证（2026-11-18）](bot-workbench-implementation-2026-11-18.md)：OnO 完成版本、六个 CMO Bot、独立 Host、AI 交互、业务适配及迁移边界。

## 后续规划与研究

- [企业助理与会议伴侣规划](enterprise-assistant-plan.md)：双来源会议合并显示、消息提醒第一版和 WeLink 写入确认已实现；会议伴侣与实体会议室预约已纳入规划；手机入口、完整办公分析和答案引用继续研究。
- [办公材料服务与 Bot 工作台设计](office-materials-and-bot-workspaces.md)：材料共享、回答出处、当前写入确认边界与工作台划分讨论；办公新服务、页面尚未开发，Bot 核心已另行落地。
- [日程待办与办公助理界面概念](design/office-ui-2026-11-17/README.md)：三版设计已保留，尚未选定；pending，等 Bot 架构改造后再评审实施。

## 验收证据

- [68-ai-model-long-ellipsis-1280.png](evidence/68-ai-model-long-ellipsis-1280.png)（保留原有提交范围）
- [68-ai-model-menu-open-1280.png](evidence/68-ai-model-menu-open-1280.png)（保留原有提交范围）
- [assistant-home-warm.jpg](evidence/assistant-home-warm.jpg)（仅本机，Git 忽略）
- [assistant-layout-checks.json](evidence/assistant-layout-checks.json)（仅本机，Git 忽略）
- [assistant-narrow-overlay.jpg](evidence/assistant-narrow-overlay.jpg)（仅本机，Git 忽略）
- [assistant-project-audit.json](evidence/assistant-project-audit.json)（仅本机，Git 忽略）

## 仓库外资料位置

原始测试证据和业务来源保持原位置，不重复拷贝整套临时数据；以下记录实测存在性，远端链接未联网重验。

| 地址 | 当前状态 |
|---|---|
| [远端资料](https://fluent2.microsoft.design/components/web/react/core/drawer/usage) | 远端引用，未联网复验 |

验收截图、测量和报告统一存放在 evidence/；本机资料继续由 Git 忽略，原有验收图的提交范围通过显式规则保留。设计稿保留在 design/，临时调试输出放 test-results/。
