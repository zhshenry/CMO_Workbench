# New API 内网只读验证方案

配套脚本：`tooling/probe-newapi-usage.mjs`。脚本独立于工作台，不修改应用接入逻辑、账号配置或网站业务数据；仅调用登录与当前用户的只读接口，不调用模型、不产生模型测试消费。

## 运行

使用与你当前工作台相同的 Node.js 24，无需 `npm install`。可以把单个 `.mjs` 文件复制到内网电脑运行。

在项目根目录的 PowerShell 中，把地址、用户名替换为内网站点实际值：

```powershell
node .\tooling\probe-newapi-usage.mjs --base-url "http://newapi.internal:3000" --username "你的内网用户名"
```

程序随后要求输入密码，输入不会回显。密码、认证 Token、Cookie 值和原始日志不写入文件，也不出现在报告中。地址和用户名可以放在命令里，密码不要放进命令。

默认查询北京时间当天 00:00 至执行时刻。若当天没有调用，建议选一个确定有消费的日期再验证：

```powershell
node .\tooling\probe-newapi-usage.mjs --base-url "http://newapi.internal:3000" --username "你的内网用户名" --date 2026-11-10
```

## 具体请求顺序

1. `GET /api/status`：检查是否允许账号密码登录。若启用了密码加密、验证码或协议确认，脚本停止，请通过网页完成对应流程。
2. `POST /api/user/login`，JSON 为 `{"username":"你的用户名","password":"运行时输入"}`。只进行一次登录，不自动反复尝试密码。读取 `data.user.id` 或 `data.id`、会话 Cookie，以及可能返回的 `data.access_token`；访问令牌不是必填返回字段，内网实测可以只返回 Cookie。
3. 分别检查两种认证方式能否读取日志：
   - 新版：`Authorization: Bearer <data.access_token>`；用户 ID 优先从 `data.user.id` 读取。
   - 旧版：登录返回的 Cookie 加 `New-Api-User: <data.id>`。
   - 报告只显示 Cookie 名称；`session` 必须是完整的 Cookie 名称，不能把 `new_api_has_session` 误识别为旧会话。
4. 用成功的认证方式检查相同 `page_size=100` 下 `p=0`、`p=1` 的返回页码与完整记录，检测分页归一化或重复返回。`data.page` 用于选择读取基准；仅凭首条 `id` 相同，不能断言起始页错位或边界重叠。`p=0` 被规范为返回第 1 页时，不再重复计入第 1 页；若返回页码为 0，但 `p=1` 再次返回该页，则核对并排除重复记录后继续读第 2 页。
5. 拉取消费日志。请求格式与字段定义可对照 [New API 官方日志文档](https://doc.newapi.pro/api/fei-log/)：

```http
GET /api/log/self?p=1&page_size=100&type=2&start_timestamp=<日期起点秒级时间戳>&end_timestamp=<日期终点秒级时间戳>
New-Api-User: <用户 ID>
Authorization: Bearer <访问令牌>
```

旧认证使用 Cookie 替换 Authorization。`type=2` 为消费日志；起点为北京时间当天 00:00，历史日期的终点为当天 23:59:59，今日终点为执行时刻。

6. 按 `data.items`、`data.total` 继续分页，固定整个查询的起止时间。优先用 `request_id` 并核对除展示 `id` 外的全部明细；没有请求标识时，用 `id` 和明细共同核对，不能仅凭 `id` 或相同 Token 数量合并日志。读取到不足一页或空页后，去重条数必须与 `total` 相等；不在累计条数刚达到 `total` 时提前结束。总数变化、后续整页重复、记录重编号导致条数无法核对、缺失字段或任何一页失败时，不输出不完整用量。每次最多验证 50 页，超过时停止，请改选日志较少的日期。
7. `GET /api/log/self/stat` 用于检查聚合字段，同时记录可用的 `token` 和原始 `quota`。此接口不可用不影响日志汇总；`quota` 是额度，`rpm/tpm` 是速率，不当作当日 Token 总量。

## Token 与光谱的计算

```text
单条 Token = prompt_tokens + completion_tokens
当日 Token = 当日消费日志的单条 Token 之和
模型 Token = 按 model_name 分组后求和
模型占比 = 模型 Token / 当日 Token
额度对照 = 同一份去重消费日志的 quota 求和（字段全部有效时）
```

不把失败请求、充值或退款日志作为消费日志计入。只有读取完整且没有消费记录时，才报告真实的 0。

`usage.quota_units` 与 `usage.total_tokens` 分开输出，不推定额度等于 Token 或金额；缺少有效 `quota` 时，额度对照为 `null`，并报告缺失条数。与网页“实际消耗”对照前，需要确认网页字段、时间范围及换算规则。CMO 的今日总量和模型光谱均使用同一份完整日志的原始 Token 求和，不使用额度替代。

## 重点查看报告

| 字段 | 用途 |
|---|---|
| `login.data_fields`、`login.user_id_field` | 判断登录返回结构 |
| `login.cookie_names`、`login.has_exact_session_cookie` | 判断是否为旧会话 Cookie |
| `authentication`、`selected_authentication` | 两种认证的 HTTP 状态及最终使用方式 |
| `pagination.first_page` | 根据返回页码选择的读取基准，不代表已经确定重复返回的根因 |
| `pagination.p0_p1_same_records` | p=0/p=1 是否返回相同记录；空列表相同不证明分页重叠 |
| `pagination.identity_check` | 标识、记录明细和总条数共同核对 |
| `stat.data_fields`、`stat.token`、`stat.quota_units` | 聚合接口提供的 Token 或原始额度字段 |
| `log_fields` | 日志字段名称，不含原始日志值 |
| `usage.complete` | 是否确认读取完整 |
| `usage.total_tokens`、`usage.models` | 总量与按模型汇总结果 |
| `usage.duplicates_removed` | 实际读取过程中排除的重复记录数，不含仅用于探测的响应 |
| `usage.quota_units`、`usage.quota_missing_records` | 原始额度对照与缺失条数 |

验证后可把这份报告发回来；若提示失败，把错误文字一起提供。当天返回 0 时，换有已知消费的日期，才能确认真实日志字段与网页显示的口径。

脚本每次重新登录，不保存或长期维护会话。工作台接入已兼容 Cookie／Bearer，认证失效时最多重新登录一次；访问令牌和会话 Cookie 仅保留在运行时内存，脚本测试账号不会写入工作台配置。

## 本地验证

```powershell
node --import tsx --test tests/newapi-quotas.test.ts tests/newapi-usage-probe.test.mjs tests/island-quota.test.ts tests/home-quota-card.test.ts
```

测试使用合成响应，不连接真实站点，覆盖新旧认证、认证失效和回退、两种分页、107 条日志被返回 207 条、边界重复、展示 ID 冲突或重编号、按模型汇总、独立额度口径、真实零值、失败保留缓存、缺失字段及额外登录保护。修改后的工作台读取逻辑另已在用户提供的外网站点完成只读验证，覆盖 Bearer 登录、完整历史日志汇总和今日零消费；内网实际读数仍需在内网环境验收。
