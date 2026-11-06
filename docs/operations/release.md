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

   构建产出 `release/CMO-Workbench-Setup-版本-x64.exe` 与 `.blockmap`（`package-release.ps1 -Mode All` 会把两者从 `release/` 根移至 `release/installer/`，故下一步 cp 取 `release/installer/...`）。**注意**：v1.1.0 起已删除 `build.publish`，electron-builder 不再生成 `latest.yml` 和 `app-update.yml`（`createUpdateInfoTasks` 在无 publishConfigs 时返回 null），两者均非发版必需资产，无需手工生成。`tooling/package-release.ps1 -Mode All` 的必需资产校验只剩安装包 `exe` 与 `.blockmap`（`app-update.yml` 与 `latest.yml` 均不再必需）；`latest.yml` 若构建残留存在则归档到 `release/metadata/`，缺失则跳过（见下方「v1.1.8 发版实录」边界说明）。
4. 把新 exe 放进 `releases` 分支的 `dist-releases/v版本/` 子目录（`.gitattributes` 已 track `dist-releases/**/*.exe` 走 LFS，`git add` 后是几字节 LFS 指针），提交并推送：

   ```powershell
   mkdir -p dist-releases/v版本
   cp release/installer/CMO-Workbench-Setup-版本-x64.exe dist-releases/v版本/
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

> `tooling/publish.mjs` 是上游 Ono 的 GitHub Release 发布器,读取 `build.publish`(CMO 在 v1.1.0 已删)。CMO 走 CodeHub 连接器 + `releases` 分支 LFS 流程,不使用该脚本;对应的 `release`/`release:check`/`release:verify` 三条 npm 脚本已从 `package.json` 删除。`tests/release-process.test.ts` 仍直接以 `node tooling/publish.mjs --dry-run` 方式调用该脚本做上游发布流程回归测试,脚本本身保留供测试使用。

**发布的安装包资产**（推到 `releases` 分支 LFS，在 CodeHub Release description 里给出下载指引）：

| 本地文件 | LFS 路径（releases 分支） |
|---|---|
| `release/installer/CMO-Workbench-Setup-版本-x64.exe` | `dist-releases/v版本/CMO-Workbench-Setup-版本-x64.exe` |

便携 ZIP 留本地不发布（沿用 v1.0.0 策略）。`release/` 全部由 Git 忽略；`dist-releases/` 下的 exe 是 LFS 指针文件（几字节文本），真二进制在 LFS store。

**CodeHub 下载链路**：`/raw` API 只返回 134 字节 LFS 指针，不是真身。下载真身靠：网页文件页「下载文件」按钮（走 LFS batch API 重定向），或 `git clone -b releases && git lfs pull`。网页直链正确形态：`https://codehub-g.huawei.com/z00545972/CMO-Workbench/files?ref=releases&filePath=dist-releases%2Fv版本%2Fexe名&isFile=true`（`?ref=` + `&filePath=`（URL 编码 `/`→`%2F`） + `&isFile=true` 三段缺一不可；`/blob/分支/路径`、`/tree/分支/路径`、`/files/子路径?ref=` 都会回退到 master 根目录）。

## 更新与数据边界

