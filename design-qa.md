# 设计验收索引

## 2026-11-19 · 新增事项对齐 OnoSan

- 页头新增、Ctrl+N 和顶栏新增共用 408×430 CSS px 的 TaskEditor 模态框。初始聚焦名称，禁用的创建按钮降低视觉强调。顶栏菜单收起前将焦点交给对应胶囊，供表单关闭恢复。

- 隔离 Electron 的 11 组检查通过。覆盖引导气泡与模态框优先级、日期弹层逐层 Escape、放弃草稿确认、实际创建一条合成待办并恢复焦点，以及 1359×880 和 818×576 CSS 视口。顶部入口保留默认待办／日程类型。 [桌面截图](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/ui-design/cmo-create.png) · [125% 缩放](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/ui-design/cmo-compact-create.png) · [实测数据](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/ui-design/design-metrics.json)

## 2026-11-18 · Bot 名片与卡内侧栏

使用独立数据目录启动本项目的 Electron 窗口，通过本机模拟模型完成对话并保存交付件。核对顶部名片相对正文的中心位置、侧栏分隔线、头像与资料保存、工作台独立开合、右键和键盘菜单、资料库预览与来源任务、1024px 窗口和重启后的草稿。模型请求记录确认，分别选择模型的两个 Bot 实际发往各自配置的模型。

CMO 构建和 71 项 Bot 回归通过。本轮另跑了六组隔离桌面流程，包括定时任务草稿跨页签保留、灵动岛查看工作记录并转到主窗口编辑资料。项目全量测试仍有 45 项失败，逐项在还原本轮改动的临时源码副本复现。

## 2026-11-16 · 邮箱日历与 WeLink 会议共同同步

- 根据用户提供的日历列表、详情和会议返回结构新增固定的两来源读取器。日历按中国时区逐日查询，会议按待参加／已结束类型完整分页；与实际条目矛盾的 total 不参与结束判断。查询结果区分成功、失败与不完整，单个来源失败时仍提交另一来源的合法更新，旧缓存保留；清理仅限已完整核验的来源、账号与窗口。
- 同步本地写入使用事务。账号／邮箱前后不一致、数据错误、分页重复或达到上限时不清理该来源旧记录；明确取消可移除。完成时间、创建时间及未改期的提醒状态保持。旧会议可按已返回的 meetingId 补齐身份并保留旧 ID 和完成状态；无归属的旧历史不删除。已知其他账号的缓存从当前列表和提醒认领中排除，避免跨账号认领；不推断旧数据的账号归属。
- 自动刷新、手动刷新与新增 AI 工具 welink_agenda 共用一套服务，按需详情也共用缓存和账号验证。成功历史查询不把本轮缺失的缓存当作新结果，不清理轮询窗口。AI 返回来源状态与 cached 标识，只有两来源完整成功且无记录才说明没有安排。没有可靠的公共标识时不跨源合并，不把 URL 参数或会议号当 meetingId。
- W3和Welink接入默认直接同步当前登录账号日历；可选邮箱仅在 CLI 明确提示缺少连接配置时用于发现，不作为查询前置条件。按来源显示数量、失败／不完整提示与最近成功时间。同步只读，来源徽标分别为邮箱日历与 WeLink，原完成确认保留。详情在禁用字段集外按需读取参会人、说明与入会链接；isOnlineMeeting=false 时仍可显示有效链接，正文按纯文本渲染。全天在列表、顶栏与灵动岛明确标注，跨午夜外部日程按重叠日期显示。
- 本机 CLI 实测为 1.0.16，实际参数解析拒绝 calendar --format json；文档与调用已同步修正。当前没有可用的 WeLink 登录，未完成真实邮箱网络连通验收。未把用户贴出的“实测结论”直接视为本机实测；测试仅使用虚构邮箱、会议和链接，没有复制原始个人会议内容到仓库。
- npm run verify 与最终 92 项相关检查通过，包含双来源、真实空结果／失败区别、429 有界重试、超过 30 条的分页、500 条截断、异常响应、周期标识冲突、事务回滚、身份变更、完成保留、全天／跨日、AI 工具路由、详情缓存及原有日程／设置／提醒交互。早期未提权临时文件测试出现 EPERM，重新以允许的隔离临时目录操作复测后通过；没有把环境写入失败当成功。
- 隔离 Electron 使用进程内 CLI 返回夹具，完整运行设置 → 不填邮箱直接同步 → 可选连接缺失回退 → 双来源列表 → 只读详情 → 部分失败及恢复。6 组流程检查通过，页面异常为 0。最小 1024×680、1280×820 与 150% 缩放检查通过；截图发现邮箱说明被挤窄后增加窄屏上下排列，并补充实际说明宽度断言复核。外部内容没有通过测试发出创建、取消或发送操作。
- 严格审计保持与上轮相同的 9 项，无新增；DESIGN lint 为 0 错误、1 条原有无 YAML 提示，git diff --check 通过。未运行全量测试。样例、日志、隔离窗口截图和过程证据位于 artifacts/welink-agenda-20261116/，实现边界见 docs/welink-calendar-sync.md。真实周期实例和邮箱端到端连接仍需登录后验收；隔离测试产物按仓库规则保留在本地。

## 2026-11-15 · Ono 外观系统落地到 CMO

