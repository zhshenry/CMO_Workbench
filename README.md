# CMO 工作台

一个常驻 Windows 桌面的个人工作台——把日常研发办公所需的信息、提醒、AI 协作收进一个应用里,打开就能用,不用在多个窗口和网页间切换。

内置待办与日程、四个华为业务工作台、文档中心、内置浏览器,以及一个常驻桌面的「灵动岛」陪你过完一天。版本以 [package.json](package.json) 为准,完整产品定义见 [PRODUCT.md](PRODUCT.md)。

## 能帮你做什么

### 一日待办与日程,一眼看到

- 打开应用即见今日待办与日程速览,核心信息一次注视可达。
- 待办支持优先级、标签、提醒、事项库、软删除;日程按时段排序,到点提醒。
- 待办与 OnO 共用工作台本地库，与 To-Do-List 独立存储。

### 桌面灵动岛:不打扰你,但随时在

- 一条常驻桌面的小条(收起态仅 40px 高),显示日程、AI 额度、吉祥物伙伴。
- 到点提醒:喝水、久坐、日程、额度告急——以吉祥物语音气泡弹出(停留 20 秒),不强行打断当前工作。
- 收消息:CodeAI(Claude Code)在你任意项目跑完一轮,岛上的吉祥物亮未读徽标,消息列表显示这轮回复摘要,点「查看对话」复制会话编号回 CodeAI 续看。
- 四向停靠(上/左/右),睡眠/锁屏唤醒后自动恢复置顶,不被其他窗口压下去。

### 四个华为业务工作台

集成研发办公常用页面,内嵌浏览器承载,各工作台登录分区相互隔离:

- **权限管理**:权限查询、群组创建。
- **交付件管理**:交付件查询与维护。
- **PBI 管理**:特性管理、子系统与模块。
- **DTS 管理**:DTS 查询。
- 配置 W3 账号后,内嵌浏览器遇到 `login.huawei.com` 登录页自动填充用户名密码(仅填值,不自动提交;扫码与二次验证由你接管)。

### Bot 助理：持续对话与协作

- 内置总管、助理、权限管家、交付件管家、PBI系统管家和 DTS系统管家。主对话、委派、工作进度、交付件、资料、记忆和定时任务采用 OnO 同套交互。交付与 DTS 业务后端仍未接入。
- 顶栏 AI 助手菜单提供「固定」「悬浮」「收起助手」。灵动岛的对话／消息窗口与总管共享消息，各自保留草稿。
- 待办建议、WeLink 写命令和 PIC 提交先确认，结果不明保留待核对。浏览器沿用当前站点授权和工具边界，通用网页操作尚没有全面自动写入识别。
- 独立本机 Host 持久保存任务；需要退出界面后继续时，在「设置 → 通用」启用「独立 Bot 后台」。休眠、关机期间暂停，浏览器任务需要工作区在线。详见 [实施和验证说明](docs/requirements/shared/ai-assistant/bot-architecture/qa.md)。
- AI 额度查询:接入 New API 多账号,灵动岛侧查今日 Token 用量,额度环图与今日数据一目了然。

### 文档中心

- 内置 Word / PPT / Excel 预览与编辑,Office 转 PDF。
- 拖入文件即可暂存到置物架,便利贴随手记草稿(草稿实时持久化,切换时防丢字)。

### 主题与个人化

- 三套主题:mist 雾灰轻雾(默认)/ cool 冷灰凝霜 / warm 暖砂柔雾。
- 个人资料驱动头像与首页问候。
- 设置工作台:通用与外观、AI 助手、待办与数据、通知、关于,分页收纳。

## 本地开发

```powershell
npm ci
npm run dev
```

开发模式使用 `http://localhost:5180/`，可与使用 5174 端口的 Ono 同时运行。

```powershell
npm test           # 单元、组件与契约测试
npm run verify    # 字阶检查、类型检查与生产构建
npm start         # 启动已构建产物；首次先执行 npm run build
```

Windows 本机可能因缺少创建文件符号链接的权限而使两项安全回归测试报 `EPERM`;保留失败记录,不能据此宣称全套通过。开发验收入口与限制见 [文档索引](docs/README.md)。

`#dev/browser` 与 `#dev/office` 仅在 `npm run dev` 或显式执行 `npm run build:diagnostics` 后可用,调试页按需加载。常规 `build`、`verify` 和发布构建排除这些入口及其专用前端资源;Office 转换内核保留。诊断后执行 `npm run build` 恢复正式构建。

## 目录与维护归属

| 目录 | 用途 |
|---|---|
| `src/` | 应用外壳、导航、跨模块视图;公共控件位于 `src/ui/controls.tsx` |
| `modules/` | 待办、浏览器、阅读、Office 等领域实现 |
| `electron/` | 主进程、IPC、存储、浏览器宿主、更新及窗口管理 |
| `shared/` | 主进程与界面共用的契约、校验和纯函数 |
| `tests/` | 回归测试;不是运行产物 |
| `tooling/` | 构建、发布与验收脚本;`tooling/qa/` 是有路径限制的历史脚本 |
| `docs/` | 按规范、需求、流程、历史分层;需求按工作台归类,方案与原型、图片放在一起 |
| `design/` | 设计演进入口与两个固定 CI 原型;其他资料已按需求迁移,见 [资料索引](docs/RESOURCE-INDEX.md) |

共享控件由工作台维护,待办的 `modules/todo/ui/ui.tsx` 保留为上游映射兼容入口。浏览器按 `workspace-pane → pane → automation` 分层,恢复宿主不再与工具栏相互运行时导入。源码审查与设计差距记录见 [本轮清理报告](docs/archive/audits/cleanup-2026-10-17.md)。

## 规范与数据

- [DESIGN.md](DESIGN.md):视觉意图、组件归属与主题规则;运行时 token 由 `src/shell.css` 维护。
- [UX-CONTRACT.md](UX-CONTRACT.md):导航、输入、弹层、保存、权限等可观察行为。
- [design-qa.md](design-qa.md):按日期记录验收结果,历史条目不能代替当前验收。
- [待办同步台账](modules/todo/SYNC.md):与 To-Do-List 的移植映射和共享数据库边界。

OnO 与 CMO 共用 `%APPDATA%/OnoCmoWorkbench/tasks.db`。首次启动从旧位置 `%APPDATA%/To-Do-List/tasks.db` 只读导入事项和标签，此后工作台使用新库。CMO 设置和对话存于 `%APPDATA%/CMOWorkbench`。自动化验收须设置 `WORKBENCH_TEST_DATA_DIR` 隔离数据根目录，仅设置 `WORKBENCH_ISOLATED=1` 仍会使用真实工作台待办库。不要提交个人数据库、模型密钥配置、登录分区或本机截图。

## 发布

Windows x64 NSIS 安装包,本地构建后安装包走 Git LFS 托管在 CodeHub 仓库 `releases` 分支 `dist-releases/vX.Y.Z/`。便携版(完整 ZIP)本地备用,不随发版推送。版本号同步在 `package.json` / `package-lock.json`,`CHANGELOG.md` 按版本记录变更。日常代码整理不自动触发提交、推送、打包或发布。
