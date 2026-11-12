# 设计验收索引

2026-10-17：完整验收正文已按模块和需求迁入 docs/requirements；本页保留原标题作为历史链接入口。当前效果以 DESIGN / UX-CONTRACT 及对应日期的验收记录为准。此次目录整理未重跑历史实机流程。

[需求总索引](docs/requirements/README.md) · [全部资料与原路径映射](docs/RESOURCE-INDEX.md)

# 代码仓整理与整体设计核对 · 2026-10-17

[查看完整记录](docs/archive/audits/design-sync-2026-10-17.md)

# 试玩保留档重置 · 方案 1 · 2026-10-17

[查看完整记录](docs/requirements/game/trial-reset/qa.md)

# AI 收起时的其他工作台悬浮目录 · 2026-10-17

[查看完整记录](docs/requirements/shared/navigation/qa.md)

# 游戏工作台二级目录恢复 · 2026-10-17

[查看完整记录](docs/requirements/game/trail-detective/qa.md)

# AI 悬浮胶囊 · 2026-10-17 · 内嵌按钮修订

[查看完整记录](docs/requirements/shared/ai-activity/qa.md)

# 浏览器任务记录 · 2026-10-17 · 已选方案 2

[查看完整记录](docs/requirements/web/browser-task-record/qa.md)

# 顶栏日程/待办共享面板 · 2026-10-17 · 已选方案 2

[查看完整记录](docs/requirements/shared/topbar/qa.md)

# 应用更新改为主动安装 · 2026-10-17

[查看完整记录](docs/requirements/shared/app-update/qa.md)

# AI 合并悬浮胶囊 · 2026-10-17 · 已选方案 3（历史阶段，已被内嵌按钮修订替代）

[查看完整记录](docs/requirements/shared/ai-activity/qa.md)

# 顶栏更新气泡紧凑调整 · 2026-10-17

[查看完整记录](docs/requirements/shared/app-update/qa.md)

# 顶栏应用更新验收 · 2026-10-17 · 已选方案 1（初版）

[查看完整记录](docs/requirements/shared/app-update/qa.md)

# AI 连续任务状态验收 · 2026-10-17（历史阶段，44px 固定状态行已被替代）

[查看完整记录](docs/requirements/shared/ai-activity/qa.md)

# 三主题还原验收 · 2026-09-24

[查看完整记录](docs/requirements/shared/themes/qa.md)

## 浏览器确认组合 · 2026-10-16

[查看完整记录](docs/requirements/web/browser-automation/qa.md)

## 浏览器网页缩放 · 2026-10-16

[查看完整记录](docs/requirements/web/page-zoom/qa.md)

## 阅读库路径入口修复 · 2026-10-16

[查看完整记录](docs/requirements/life/reading-import-51/qa.md)

## 浏览器运行胶囊动效 · 2026-10-16

[查看完整记录](docs/requirements/web/browser-activity/qa.md)

## 浏览器 AI 状态框持续动效 · 2026-10-16

[查看完整记录](docs/requirements/web/browser-activity/qa.md)

## 轨迹侦探双区联调 · 2026-10-16

[查看完整记录](docs/requirements/game/trail-detective/qa.md)

## 游戏项目终端 · 方案 2 · 2026-10-16

[查看完整记录](docs/requirements/game/terminal/qa.md)

## 浏览器站点授权 · 方案 3 · 2026-10-17

[查看完整记录](docs/requirements/web/site-authorization/qa.md)

## 游戏项目栏 · 方案 1 · 2026-10-17

[查看完整记录](docs/requirements/game/project-bar/qa.md)

## 双环境试玩与线上侧栏 · 方案 1 细化稿 · 2026-10-17

[查看完整记录](docs/requirements/game/online-preview/qa.md)

## 游戏项目说明 · 内置只读 Markdown 弹窗 · 2026-10-17

[查看完整记录](docs/requirements/game/run-instructions/qa.md)

## 试玩更新提示 · 方案 3 · 2026-10-17

[查看完整记录](docs/requirements/game/preview-refresh/qa.md)

## 2026-10-17 问题反馈方案 2：记录入口、持久保存与 ZIP

[查看完整记录](docs/requirements/game/issue-feedback/qa.md)

## 2026-11-11 灵动岛 AI 消耗：消耗光谱

source visual truth: `docs/requirements/shared/desktop-island/design/token-spectrum-2026-11-11.png`（1536×1024 设计板）。