- 按用户指定的 Ono `docs/design/cmo-appearance-system-implementation-2026-11-15.md` 和当前实现，将外观控制、设置单选预览、两种导航、三档材质、八个主题落入 CMO。主窗口 `src/appearance.css` 是外观所有者，`src/shell.css` 保持共同几何；只新增「个性化」，通用仍保留 CMO 的提醒、关闭行为、开机启动及语言。旧 `cool`／`sunny` 转为雾珀，无效字段独立回退，W3／WeLink／个人资料保持。窗影按本地时间推导，不落盘时间状态。
- 实际原生窗口核验 60 种组合（2 导航 × 3 材质 × 7 普通主题加窗影 3 时段），每种访问首页、日程和待办、权限浏览器，共 180 次组合页面检查；两种导航下另查 38 个入口（含设置与旧通知链接），再查 120 组尺寸／缩放／导航展开／AI 开合场景。所有几何断言通过，无页面异常。窗口覆盖 1280×820、1024×680、1440×900，125% 和 150% 缩放；经典侧栏背景与内容共用上下边界，悬浮胶囊在可用走廊居中，两者不移动内容和窗口控制。
- 交互核验包括真实动画帧及快速反向、展开／收起图标纵向位置、缩放长日程、原生单选键盘操作、减少动态效果／透明度与强制颜色。首页编辑与保存布局、日程未保存草稿、AI 未发送输入、实际浏览器 guest 的身份／活动标签／未提交表单全部保持。修复了上层设置点击被底层日程弹层当成外部关闭的问题，补充回归测试；设置关闭后原草稿仍可继续编辑。
- 额外以空 W3 账号、12 条待办，在最小窗口的 100%／125%／150% 缩放中检查两种导航，共 6 组窄屏占位检查；另查调整窗口时取消导航动画及完整退出／重启，共 8 组补充检查。重启后外观和 12 条待办保持、光线按当前时间重新推导、首次加载不播放切换动画。窄屏 W3 提示收成短按钮，工具与窗控保持至少 32px，日程和待办的文字／数字／箭头无越界。高缩放采用 Electron `capturePage()` 核验完整窗口；Playwright 页截图在该环境会裁切右侧，不能以其裁切结果判断布局。
- 日程独立页完成 7 组实际交互回归，包括创建／编辑／完成确认／撤销、列表与卡片切换、八主题菜单与键盘、最小窗口加最大 AI 宽度、WeLink 来源徽标和只读字段。WeLink 夹具记录未改变；未访问真实账号或变更接入逻辑。原有已删除事项未进入事项库的问题保持记录，不把 API 恢复验证当作删除列表可用的证明。
- 保留 Ono 背景与材质，针对强玻璃降低辅助文字亮度；照片主题使用更深的次级色。对 10 种主题／光线状态各抽取 165 个实际截图面板空白／文字邻近背景点，按最终辅助文字颜色计算的最低对比度为 4.59:1。报告 `contrast-samples.json` 仅代表这些采样位置，不作为每个页面像素或全部语义色的证明。
- `npm run verify` 和 105 项设置、外观、日程、首页、额度、弹窗、顶栏与 WeLink 相关检查通过；最后的窄屏调整另复核受影响测试。严格静态审计保持与上一轮相同的 9 项，无新增；DESIGN lint 为 0 错误、1 条既有无 YAML 提示。未声称全量测试通过；前轮确认的无关 AI 测试失败未纳入本轮范围。
- 修改前基线、当前截图、逐项结果、隔离测试脚本及日志在 `artifacts/appearance-system-20261115/`。浏览器测试仅使用本机临时页面，AI 只验证未发送输入。Ono 仓库和用户真实运行数据未修改；隔离测试产物按仓库规则留在本地。

## 2026-11-15 · 全工作台上下边界复核与独立日程页对齐 Ono

- 重新读取当前 Ono 外壳和日程页，在两个项目的隔离 Electron 窗口中使用相同任务与会议夹具对照。全局工作区间距由 16px 对齐为 Ono 的 10px，侧栏可见背景、内容视口与 AI 面板共用窗口内 74px 顶边、窗口底部 12px 留白。顶栏与侧栏尺寸、位置、材质在切页中保持不变；保留 CMO 的纯淡入切页，首页卡片仍按保存的尺寸与位置展示，设置仍为独立弹窗。
- 日程页同步 Ono 的白色页头、22/24px 内距、统计与提示、不可清空的日程日期、按钮锚定新增弹层以及提交中关闭保护。静态对照前完成有限切页动画，避免把 Ono 动画的 6px 起始位移和临时滚动条当作最终布局。相同 1440×900 窗口下，页头与左右栏的位置、宽高、间距完全一致；新增按钮和弹层边界也一致（408×172px 初始弹层）。`todo-parity.json` 的差异为 0。
- 按用户确认的独立页待办列表范围，新增共享画笔菜单切换「列表／卡片」，复用已有两种 PlanRow 渲染，单独保存于 `wb.todo.plan-view`。已实测键盘选择、当前项标记、Escape 返回焦点、切页／重载后保持、事项库开合及卡片二次完成确认。WeLink 来源徽标、外部日程只读字段、禁止保存／删除保持原规则，夹具记录完全未变；未改 WeLink 接入与同步代码。
- 三主题 × 四组窗口（1440×900、1280×760、1160×720、1024×680）覆盖导航收展及 AI 停靠／覆盖，共 216 次路由布局检查、60 次切页过程检查通过，页面异常为 0。另完成三组长内容／布局编辑／减少动态效果检查和七组日程页交互检查；长待办与自定义首页可滚动到底，滚动、设置开关和布局取消不改变外壳或原数据。三主题样式菜单与最小窗口最大 AI 宽度无横向溢出，新增弹层留在窗口内。截图与结果位于 `artifacts/full-page-alignment-20261115/`。
- `npm run verify`、71 项日程／首页／额度／嵌套弹窗／顶栏／WeLink 相关检查和 `git diff --check` 通过。严格审计仍是与上一轮完全相同的 9 项，无新增；DESIGN lint 为 0 错误、1 条原有无 YAML 提示。未重跑全量测试，未访问真实账号、修改 Ono 源码或提交推送本地改动。
- 提交前补充运行助手页面上下文、参考快照与工作台范围的 18 项检查，16 项通过；阅读兼容页名称断言和参考快照模拟模型请求两项失败。取提交前 HEAD 的原始测试及依赖源码复测，两项均以同样原因失败，确认是原有问题；未在本次页面对齐中扩展修复。日志为 `artifacts/full-page-alignment-20261115/pre-push-ai-tests.log` 与 `pre-push-baseline-tests.log`。
- 已记录的原有问题：CMO 和 Ono 的 `todoState()` 都调用排除软删除记录的 `store.all()`，因此事项库「已删除」列表没有可恢复项。实际验证软删除及恢复接口有效，完成事项可在事项库恢复；本次保持数据读取逻辑，未把该问题计为 UI 还原通过。后续整体 UI／交互排查可单独处理。

