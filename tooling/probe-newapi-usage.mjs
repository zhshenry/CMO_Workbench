// Read-only New API compatibility check. No credentials or raw logs are written.
import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { pathToFileURL } from 'node:url';

const PAGE_SIZE = 100, MAX_PAGES = 50;
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const keys = value => value && typeof value === 'object' ? Object.keys(value) : [];
const describe = response => ({ http_status: response.status, success: response.ok, data_fields: keys(response.body.data) });
const details = item => keys(item).filter(key => key !== 'id').sort().map(key => [key, item[key]]);
const logKey = item => JSON.stringify([typeof item?.request_id === 'string' && item.request_id ? ['request', item.request_id] : ['id', item?.id], details(item)]);

export async function probeNewApiUsage({ baseUrl, username, password, date }) {
  if (!username || !password) throw new Error('用户名和密码不能为空');
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('请使用不含账号、密码或查询参数的 HTTP/HTTPS 站点地址');
  const origin = base.href.replace(/\/+$/, '');
  date ||= new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
  const start = Date.parse(`${date}T00:00:00+08:00`) / 1000;
  const end = Math.min(start + 86399, Math.floor(Date.now() / 1000));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(start) || new Date((start + 28800) * 1000).toISOString().slice(0, 10) !== date || end < start) throw new Error('日期须为有效的 YYYY-MM-DD，且不能是未来日期');

  const request = async (path, headers = {}, body) => {
    const response = await fetch(`${origin}${path}`, {
      method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined,
    });
    let json;
    try { json = await response.json(); } catch { throw new Error(`HTTP ${response.status}：${path.split('?')[0]} 未返回 JSON`); }
    return { status: response.status, ok: response.ok && json.success === true, body: json, cookies: response.headers.getSetCookie() };
  };
  const publicStatus = await request('/api/status');
  if (!publicStatus.ok) throw new Error(`无法读取站点状态：HTTP ${publicStatus.status}`);
  const settings = publicStatus.body.data ?? {};
  if (settings.password_login_enabled === false) throw new Error('站点未开启账号密码登录');
  if (settings.password_login_encryption_enabled || settings.turnstile_check || settings.user_agreement_enabled || settings.privacy_policy_enabled) throw new Error('站点启用了密码加密、验证码或协议确认，请先通过网页完成对应登录流程；本脚本不代为处理这些步骤');

  const login = await request('/api/user/login', {}, { username, password });
  if (!login.ok) throw new Error(`登录失败：HTTP ${login.status}；${typeof login.body.message === 'string' ? login.body.message.replaceAll(password, '[已隐藏]').slice(0, 200) : '请在网页核对账号登录结果'}`);
  const data = login.body.data ?? {};
  const id = data.user?.id ?? data.id;
  const token = typeof data.access_token === 'string' ? data.access_token : '';
  const cookiePairs = login.cookies.map(cookie => cookie.split(';', 1)[0]);
  const cookieNames = cookiePairs.map(cookie => cookie.slice(0, cookie.indexOf('=')));
  const cookieHeader = cookiePairs.join('; ');
  const userHeader = id != null ? { 'New-Api-User': String(id) } : {};
  const logPath = (page, size) => `/api/log/self?${new URLSearchParams({ p: String(page), page_size: String(size), type: '2', start_timestamp: String(start), end_timestamp: String(end) })}`;
  const attempts = [];
  if (token) attempts.push({ mode: 'Bearer', headers: { ...userHeader, Authorization: `Bearer ${token}` } });
  if (cookieHeader && id != null) attempts.push({ mode: 'Cookie', headers: { ...userHeader, Cookie: cookieHeader } });
  for (const attempt of attempts) attempt.response = await request(logPath(1, PAGE_SIZE), attempt.headers);
  const selected = attempts.find(attempt => attempt.response.ok);
  if (!selected) throw new Error(`未取得可用认证：${attempts.map(attempt => `${attempt.mode} HTTP ${attempt.response.status}`).join('，') || '登录响应中没有可用 Token 或 Cookie/用户 ID'}`);

  const page0 = await request(logPath(0, PAGE_SIZE), selected.headers);
  const page1 = selected.response;
  if (!page0.ok && page0.status !== 400) throw new Error(`日志第 0 页检查失败：HTTP ${page0.status}；无法确认完整用量`);
  const firstPage = page0.ok && page0.body.data?.page === 0 ? 0 : page1.body.data?.page === 1 ? 1 : null;
  if (firstPage === null) throw new Error('无法根据 data.page 确定分页基准，请核对站点日志响应字段');
  let statReport;
  try {
    const stat = await request(`/api/log/self/stat?start_timestamp=${start}&end_timestamp=${end}&type=2`, selected.headers);
    statReport = { ...describe(stat), token: isCount(stat.body.data?.token) ? stat.body.data.token : null, quota_units: isCount(stat.body.data?.quota) ? stat.body.data.quota : null };
  } catch { statReport = { unavailable: true, note: '统计接口未能读取，继续按消费日志汇总' }; }
  const report = {
    site: origin, date, timezone: 'Asia/Shanghai', start_timestamp: start, end_timestamp: end,
    login: { data_fields: keys(data), user_id_field: data.user?.id != null ? 'data.user.id' : id != null ? 'data.id' : null, has_access_token: Boolean(token), cookie_names: cookieNames, has_exact_session_cookie: cookieNames.includes('session') },
    authentication: attempts.map(attempt => ({ mode: attempt.mode, ...describe(attempt.response) })), selected_authentication: selected.mode,
    pagination: { requested_p0: { ...describe(page0), returned_page: page0.body.data?.page }, requested_p1: { ...describe(page1), returned_page: page1.body.data?.page }, first_page: firstPage,
      p0_p1_same_records: page0.ok && Array.isArray(page0.body.data?.items) && Array.isArray(page1.body.data?.items) && JSON.stringify(page0.body.data.items.map(logKey)) === JSON.stringify(page1.body.data.items.map(logKey)),
      identity_check: 'request_id_or_id_plus_record_details_and_total_count' },
    stat: statReport,
  };
  const seen = new Set(), models = new Map();
  let prompt = 0, completion = 0, consumed = 0, duplicate = 0, quota = 0, missingQuota = 0, total;
  for (let offset = 0; offset < MAX_PAGES; offset++) {
    const page = firstPage + offset;
    const response = offset === 0 ? (firstPage === 0 ? page0 : page1) : page === 1 ? page1 : await request(logPath(page, PAGE_SIZE), selected.headers);
    if (!response.ok) throw new Error(`日志第 ${page} 页读取失败：HTTP ${response.status}；本次不输出不完整用量`);
    const batch = response.body.data;
    if (!Array.isArray(batch?.items) || !isCount(batch.total) || batch.page !== page || batch.page_size !== PAGE_SIZE || batch.items.length > PAGE_SIZE) throw new Error(`日志第 ${page} 页的 items/total/page/page_size 与预期不同，无法确认完整用量`);
    total ??= batch.total;
    if (batch.total !== total) throw new Error('日志总条数发生变化，请重新验证');
    if (batch.items.length && !report.log_fields) report.log_fields = keys(batch.items[0]);
    let fresh = 0;
    for (const item of batch.items) {
      if (!item || typeof item !== 'object') throw new Error('日志记录格式异常');
      if ((item.id == null || item.id === '') && !(typeof item.request_id === 'string' && item.request_id)) throw new Error('日志缺少记录标识，无法核对重复记录');
      if (!isCount(item.created_at) || item.created_at < start || item.created_at > end) throw new Error('接口返回了日期范围外的日志，请核对时间过滤参数');
      if (item.type !== 2) throw new Error('消费日志 type 过滤未生效，无法确认完整用量');
      if (!isCount(item.prompt_tokens) || !isCount(item.completion_tokens)) throw new Error('消费日志缺少有效的 prompt_tokens/completion_tokens，不能按零值处理');
      const key = logKey(item);
      if (seen.has(key)) { duplicate++; continue; }
      seen.add(key); fresh++;
      if (isCount(item.quota)) quota += item.quota;
      else missingQuota++;
      const name = typeof item.model_name === 'string' && item.model_name ? item.model_name : '未知模型';
      const model = models.get(name) ?? { model_name: name, requests: 0, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      model.requests++; model.prompt_tokens += item.prompt_tokens; model.completion_tokens += item.completion_tokens;
      model.total_tokens = model.prompt_tokens + model.completion_tokens; models.set(name, model);
      consumed++; prompt += item.prompt_tokens; completion += item.completion_tokens;
    }
    if (seen.size > total) throw new Error('日志条数超过总数，可能存在重新编号的重复记录；本次不输出不完整用量');
    if (batch.items.length < PAGE_SIZE) {
      if (seen.size !== total) throw new Error('日志条数与总数不符，无法确认完整用量');
      report.log_fields ??= [];
      report.usage = { complete: true, logs: seen.size, consumption_requests: consumed, ignored_non_consumption: 0, duplicates_removed: duplicate, prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion,
        quota_units: missingQuota ? null : quota, quota_missing_records: missingQuota, models: [...models.values()].sort((a, b) => b.total_tokens - a.total_tokens) };
      return report;
    }
    if (!fresh && !(offset === 1 && firstPage === 0)) throw new Error('分页未取得新记录，无法确认完整用量');
  }
  throw new Error(`已达到 ${MAX_PAGES} 页验证上限，不能确认完整用量；请改选日志较少的日期`);
}