implementation screenshot: `C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/spectrum-side-expanded.png`（320×560，侧边展开）；同目录有顶部展开、顶部收起、侧边收起与长列表的 1:1 裁切证据。

浏览器 CSS 视口为 480×560 / 580×320，devicePixelRatio 0.5；原始捕获 960×1120 / 1160×640，按 DOM 组件边界裁切，不缩放组件。对照了设计板、完整组件及紧凑读数／顶部三模型行。修复顶部第三行裁切后，三行内容高与可见高均为 70px；侧边大字、构成条、账号下拉与底部操作通过视觉复核。账号鼠标／键盘切换、失败恢复、刷新、零值、跨日、缓存、不完整明细与 20 模型滚动已检查，无新增相关控制台错误。

工程验证：`npm run verify` 通过，相关回归 23/23 通过；全量测试仍有 55 项失败，真实 New API 服务本轮未验证。

[查看详细对照、迭代与验证限制](docs/requirements/shared/desktop-island/qa-token-spectrum-2026-11-11.md)

final result: passed

### 顶部收起态细化：数字上、光谱下

依据用户对顶部示意图的反馈，账号数字与构成条改为上下两行；条宽与数字对齐，间隔 2px。双账号数字顶部均为 8px，光谱位于 28–32px，整体仍为 40px 高；580px 与 480px 宽均无竖向裁切。侧边账号仍为原来的纵向 flex 排列。字阶检查与构建通过。

更新截图：`C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/spectrum-top-stacked.png`（580×40，示例数据）。

### AI 连接整体外框

参考 AI 模型配置页，左侧连接来源与右侧详情整体复用 `set-rows` 外框；检查实际边框为 1px、圆角 14px、内距 16px / 20px，并沿用共享玻璃底和阴影。修正原灵动岛设置对所有 `set-rows` 的清空规则，使新增外框保留共享材质。

浏览器验证 New API／CodeAI 切换、添加账号四个字段与取消；500×800 窄视口下外框宽 452px、内容单列且无横向溢出。控制台无相关 error / warn。相关回归 6/6 和 `npm run verify` 通过。示例截图：`C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/connection-frame-wide.png`。

### 顶部展开态账号与模型区齐顶

将 New API 来源标识移入左侧账号区域，位于选择器下方；右侧模型区与选择器顶部均为 y=40px。顶部窗口仍为 580×270，三模型列表可见高与内容高均为 70px；20 模型时仅列表内部滚动，账号选择器保持 180px。侧边展开仍为 320×560，底部操作与导航完整。浏览器确认账号切换后数字和模型明细同步更新，未连接及首次加载状态无裁切，控制台无 error / warn。类型检查、字阶检查及相关回归 11/11 通过。

截图：`C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/spectrum-top-account-aligned.png`（示例数据）。

### 收起态未连接文字弱化

移除“未连接”对 Token 数字样式的复用，改用 11px、400 字重与灰色辅助文字。浏览器实测顶部仍为 580×40，文字框为 33×14、垂直居中；右侧 64×360 使用现有紧凑字阶 10px，均无横向溢出。正常双账号数字仍为 14px / 700。字阶检查、类型检查与构建通过。截图：`C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/disconnected-top-refined.png`。

### 日程气泡完成与 WeLink 本地状态 · 2026-11-11

参照本地 Ono 的日程气泡，日程与待办都支持第三列“完成 → 确认完成”，保留灰色类型标签和现有操作行。按用户确认，WeLink 仅保存本地完成状态及时间，会议来源、编号和会议信息保持不变；同步更新、取消与重新出现后保留完成状态。没有新增远端写操作。

使用项目 Playwright 启动实际 Electron 44.7.2，数据目录隔离为 `C:/Users/henry/.codex/visualizations/2026/11/10/01a1c5b5-613c-7f11-85b2-985e8ba3722b/cmo-meeting-completion-data`。通过真实 todo IPC 创建本地／WeLink 来源的测试日程并点击气泡：首次点击状态仍为 todo，二次点击为 done、写入 completedAt，成功后移除提醒；两种来源的确认前后按钮矩形完全相同。224px 宽气泡中三个按钮均在一行，长日程标题两行展示，底部间距仍为 6px。关闭测试应用后另开只读 SQLite 连接，确认两条完成记录均已持久保存，WeLink 编号 123 仍保留；页面错误为 0。