## 2026-11-15 · 首页整体细节继续对齐 OnoSan

- 在隔离 Electron 中并排读取两项目首页画面与尺寸。CMO 添加面板原为 640×520px，Ono 为 520×427.25px、最高 440px；本轮同步紧凑内距、96px 缩略图与 32px 尺寸控件，实测 CMO 也为 520×427.25px。卡片标题采用 Ono 的单行省略，并提供完整标题提示。继续使用 CMO 两类卡片、既有主题、数据及布局存储；未改公共外壳或独立日程页。
- 对齐空白网格拖放：始终显示卡片完整落点框，允许拖动经过自身时继续预览和放置；碰撞后按实际边缘保留 12px，不再多跳一个 80px 网格行。鼠标实际拖放的预览与最终坐标一致；Alt＋方向键的碰撞间距、保存重载、取消恢复、宽高键盘调整、添加面板应用／Escape 焦点返回均通过。页面变化不修改待办记录，也不移动顶栏、侧栏和内容外框。
- 三主题 × 1440px、1160px 带 AI、1024px 展开导航及 AI，共九组布局检查通过；添加与样式菜单位于视口内，标题不换行挤占工具按钮。缩略图、所有宽高档位、减少动态效果及真实鼠标拖放已检查；六组新交互检查、六组原样式菜单验证通过，页面异常为 0，截图已查看。
- `npm run verify`、24 项首页及 New API 相关测试、`git diff --check` 通过。严格静态审计仍为原有相同 9 项，无新增；DESIGN lint 为 0 错误、1 条原有无 YAML 提示。未重跑全量测试，未读取真实账号或修改 OnoSan 源码。基线、源码修改前备份、截图和验证结果位于 `artifacts/home-ono-alignment-20261115/`。

## 2026-11-15 · 首页样式选择对齐 OnoSan 缩略图菜单

- 对照 OnoSan 当前 `HomeView.tsx`、`GameOptionsMenu.tsx` 与 `home-dashboard.css`：将文字列表改为 480px 的卡片缩略图菜单，带标题、96px 高预览、主题描边与勾选。入口同步为画笔图标；沿用同一 `DashboardPreview`、卡片正文和菜单所有者。CMO 两种日程图表继续在同一卡片内切换，额度卡沿用单一样式禁用规则；卡片尺寸、位置及保存协议保持原行为。
- 菜单打开时才挂载预览，缩略图内容为 inert 且从无障碍树隐藏；方向键只选择 `menuitemradio`，支持左右／上下、Home／End、Enter 与 Escape，打开时聚焦当前项并使其在菜单内可见。选中只更新编辑草稿，完成保存，取消恢复；关闭会卸载预览，外部点击、窗口变化及原卡片滚动移位继续收起菜单。
- 隔离 Electron 数据夹具包含未完成、已完成待办和日程，真实验证两张缩略图渲染不同图表与当前数据；整张缩略图点击可选、键盘移动不提前切换，预览关闭卸载，保存重载与取消恢复正常，待办记录和卡片其他属性不变。三主题、1280／1160／1100／1024px 且展开导航和 AI 下检查菜单与标题／按钮边界，打开前后首页滚动范围与位置一致；减少动态效果及删除卡片不残留弹层。六组 pilot 检查通过，页面异常为 0；截图已查看。
- `npm run verify`、24 项首页与额度相关测试、`git diff --check` 通过。严格静态审计仍为原有相同 9 项，无新增发现；DESIGN lint 为 0 错误、1 条原有无 YAML 提示。未重跑全量测试，未访问真实账号或改动 OnoSan 源码。证据、截图和修改前三个源码文件位于 `artifacts/dashboard-style-preview-20261115/`。

## 2026-11-15 · 首页卡片三个工具统一悬浮反馈

- 直接对照 OnoSan 的 `home-dashboard.css`，将拖动、样式、移除共用为 26×26px、6px 圆角、150ms 颜色／背景过渡；悬浮、按下和菜单展开时统一使用已有主题色。只有一种样式时保留禁用状态和原因提示，仅图标置灰，悬浮底色与其余按钮一致。未更改按钮动作、菜单内容或布局存储。
- 真实 Electron 隔离实例覆盖两类卡片 × 三主题 × 三个按钮，共 18 个悬浮状态，背景、图标色、尺寸、圆角、整体透明度及过渡逐项一致。AI 额度的禁用样式入口仍不可点击，图标透明度为 0.4；三个按钮的实际悬浮截图已查看。原样式菜单的键盘选择、外部／Escape 关闭、取消恢复、完成保存重载及删除流程均通过；1280／1160／1100／1024px 且展开导航和 AI 时，标题、按钮和菜单均在边界内，减少动态效果保留操作。共五组 pilot 检查通过，页面异常为 0，待办与卡片保存布局保持原有行为。
- `npm run verify` 与 `git diff --check` 通过；严格静态审计仍为原有相同 9 项，无新增发现；DESIGN lint 为 0 错误、1 条原有无 YAML 提示。未新增单元测试或重跑全量测试。修改前 CSS、18 次悬浮指标、五组流程结果和截图位于 `artifacts/dashboard-button-hover-20261115/`。

