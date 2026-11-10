# 会议与议题

所有 `--meeting-id` 都是**会议主键**，不是视频会议号。从 `query-list` / `create` / `fuzzy-search` 取 `meetingId`。`meetingNo` 只展示给用户。

与会人、议题汇报人填 **w3 账号**（空格分隔多个）。用户提出创建会议即直接 `meeting create`，禁止追问、禁止 `auth login`。

| 参数 | 默认（用户没说才用）                                         |
|------|----------------------------------------------------|
| 开始 | 现在 + 5 分钟                                          |
| 结束 | 开始 + 60 分钟                                         |
| 主题 | `新建的会议`                                            |
| 与会人 | 自己（`weclaw whoami` 的 `User ID`，否则 `$env:USERNAME`） |

用户给了主题/起止时间就用用户的。`z80061539` 这类 w3 账号直接入名单并带上自己；姓名或纯工号先 `search person --text`。

修改、取消会议或议题前必须确认。

## 目录

- 会议 CRUD 与列表
- 模糊搜索
- 议题与材料
- 时间戳

## 会议 CRUD 与列表

```bash
welink-cli meeting create --start-time 1778378400000 --end-time 1778382000000 --subject welink-cli测试创建会议 --meeting-user-list c00899563 t00845328

welink-cli meeting update --meeting-id 203422177 --subject 更新后的主题
welink-cli meeting update --meeting-id 203422177 --meeting-user-list c00899563 t00845328

welink-cli meeting cancel --meeting-id 184521460

welink-cli meeting query-list --meeting-start-time 1767196800000 --meeting-end-time 1798732799999 --type 1 --meeting-sort asc --page 1 --size 15

welink-cli meeting info --meeting-id 184531461
```

| 命令 | 参数 |
|------|------|
| `meeting create` | 全部必填：`--subject`、`--start-time`、`--end-time`、`--meeting-user-list` |
| `meeting update` | `--meeting-id` 必填；其余只传要改的字段 |
| `meeting cancel` | `--meeting-id` |
| `meeting info` | `--meeting-id` |
| `meeting query-list` | 全部必填：`--meeting-start-time`、`--meeting-end-time`、`--type`、`--meeting-sort`（`asc`/`desc`）、`--page`、`--size` |

`query-list` 的时间是 **13 位毫秒时间戳**，不要传 `YYYY-MM-DD`。

`type`：

| 值 | 含义 |
|----|------|
| 0 | 公开的会议 |
| 1 | 待参加的会议 |
| 2 | 已结束的会议 |
| 3 | 我预定的会议 |
| 4 | 所有的会议 |
| 5 | 我管理的会议 |

## 模糊搜索

可重复 `--search-type` + `--search-content` 做组合条件。

```bash
welink-cli meeting fuzzy-search --result-type meeting --limit 10 --offset 0 --search-type subject --search-content 代码QC --search-type startTime --search-content 1774972800000 --search-type endTime --search-content 1775664000000
```

| 参数 | 说明 |
|------|------|
| `--result-type` | `meeting` 或 `file` |
| `--limit` / `--offset` | 分页 |
| `--search-type` | 如 `subject`、`startTime`、`endTime` |
| `--search-content` | 与上一组 `--search-type` 配对 |
| `--with-full-content` | `true` / `false` |

按主题搜时间范围内的会议时，`startTime`/`endTime` 的 content 也是毫秒时间戳。

## 议题与材料

议题分类常用：汇报类、研讨类、决策类、审批类。

```bash
welink-cli meeting topic-create --meeting-id 203422177 --topic-name 议题名称 --topic-category 汇报类 --topic-member-list c00899563 t00845328

welink-cli meeting topic-update --meeting-id 203422177 --topic-id 88711297 --topic-name 更新后的议题名称

welink-cli meeting topic-delete --meeting-id 203422177 --topic-id 88711297

welink-cli meeting topic --meeting-id 184531461

welink-cli meeting topic-materials --meeting-id 202674731 --topic-id 88520416
```

| 命令 | 参数 |
|------|------|
| `topic-create` | 全部必填：`--meeting-id`、`--topic-name`、`--topic-category`、`--topic-member-list` |
| `topic-update` | `--meeting-id`、`--topic-id` 必填；其余只传要改的字段 |
| `topic-delete` | `--meeting-id`、`--topic-id` |
| `topic` | `--meeting-id` |
| `topic-materials` | `--meeting-id`、`--topic-id` |

`--topic-member-list` 不能省。材料结果里的 `spaceId`/`fileId` 可交给 onebox 继续下载。

## 时间戳

```bash
node -e "console.log(new Date('2026-05-14T17:00:00').getTime())"
```

必须是 13 位毫秒，不要用秒级时间戳或日期字符串（`query-list` 同样如此）。