截图与结构化结果位于同一目录：`cmo-meeting-completion-local-confirm.png`、`cmo-meeting-completion-welink-confirm-native.png`、`cmo-meeting-completion-native-results.json`。测试中的 WeLink 记录为合成数据；同步测试使用实际 Store 与 WelinkSync、模拟 query-list 响应，未连接真实 WeLink 服务。

`npm run verify` 通过。`node --import tsx --test tests/island-bubble-ui.test.ts tests/welink-source.test.ts tests/welink-completion-sync.test.ts tests/todo-store.test.ts tests/todo-shared.test.ts tests/island-reminder-bubbles.test.ts tests/island-sedentary-time.test.ts tests/island-assistant-window.test.ts` 为 58/58 通过，覆盖二次确认、防重复提交、失败重试、版本冲突、跨午夜会议、本地完成字段保护、同步保留及既有提醒时序。未运行全量测试。DESIGN lint 为 0 错误、1 条既有无 YAML 警告；strict UI audit 保留原有 10 条发现，与 `cmo-footer-bubbles-audit.json` 比较无新增，不能视为全项目审计通过。

### WeLink 轮询间隔与同步控件

以当前页面组件和示例登录账号验证两项控件：均为 112×36px、10px 圆角并齐右；输入带分钟单位，同步按钮使用淡蓝底、16px 图标和 6px 图文间距。mist / cool / warm 截图均已复核；500px 窄视口下卡片宽 452px、两控件右边界均为 x=435px，卡片无横向溢出。键盘焦点可见，输入 99 后失焦修正为 60；恢复 10 后模拟同步期间按钮禁用，完成后显示同步结果。控制台无 error / warn，字阶、类型检查与构建通过；未执行真实 WeLink 同步。

截图：`C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/welink-controls-refined.png`；同目录保留 cool / warm / narrow 对照。

### WeLink 扫码登录等待提示

点击后立即显示“正在获取登录二维码，请稍候…”，按钮为带旋转图标的“获取中…”并禁止重复请求；等待和扫码期间都可取消，二维码到达后切换为“等待扫码”及扫码说明。启动失败、超时和登录状态读取失败都保留错误与重试；主动取消不显示红色错误。移除首次状态读取时对新二维码的清空，避免慢响应覆盖已到达的二维码。

示例桥接浏览器验证等待、取消和失败重试；按钮实测为 112×32px，500px 窄视口下卡片宽 452px，两个操作均在边界内且无横向溢出，控制台无 error / warn。新增 UI 回归覆盖启动先返回、禁止重复请求、二维码到达、完成登录、失败重试、超时、扫码前后取消，以及慢状态响应；相关测试 12/12 与 `npm run verify` 通过。未执行真实账号登录。

截图：`C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/welink-login-waiting.png`；同目录保留 narrow 对照。

### WeLink 登录失败的具体原因

复现旧实现只返回退出码的问题后，将失败处理移至输出流关闭后，保留尾部错误信息；已知无法连接桌面客户端、缺少登录程序提供中文原因，其余返回诊断错误行，无详情时明确说明。输出移除终端控制码、二维码、认证值与链接；中文跨 UTF-8 数据块仍完整。错误区保留换行并允许长内容折行。

20 项 CLI / UI 回归及 `npm run verify` 通过，覆盖尾部 stderr、服务返回拒绝原因、无详情、中文分块、程序缺失、原有成功/取消，以及页面错误显示与重试。模拟浏览器检查 860px 与 452px 卡片的多行原因均完整、无横向溢出；开发实例已重启加载主进程改动，未使用真实账号重试登录。旧失败的具体原因无法从单一退出码还原。

模拟截图：`C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/welink-login-error-reason.png`。

### 收起态未连接补充来源

文案改为“New API 未连接”。顶部为 11px 单行，侧边为 10px 两行居中；实测侧边文字框约 38×26px，无横向溢出，顶部文字框约 80×14px。字阶、类型检查与构建通过。截图：`C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/newapi-disconnected-right.png`。

### AI 连接统一背景与中间分隔线

依据模型配置页参考，移除来源选中项的左侧蓝色标记，保留浅蓝选中底；New API／CodeAI 详情均为透明背景、无独立卡片边框与圆角，共用外层玻璃底。左侧来源导航撑满内容高度，中间为 1px 细线；来源右内距 14px、两列间距 18px。搜索同时显示多组结果时以横线分隔。

