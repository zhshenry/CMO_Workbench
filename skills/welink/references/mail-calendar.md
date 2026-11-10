# 邮件与日历

首次使用邮件或日历前必须执行：

```bash
welink-cli mail autodiscover --email user@example.com
```

成功示例：`Discovered EWS URL: https://imailcn55.email.huawei.com/EWS/Exchange.asmx`。

`--format`、`--timezone`/`--tz` 写在 `mail`/`calendar` 之后、子命令之前：

```bash
welink-cli mail --format json list
welink-cli calendar --format json list
welink-cli calendar --tz "China Standard Time" create --subject "专注时间" --start 2026-04-10T09:00:00 --end 2026-04-10T11:00:00
```

`--format`：`table`（默认）或 `json`。默认时区 `China Standard Time`。

`--start` **含当天**，`--end` **不含当天**（等价 `YYYY-MM-DDT00:00:00`）。查 5/8 单天写 `--end 2026-05-09`；覆盖整个 4 月写 `--end 2026-05-01`。

发送、回复、转发、移动前必须确认。

## 目录

- 邮件列表与详情
- 发送 / 回复 / 转发
- 附件、移动、文件夹
- 日历

## 邮件列表与详情

```bash
welink-cli mail list
welink-cli mail list --max 50
welink-cli mail list --is-read 0
welink-cli mail list --from boss@example.com
welink-cli mail list --folder-id sentitems
welink-cli mail list --start 2026-05-08 --end 2026-05-09
welink-cli mail list --from zhang@example.com --is-read 0 --start 2026-04-01 --end 2026-04-11
welink-cli mail list --max 10 --offset 10
welink-cli mail get --item-id <ItemId>
```

`mail list` 参数：

| 选项 | 默认 | 说明 |
|------|------|------|
| `--folder-id` | `inbox` | 先用 `mail folders` 拿真实 FolderId。简称：`inbox` / `sentitems` / `drafts` / `deleteditems` / `calendar`。**不要用中文别名** |
| `--max` | 10 | 0–500 |
| `--offset` | 0 | 翻页 |
| `--is-read` | -1 | `0` 未读，`1` 已读，`-1` 全部 |
| `--from` / `--subject` | | 模糊匹配 |
| `--start` / `--end` | | `YYYY-MM-DD`，end 不含当天 |
| `--query` | | KQL，仅专用选项不够时再用，例如 `from:zhang subject:周报` |

列表关键列：`ItemId`（后续 get/reply/forward/move 都用它）、`Read`、`From`、`Subject`、`Date`。

`mail get`：`--item-id` 必填；`--body-type` 默认 `Text`，可选 `HTML`。附件 ID 从详情里取，再交给 `mail attachment`。

日常筛选优先 `--from` / `--subject` / `--start` / `--end`。KQL 写错时报错难读。完整语法见 Microsoft KQL 文档。

## 发送 / 回复 / 转发

```bash
welink-cli mail send --to user@example.com --subject "Hello" --body "Hi there"
welink-cli mail send --to "a@example.com,b@example.com" --subject "通知" --body "内容"
welink-cli mail send --to user@example.com --cc mgr@example.com --subject "报告" --body "见附件" -a report.pdf -a data.xlsx
welink-cli mail send --to user@example.com --subject "通知" --body "<h1>标题</h1><p>内容</p>" --html

welink-cli mail reply --item-id <ItemId> --body "已收到，谢谢"
welink-cli mail reply --item-id <ItemId> --body "<p>已收到</p>" --html
welink-cli mail reply --item-id <ItemId> --subject "周报反馈" --body "已阅"
welink-cli mail reply --item-id <ItemId> --body "补充材料" -a ./report.pdf
welink-cli mail reply-all --item-id <ItemId> --body "同意"

welink-cli mail forward --item-id <ItemId> --to colleague@example.com --body "请查阅"
welink-cli mail forward --item-id <ItemId> --to colleague@example.com --cc mgr@example.com --body "附件转发"
welink-cli mail forward --item-id <ItemId> --to peer@example.com --body "增加封面" -a ./cover.pdf
```

`mail send`：`--to`、`--subject` 必填。`--to`/`--cc`/`--bcc` 可用逗号或重复指定。`--html` 是 flag，启用后 `--body` 必须是 HTML，否则标签会当纯文本发出。有附件时 CLI 自动走「建草稿 → 上传附件 → 发送」。

`mail reply` / `reply-all` / `forward`：`--item-id` 必填。不传 `--subject` 时 EWS 自动加 `RE:` / `FW:`。`forward` 自动带原始附件；`-a` 只用于追加新附件。

命令树里还有 `mail delete`、`mail mark`，细节以 `welink-cli mail <subcommand> --help` 为准；删除前必须确认。

## 附件、移动、文件夹

```bash
welink-cli mail folders
welink-cli mail list --folder-id <FolderId>

welink-cli mail attachment --attachment-id <AttachmentId> --path ./downloads/
welink-cli mail attachment --attachment-id <AttachmentId> --path report.pdf

welink-cli mail move --item-id <ItemId> --folder-id drafts
welink-cli mail move --item-id <ItemId> --folder-id <FolderId>
```

| 命令 | 要点 |
|------|------|
| `mail folders` | 取自定义文件夹的 `FolderId` |
| `mail attachment` | `--attachment-id` 与 `--path` 必填。`--path` 是目录则保留原文件名，是文件路径则用该文件名。**不要用** `--output-path`，也不要传 `--item-id` |
| `mail move` | `--item-id`、`--folder-id`。移动后 **ItemId 会变**，继续操作须从目标文件夹重新 list |

## 日历

```bash
welink-cli calendar list
welink-cli calendar list --start 2026-04-01 --end 2026-05-01
welink-cli calendar list --start 2026-05-08 --end 2026-05-09
welink-cli calendar list --max 50

welink-cli calendar get --item-id <ItemId>

welink-cli calendar create --subject "专注时间" --start 2026-04-10T09:00:00 --end 2026-04-10T11:00:00

welink-cli calendar create --subject "代码评审" \
  --start 2026-04-10T14:00:00 --end 2026-04-10T15:00:00 \
  --location "会议室 A" --attendee "alice@example.com,bob@example.com"

welink-cli calendar --tz "Tokyo Standard Time" create --subject "跨时区会议" \
  --start 2026-04-10T14:00:00 --end 2026-04-10T15:00:00 \
  --attendee "tokyo-team@example.com"
```

| 命令 | 参数 |
|------|------|
| `calendar list` | `--start` 默认今天；`--end` 默认 start+7 天且不含当天；`--max` 默认 20（0–500） |
| `calendar get` | `--item-id`（从 list 取）；`--body-type` 默认 `Text` |
| `calendar create` | `--subject`、`--start`、`--end` 必填。可选 `--body`、`--html`、`--location`、`--attendee`、`--reminder`（默认 15，`0` 不提醒） |

有 `--attendee` 会自动发会议邀请；没有则只建个人日程。`--start`/`--end` 推荐不带 `Z`/`+08:00`，由 `--tz` 解释。常用时区：`China Standard Time`、`Tokyo Standard Time`、`Singapore Standard Time`、`GMT Standard Time`、`Eastern Standard Time`、`Pacific Standard Time`。

**没有** `calendar delete`。列表项 ID 是 `ItemId`，不要用 `--event-id`、`--start-time`、`--attendees`。