## 2026-11-15 · 所有工作台页面外壳与内容上下对齐

- 对照 OnoSan 的公共顶栏、侧栏及首页／日程内容边距。修改前的真实 Electron 测量复现：首页侧栏背景顶边 74px、内容 80px；日程内容顶边 86px、底部缩进 26px；业务页侧栏与内容为 80px，且单独覆盖外壳材质；兼容浏览器顶边 76px。整页淡入还包含 6px 上移。
- 在公共外壳中统一尺寸来源，并将原内边距改为滚动视口外侧的留白，侧栏可见背景、内容视口及展开的 AI 面板顶边为 80px、底部留 12px。顶栏保持上距 10px、高 54px、左距 10px、右距 12px；折叠／展开导航仍为 66／200px。移除页面的内容内距和业务页外壳材质覆盖，切页只淡入。首页以整个看板视口对齐，卡片的保存尺寸与位置保持原有行为；设置继续使用弹窗。
- 隔离 Electron 实例逐页验证首页、日程待办、权限查询、群组创建、交付件、PBI 特性、PBI 子系统模块、DTS、兼容浏览器及阅读页、七个设置分类和旧通知入口。三主题 × 四组窗口／导航／AI 状态（1440×900 折叠无 AI、1280×760 展开无 AI、1160×720 折叠有 AI、1024×680 展开有 AI），共 216 次页面测量通过；另采集 60 次切页的逐帧坐标，外壳及活动页框无位移。AI 上下边界、设置弹窗窗口边界和内容横向溢出检查通过；页面异常为 0。
- 长内容夹具在独立数据库创建 18 条待办，并保存有较大高度与主动偏移的首页布局。宽／窄窗均可滚动到最后一条待办和下方额度卡，打开关闭设置、进入编辑再取消、减少动态效果下切换六个工作台均保持外壳坐标；待办数据和已保存首页布局不变。首页、日程、业务页、三主题及窄窗截图已查看。未读取真实账号或改动 OnoSan 源码。
- `npm run verify`、46 项顶栏／首页／日程／额度相关测试、`git diff --check` 通过。严格静态审计仍为原有 9 项，按文件／规则／消息对照无新增；DESIGN lint 为 0 错误、1 条原有无 YAML 提示。未重跑全量测试。修改前四个源码文件、基线、216 次测量、滚动夹具与截图位于 `artifacts/shell-alignment-20261114/`。

## 2026-11-13 · 灵动岛日历按 Ono 处理记忆与跨天

final result: passed（日期选择、返回与完成确认保护）

- 同一天保留所选日期和浏览月份；跨天返回日程、展开、聚焦、恢复可见、解锁或唤醒时回到今天与当月。持续查看今天时自动换日，浏览其他日期或月份时延后到下次返回。新一天的手动选择继续按当天记忆。
- 完成待确认与保存中延后切换；成功／取消后回到今天，保存失败保留原日期、确认和错误供重试。CMO 原有“当天／全部”切换、今天包含逾期待办和来源标识保留；未增加设置或改动日历布局与配色。
- 新增 `tests/island-schedule-date.test.ts`，直接操作真实 React 组件并模拟本地时钟，覆盖同日日期／月份保留、跨天、跨月、跨年、页面往返、聚焦／可见性／唤醒、确认等待、保存中、成功、失败和取消；修改前复现跨天返回仍选中旧日期，修改后通过。`tests/island-topmost.test.ts` 增补安静时段下休眠恢复与解锁的运行时序号回归。
- 54 项相关测试全部通过：`node --import tsx --test tests/island-schedule-date.test.ts tests/island-topmost.test.ts tests/island-bubble-ui.test.ts tests/island-reminder-bubbles.test.ts tests/island-assistant-window.test.ts tests/island-sedentary-time.test.ts tests/island-display-settings.test.ts tests/island-connection-layout.test.ts tests/island-quota.test.ts`。初次使用仓库内临时目录遇到 Windows 原子重命名 `EPERM`，改用系统临时目录在沙箱外完成；最终记录为 `artifacts/island-schedule-date-20261113/regressions-final.log`。`npm run verify`、`git diff --check` 通过；严格静态审计仍有 10 项既有发现，按文件／规则／内容对照无新增。
- Browser 插件未提供，使用 Playwright Electron 启动生产构建和真实 preload／主进程，设置独立应用数据与待办数据库。实际验证解除固定后收起／再展开、自动换日与月份、安静时段的主进程 resume 通知、跨年确认后取消、键盘选日和侧边停靠的 unlock 通知。页面身份与正文正常，无框架错误覆盖，页面异常、控制台错误及警告均为空，侧边 CSS 视口 320×560，根页面横向溢出 0。
- 已打开核对顶部与侧边原生截图：`C:/Users/henry/.codex/visualizations/2026/11/13/01a1d295-2dfb-74a3-bc96-68c586732c88/island-date-top.png`、`island-date-side.png`。顶部标题、日历选中日及“今天”列表标题一致；侧边的实心选中与今天描边可辨，日期、筛选、导航和空态可见。脚本及 `island-date-results.json` 在相同目录；测试实例已关闭。日期及 powerMonitor 事件均为模拟，未做真实过夜或物理休眠验收。

## 2026-11-13 · DTS 入口取消二级目录

DTS 一级入口直接进入原 `dts-query` 页面，展开导航不渲染子目录，折叠导航的点击、悬停及键盘聚焦不再提供悬浮目录。仅修改 App 的两处导航分支条件，页面路由保留；`npm run verify`、`git diff --check` 通过，严格静态审计仍为原有 10 项发现。本轮为小范围导航调整，未新增测试或重复实机检查。

## 2026-11-13 · 交付件入口取消二级目录

