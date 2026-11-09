# Changelog

本项目按 Keep a Changelog 格式记录版本变更。正式 Release 使用对应版本条目生成发布说明。

## [Unreleased]

## [1.2.0] - 2026-11-09

v1.1.19 之后叠加桌面灵动岛全量改造,本次发版。整体把悬浮待办窗替换为常驻灵动岛,并对齐 onosan v2.1.4 的 9 项优化。

### Added

- 桌面灵动岛替换悬浮待办窗:新建 `desktop-island` 模块(独立 BrowserWindow + `setShape` 点击穿透 + 四向停靠 + 收起/展开/提醒/语音四态),置物架页支持拖入文件暂存 + 便利贴(文字记录,草稿实时持久化 + 切换确认防丢字),复用 onosan 一体化布局(`c2d6177`)。
- New API 额度查询:灵动岛侧查今日 Token 用量,多账号管理(主进程 safeStorage 加密凭据),额度环图与今日数据展示(`f98285c`)。
- 窗口永久显示:powerMonitor 联动 `suspend/resume/lock/unlock` + `suspended` 状态,睡眠/锁屏唤醒后自动恢复置顶,不被其他窗口压下去(`180d44e`)。
- 久坐提醒:照 water 模板平移,`HealthReminder` 组件四列紧凑行(喝水 + 久坐合并),到点弹语音「到活动时间了」,锁屏/勿扰/睡眠时暂停(`965d9e4`)。
- AI 对话助手独立窗:`IslandAssistant` 双 tab(对话 + 消息),`?window=island-assistant` 独立 BrowserWindow,复用 `wb.ai.*` 全栈(`module:'todo'` 会话),收起态/展开态 footer 点吉祥物弹出;消息 tab 占位待接 codeai 数据源(`8089f7d` + 后续)。
- AI 额度配置 master-detail:灵动岛设置页账号列表改左来源 + 右详情 + GameOptionsMenu 收纳「打开控制台/删除账号」(`67adb38`)。
- 便利贴复制走主进程剪贴板:`clipboard:write` IPC,岛窗失焦时复制更稳,与 onosan 一致。
- AI 额度圆环配色:每个账号按顺序循环蓝/紫/青/橙四色,收起态小圆环纯色区分。

### Changed

- 设置页通知并入通用与外观:取消独立「通知」二级目录,「待办提醒」开关移入通用页;旧 `settings-notifications` 视图经 `resolveView` 重定向兼容(`70a9e25`)。
- 收起态左右停靠账号卡片改竖排(名字在上、圆环在下),吉祥物与日程图标间距加大。

### Fixed

- 多显示器跨屏全屏误判导致灵动岛消失:已通过收紧全屏检测范围解决(此前副屏全屏工作会让主屏的岛隐藏)。

## [1.1.19] - 2026-11-05