浏览器验证来源切换、添加账号四字段及取消；500px 窄视口下外框为 452px，分隔线为底部 1px 横线、右侧边框为 0，内容无横向溢出，控制台无 error / warn。相关回归 6/6 与 `npm run verify` 通过。截图：`C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/ai-connections-unified-wide.png`；同目录保留 CodeAI、表单及窄窗口对照。

### 首页用量卡片移除重复连接入口

移除标题栏右侧“AI 连接 →”及无用图标导入，保留手动刷新和未连接空态中的“去连接”。浏览器确认标题操作区仅有刷新按钮，空态连接入口仍可见；既有首页卡片回归 7/7 与 npm run verify 通过。截图：C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/home-quota-no-header-link.png。

### CodeAI 标题区精简

移除“项目完成一轮后通知，需新会话生效”和“消息仅保存在本机”两句说明及其无用样式，标题区仅保留标题与重新扫描。浏览器实测标题区高约 36px，无残留说明占位；来源切换相关回归 6/6 与 npm run verify 通过。截图：C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/codeai-no-header-description.png。

### 灵动岛收起条分割线对齐 Ono（2026-11-11）

分割线移到吉祥物与摘要之间，复用 `--island-line`：顶部 1×16px，左右侧 36×1px，紧凑侧栏 24×1px。没有吉祥物入口时不画线，移除日程与 AI 消耗之间的重复线；侧边吉祥物入口和角标间距按 Ono 对齐。

独立 Electron 窗口验证顶部／左右侧、收起／提醒气泡／消息模式、100%／125%／200% 缩放，共 27 个分割线检查通过；无吉祥物入口的 3 个场景和未读角标的 3 个定位检查通过。消息模式不包含摘要条。构建、8 项相关回归、字体检查通过；严格审计仍为原有 10 项，无新增项，DESIGN lint 无错误。几何结果及原生截图：C:/Users/henry/.codex/visualizations/2026/11/10/01a1c5b5-613c-7f11-85b2-985e8ba3722b/cmo-island-divider-native-results.json。

## 2026-11-12 · WeLink 日程来源标识

- 使用共享 TaskSourceBadge：首页、事项库和灵动岛展开列表显示 WeLink，详情标题旁显示 WeLink · 只读；本地日程和收起摘要不增加来源标识。原分类标签、日程点击跳转和会议信息只读规则保留。
- 实际组件配合示例数据，在 1024×680 的 mist/cool/warm 主题检查分类筛选、详情打开与键盘关闭、本地日程对照，以及 132 字长标题。修正主工作台网格子项的最小宽度后，页面宽度保持 1024，标题省略而来源完整。灵动岛另核对顶部 580×270、侧边 320×560 和收起态来源隐藏。
- 本地截图与几何记录：artifacts/island-spectrum-20261111/welink-source-*.png、welink-source-browser-checks.json。预览不读写真实日程或账号。
- 验证：19 项相关测试通过（welink-source-badge、welink-source、welink-completion-sync、island-bubble-ui），npm run verify 通过。全项目静态 UI 审计仍为此前相同的 10 项发现，规则与文件未新增；未修改本次范围外的原生选择器等问题。

## 2026-11-12 · 灵动岛底部导航对齐 OnoSan

- 复现：AI 消耗页的专属规则同时改变整组导航字号、内边距、图标大小和选中配色。实际组件在顶部切页时最大横移 31.1875px，左右侧按钮高度变化 2px；按住本身没有几何变化，OnoSan 同条件切页无位移。
- 移除 AI 消耗页对底部导航的覆盖，统一复用 OnoSan 的按钮与选中底块样式；补齐侧边容器不超过 200px 时只显示图标的相同规则。保留 AI 消耗文案与消耗图标。
- Browser plugin not available，使用 Playwright 和隔离的无头 Chrome 加载两项目真实组件及模拟只读数据。临时页面为 localhost:5180 与 localhost:5181，验证结束后关闭服务与浏览器；未读取或修改真实日程、账号及 OnoSan 源码。
- 顶部 580×270、左右侧 320×560 的三主题，加上顶部 360px／侧边 160px 窄视口和减少动态效果，共 30 组两项目对照、180 次鼠标切页；另外逐组验证 Enter、Tab 和 Space。悬停、按住、切换中和切换后的按钮／图标几何均稳定，CMO 与 OnoSan 相同；选中底块对齐误差不超过 1px，选中配色一致。页面身份、非空内容、框架错误层、控制台检查通过。这里的窄视口检查不等同 Windows 原生显示缩放验证。
- 验证：island-bubble-ui、island-quota、welink-source-badge 共 19 项测试及 npm run verify 通过。严格静态审计仍为原有相同的 10 项，无新增规则／文件发现。几何、截图及静态审计证据位于 C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/island-nav-*。

