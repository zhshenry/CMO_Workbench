# CMO 本地需求入口

[双仓本地需求总表](../../../onosan_workbench/docs/requirements/README.md) 统一登记需求名称、各仓路径、当前状态和计划或任务。这里按 CMO 工作台进入业务正文。[CMO GitHub 工单](../issues/README.md)

## 需求资料放置规则

本地需求使用 `<工作台>/<功能>/proposal.md`。跨工作台能力归 `shared/`，Bot 独立专项归 `shared/ai-assistant/<功能>/`。现有功能的小改动更新原需求。需独立验收的功能另建目录。

按 SDD 顺序整理。`proposal.md` 写业务需求和验收条件，界面评审按需补 `design/` 或 `prototype/`，`spec.md` 写技术规格，再按需用 `plan.md`、`tasks.md` 执行，`qa.md` 记录实测。工作台和功能组使用 `README.md` 导航，具体需求从 `proposal.md` 进入。新增或修改需求后同步[双仓总表](../../../onosan_workbench/docs/requirements/README.md)和对应分类入口。

GitHub 工单的进度在原 Issue 更新。相关业务需求可链接原工单。[双仓完整规范](../../../onosan_workbench/docs/requirements/README.md#需求资料放置规则)

「状态」列在双仓总表登记。各需求的交付范围、完成数和验收备注记在本仓 `proposal.md` 的「交付进展」。[双仓状态说明](../../../onosan_workbench/docs/requirements/README.md#状态说明)

## 工作台目录

| 工作台/范围 | 入口 |
|---|---|
| 跨工作台能力 | [shared/](shared/README.md) |
| 首页与待办 | [home/](home/README.md) |
| 网页工作台 | [web/](web/README.md) |
| 小工具：阅读 | [life/](life/README.md) |
| 设置 | [settings/](settings/README.md) |

[文档与资源逐项索引](../RESOURCE-INDEX.md) · [设计验收历史入口](../../design-qa.md)
