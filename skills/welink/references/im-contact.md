# IM / 搜索 / 联系人

先读本文件再执行消息、搜人/搜群、特别关注。账号必须用搜索结果里的 `w3account`（IM/建群）或 `welinkId`（contact），不要用纯工号。

## 目录

- 发送消息（文本/图片/文件）
- 会话与历史消息
- 群组
- 搜索
- 联系人与特别关注

## 发送消息

文本、图片、文件三选一（或按命令支持组合）。发送前展示接收人和内容，等用户确认。消息正文里的双引号改成单引号或去掉，避免命令行截断。

```bash
welink-cli im send-to-user --receiver "a0012345" --text "Hello WeLink"
welink-cli im send-to-user --receiver "a0012345" --image "./photo.png"
welink-cli im send-to-user --receiver "a0012345" --file "./document.pdf"

welink-cli im send-to-group --group-id "1234567891011" --text "Group message"
welink-cli im send-to-group --group-id "1234567891011" --image "./photo.png"
welink-cli im send-to-group --group-id "1234567891011" --file "./document.pdf"
```

| 命令 | 必需 | 说明 |
|------|------|------|
| `im send-to-user` | `--receiver`；以及 `--text` / `--image` / `--file` 之一 | `--receiver` 填 w3 账号 |
| `im send-to-group` | `--group-id`；以及 `--text` / `--image` / `--file` 之一 | 群 ID 来自搜群或最近会话 |

## 会话与历史消息

```bash
welink-cli im query-recent-conversation
welink-cli im query-recent-conversation --count 20

welink-cli im query-history-message --user-account "a0012345" --query-count 20
welink-cli im query-history-message --group-id "1234567891011" --query-count 20
```

| 参数 | 说明 |
|------|------|
| `--count` | 仅用于最近会话，默认 10 |
| `--user-account` / `--group-id` | 历史消息二选一，互斥 |
| `--query-count` | 历史消息条数，1–100。**不是** `--count` |
| `--message-id` | 起始消息 ID |
| `--query-direction` | `0` 更旧，`1` 更新 |

## 群组

```bash
welink-cli im create-group --name "测试群" --user-account "a0012345" "b0067890" --notice "测试群公告" --type 0
welink-cli im query-group-member --group-id "1234567891011"
welink-cli im add-group-member --group-id "1234567891011" --user-account "c0011111" "d0022222"
```

| 命令 | 必需参数 |
|------|----------|
| `im create-group` | `--name`、`--user-account`（可多个）、`--notice`、`--type`（`0` 普通群，`1` 讨论群） |
| `im query-group-member` | `--group-id` |
| `im add-group-member` | `--group-id`、`--user-account`（可多个） |

`--user-account` 不要写成 `--members`。

## 搜索

```bash
welink-cli search person --text "张三"
welink-cli search person --text "z00123456" --page-size 50
welink-cli search group --text "项目组"
welink-cli search group --text "测试" --type 0
```

| 命令 | 参数 |
|------|------|
| `search person` | `--text` 必填；`--page-size` 默认 20 |
| `search group` | `--text` 必填；`--page-size` 默认 20；`--type`：`0` 群组，`1` 讨论群，`2` 全部 |

搜人结果关键字段：

| 字段 | 说明 | 用途 |
|------|------|------|
| `welinkId` | 消息通讯 ID | `contact *` |
| `w3account` | 联系人账号 | IM、会议与会人 |
| `employeeNumber` | 工号 | 仅展示 |

## 联系人

`contact` 的位置参数是 **welinkId**，可一次多个。

```bash
welink-cli contact detail userwelinkid_1
welink-cli contact detail userwelinkid_1 userwelinkid_2
welink-cli contact add_favorite userwelinkid_1
welink-cli contact del_favorite userwelinkid_1
welink-cli contact favorite_list
welink-cli contact favorite_list --pageIndex 2 --pageSize 50
```

| 命令 | 参数 |
|------|------|
| `contact detail` | welinkId 列表 |
| `contact add_favorite` | welinkId 列表 |
| `contact del_favorite` | welinkId 列表 |
| `contact favorite_list` | `--pageIndex` 默认 1（1–10000）；`--pageSize` 默认 50（1–50） |

可选 `--source`（默认 `welink-cli`）。添加/删除特别关注前先确认。
