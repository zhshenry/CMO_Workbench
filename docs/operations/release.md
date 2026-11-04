# Windows 发布、安装与更新

CMO Workbench 的二进制安装包通过 **Git LFS 托管在 `releases` 分支**、**CodeHub 连接器创建/更新 Release** 发布；源码在 `master`。发布顺序：**同步版本与 CHANGELOG → 测试、提交及推送 `master` 与版本标签 → 构建 NSIS 安装包 → 推 exe 到 `releases` 分支 LFS → 连接器创建 CodeHub Release → 核验 Release 与下载资产**。

项目 ID `6140022`，仓库路径 `z00545972/CMO-Workbench`。SSH 地址 `ssh://git@codehub-dg-g.huawei.com:2222/z00545972/CMO-Workbench.git`（SSH key 直认，不走 MFA；LFS 对象走 SSH 通道）。

## 固定发布步骤

1. 同步 `package.json`、`package-lock.json` 根版本与 `packages[""].version`，在 `CHANGELOG.md` 顶部按 Keep a Changelog 格式补齐 `## [版本] - 日期` 和变更条目。可用 `npm version 新版本 --no-git-tag-version` 更新两个版本文件。
2. 运行 `npm test`、`npm run verify`，将本次发行范围提交到 `master`，创建对应的 `v版本` 标签，推送 `master` 和**本次标签**：

   ```powershell
   git commit -m "release(v版本): bump 版本号 + CHANGELOG"
   git tag v版本
   git push origin master v版本
   ```

   CodeHub `master` 是保护分支，拒绝 `--force`/`--force-with-lease`；要线性化历史走 `git pull --rebase`。
3. 在 Windows x64 上构建 NSIS 安装包（`NODE_TLS_REJECT_UNAUTHORIZED=0` 用于 electron-builder 从华为镜像下载 NSIS）：

   ```powershell
   $env:NODE_TLS_REJECT_UNAUTHORIZED=0
   npm run dist:installer
   ```

   构建产出 `release/CMO-Workbench-Setup-版本-x64.exe` 与 `.blockmap`。**注意**：v1.1.0 起已删除 `build.publish`，electron-builder 不再生成 `latest.yml` 和 `app-update.yml`（`createUpdateInfoTasks` 在无 publishConfigs 时返回 null）。`tooling/package-release.ps1 -Mode All` 的必需资产校验已去掉 `app-update.yml`；`latest.yml` 需手动生成（用 node 算 sha512 base64 + size 拼 yml），内容含 `version`/`files[].url`/`sha512`/`releaseDate`。
4. 把新 exe 放进 `releases` 分支的 `dist-releases/v版本/` 子目录（`.gitattributes` 已 track `dist-releases/**/*.exe` 走 LFS，`git add` 后是几字节 LFS 指针），提交并推送：

   ```powershell
   mkdir -p dist-releases/v版本
   cp release/CMO-Workbench-Setup-版本-x64.exe dist-releases/v版本/
   git add dist-releases/v版本/CMO-Workbench-Setup-版本-x64.exe
   git commit -m "release(v版本): add Windows x64 installer via LFS"
   git push origin releases
   ```

   **统一用 `releases` 分支**（v1.1.0 起改名，以前是 `releases/v{版本}` 每版一分支）。CodeHub 拒绝 `releases` 与 `releases/v1.0.0` 这样的层级 refname 并存（refname conflict），改名前必须先删远端旧分支。331 MB ≈ 47s @ 7MB/s，配额未爆。
5. 用 **CodeHub 连接器**（`git-codehub-g`，令牌服务端注入，不要手动传 Authorization）创建 Release：POST `/projects/6140022/releases`，body 含 `tag_name`/`name`/`ref=releases`/`description`。description 里写下载指引：新 exe 名、SHA256、大小、LFS 下载命令（`git clone -b releases ssh://... && git lfs pull`）、网页直链。如需补充修改 description，用 PUT `/projects/6140022/releases/v版本`。
6. GET `/projects/6140022/releases/v版本` 复核创建成功，确认 tag/name/ref/description/commit 正确。

