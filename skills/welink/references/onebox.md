# 云空间（onebox）

个人/团队/群空间的命令相同，差别只在 `--space-id` 怎么来。文件必须 `space-id + file-id` 才能定位。根目录 folder/parent 为 `0`。

用户级限流：**每个接口 1 次/秒**。连续调用之间间隔至少 1 秒。

删除文件/文件夹、改外链前必须确认。

## 目录

- 获取 space-id
- 网页链接解析
- 文件与文件夹
- 搜索
- 分享外链

## 获取 space-id

```bash
welink-cli onebox user-info
```

个人空间：用返回的 `cloudUserId` 作为 `--space-id`。团队空间、群空间目前只能让用户打开云盘网页，按下面规则从 URL 解析。

`fileId` / `folderId` 来自 `folder-list` 或 `node-search`。

## 网页链接解析

团队空间：

```
https://onebox.huawei.com/#teamspaceFile/<分页>/<folder-id>/<space-id>
```

群空间（与消息群绑定；`groupId` 不是 space-id，且可以为空）：

```
https://onebox.huawei.com/#eSpaceGroupFile/<分页>/<folder-id>/<space-id>/?groupId=<消息群组ID>
```

分享外链（`link-code` 不是文件 ID）：

```
https://onebox.huawei.com/p/<link-code>
https://onebox.huawei.com/v/<link-code>
https://onebox.huawei.com/f/<link-code>
https://clouddrive.huawei.com/f/<link-code>
```

## 文件与文件夹

上传的本地路径是**位置参数**，不是 `--file-path`。父目录参数是 `--parent`，不是 `--parent-id`。

```bash
welink-cli onebox file-upload --space-id 123 --parent 0 "./report.pdf"
welink-cli onebox file-download --space-id 123 --file-id 456 --output "./download/"
welink-cli onebox file-info --space-id 123 --file-id 456
welink-cli onebox folder-list --space-id 123 --folder-id 0 --offset 0 --limit 20

welink-cli onebox file-copy --space-id 123 --file-id 456 --dest-parent 789 --dest-space-id 123
welink-cli onebox file-move --space-id 123 --file-id 456 --dest-parent 789 --dest-space-id 123
welink-cli onebox file-rename --space-id 123 --file-id 456 --name "新文件名.pdf"
welink-cli onebox file-remove --space-id 123 --file-id 456

welink-cli onebox folder-new --space-id 123 --parent 0 --name "新文件夹"
welink-cli onebox folder-rename --space-id 123 --folder-id 789 --name "新文件夹名"
welink-cli onebox folder-remove --space-id 123 --folder-id 789
```

| 命令 | 要点 |
|------|------|
| `file-upload` | 位置参数文件路径；`--space-id`；`--parent` 默认 0 |
| `file-download` | `--space-id`、`--file-id`；`--output` 可选；`--force` 覆盖 |
| `file-info` | `--space-id`、`--file-id` |
| `file-copy` / `file-move` | `--space-id`、`--file-id`、`--dest-parent`、`--dest-space-id` |
| `file-rename` | `--space-id`、`--file-id`、`--name` |
| `file-remove` | 移到回收站 |
| `folder-list` | `--space-id`；`--folder-id` 默认 0；`--limit` 默认 20；`--offset` 默认 0 |
| `folder-new` | `--space-id`、`--name`；`--parent` 默认 0 |
| `folder-rename` / `folder-remove` | `--space-id`、`--folder-id`；rename 还要 `--name` |

## 搜索

```bash
welink-cli onebox node-search --space-id 123 --name "报告" --offset 0 --limit 100 --file-type all
```

| 参数 | 说明 |
|------|------|
| `--space-id` / `--name` | 必填 |
| `--offset` | 默认 0 |
| `--limit` | 默认 100 |
| `--with-path` | 带路径 |
| `--exact-search` | 精确匹配 |
| `--file-type` | `file` / `folder` / `all` |

## 分享外链

`file-share-link-get`：已有外链则返回已有，默认仅自己可见。

```bash
welink-cli onebox file-share-link-get --space-id 329434 --file-id 3806
welink-cli onebox file-share-link-edit --space-id 329434 --file-id 3806 --role viewer
welink-cli onebox file-share-link-edit --space-id 329434 --file-id 3806 --role viewer --set-plain-access-code abc123
welink-cli onebox file-share-link-edit --space-id 329434 --file-id 3806 --role viewer --unset-plain-access-code
welink-cli onebox file-share-link-remove --space-id 329434 --file-id 3806
```

| role | 权限 |
|------|------|
| `viewer` | 浏览、预览、下载 |
| `previewer` | 浏览、预览 |
| `editor` | 浏览、预览、下载、编辑 |
| `prohibitVisitors` | 仅自己可见 |