交付件一级入口直接进入 `delivery-projects`，展开导航不再渲染子目录，折叠导航的点击、悬停及键盘聚焦不再提供悬浮目录。仅调整 App 的导航分支条件，原页面路由保留。`npm run verify`、`git diff --check` 通过，严格静态审计仍为原有 10 项发现。实机检查因持续检测到用户输入干扰中断，未记为通过；本轮未新增测试。

## 2026-11-13 · 移除工作台页头说明

权限、交付件、PBI、DTS 共用页头只显示工作台名称，移除副标题属性、调用和对应样式；单行页头自然收紧。`npm run verify` 与 `git diff --check` 通过。隔离 Electron 实景已确认权限页头只显示名称，记录于 `artifacts/business-workbenches-20261113/permission-no-subtitle.png/json`；共用组件覆盖其余三个工作台。严格静态审计仍为原有 10 项发现。

final result: passed

## 2026-11-13 · 三个工作台统一样式与 PBI 双标签合并

final result: passed（交付件／DTS 外壳与 PBI 标签整合）

- 视觉基准沿用本轮已落地的权限工作台，四个业务工作台共用 `WorkbenchPage`、`--workbench-*` 表面色和 AI 样式。整窗并排对照为 `artifacts/business-workbenches-20261113/workbench-family.png`：左上权限基准，右上 PBI，左下交付件，右下 DTS；原截图均为 1600×1000、device scale factor 1、窗口 zoom factor 1。完整及组合截图均已打开核对。
- 字体、密度与内容：共用既有字阶、同一页头与 18px 圆角主卡；页头及浏览器标签文字完整。交付件／DTS 明确显示“页面建设中”，没有新增业务表单或不可用操作。PBI 协助对象随“特性管理／子系统&模块”更新，保留原对话及模型配置状态。
- 布局与颜色：常规 1600×1000 和最小 1024×680 中主卡及 AI 顶边均为 80px，底边分别为 988px／668px，根页面横向溢出 0。mist 的 PBI、cool 的交付件、warm 的 DTS 代表场景均验证白色卡片与 AI、近白导航、浅灰工具栏；色场只在卡片之间出现。图标复用 Phosphor 与原有应用资产，无新增图片资产。
- PBI 从原 `pbi-features`／`pbi-modules` 两套合成旧标签记录首次进入，恢复为两个固定标签，保留各自原地址及历史；新的统一记录写入 `pbi`。实际 guest 的分区仍为 `persist:wb-browser-pbi-features`／`persist:wb-browser-pbi-modules`，离开到交付件及 DTS 再返回，guest ID 和分区保持不变。
- CUA 实查：将特性名称改为 `PBI-DRAFT-KEPT`，切到模块后按 Home 返回，草稿保留；跨工作台回来后仍保留。普通新标签新增、关闭正常，两个默认标签无关闭按钮，PBI 导航没有内嵌二级分支。进程真实重启后恢复上次的“子系统&模块”、对应地址及 AI 对象，见 `pbi-before-restart.json`、`pbi-after-restart.json`。
- `npm run verify` 通过（字阶、渲染层与主进程类型检查、生产构建）。35 项相关回归通过，命令：`node --import tsx --test tests/pbi-browser.test.ts tests/permission-browser.test.ts tests/permission-groups.test.ts tests/browser-restorable-tabs.test.ts tests/ai-scope.test.ts`。新增 5 项 PBI 回归覆盖同源旧页面合并、重启持久化、固定标签保护和原 AI 页面身份；结果在 `artifacts/business-workbenches-20261113/regressions.log`。
- 扩展加入 `tests/ai-page-context.test.ts` 时共 37 项、36 通过、1 失败：旧测试仍期望已不在 CMO 导航中的“阅读清单”归属“小工具”；`src/nav.ts`、`src/ai-page-context.ts` 及该测试本轮均未修改。保留此已有问题，未借本轮修改阅读逻辑。
- 严格静态审计仍为 10 项既有发现，本轮修改文件没有对应发现，记录在 `artifacts/business-workbenches-20261113/premium-audit.json`。`git diff --check` 通过。无新增 P0／P1／P2 视觉问题。

截图：`pbi-after-restart.png`、`pbi-narrow.png`、`delivery-wide.png`、`delivery-narrow-cool.png`、`dts-wide.png`、`dts-narrow-warm.png`，同目录 JSON 保存实测几何与颜色，renderer errors 均为空。PBI 内页由隔离测试分区提供并标明演示，没有访问或提交真实内网业务。此轮修改主进程 IPC，已有开发进程需重启后加载新协议。

## 2026-11-13 · 权限管理工作台高保真落地

final result: passed（权限工作台外壳与原有标签交互）

- 选定参考：原聊天 `01a1c5b5-613c-7f11-85b2-985e8ba3722b` 的已同意生成稿 `C:/Users/henry/.codex/generated_images/01a1c5b5-613c-7f11-85b2-985e8ba3722b/exec-811a324c-ff07-4168-9ff3-f13f8749460e.png`，以及 Ono 的 `design/selfmedia-card-blog-applied-2026-11-13.png`、`src/shell.css` 与 `modules/browser/ui/pane.css`。范围为工作台页头、主卡、双标签、工具栏、导航表面与 AI 侧栏；业务网页继续由原 guest 承载。
- 实现截图：`artifacts/permission-style-20261113/groups-final.png`。参考原始像素 1585×992，实装为 1600×1000 CSS px、device scale factor 1、窗口 zoom factor 1；参考等比例近似归一至 1600×1000 后，与同为群组创建、展开导航、展开 AI 的实装并排检查。`comparison-full.png`、`comparison-browser.png`、`comparison-assistant.png` 分别保存整窗与局部对照，均已打开检查。

**发现与修复**

