# WeLink CLI 响应字段

命令输出可能是 JSON 或 table。只提取后续操作需要的 ID，不要回显 token。

## 目录

- 通用
- 搜索 / 联系人 / IM
- 会议 / 议题
- 邮件 / 日历
- 云空间
- 认证

## 通用

成功常见 `code: 200`。业务体可能在 `response` 或 `data`。错误常见：

```json
{ "code": 400, "message": "...", "description": "..." }
```

| 代码 | 处理 |
|------|------|
| 200 | 成功 |
| 400 | 检查参数名和格式 |
| 401 | `auth login --env pro` |
| 403 | 权限不足 |
| 404 | 检查 ID（尤其 meetingId vs meetingNo） |
| 500 | 网络/服务，稍后重试 |

## 搜索 / 联系人 / IM

搜人后按字段分流：`w3account` → IM/会议；`welinkId` → contact；`employeeNumber` 仅展示。

```json
{
  "welinkId": "z00000000",
  "w3account": "z00123456",
  "employeeNumber": "00123456"
}
```

最近会话：区分单聊/群聊，群消息用会话里的群 ID。历史消息继续翻页时带上上一批的 `message-id` 和 `--query-direction`。

建群/加成员成功后，后续发群消息用返回的 `group-id`。

## 会议 / 议题

`meeting create` 关键字段：

| 字段 | 路径 | 用途 |
|------|------|------|
| 会议主键 | `response.id` / `response.meetingId` | 后续 CLI |
| 视频会议号 | `response.onlineMeeting.joinPasscode` | 只展示 |
| 会议链接 | `response.onlineMeeting.onlineMeetingMsg`（JSON 字符串） | 只展示 |

`meeting query-list`：用 `data.data[].meetingId`，不要用 `meetingNo`。`roles` 为逗号分隔：`0` 召集人、`1` 固定与会人、`2` 创建人、`6` 管理员、`7` 抄送人。含 `0/2/6` 才适合帮用户改会/取消。

`meeting info`：`jumpUrls[].type` 为 `basic`（详情）或 `summary`（纪要）。

`meeting topic-create`：`response.id` 即 `topicId`。

`meeting topic` 的 `topicMember.role`：`createUser`、`topicReporter`、`topicRecorder`、`topicMeetingUsers`、`topicProposer`。

`topic-materials`：`spaceId` + `fileId` 可交给 `onebox file-download`。

## 邮件 / 日历

`mail list`（table）：`ItemId`、`Read`（Y/N）、`From`、`Subject`、`Date`。

`mail get`：正文、To/CC、附件名/大小/附件 ID。下载用附件 ID，不是邮件 ItemId。

`mail folders`：`Name`、`Total`、`Unread`、`FolderId`。自定义文件夹必须用这里的 FolderId。

`mail move` 成功后原 ItemId 失效，从目标文件夹重新 `list`。

`calendar list`：`Subject`、`Start`、`End`、`Location`、`Status`（Free/Tentative/Busy/OOF）、`Organizer`、`ItemId`。详情用这个 `ItemId`，不是 event-id。

`calendar get`：额外有 All Day、Cancelled、Meeting URL、Body。

`calendar create` 成功：`Calendar event created successfully` + 新 `ItemId`。

## 云空间

`onebox user-info`：`cloudUserId` 即个人 `--space-id`。

`folder-list` / `node-search`：记下目标的 `file-id` / `folder-id`。根目录为 `0`。

`file-share-link-get`：返回外链 URL；默认仅自己可见，需要别人打开时再 `file-share-link-edit --role viewer`。

## 认证

`auth status` 显示登录状态、用户信息、已授权 scope。不要把输出里的 token 贴给用户。

`auth logout` 会清除 token、refresh token、WebSocket sign/nonce、加密密钥、`config.json` 和 `credentials.json`。
