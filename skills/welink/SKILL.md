---
name: welink
description: '通过 welink-cli（对齐 WeLink-Cli 必读 v3.1 / CLI 1.0.16）操作 WeLink：IM、会议与议题、邮件、日历、云空间、搜索、联系人与特别关注、版本检查。


  触发场景：

  - IM：给用户/群发文本、图片、文件；查最近会话、历史消息；建群、查/加群成员

  - 会议：创建/修改/取消、查详情与列表、模糊搜索会议/议题/材料/纪要、议题增删改查、议题材料

  - 邮件：autodiscover、列表/详情、发送、回复/回复全部/转发、附件下载、文件夹、移动邮件

  - 日历：按日期查日程、详情、创建个人日程或会议邀请

  - 云空间：上传下载、文件/文件夹增删改、搜索、分享外链

  - 搜索与联系人：搜人/搜群、用户详情、特别关注

  - 认证：首次扫码登录、token 过期后重新登录


  触发词：welink, WeLink, welink-cli, IM, 消息, 群聊, 邮件, mail, 会议, meeting, 议题, 日历, calendar,
  云空间, onebox, 云盘, 外链, 搜索联系人, 特别关注, 发消息, 发邮件


  边界：

  - 只通过 welink_run 工具调用 welink-cli，不直接调 WeLink API

  - 首次使用需在设置页扫码登录（welink-cli auth login --env pro）；创建会议禁止扫码，账号用本机用户名

  - 写入/删除/发送前必须先调 declare_write 声明意图，等用户确认（用户提出创建会议即视为确认，缺参用默认值）

  - 禁止输出 token、密钥

  - 仅支持 Windows

  '
license: MIT
metadata:
  author: cmo-workbench
  version: 1.1.0
  compatibility: Windows, Node.js, WeLink PC >= 7.34.16, welink-cli 已登录
  cliHelp: welink-cli --help
  installation: 随 WeClaw Desktop 安装（resources/bundled/opencode/welink-cli.exe v1.0.16）或 npm install -g @welink/welink-cli --registry=https://cmc.centralrepo.rnd.huawei.com/artifactory/api/npm/product_npm/ --strict-ssl=false
---

# WeLink CLI 工具

通过 `welink_run` 工具调用 `welink-cli` 操作 WeLink。命令与参数以 **WeLink-Cli 必读 v3.1** 为准，当前最新 CLI 为 **1.0.16**。仅支持 Windows。

> 本机 calendar autodiscover 可能不可用；会议日程同步（设置页 WeLink 接入开启后）走 meeting query-list --type 1 自动拉取，无需 AI 介入。

执行前先判断模块，再按需读取对应参考，不要一次加载全部：

| 任务 | 先读 |
|------|------|
| 发消息、查会话、建群、搜人/搜群、特别关注 | [references/im-contact.md](references/im-contact.md) |
| 会议、议题、材料、纪要搜索 | [references/meeting.md](references/meeting.md) |
| 邮件、日历 | [references/mail-calendar.md](references/mail-calendar.md) |
| 云盘文件/文件夹/外链 | [references/onebox.md](references/onebox.md) |
| 解析命令 JSON 字段 | [references/response-structure.md](references/response-structure.md) |

不确定参数时执行 `welink-cli <service> <subcommand> --help`。

## 执行流程

1. 确认 `welink-cli` 可用：`welink-cli --version`。没有则按下方安装。
2. 需要登录时执行 `welink-cli auth login --env pro`（员工助手必须带 `--env pro`）。不要每次操作前跑 `auth status`；token 会在命令执行时自动刷新。仅认证失败或 refresh token 过期（约 30 天）时重新登录。
3. 按用户意图选 service/subcommand，缺账号先 `search person`，缺群 ID 先 `search group`。
4. 发送、创建、修改、删除、移动前，展示操作摘要并等用户确认。
5. 执行命令，解析输出关键字段，禁止打印 token/密钥。

## 安装与环境

前置：Node.js（npm/npx）；WeLink PC ≥ 7.34.16（头像 → 关于 WeLinkPC）；管理员 PowerShell 执行一次：