- [P2，已修复] 内容区旧选择器覆盖内距，主卡顶边原为 76px，AI 为 80px。以可见浏览器 Host 限定权限内容区规则后，两者均为 80px，底边同为窗口高度减 12px；最终 1600×1000、1280×820、1024×680 均确认对齐。
- [P2，已修复] 1024×680、展开导航和 400px AI 时，旧规则重复扣减 AI 宽度，工具栏仅 16px。权限浏览器取消重复扣减，工具栏／标签栏恢复 376px，两个固定标签可适度收缩；最小窗口实景与 `groups-1024-final.json` 已复查。
- [P2，已修复] 起始页继承半透明底，使色场透进主卡。权限起始页与网页舞台统一消费白色工作区 token；实际窗口中同时检查了原站点加载失败状态。

**五项视觉核对**

- 字体：沿用项目与 Ono 共用的 Bahnschrift／Segoe UI／微软雅黑及既有字阶；页头使用 `--type-lead`，工具栏使用 `--type-control`，辅助文案使用 `--type-support`。实际字体与密度以维护中的 DESIGN 和 Ono 源码为准，生成稿的字重与密度为视觉参考。
- 间距与布局：单一 18px 圆角白色主卡承载页头、双标签、地址栏和网页；内壳去掉重复边框与投影。AI 为 56px 标题行、14px 上边距的协助对象卡，表面顶部及底部对齐。标签基准 180px，最小 120px，更多标签仍由原横向滚动区承载。
- 颜色：白色 `#ffffff`、浅灰 `#f7f8fa`、近白 `#fafbfc` 均由 `src/shell.css` 的 `--workbench-*` token 提供；mist／cool／warm 中主卡和 AI 保持白色，工具栏保持浅灰，色场在卡片之间呈现。主卡、AI、工具栏与对象卡 computed style 已检查。
- 资产：复用现有 Logo、灵动岛图标与 Phosphor 图标，未新增位图资产。生成稿中的 PIC 表单仅用于说明外壳布局，未替换生产业务页面。
- 内容与状态：保留实际页面名称、地址、AI 协助对象与模型配置状态。隔离配置未启用模型，故预览显示“配置模型”；原有空对话文案与快捷操作规则继续生效。没有模拟 AI 已完成操作或真实提交成功。

**验证**

- `npm run verify` 通过；最终 CSS 修正后再次 `npm run build` 与 `npm run check:typography` 通过。没有仓库配置的 formatter／DESIGN lint 入口，`git diff --check` 通过。
- `node --import tsx --test tests/permission-browser.test.ts tests/permission-groups.test.ts tests/browser-restorable-tabs.test.ts`：23 项通过。使用仓库内独立 TEMP／TMP，避免沙盒系统临时目录的 rename EPERM。
- CUA 实际操作独立 Electron 窗口：权限查询／群组创建切换、地址和 AI 协助对象更新；将演示草稿改为 `HIS-DRAFT-KEPT`，切到查询后按 End 返回，原值仍保留；助手展开／收起、三主题、标准窗口及最小窗口均已检查。
- 1280×820 内容尺寸、Electron 窗口 zoom factor 2 时，CSS 视口为 640×410；收起助手后两个固定标签、地址栏及网页滚动可用，根页面无横向溢出。此项是应用窗口缩放，不代表已验证操作系统显示缩放。证据为 `groups-200-percent.png/json`。
- 最终 `groups-final.json`：主卡／AI 顶边 80px、底边 988px，主卡及 AI 为白色，工具栏为浅灰，根页面横向溢出 0，renderer errors 为空。严格静态审计仍有 10 项既有发现，均在本轮未修改文件中，记录于 `artifacts/permission-style-premium-audit.json`，未扩大本轮范围修理。

边界：隔离演示页通过测试分区的协议处理器提供，并明确标为演示；未访问或提交真实 PIC／iRight 表单，未验证真实 GLM 请求。现有实际开发窗口访问内网站点返回 `ERR_CONNECTION_CLOSED`，不能将演示验收解释为真实内网业务成功。预览保留在独立验收窗口。

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

## 2026-11-14 · 待办独立页面参照 OnoSan

- 用户要求拆出独立待办页、首页本阶段保持原样。一级「待办」位于首页下方，直接进入「日程待办」，无二级目录；沿用 OnoSan 左日程／右待办及全部事项布局。共享 TodayBoard 增加 `workspace` 变体，默认 `compact` 保持原行为；编辑器、事项库、日期控件、来源标识与数据库继续复用 CMO 的所有者。首页组件无代码差异。
- Browser plugin not available，使用 Playwright 启动当前构建的真实 Electron 隔离实例，通过真实 Todo／Island IPC 创建合成记录；未操作用户实际日程、账号或 OnoSan 源码。改动前后同一组记录的首页 HTML（仅去掉生成 ID）与位置、尺寸完全一致。1440×900 核对双栏；1024×680 展开导航后核对操作可达，叠加 AI 助手时按剩余宽度上下排列，日期弹层保持在视口内。mist／cool／warm 均使用原主题；截图经人工查看，页面及控制台未报错。
- 实机流程覆盖日／周切换、空日程、日期与年份／月份选择、键盘跨周与 Escape 焦点返回；浏览日期不写数据库，也不筛掉右侧待办。新增、编辑、保存、取消完成、确认完成、事项库／快捷键、顶栏详情、灵动岛新入口和旧首页事项链接均可用。并发更新产生版本冲突时保留输入、显示错误、不覆盖新记录；取消编辑与无事项时新增入口可用。相关组件测试另覆盖跨月／跨年、今天跟随、来源徽标及默认 compact 结构。
- `npm run verify` 和 55 项相关测试通过。全量 `npm test` 为 842 项：805 通过、37 失败；在改动前 HEAD `3bf423c` 的源码快照中运行同一命令为 839 项：799 通过、40 失败，当前失败名称均在改动前复现，没有新增失败项。旧浮窗文件已缺失、部分 AI UI 测试超时／旧断言和 Windows symlink 权限等问题保留原状。DESIGN lint 为 0 错误、1 条已有无 YAML 提示；严格审计仍为相同 10 项，按文件／规则／消息对照无新增发现。
- 验证日志、静态审计与前后源码快照位于 `artifacts/todo-page-20261114/`；实际窗口截图、首页基准和检查结果位于 `C:/Users/henry/.codex/visualizations/2026/11/13/01a1d295-2dfb-74a3-bc96-68c586732c88/todo-page-20261114/`。