## 本地命令与发布资产

`npm ci` 安装开发依赖。打包命令使用 `--publish never`。

| 命令 | 行为 |
|---|---|
| `npm run dist:installer` / `npm run dist:all` | 完整验证并生成 NSIS 安装包与便携 ZIP，更新本地 SHA256 清单 |
| `npm run dist:portable` / `npm run dist:win` | 验证并生成完整便携 ZIP，更新本地 SHA256 清单 |
| `npm run release:check` | 只读检查本地资产及 CHANGELOG（注意：`tooling/publish.mjs` 是 GitHub 专用，CMO 走 CodeHub + releases 分支，绕开它；其版本号正则有 `replaceAll('.', '\\.')` bug，本地校验用字面正则） |
| `npm run release:verify` | 只读核验（GitHub 专用，CMO 用连接器 GET 复核） |

**发布的安装包资产**（推到 `releases` 分支 LFS，在 CodeHub Release description 里给出下载指引）：

| 本地文件 | LFS 路径（releases 分支） |
|---|---|
| `release/CMO-Workbench-Setup-版本-x64.exe` | `dist-releases/v版本/CMO-Workbench-Setup-版本-x64.exe` |

便携 ZIP 留本地不发布（沿用 v1.0.0 策略）。`release/` 全部由 Git 忽略；`dist-releases/` 下的 exe 是 LFS 指针文件（几字节文本），真二进制在 LFS store。

**CodeHub 下载链路**：`/raw` API 只返回 134 字节 LFS 指针，不是真身。下载真身靠：网页文件页「下载文件」按钮（走 LFS batch API 重定向），或 `git clone -b releases && git lfs pull`。网页直链正确形态：`https://codehub-g.huawei.com/z00545972/CMO-Workbench/files?ref=releases&filePath=dist-releases%2Fv版本%2Fexe名&isFile=true`（`?ref=` + `&filePath=`（URL 编码 `/`→`%2F`） + `&isFile=true` 三段缺一不可；`/blob/分支/路径`、`/tree/分支/路径`、`/files/子路径?ref=` 都会回退到 master 根目录）。

## 更新与数据边界

安装版不再内置自动更新源（已移除 `build.publish`，安装包不含 `resources/app-update.yml`），启动后不会联网检查更新。新版本需到 [CodeHub Release](https://codehub-g.huawei.com/z00545972/CMO-Workbench/files/releases) 下载安装包覆盖安装；“设置 → 关于”的“查看更新说明”会打开该 Release 页（有版本号直达 `/files/releases/v版本`，无版本号回退列表页）。开发和自动化测试模式同样不访问更新源。

便携包沿用 To-Do-List 约定，打包时去掉 `resources/app-update.yml`，不启用自动更新；更新时下载完整 ZIP、退出应用后解压替换。包内 `README.txt` 说明启动、更新和数据位置。

发布源须允许使用者读取安装器和元数据。发布凭据只放在本机或 CI 环境变量中，不写入源码和安装包。当前未配置代码签名；Windows 可能显示未知发布者提示。

安装包仅包含运行产物、更新器、Office 转换运行时和必要 PDF 资源，不包含开发依赖、设计记录、测试、个人配置或数据库。运行文件放在普通目录中，不使用 ASAR：Office 转换库需要按真实磁盘路径启动原生程序和 worker；NSIS 仍会压缩整个安装包。

项目终端使用锁定 `node-pty` 随包提供的 Windows x64 Node-API 原生模块，`build.npmRebuild=false` 保留这些产物，避免构建器强制改用本机 C++ 编译。发行验收须在锁定 Electron 与实际便携载荷中启动 PowerShell、核对中文输出；以后增加其他原生依赖时需重新核对其 ABI 和重建要求。

升级保留 `%APPDATA%/CMOWorkbench` 的设置、密钥配置、对话和草稿；待办仍使用 `%APPDATA%/To-Do-List/tasks.db`。卸载不删除应用数据。`WORKBENCH_TEST_DATA_DIR` 仅供自动化验收隔离这两处数据，设置后禁用联网更新及开机自启注册。