v1.1.15 之后叠加 ONO bundle-1(skill 名标签)+ 2 项 AI 协议调参,本次发版。承接 v1.1.15 的合入(ONO 流水线 #10)。

### Added

- AI 模型上下文与输出上限扩容:接入侧模型声明 `contextWindow` 128000 → 200000、`maxTokens` 3500 → 100000(`ec02ad1`)。此前 3500 输出上限在长任务(浏览器多步操控、表格提取)中频繁触发截断,扩容后模型可在单轮内完成更长的工具调用链与结构化输出。
- read 工具标签显示具体 skill 名:AI 在浏览器页加载页面 skill 时,工具执行行原本固定显示「加载 Skill 子文件」,看不出加载的是哪份说明书。现读 SKILL.md 入口文件时由 `ai-core.ts` 读 frontmatter name 覆盖为「加载 Skill `<name>`」(如「加载 Skill permission-query-iright」),读 skill 子文件(字段字典、示例等无 name 头)时仍显示通用「加载 Skill 子文件」。`modules/browser/ai.ts` 兜底标签从「读取 skill 子文件」改为「加载 Skill 子文件」措辞统一(bundle-1 / ONO #10,`095035e`)。

### Fixed

- AI 空回复报错补充 stopReason 诊断:模型结束循环但未返回任何文本时,原报错「模型未返回可用内容」无法区分是 max_tokens 截断、模型静默结束还是服务端空响应。现把最后一条 assistant 消息的 stopReason 带进错误信息「模型未返回可用内容(停止原因:`<stopReason>`)」,便于下次直接定位(`b87b550`)。

## [1.1.15] - 2026-11-05

v1.1.8 之后叠加 6 个需求(bundle-1 ~ bundle-6)+ 1 个 DTS 缺陷修复 + 1 个浏览器报错细化,本次正式发版。

### Added

- AI 首配自动启用:保存首个模型后若用户未主动关闭过 AI,自动置 `aiEnabled=true`(bundle-1,`7b0c6eb`)。`ai-store` 新增 `aiExplicitlyDisabled` 标记区分"从未开"与"主动关";删除个人资料页底部"资料保存在本机应用数据…"提示句;W3 账号/密码从两行改为一行等宽并排。
- 未填 W3 账号时顶部提醒:设置页 `w3Uid` 为空时,在顶部待办胶囊右侧渲染"未设置 W3 账号,点击维护"提醒按钮,点击跳转个人资料页;填好保存后离开设置页重读 `w3Uid`,提醒即时消失(bundle-5,`886dafa`)。
- AI 配置变更实时同步已开侧栏:此前 `AiPanel` 仅在 open 变化时读一次 config,`AiSettings` 保存后侧栏需关掉重开才生效。新增主进程→渲染进程 `ai:config-changed` 事件广播,各配置变更 handler 后广播最新 config,已打开侧栏即时跟随(bundle-6,`60ad4d9`)。
- 群组创建 SKILL 实测文档:从占位文档扩充为实测文档——页面结构、Offering 弹窗全流程、单个添加全列控件、字段枚举(前缀 11/应用类型 8/有效期 3)、8 条用户决策规则、4 处隐形坑、提交失败反馈(`abc5b46`)。

### Fixed

- AI 自动化关闭首个任务标签产生僵尸标签:渲染层 `closeTab`(pane.tsx)此前对首个标签静默 early-return,但主进程 `tasks.ts` close 路径只守"最后一个任务标签",不知哪个是首标签——任务持有 `[首标签A, B]` 时 AI close A,首标签从 `tabIds` 移除、guest 销毁,可标签条首个标签还在(且不渲染 X),变成不可关闭、不可重载的僵尸标签。主进程 close 路径现按 `tabIds[0]` 拒关首标签,与渲染层首标签保护一致(回归自 23da968,v1.1.8 条目宣称的"AI 自动化 close 一并拒关"此前未真正达成)(`01fffae`)。
- `browser_act` 纠错反馈注入真实 ref:模型调 `browser_act` 缺 type/ref 时,错误反馈 examples 原只用占位符 `<observe 返回的 ref>`,模型无法直接抄写纠正,反复猜(用户实测连报 4 次才摸对结构)。现用最近一次 `browser_observe` 返回的真实元素生成 examples,首次报错后第二次即可照真实 ref 纠正(bundle-2,`21daae1`)。
- 浏览器标签页宽度固定 180px:`.mbp-tab` 从 `min-width:100px/max-width:210px/flex:0 1 auto` 改为 `width:180px/min-width:180px/flex:0 0 auto`,标签宽度不再随标题长度变化;超长标题仍走省略号截断(bundle-3,`d4c059a`)。
- `element-blocked` 报错细化:`driver.ts` 拆分为不可见/已禁用/被遮挡三种具体报错,遮挡场景带出遮挡元素的标签/class/文本/尺寸,便于 AI 自愈(`abc5b46`)。

### Changed

- 去掉工作台「小工具」入口:从 `src/nav.ts` 删除 `id='life'` 导航条目,左侧图标栏、hover 二级目录、首页"更多工作台"网格三处入口同步消失。后端 reading 模块与 `WorkbenchId 'life'` 枚举保留不动,数据不丢,仅界面不再暴露入口(bundle-4,`79a25cb`)。

## [1.1.8] - 2026-11-04

### Fixed

- 修复「查看更新说明」跳转错误:`updateNotesUrl` 此前用 GitLab 标准路径 `/-/releases`,在 CodeHub 上被前端路由重定向到代码仓文件页,看不到 Release。改用 CodeHub 实际可用路径 `/files/releases` 列表页(该页按时间倒序展示各版本 Release)。版本号不再作为路径段——`/files/releases/v{版本}` 子路径实测同样回退到代码页,无法直达单版本详情。
- 工作台内嵌浏览器默认标签页不可关闭:首个标签承载工作台主页 `initialUrl`,此前可被误关导致主页 URL 丢失、无法恢复(用户在权限查询页误关群组页后打不开)。渲染层 `closeTab` 增加首个标签保护,标签条首个标签不再渲染 X 关闭按钮(AI 自动化 close 路径的真正拒关见 [1.1.15] 条目,此前本条宣称的"AI 自动化 close 一并拒关"未达成)。
- 修复设置页旧版视图标识兼容:v1.1.0 合并「通用」与「外观」为「通用与外观」后,已升级用户的本地数据仍可能记录旧 `viewId` `settings-appearance`,导致设置页无法定位到合并后的页面。`ai-scope` 现将旧 `settings-appearance` 归一到 `settings-general`,无需用户手动清理数据。

## [1.1.0] - 2026-11-04

### Fixed

- 断开应用内 GitHub 自动更新:此前安装版启动后会自动连上游 GitHub 仓库检查/下载更新,存在把本地 CMO 覆盖成上游 Ono 的风险。移除 `build.publish` 配置,安装包不再含 `app-update.yml`,启动不联网检查;设置页"查看更新说明"改指 CodeHub Release 页。

### Changed

- 合并设置页「通用」与「外观」为「通用与外观」单页:原两页内容较薄,合并后主题色卡置于行为项下方,导航二级目录少一项。

## [1.0.0] - 2026-11-03

CMO Workbench 首发版本。在上游 v1.2.3 基线之上叠加 CMO 定制,并移除与 CMO 无关的上游业务(游戏、命理、自媒体)。

### Added

- 华为 W3 SSO 自动填充:在设置页配置 W3 账号后,内嵌浏览器遇到 `login.huawei.com` 登录页自动填充用户名密码(仅填值,不自动提交;扫码、二次验证与原生弹窗由用户接管)。
- 四个业务工作台:权限管理(权限查询、群组创建)、交付件管理、PBI 管理(特性管理、子系统与模块)、DTS 管理(DTS 查询)。
- AI 浏览器操控扩展到四个业务工作台:复用同一套定位、读取、点击、填写、核验能力,各工作台持久登录分区相互隔离。
- AI 工具写操作确认机制:写操作经 `declare_write` 声明并附说明,执行前逐次人工确认;`read` 工具标签按工作台上下文动态化。
- AI 助手接入 skill 子系统:LV1 工作台级 skill 注入,内置受限 `read_reference` 只读工具。
- AI 助手上下文卡:工作台名称与子页名称跟侧栏导航统一,已选对象(书籍、待办等)继续显示对应对象。
- 设置工作台:个人资料、通用、外观(mist/cool/warm 三主题)、AI 助手、待办与数据、通知、关于七个子页。

### Changed

- 应用命名为「CMO 工作台」:窗口标题、托盘、关于页统一更新。
- 权限管理页字号改用 type token,与全局字阶系统一致。
- 内嵌浏览器主框架导航事件 `did-navigate-in-page` 改用第三个回调参数判断 `isMainFrame`,修复此前主框架页内导航(如 hash 变化)不触发 SSO 同步的运行时缺陷。
- `windows-cloud-pilot.yml` GitHub Actions 工作流恢复,覆盖 Windows 云验收流水线。

### Removed

- 移除游戏工作台(轨迹侦探项目运行/预览/测试),与 CMO 无关的上游业务。
- 移除命理模块(八字/紫微/占星、命例管理、AI 解读),与 CMO 无关的上游业务。
- 移除自媒体工作台(博客编辑、图文发布、小红书素材采集、浏览器簇),与 CMO 无关的上游业务。
- 清理上述模块的残留:死 CSS、`bazi-*` 类名改名为 `rd-*`、prototype HTML 与文档中的命例/小红书字样、`context-picker-pilot` 与 `windows-pilot` 测试中的 copy/bazi 断言。

### Notes

- Windows x64 安装版与便携版本次仅在本地构建与验收;因 CodeHub 不支持二进制附件上传,安装包与便携包保留在本地,CodeHub Release 仅发布源码归档与发布说明。
- 安装器未配置代码签名;便携版使用完整 ZIP 手动替换。
- `npm test` 全量测试在 Windows 本机存在 7 项既有失败(符号链接 EPERM、Windows 打包 fixture、jsdom React act 环境不稳),经在 baseline 验证为环境限制,非本次代码引入,不影响发版。