## 2026-11-14 · 首页参照 OnoSan 看板

- 用户随后授权改造首页，本阶段仅开放「日程和待办」「AI 额度」。从 OnoSan 当前源码适配个人看板页头、卡片框架、两种日程统计图、添加预览面板、拖动排序／空白网格放置、四边尺寸调整及取消／完成。默认 4＋2 列、2 行，布局保存在本机；日程两种图表共用同一张卡片。AI 卡片继续读取 CMO New API 今日 Token 消耗，不复制其他供应商连接或虚构剩余百分比；刷新、连接入口及真实零值／缓存／跨日／错误语义保留。日程编辑和待办助手仍归属独立页面。
- Browser plugin not available，使用 Playwright 启动最终构建的真实 Electron 隔离实例，借助真实 Todo／Island IPC 创建合成记录。验证添加／移除／重新添加、图表切换不增加第三张卡片、键盘及鼠标排序／缩放、Escape 撤销尺寸、空白放置、取消恢复、完成后重载、主动清空后重载。仅布局编辑时数据库内容完全一致；卡片可进入独立日程待办页和既有 New API 设置。未操作真实账号、用户日程或 OnoSan 源码。
- 对照夹具直接打包 OnoSan 与 CMO 的 HomeView，使用相同任务、时钟、昵称和两卡布局；只读夹具替代各自 IPC。1280×820、760×680、460×680 与三主题共 9 组，页头、网格、卡片框架及历史图等 11 个节点的几何、字号、行高、内距、圆角、颜色与阴影逐项相同；卡片名称和 AI 内容按本次 CMO 范围适配。真实主窗另检查 1440×900、1024×680 展开导航及 AI、弹层边界、点击外部关闭与 Escape 焦点返回。三主题及宽窄截图经人工查看。
- 账号夹具覆盖真实 0、多账号、长名称、昨天读数、同日缓存、刷新中禁用与失败保留数据；最小一行高度时账号列表可滚动、底部操作保持可见。减少动态效果保留信息与操作。最终 pilot 的 9 组检查通过，页面异常为 0。
- `npm run verify`、首页与用量 13 项测试、首页上下文 2 项断言通过。全量 `npm test` 为 848 项：811 通过、37 失败；与本次首页修改前的 842 项／805 通过／37 失败对照，失败名称完全一致。严格静态审计仍为原有相同 10 项，无新增文件／规则／消息；DESIGN lint 为 0 错误、1 条原有无 YAML 提示。`git diff --check` 通过。测试、对照指标、截图及编辑前差异备份位于 `artifacts/home-dashboard-20261114/`。

## 2026-11-14 · 编辑卡片直接更换样式

- 参照 OnoSan 新增的调色板入口，为共享 `GameOptionsMenu` 增加 `dashboard` 变体。编辑时卡片右上角显示 26px 图标按钮，直接展开本类型的样式菜单；日程和待办可切换现有两种图表，AI 额度只有一种样式时禁用并提示原因。非编辑时隐藏且不可聚焦；切换只更新草稿中的当前卡片样式，完成保存、取消恢复。复用既有样式集合、布局存储与菜单键盘行为，未增加卡片种类、数据读写或新的样式。
- 在真实 Electron 隔离实例中验证选中标识与焦点、上下键／Home／End／Enter、Escape 返回按钮、外部点击／重复点击关闭、删除卡片不残留弹层、取消恢复和保存重载；卡片尺寸、顺序、位置、其他卡片及待办记录保持一致。三主题截图人工检查；1280／1160／1100／1024×680 且展开导航与 AI 时，菜单始终在窗口内，窄列标题换行后按钮仍完整，实际内容滚动会收起菜单，减少动态效果时仍可操作。pilot 四组流程通过，页面异常为 0，未读取真实账号或修改用户日程及 OnoSan 源码。
- `npm run verify`、13 项首页相关测试及 `git diff --check` 通过。DESIGN lint 为 0 错误、1 条原有无 YAML 提示；严格静态审计 9 项，无新增发现，原共享菜单的 actionless-button 检测项因新增显式 disabled 属性不再报告。证据、截图及改动前三个源码文件备份位于 `artifacts/home-style-menu-20261114/`。


## 2026-11-19 · CMO 与 ONOSAN 的月／周／日视图工具栏