安装版不再内置自动更新源（已移除 `build.publish`，安装包不含 `resources/app-update.yml`），启动后不会联网检查更新。新版本需到 [CodeHub Release](https://codehub-g.huawei.com/z00545972/CMO-Workbench/files/releases) 下载安装包覆盖安装；“设置 → 关于”的“查看更新说明”会打开该 Release 列表页(`/files/releases`,按时间倒序展示各版本 Release)。开发和自动化测试模式同样不访问更新源。

便携包沿用 To-Do-List 约定，打包时去掉 `resources/app-update.yml`，不启用自动更新；更新时下载完整 ZIP、退出应用后解压替换。包内 `README.txt` 说明启动、更新和数据位置。

发布源须允许使用者读取安装器和元数据。发布凭据只放在本机或 CI 环境变量中，不写入源码和安装包。当前未配置代码签名；Windows 可能显示未知发布者提示。

安装包仅包含运行产物、更新器、Office 转换运行时和必要 PDF 资源，不包含开发依赖、设计记录、测试、个人配置或数据库。运行文件放在普通目录中，不使用 ASAR：Office 转换库需要按真实磁盘路径启动原生程序和 worker；NSIS 仍会压缩整个安装包。

项目终端使用锁定 `node-pty` 随包提供的 Windows x64 Node-API 原生模块，`build.npmRebuild=false` 保留这些产物，避免构建器强制改用本机 C++ 编译。发行验收须在锁定 Electron 与实际便携载荷中启动 PowerShell、核对中文输出；以后增加其他原生依赖时需重新核对其 ABI 和重建要求。

升级保留 `%APPDATA%/CMOWorkbench` 的设置、密钥配置、对话和草稿；待办仍使用 `%APPDATA%/To-Do-List/tasks.db`。卸载不删除应用数据。`WORKBENCH_TEST_DATA_DIR` 仅供自动化验收隔离这两处数据，设置后禁用联网更新及开机自启注册。

## v1.1.8 发版实录（下次发版参考）

2026-11-04 发版。此节记录该次实际操作与产物，供下次发版对照，不替代上方「固定发布步骤」。

**版本号决策**：从 1.1.2 跳到 1.1.8。1.1.2 当时只 bump 版本号 + CHANGELOG（commit `196ba40`）但未构建安装包、未发 CodeHub Release；1.1.8 把 1.1.2 起累积的改动（默认标签不可关闭、查看更新说明 URL 改指 `/files/releases`、`ai-scope` 旧 viewId 归一、`package-release.ps1` 去掉 `latest.yml` 强校验、文档改写）合并成一次正式发版，跳过 1.1.3–1.1.7。下次若再有「只 bump 未发」的中间版本，最终发版可同样跳号收编。

**实际步骤与产物**：

1. master：`d50ff95 release(v1.1.8): bump 版本号 1.1.2 -> 1.1.8 + CHANGELOG`，改 `package.json`/`package-lock.json` 版本号、`CHANGELOG.md` 加 `## [1.1.8]` 条目、本文件 URL 描述修正；`git tag v1.1.8`（指向 d50ff95）；`git push origin master v1.1.8`。
2. 构建：Windows x64，`$env:NODE_TLS_REJECT_UNAUTHORIZED=0; npm run dist:installer`（内含 `npm run verify`）。产出 `release/CMO-Workbench-Setup-1.1.8-x64.exe`（331,052,111 字节）+ `.blockmap`；`package-release.ps1 -Mode All` 顺手生成便携 ZIP（留本地不发）并更新 `release/SHA256SUMS.txt`。
3. releases 分支：`cp release/installer/CMO-Workbench-Setup-1.1.8-x64.exe dist-releases/v1.1.8/`，`git add` 后是 LFS 指针；`49664b4 release(v1.1.8): add Windows x64 installer via LFS`；`git push origin releases`（SSH key 直认，331 MB 走 SSH 通道约 47s）。
4. CodeHub Release：连接器 `git-codehub-g` POST `/projects/6140022/releases`，body `tag_name=v1.1.8`/`name=v1.1.8`/`ref=releases`/`description`。description 含下载指引（`git clone -b releases ssh://... && git lfs pull`、网页直链 `?ref=releases&filePath=dist-releases%2Fv1.1.8%2FCMO-Workbench-Setup-1.1.8-x64.exe&isFile=true`）、文件大小、SHA256、更新内容（v1.1.0 → v1.1.8 的 Fixed 三条）、升级说明。创建时间 2026-11-04T15:49:45+08:00。
5. 核验：GET `/projects/6140022/releases/v1.1.8` → HTTP 200，确认 tag/name/ref/description/commit 正确。

**关键产物 SHA256（下次发版可对照同口径计算）**：

| 资产 | SHA256 |
|---|---|
| 安装包 `CMO-Workbench-Setup-1.1.8-x64.exe` | `2b97f81a329ec5c35ad90debcbb47697ac9da9a9f50b2e1473340d3d14087eaf` |
| 便携 ZIP `CMO-Workbench-1.1.8-Windows-x64-Portable.zip`（留本地） | `1ded89e76af9278e3049f32659905bde7e50e32d7c1c7121e541d5115a405d1f` |

**本次确认的边界**：

- `latest.yml` 自 v1.1.0 起不再由 electron-builder 生成（`build.publish` 已删，`--publish never` 不产 update info）。本次 `package-release.ps1` 把残留的 `latest.yml` 归档到 `release/metadata/`，缺失则跳过——**它不再是发版必需资产**，不要为它的缺失阻塞发版。
- CodeHub Release 的 `assets` 只有 4 种源码归档（zip/tar.gz/tar.bz2/tar），**没有二进制附件**——330+ MB 的安装包超 CodeHub 附件 50 MB 上限，统一走 LFS，description 里给下载指引。
- 便携 ZIP 沿用 v1.0.0 策略留本地不发，只在 `release/SHA256SUMS.txt` 留校验值。