## 2026-11-12 · 灵动岛顶部日期固定居中

- 顶部标题栏原先将日期放在页名与操作按钮之间的剩余空间内居中。四个 TAB 的页名字数不同，实际日期和时间横移 6.5px；左右停靠的第二行日期原本稳定。
- 仅修改顶部展开态标题栏：日期与时间相对标题栏整体居中，右侧操作按钮靠右保持原位；侧边日期及窄窗口原有隐藏规则保留。
- 隔离无头 Chrome 使用真实组件和模拟只读数据，在 5182 临时端口验证，保留用户运行中的 5180 服务。三种停靠、三主题、顶部 380–580px／侧边 160–320px 视口及减少动态效果共 23 组场景、92 次 TAB 切换通过，日期／时间位移为 0；右侧操作和底部导航几何稳定，顶部可见日期居中且不遮挡相邻控件。另外等待动画完成后核对四个 TAB 并截图，位置仍相同。页面身份、内容、错误层与控制台检查通过；不代表 Windows 原生显示缩放验证。
- 验证：island-bubble-ui、island-quota、welink-source-badge 共 19 项及 npm run verify 通过。DESIGN lint 为 0 错误、1 条已有的无 YAML 提示；严格静态审计仍为相同的 10 项发现，无新增规则／文件项。未修改本次范围外的问题。
- 证据：C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/island-header-*-results.json、island-header-capture-*.png 及 island-header-premium-audit.json。

## 2026-11-12 · AI 消耗页直接显示登录用户名

- 将账号名称／选择器旁固定的 New API 文案替换为当前账号的登录用户名，复用原有辅助字阶、省略和完整悬停提示。未配置账号时不显示该项，账号名称仍独立保留。
- 使用真实组件和模拟数据，在隔离无头 Chrome 验证顶部／左侧／右侧的单账号、多账号切换、未配置、长用户名、切换失败及三主题，共 21 组场景。用户名与账号选择同步更新，鼠标／键盘均可切换；失败保留原账号及用户名，长用户名省略且完整值仍可提示。页面及控制台无相关错误；未读取或修改真实账号配置。
- 19 项相关回归及 npm run verify 通过；DESIGN lint 为 0 错误、1 条已有无 YAML 提示。严格静态审计仍为相同 10 项发现，未新增规则／文件项。证据：C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/newapi-username-results.json、newapi-username-updated-*.png 及 newapi-username-premium-audit.json。

## 2026-11-12 · 灵动岛设置页滚动条布局稳定

- 复现：真实 SettingsView 及共享 `.content`／`.view-fade` 结构加载模拟项目列表，短 New API 页面切换到长 CodeAI 列表时，普通滚动条占用 15px，居中页面横移 7.5px。
- 只在包含 `.settings-island-page` 的 `.content` 上设置 `scrollbar-gutter: stable`，预留主滚动条空间；保持原有滚动和页面自然高度，不增加固定高度或嵌套滚动容器。
- Playwright 无头 Chrome 显式移除默认的 `--hide-scrollbars`，确认滚动条实际占用布局宽度。三主题与 1440×900、1280×820、1024×680 共 9 组场景验证来源切换、历史展开、搜索及五个页签；页头、搜索、页签与卡片的横向位置和宽度均保持不变，横移为 0，长内容仍可正常滚动。页面及控制台检查通过，使用模拟只读数据，未改真实配置。
- island-connection-layout、island-display-settings 共 11 项回归及 npm run verify 通过。DESIGN lint 为 0 错误、1 条已有无 YAML 提示；严格静态审计仍为相同 10 项发现，无新增规则／文件项。证据：C:/Users/henry/.codex/visualizations/2026/11/11/01a1c947-47bf-7882-8e4b-a11d6312af30/island-settings-scrollbar-*-results.json、island-settings-scrollbar-after.png 及 island-settings-scrollbar-premium-audit.json。
