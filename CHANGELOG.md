# Changelog

本项目按 Keep a Changelog 格式记录版本变更。正式 Release 使用对应版本条目生成发布说明。

## [Unreleased]

## [1.0.0] - 2026-11-03

CMO Workbench 首发版本。在 Ono Workbench v1.2.3 基线之上叠加 CMO 定制,并移除与 CMO 无关的上游业务(游戏、命理、自媒体)。

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
