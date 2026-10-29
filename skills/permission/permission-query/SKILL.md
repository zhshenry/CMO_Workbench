---
name: permission-query-iright
description: iRight 群组服务平台「权限查询」页的网页使用流程与表格数据读取，用于 browser_observe/extract/act/wait/check
---

# iRight 群组列表页（权限查询）

> 本 skill 指导如何在该页搜索群组并读取群组列表的结构化数据。
> 页面会改版，使用前先 observe 确认实际结构。

## Part 1：怎么用这个网页（操作 SOP）

### 站点
- 站点：https://group.iright.huawei.com/web/groupWeb/#/groupList
- 页面标题「群组管理前台」，左侧导航树有「群组管理 / 所有流程 / 我的工作空间」。
- 表格在主 frame（非 iframe）。observe 返回的 frames 里 `issdp.huawei.com` 那两个是无关的跨站 iframe，不要往那里读。

### 搜索群组
1. 搜索框在表格上方，placeholder 可能是「请输入群组名称或其中关键字」或「请输入内容进行筛选」（页面有两个相似输入，先 observe 确认哪个是群组名搜索框，选 role=textbox 且 name 含"群组名称"或"筛选"的那个）。
2. 用 `browser_act` 的 `fill` 把群组名（如 `his-dsp-cme`）填入搜索框。ref 来自最近一次 observe 的 elements。
3. 填完后点「搜索」按钮（role=button, name=搜索）。用 `browser_act` 的 `click`。
4. 点完用 `browser_wait` 等结果：表格会刷新，结果条数变化。可 wait 搜索按钮变为可用，或 wait 结果文本出现。
5. 重新 `browser_observe` 看刷新后的表格——**搜索后的 observe 才能看到真实结果**，搜索前的 observe 看到的是默认列表。

### 翻页
- 表头有「共 N 条」是总数。
- 底部有「跳至」分页器 +「条/页」选择（默认 10 条/页）。
- 多页时点分页器或用「跳至」输入页码。

### 进入群组详情
- 群组名称列是链接（role=link），点群组名进入详情页看成员/权限。
- HIS-XXX-KIA 后缀的群组是机要群组（KIA），申请加入前需特别确认。

### 核验要点
- 搜索成功：用 `browser_check` 核验「搜索框已填入目标」+「结果里出现目标群组」两项。
- 群组状态：生效日期 ≤ 今天 ≤ 失效日期，状态=启用，才是有效群组。
- 管理员列格式：`<姓名> <工号>`（如 `weixiaocui 00514659`）。

## Part 2：怎么读取表格数据（observe/extract 用法）

> 表格结构部分待实测填入（见下方待办）。

### observe 读表格行
- `browser_observe` **不传 query 只返回按钮/输入框等交互元素，看不到表格行**。要读表格行必须传 query：
  `query: { selector: { by: 'css', value: 'tr' } }` 或 `{ by: 'role', value: 'row' }`。
- observe 返回的 elements 里若含 row/cell，会自动带每行的 cells 列文本，据此核对列序。
- 表格数据也会出现在 observe 的 text 正文里（平铺文本流），但那是非结构化的，要按列提取得靠 elements 的 cells 或 extract。

### extract 提取表格
- `browser_extract` 的 input 是 collect/read 两形态，字段不能混用。
- collect：query 指向真数据行，fields 指定列（name + 从 0 起的 column），keyFields 指定唯一键（值不能为空，否则整行丢弃）。
- extract 前必须先用带 query 的 observe 确认能选到**非空**行；选到空 tr（分页/占位）会读出空行被 keyFields 全丢 → `rows:[]`。
- totalQuery 指向「共 N 条」总数，endCondition 核验末页；缺这两项或未读完不能称为全部。

### 字段列序（从 0 起，待实测核对）
0 群组名称 | 1 应用类型 | 2 类别 | 3 群组归属 | 4 群组管理员 | 5 群组Owner
6 是否系统创建 | 7 是否管理KIA | 8 是否可申请加入 | 9 是否已周期核对 | 10 状态
| 11 生效日期 | 12 失效时间 | 13 最近核对时间 | 14 是否订阅周期核对
（此列序从 observe text 正文推断，未核对，使用前用带 query 的 observe 的 cells 确认）

### 表格结构（待实测填入）
- [待实测] 表格是标准 `<table>/<tr>` 还是 `<div>` 模拟：决定 extract 的 query 用 `css=tr` 还是 `css=.row-class`。
- [待实测] 真数据行的稳定定位选择器（避开空行/分页占位）。

## 常见坑
- 不传 query 的 observe 看不到表格行（只返回交互元素），不要据此判断"表格读不到"。
- extract 选到空 tr 会读出空行被 keyFields 全丢 → `rows:[]`；需换更精确的 query。
- 表格若为 div 模拟，`css=tr` 选不到，改用实际行 class 或 `role=row`。
- `issdp.huawei.com` 的 iframe 是无关跨站框架，不是群组表格。