async function main() {
  const { values } = parseArgs({ options: { 'base-url': { type: 'string' }, username: { type: 'string' }, date: { type: 'string' }, help: { type: 'boolean' } } });
  if (values.help || !values['base-url']) {
    console.log('用法：node tooling/probe-newapi-usage.mjs --base-url http://内网NewAPI地址 --username 用户名 [--date YYYY-MM-DD]\n密码在运行时隐藏输入；输出不含密码、Token、Cookie 值或原始日志。要求 Node.js 24，无需安装依赖。');
    if (!values.help) process.exitCode = 1;
    return;
  }
  if (!process.stdin.isTTY) throw new Error('请在 PowerShell 等交互终端中运行，密码需要隐藏输入');
  let muted = false;
  const terminalOutput = new Writable({ write(chunk, encoding, done) { if (!muted) process.stdout.write(chunk, encoding); done(); } });
  const terminal = createInterface({ input: process.stdin, output: terminalOutput, terminal: true });
  terminal.on('SIGINT', () => process.exit(130));
  const credentials = { username: '', password: '' };
  try {
    credentials.username = values.username || await terminal.question('用户名：');
    process.stdout.write('密码：'); muted = true;
    credentials.password = await terminal.question('');
  } finally { terminal.close(); process.stdin.pause(); process.stdout.write('\n'); }
  try {
    console.log(JSON.stringify(await probeNewApiUsage({ baseUrl: values['base-url'], date: values.date, ...credentials }), null, 2));
  } finally { credentials.password = ''; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(
    () => process.stdout.write('', () => process.exit(process.exitCode ?? 0)),
    error => process.stderr.write(`验证失败：${error.message}\n`, () => process.exit(1)),
  );
}