- 对照来源：[滴答清单月视图](C:/Users/henry/AppData/Local/Temp/codex-clipboard-f2dfe6b6-5206-450b-8ab4-f66b4c8bc213.png)（2280×1560 px）、[翻页按钮](C:/Users/henry/AppData/Local/Temp/codex-clipboard-e6bab269-9f3c-4802-bc00-c5ebead9179b.png)（276×114 px）。对齐月视图的页头、月历结构和导航按钮；对照的应用外框、示例日程与配色不同。
- 隔离 Electron 实窗，1460×930 窗口、1459 CSS px 渲染视口，CMO 卡片 1280×631 px，ONOSAN 卡片 1162×631 px，截图均按 1× CSS 导出。整体以同宽缩略图比较；翻页组对照将参考的 240×58 裁区按 2× 归一为 120×29，两端组为 109×33。[布局与控件对照](C:/Users/henry/.codex/visualizations/2026/11/17/01a1e820-9814-7a80-bf7d-50074c8d037e/calendar-ticktick-layout-comparison.png)。
- 第一轮发现月历时间挤掉标题（P1），紧凑布局只剩日期图标，普通桌面仍需滚动才见最后一周（P2）。随后保留标题宽度、给窄区保留短月份名，并让月历按可用高度展示。[首轮对照](C:/Users/henry/.codex/visualizations/2026/11/17/01a1e820-9814-7a80-bf7d-50074c8d037e/calendar-ticktick-layout-first-pass.png) · [CMO 月历](C:/Users/henry/.codex/visualizations/2026/11/17/01a1e820-9814-7a80-bf7d-50074c8d037e/cmo_workbench-calendar-month-new.png) · [ONOSAN 月历](C:/Users/henry/.codex/visualizations/2026/11/17/01a1e820-9814-7a80-bf7d-50074c8d037e/onosan_workbench-calendar-month-new.png) · [410px 工作区](C:/Users/henry/.codex/visualizations/2026/11/17/01a1e820-9814-7a80-bf7d-50074c8d037e/onosan_workbench-calendar-narrow-new.png)。
- 复核字体及文字层级、内距和边框、主题选中态、图标和文案。两端顶栏均为 42 CSS px，410 CSS px 工作区中页签、月份、下拉及翻页组仍同一行。沿用现有主题与 Phosphor 图标；参考图中的品牌装饰、颜色分组和其他视图不属于本次范围。
- 实窗验证：周／日／月切换，下拉键盘操作与 Escape，前后翻页与回到本期，日期弹窗，月历日程详情、更多日程及窄窗返回，待办页签切换；0 个渲染异常。只用隔离事项库的示例日程；CMO 用模拟 CLI 校验 11 月 1–30 日的查询顺序和边界，ONOSAN 仍用本地日程。
- 两端构建、类型检查、日程和日期选择回归通过（CMO 10 项、ONOSAN 11 项）。

final result: passed

## 首页看板固定页头（2026-11-19）

- 用户选定的参考布局把看板名、日期、添加卡片和编辑布局纳入工作区页头。两端均使用 56px 固定单行页头与 36px 操作按钮，卡片从页头下方 12px 开始。看板名用 24px 页标题字阶，日期用 14px 正文字阶。标题和按钮沿用主题文字与操作表面，页头和卡片区共享外壳。
- 隔离 Electron 实窗检查覆盖 1420×830 与 968×592 CSS 视口。125% 缩放下，480px 工作区把操作排到第二行。对话栏调至 560px 时，两端在约 239px 工作区内仍可点击添加和编辑，按钮文字完整。
- 验证固定页头下的卡片滚动、进入和取消编辑时的位置、卡片目录锚定与 Escape 焦点返回、应用与完成持久化，以及切换其他工作区再返回。无渲染异常。字阶检查、两份类型检查、渲染层与 Electron 构建、本项目 6 项看板回归均通过。
- 截图使用独立资料名与示例卡片布局，额度保留各自的未连接状态。[选定图与双端实窗对照](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/workbench-dashboard-comparison.png) · [125% 缩放实窗](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/cmo-dashboard-zoom-edit.png) · [验收记录](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/cmo-dashboard-qa.json)。

final result: passed

## 首页看板卡片调宽（2026-11-19）

- 在 669px 画布使用两个 3 列卡片复现。旧的两列映射把 2 列和 3 列都画成 328.5px，向内拖动后宽度仍是 328.5px。
- 画布超过 480px 时保留六列网格，拖到 2 列后宽度为 215px。已验证左右拖柄、4／6 列切换、Escape 回退、取消、完成保存和重开。窄卡在编辑时将工具排到标题下方。
- 原生 Electron 隔离数据中验证 100% 与 125% 缩放。单列铺满画布，横向拖柄只在键盘聚焦时显示，仍可键盘设置宽窗尺寸并拖动高度。字阶、前端类型检查、Vite 构建和看板回归均通过。
- [修复前](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/dashboard-resize/cmo-before-ineffective-drag.png) · [拖窄后](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/dashboard-resize/cmo-after-shrink.png) · [验收记录](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/dashboard-resize/cmo-after.json)。

## 看板尺寸跟随样式刷新（2026-11-19）

- 用截图对应的 1439×852 CSS 视口、560px 对话栏和已定位的卡片复核。548px 画布选择「AI 额度 → 2 列 → 应用设置 → 完成」，卡片由 268px 缩到 174.66px，预览同步缩小，重开保留尺寸。卡片拖边也能达到同一宽度档。
- 模拟开发窗口旧两列样式切到六列且画布尺寸不变，复现已定位的 2 列卡片仍显示旧半宽。摆放、拖动吸附和目录预览改用同一份画布计算。样式刷新后，2 列仍保持 173.33px 的实际列宽。
- 两端构建、前端类型检查和既有看板回归通过。使用隔离示例数据截图。[尺寸对照](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/dashboard-resize/exact-width-comparison.png) · [验收记录](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/dashboard-resize/cmo-exact-resize.json)。

## 看板卡片四边拖动（2026-11-19）

- 隔离实窗复现旧版自动布局中缩小左卡会带动右卡填空。548px 画布中，从右边缩小待办卡片后，左边保持原位，旁边额度卡片距画布左边仍为 280.00px（调整前 280.00px）。
- 验证四条边的对边固定、12px 碰撞间距、物理方向键、Home／End、Escape 撤销和保存重开。目录使用左上角锚定，空间不足时保留弹层提示。125% 的单列调高后保留纵向空白，恢复宽窗仍读原坐标。滚动到底缩短末张卡片，编辑区松手位置稳定。
- 两端前端类型、字阶、Vite 构建和看板回归通过。实窗使用隔离数据。[拖边对照](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/dashboard-anchors/independent-card-resize.png) · [本端验收](C:/Users/henry/.codex/visualizations/2026/11/19/01a1f1c1-8493-74e3-b21a-e636df95ee62/dashboard-anchors/cmo-fixed.json)。