```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

选 Y 后关闭该窗口，后续用普通权限的 PowerShell/cmd。

```bash
npm install -g @welink/welink-cli --registry=https://cmc.centralrepo.rnd.huawei.com/artifactory/api/npm/product_npm/ --strict-ssl=false
welink-cli --version
welink-cli version check
```

`version check` 过期会自动更新。

## 认证

```bash
welink-cli auth login --env pro
welink-cli auth status
welink-cli auth logout
```

登录后 CLI 出二维码，用户用 WeLink 手机端扫码确认。`logout` 会清掉 token、WebSocket 凭证和本地配置，之后必须重新登录。

## 配置

```bash
welink-cli config show
welink-cli config init
welink-cli config timeout show
welink-cli config timeout set ws-connect-timeout 5000
welink-cli config timeout reset --all
```

WebSocket 超时（毫秒）：`ws-connect-timeout` 默认 3000（100–30000）；`ws-verify-timeout` 默认 30000（1000–120000）；`ws-receive-timeout` 默认 5000（100–60000）；`ws-close-timeout` 默认 3000（100–10000）。

## 命令结构

```
welink-cli <service> <subcommand> [options]
```

| Service | 能力 |
|---------|------|
| `auth` | login / status / logout |
| `im` | 私聊/群聊发送（文本/图片/文件）、最近会话、历史消息、建群、查/加成员 |
| `meeting` | 会议 CRUD、列表、详情、模糊搜索、议题 CRUD、议题材料 |
| `mail` | autodiscover、列表/详情/发送、回复/转发、附件、文件夹、移动 |
| `calendar` | 列表、详情、创建日程/会议邀请 |
| `onebox` | 个人空间、文件/文件夹、搜索、分享外链 |
| `search` | person / group |
| `contact` | detail、特别关注增删查 |
| `config` | show / init / timeout |
| `version` | check |

全局选项：`-v/--verbose`、`-d/--debug`、`--version`、`-h/--help`。

邮件/日历的 `--format`、`--timezone/--tz` 写在 **service 后、子命令前**：

```bash
welink-cli mail --format json list
welink-cli calendar --tz "China Standard Time" create --subject "..." --start 2026-04-10T09:00:00 --end 2026-04-10T11:00:00
```

## 必须遵守的规则

### 1. 账号：先搜再操作

用户常只给姓名或工号。禁止把纯工号当接收人。

```bash
welink-cli search person --text "00822626"
```

从结果取字段（参数名是 `--text`，不是 `--keyword`）：

| 字段 | 用途 | 例 |
|------|------|----|
| `w3account` | IM `--receiver` / `--user-account`、会议 `--meeting-user-list` | `z00123456` |
| `welinkId` | `contact detail` / 特别关注 | `z00000000` |
| `employeeNumber` | 仅展示，不要当 CLI 账号 | `00123456` |

搜群：`welink-cli search group --text "项目组"`，发群消息用结果里的群 ID。

### 2. meeting-id 是会议主键，不是视频会议号

后续 `info` / `update` / `cancel` / 议题命令一律用 `meetingId`（数字主键）。`meetingNo` / `joinPasscode` 只展示给用户。

用户提出创建会议（「创建一个会议」「临时建个会议」「创建一个会」等）即视为确认，**缺参用默认值补齐后立刻 `meeting create`**，禁止再问时间/主题/与会人，禁止 `auth login` / `auth status`。用户给了的字段用用户值，其余用默认值。

| 参数 | 默认值                                                  |
|------|------------------------------------------------------|
| 开始时间 | 现在 + 5 分钟（13 位毫秒）                                    |
| 结束时间 | 开始 + **60 分钟**（只说开始、没说结束时）                           |
| 主题 | `新建的会议`                                              |
| 与会人 | 自己：优先 `weclaw whoami` 的 `User ID`，否则 `$env:USERNAME` |

已是 w3 形态的账号（如 `z50061539`）直接进 `--meeting-user-list`，不要再 search。纯工号或姓名才 `search person --text`。指定了主持人/与会人时，名单里仍带上自己。

直接创建、不要追问的说法示例：

| 用户说 | 怎么建 |
|--------|--------|
| 帮我创建一个会议 / 临时建个会议 | 默认时间、主题「新建的会议」、与会人自己 |
| 帮我创建会议，主题是「项目进展讨论」 | 默认时间，主题用用户的，与会人自己 |
| 建一个下午三点的会议，主持人是 z50061539 | 今天 15:00–15:30，主题默认，与会人自己 + `z50061539` |
| 创建一个明天上午 9 点半到十一点半的会议 | 明天 09:30–11:30，主题默认，与会人自己 |
| 创建一个会，9 月 2 日上午 9 点到 10 点半，主题「算法迭代规划」 | 当年 09-02 09:00–10:30，主题用用户的，与会人自己 |

### 3. 时间格式按模块区分

| 场景 | 参数 | 格式 |
|------|------|------|
| 会议 create / update | `--start-time` `--end-time` | 13 位毫秒时间戳 |
| 会议 query-list | `--meeting-start-time` `--meeting-end-time` | 13 位毫秒时间戳（全部参数必填） |
| 会议 fuzzy-search 时间 | `--search-type startTime/endTime` + `--search-content` | 13 位毫秒时间戳 |
| 邮件 / 日历 list | `--start` `--end` | `YYYY-MM-DD`，**`--end` 不含当天** |
| 日历 create | `--start` `--end` | `2026-04-10T14:00:00`（无时区后缀，按 `--tz` 解释，默认中国标准时间） |

查单天：`--start 2026-05-08 --end 2026-05-09`。覆盖整个 4 月：`--end 2026-05-01`。

生成毫秒时间戳：

```bash
node -e "console.log(new Date('2026-05-14T17:00:00').getTime())"
```

### 4. 邮件/日历首次必须 autodiscover

```bash
welink-cli mail autodiscover --email user@example.com
```

未执行就调 `mail` / `calendar` 会失败。自定义文件夹先 `mail folders` 取真实 `FolderId`，不要用中文别名（会报 `ErrorInvalidIdMalformed`）。

### 5. 云空间先拿 space-id

个人空间：`welink-cli onebox user-info`，用返回的 `cloudUserId` 作 `--space-id`。文件靠 `space-id + file-id` 唯一定位；根目录 `folder-id`/`parent` 为 `0`。团队/群空间 space-id 从网页链接解析，见 [onebox.md](references/onebox.md)。云盘接口用户级限流 **1 次/秒**，连续调用之间要间隔。

### 6. 写入类操作先确认

展示操作类型、对象、内容，等用户明确同意后再执行。

| 类型 | 命令 |
|------|------|
| 发消息 | `im send-to-user` / `send-to-group` |
| 建群 / 加成员 | `im create-group` / `add-group-member` |
| 会议增改删、议题增改删 | `meeting create` 用户提出即建，不二次确认；`update/cancel`、议题仍先确认 |
| 发信 / 回复 / 转发 / 移动 | `mail send/reply/reply-all/forward/move` |
| 建日程 | `calendar create` |
| 删文件/文件夹、改外链 | `onebox file-remove` / `folder-remove` / `file-share-link-*` |
| 特别关注增删 | `contact add_favorite` / `del_favorite` |

批量操作先列出数量和对象，建议先试 1～2 条。

## 易错参数

| 错误 | 正确 |
|------|------|
| `search person --keyword` | `--text` |
| `im query-history-message --count` | `--query-count`（1–100） |
| 历史消息方向 0=更新 | `0` 更旧，`1` 更新 |
| 会议 query-list 用日期字符串 | 13 位毫秒时间戳 |
| `mail list --folder inbox` | `--folder-id inbox`（或 folders 返回的 FolderId） |
| `mail attachment --output-path` | `--path` |
| `calendar list --start-time` | `--start` / `--end` |
| `calendar get --event-id` | `--item-id` |
| `im create-group --members` | `--user-account` |
| `onebox file-upload --file-path` / `--parent-id` | 路径作位置参数；父目录用 `--parent` |
| 不带 `--space-id` 操作云盘 | 先 `onebox user-info` |

## 禁止事项

- 禁止输出 token、密钥
- 禁止未确认就发送、创建、删除、移动（创建会议除外：提出即建，缺参用默认值）
- 禁止创建会议时追问时间、主题或与会人
- 禁止用视频会议号当 `--meeting-id`
- 禁止用纯工号当 IM/会议账号
- 禁止每次操作前检查 `auth status`
- 禁止在 Linux/macOS 上使用本 skill
- 禁止邮件 `--end` 写成要查询的最后一天当天（必须写次日）
- 禁止跳过 `mail autodiscover` 直接用邮件/日历
- 禁止云盘连续调用不间隔（1 次/秒）

## 错误处理

| 现象 | 处理 |
|------|------|
| command not found | 按上文安装并确认 PATH |
| 认证失败 | 创建会议：不要 `auth login`，用 whoami 取账号后直接 create；其他场景再 `welink-cli auth login --env pro` |
| Meeting not found | 改用 `meetingId`，不要用 `meetingNo` |
| `--text is required` | 搜索用 `--text` |
| `--topic-member-list is required` | 创建议题必须带汇报人 w3 账号 |
| arguments were not expected: `--count` | 历史消息用 `--query-count` |
| `ErrorInvalidIdMalformed` | 文件夹用简称或真实 FolderId，不用中文 |
| space-id required | 先 `onebox user-info` |
| 邮件/日历服务找不到 | 先 `mail autodiscover --email` |

成功响应常见 `code: 200`。字段含义见 [response-structure.md](references/response-structure.md)。
