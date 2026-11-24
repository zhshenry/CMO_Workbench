import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Eye, EyeSlash, Globe, Key, PencilSimple, PlugsConnected, Plus, ArrowClockwise, Wrench, WarningCircle } from '@phosphor-icons/react';
import type { BotBindings, BotExtensionsView, McpServer, McpServerDefinition, McpToolView } from '../../shared/bot-extensions';
import { mcpServerSchema } from '../../shared/bot-extensions';
import { errorText, IconButton, Modal, Select } from '../ui/controls';
import type { BotSettingsState } from './BotManagement';

const api = window.workbench.bot;
type TestResult = { tools: McpToolView[]; revision: number };
export function BotExtensionsSettings({ botId, tab, picker, selected, selectServer, request, onStateChange, showMcp }: {
  botId: string; tab: 'tools' | 'mcp'; picker: ReactNode; selected: string; selectServer(value: string): void;
  request(run: () => void): void; onStateChange(state: BotSettingsState): void; showMcp(id?: string): void;
}) {
  const [data, setData] = useState<BotExtensionsView>(), [bindings, setBindings] = useState<BotBindings>();
  const [catalogs, setCatalogs] = useState<Record<string, TestResult>>({}), [reload, setReload] = useState(0);
  const [editor, setEditor] = useState<{ server?: McpServer }>(), [deleting, setDeleting] = useState<McpServer>();
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const running = useRef(false);
  const savedData = useRef(data);
  savedData.current = data;
  const discard = useCallback(() => { setBindings(savedData.current?.bindings); setError(''); setNotice(''); }, []);
  const dirty = !!data && !!bindings && JSON.stringify(data.bindings) !== JSON.stringify(bindings);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    void api.getExtensions(botId).then(value => { if (current) { setData(value); setBindings(value.bindings); } }, cause => {
      if (current) setError(errorText(cause));
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [botId, reload]);
  useEffect(() => { onStateChange({ dirty, busy, discard }); }, [dirty, busy, discard, onStateChange]);
  useEffect(() => () => onStateChange({ dirty: false, busy: false }), [onStateChange]);
  const active = data?.servers.find(server => server.id === selected) ?? data?.servers[0];
  const result = active && catalogs[active.id]?.revision === active.revision ? catalogs[active.id] : undefined;
  const assigned = bindings?.mcp.find(binding => binding.serverId === active?.id)?.tools ?? [];
  const tools = [...(result?.tools ?? []), ...assigned.filter(tool => !result?.tools.some(item => item.name === tool.name)).map(tool => ({ name: tool.name, description: result ? '服务已不再提供此工具，可取消分配。' : '测试连接后可查看描述及其他工具。', readOnly: tool.mode === 'read' }))];
  async function run(job: () => Promise<void>) {
    if (running.current) return;
    running.current = true; setBusy(true); setError(''); setNotice('');
    try { await job(); } catch (cause) { setError(errorText(cause)); }
    finally { running.current = false; setBusy(false); }
  }
  function chooseTool(name: string, mode: string) {
    if (!active) return;
    setNotice('');
    setBindings(current => {
      if (!current) return current;
      const prior = current.mcp.find(binding => binding.serverId === active.id)?.tools ?? [];
      const next = [...prior.filter(tool => tool.name !== name), ...(mode === 'off' ? [] : [{ name, mode: mode as 'read' | 'confirm' }])];
      return { ...current, mcp: [...current.mcp.filter(binding => binding.serverId !== active.id), ...(next.length ? [{ serverId: active.id, tools: next }] : [])] };
    });
  }
  const refresh = () => request(() => { setCatalogs({}); setReload(value => value + 1); });
  return <div className="bot-extensions-settings" aria-busy={busy || loading}>
    {error && <div className="bot-settings-feedback"><p className="error" role="alert">{error}</p><button type="button" className="set-btn" disabled={busy} onClick={refresh}>重新读取配置</button></div>}
    {notice && <p className="bot-settings-notice" role="status">{notice}</p>}
    {loading && <p className="bot-settings-help" role="status">正在读取工具配置…</p>}
    {data && !loading && (tab === 'tools' ? <>
      <div className="bot-settings-heading"><div><h3>当前 Bot 的工具</h3><p>最近一轮的工具快照；实际可用项由本轮职责和授权确定。</p></div>{picker}</div>
      <section className="bot-settings-card"><header><h3>应用提供</h3><span className="bot-settings-help">按职责开放</span></header>
        {data.builtins.filter(tool => !tool.name.startsWith('mcp_')).map(tool => <div className="bot-settings-row" key={tool.name}>
          <span className="bot-settings-symbol"><Wrench size={18} /></span><div className="bot-settings-copy"><strong>{tool.label}</strong><small>{tool.name}</small></div><span className="bot-settings-badge">应用管理</span>
        </div>)}
        {!data.builtins.some(tool => !tool.name.startsWith('mcp_')) && <p className="bot-settings-empty">尚无工具运行快照。这个 Bot 完成一轮对话后可在这里查看。</p>}
      </section>
      <section className="bot-settings-card"><header><h3>MCP 工具</h3><button type="button" className="bot-settings-link" onClick={() => showMcp()}>管理分配</button></header>
        {bindings?.mcp.map(binding => <div className="bot-settings-row" key={binding.serverId}><span className="bot-settings-symbol"><PlugsConnected size={18} /></span>
          <div className="bot-settings-copy"><strong>{data.servers.find(server => server.id === binding.serverId)?.definition.name ?? '连接已移除'}</strong><small>已分配 {binding.tools.length} 个工具</small></div>
          <button type="button" className="bot-settings-link" onClick={() => showMcp(binding.serverId)}>查看</button></div>)}
        {!bindings?.mcp.length && <p className="bot-settings-empty">还没有为这个 Bot 分配 MCP 工具。</p>}
      </section>
    </> : <div className="bot-mcp-layout">
      <aside className="bot-settings-card bot-mcp-servers" aria-label="本应用共用的 MCP 连接"><header><h3>MCP 连接</h3><span className="bot-settings-badge">应用共用</span></header>
        <div className="bot-mcp-server-list">{data.servers.map(server => <button type="button" key={server.id} aria-pressed={active?.id === server.id} disabled={busy}
          onClick={() => request(() => { selectServer(server.id); setError(''); setNotice(''); })}>
          <span className="bot-settings-symbol"><Globe size={18} /></span><span><strong>{server.definition.name}</strong>
            <small className={catalogs[server.id]?.revision === server.revision ? 'bot-settings-connected' : ''}>{!server.definition.enabled ? '已停用' : catalogs[server.id]?.revision === server.revision ? '测试通过' : '未测试'}</small>
            <small>{data.usage[server.id]?.length ?? 0} 个 Bot 已分配</small></span></button>)}</div>
        <button type="button" className="set-btn bot-mcp-add" disabled={busy} onClick={() => request(() => setEditor({}))}><Plus size={15} />新增连接</button>
        <p className="bot-settings-help">连接与密钥由本应用共用，工具权限分别保存。</p>
      </aside>
      <section className="bot-settings-card bot-mcp-detail" aria-label="MCP 工具与 Bot 分配">
        {!active ? <div className="bot-settings-empty"><PlugsConnected size={28} /><h3>还没有 MCP 连接</h3><p>先添加连接，再为 Bot 分配工具。</p></div> : <>
          <header className="bot-mcp-connection"><div className="bot-settings-copy"><div className="bot-settings-title"><h3>{active.definition.name}</h3><span className="bot-settings-badge">{active.definition.transport === 'http' ? 'HTTP' : '本地程序'}</span></div>
            <p>{active.definition.transport === 'http' ? active.definition.url : active.definition.command}</p>
            <div className="bot-mcp-connection-actions"><span><Key size={14} />{active.hasCredential ? '密钥已保存' : '未设置密钥'}</span>
              <button type="button" className="bot-settings-link" disabled={busy || !active.definition.enabled} onClick={() => void run(async () => {
                const tools = await api.discoverMcpTools(botId, active.id);
                setCatalogs(current => ({ ...current, [active.id]: { tools, revision: active.revision } })); setNotice('连接正常，已读取 ' + tools.length + ' 个工具。新工具默认不分配。');
              })}><ArrowClockwise size={14} />{busy ? '正在处理…' : '测试连接'}</button></div>
          </div><button type="button" className="bot-settings-link" disabled={busy} onClick={() => request(() => setEditor({ server: active }))}><PencilSimple size={15} />编辑连接</button></header>
          <div className="bot-mcp-assignment"><div className="bot-settings-heading"><h3>分配给 Bot</h3>{picker}</div>
            <div className="bot-mcp-assignment-caption"><p>仅向这个 Bot 开放已分配的工具。</p><span>已分配 {assigned.length}{result ? ' / ' + result.tools.length : ''}</span></div>
            {!active.definition.enabled && <p className="bot-settings-help"><WarningCircle size={15} />连接已停用；现有分配保留，工具不会执行。</p>}
            {!!tools.length && <div className="bot-mcp-columns"><span>工具</span><span>调用权限</span></div>}
            {tools.map(tool => <div className="bot-settings-row bot-mcp-tool" key={tool.name}><div className="bot-settings-copy"><strong>{tool.name}</strong><p>{tool.description}</p></div>
              <Select aria-label={tool.name + '的权限'} disabled={busy} matchTriggerWidth value={assigned.find(item => item.name === tool.name)?.mode ?? 'off'}
                options={[{ value: 'off', label: '不分配' }, ...(tool.readOnly ? [{ value: 'read', label: '只读调用' }] : []), { value: 'confirm', label: '每次确认' }]} onChange={mode => chooseTool(tool.name, mode)} /></div>)}
            {!tools.length && <p className="bot-settings-empty">{result ? '服务没有返回工具。' : '点击「测试连接」读取工具，再选择调用权限。'}</p>}
          </div>
          <footer className="bot-mcp-footer"><span className="bot-settings-help">{dirty ? '有未保存的修改' : '当前分配已保存'}</span><div className="actions">
            <button type="button" disabled={busy || !dirty} onClick={() => { setBindings(data.bindings); setError(''); setNotice(''); }}>取消修改</button>
            <button type="button" className="primary" disabled={busy || !dirty} onClick={() => void run(async () => {
              const saved = await api.saveBindings(botId, bindings!); setBindings(saved);
              setData(current => current && { ...current, bindings: saved, usage: Object.fromEntries(current.servers.map(server => [server.id,
                [...(current.usage[server.id] ?? []).filter(id => id !== botId), ...(saved.mcp.some(item => item.serverId === server.id && item.tools.length) ? [botId] : [])]])) });
              setNotice('工具分配已保存，下一轮生效。');
            })}>{busy ? '保存中…' : '保存分配'}</button></div></footer>
        </>}
      </section>
    </div>)}
    {editor && <McpConnectionEditor key={editor.server?.id ?? 'new'} server={editor.server} usage={editor.server ? data?.usage[editor.server.id]?.length ?? 0 : 0} blocked={busy}
      onSavingChange={setBusy} close={() => setEditor(undefined)} remove={server => setDeleting(server)} save={async (definition, revision, credential) => {
        const saved = await api.saveMcpServer(definition, revision, credential);
        setData(current => current && { ...current, servers: [...current.servers.filter(server => server.id !== saved.id), saved] });
        setCatalogs(current => { const next = { ...current }; delete next[saved.id]; return next; });
        selectServer(saved.id); setEditor(undefined); setNotice('连接已保存。测试连接后，再为 Bot 分配工具。');
      }} />}
    {deleting && <Modal title="删除 MCP 连接" className="confirm" busy={busy} close={() => setDeleting(undefined)}>
      <p>删除「{deleting.definition.name}」和密钥，并移除 {data?.usage[deleting.id]?.length ?? 0} 个 Bot 对它的工具分配？</p>
      <div className="actions"><button type="button" autoFocus disabled={busy} onClick={() => setDeleting(undefined)}>取消</button>
        <button type="button" className="danger" disabled={busy} onClick={() => void run(async () => {
          await api.removeMcpServer(deleting.id, deleting.revision);
          const next = { ...data!.bindings, revision: data!.bindings.revision + (data!.bindings.mcp.some(binding => binding.serverId === deleting.id) ? 1 : 0), mcp: data!.bindings.mcp.filter(binding => binding.serverId !== deleting.id) };
          setBindings(next); setData(current => current && { ...current, servers: current.servers.filter(server => server.id !== deleting.id), bindings: next });
          selectServer(data!.servers.find(server => server.id !== deleting.id)?.id ?? ''); setDeleting(undefined); setEditor(undefined); setNotice('连接和对应工具分配已移除。');
        })}>{busy ? '删除中…' : '确认删除'}</button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </Modal>}
  </div>;
}

type ConnectionDraft = { name: string; transport: 'http' | 'stdio'; address: string; args: string; enabled: boolean; credentialName: string; credentialPrefix: string; credential: string; clearCredential: boolean };
function connectionFor(server?: McpServer): ConnectionDraft {
  const definition = server?.definition;
  return { name: definition?.name ?? '', transport: definition?.transport ?? 'http', address: definition?.transport === 'http' ? definition.url : definition?.command ?? '',
    args: definition?.transport === 'stdio' ? definition.args.join('\n') : '', enabled: definition?.enabled ?? true, credentialName: definition?.credentialName ?? '',
    credentialPrefix: definition?.credentialPrefix ?? (definition?.transport === 'stdio' ? '' : 'Bearer '), credential: '', clearCredential: false };
}
function McpConnectionEditor({ server, usage, blocked, onSavingChange, close, save, remove }: {
  server?: McpServer; usage: number; blocked: boolean; onSavingChange(value: boolean): void; close(): void;
  save(definition: McpServerDefinition, revision: number, credential?: string): Promise<void>; remove(server: McpServer): void;
}) {
  const [draft, setDraft] = useState(() => connectionFor(server)), [baseline] = useState(() => JSON.stringify(connectionFor(server)));
  const [saving, setSaving] = useState(false), [error, setError] = useState(''), [visible, setVisible] = useState(false);
  const running = useRef(false), form = useRef<HTMLFormElement>(null), id = useRef(server?.id ?? crypto.randomUUID());
  const busy = saving || blocked, dirty = JSON.stringify(draft) !== baseline;
  useEffect(() => { onSavingChange(saving); }, [saving, onSavingChange]);
  useEffect(() => () => onSavingChange(false), [onSavingChange]);
  const patch = (value: Partial<ConnectionDraft>) => { setDraft(current => ({ ...current, ...value })); setError(''); };
  return <Modal title={server ? '编辑 MCP 连接' : '新增 MCP 连接'} className="bot-mcp-editor-modal" dirty={dirty} busy={busy} close={close}>
    <form ref={form} className="bot-mcp-editor" noValidate onSubmit={event => {
      event.preventDefault(); if (running.current || busy) return;
      const common = { id: id.current, name: draft.name, enabled: draft.enabled, credentialPrefix: draft.credentialPrefix,
        ...(draft.credentialName.trim() ? { credentialName: draft.credentialName.trim() } : {}) };
      const parsed = mcpServerSchema.safeParse(draft.transport === 'http' ? { ...common, transport: 'http', url: draft.address.trim() }
        : { ...common, transport: 'stdio', command: draft.address.trim(), args: draft.args.split('\n').filter(Boolean) });
      if (!parsed.success) { setError(parsed.error.issues[0]?.message || '请检查连接内容'); form.current?.querySelector<HTMLInputElement>(!draft.name.trim() ? '[name="name"]' : '[name="address"]')?.focus(); return; }
      if (draft.transport === 'stdio' && (draft.credential || server?.hasCredential) && !draft.clearCredential && !draft.credentialName.trim()) {
        setError('请填写本地程序接收密钥的环境变量名。');
        const advanced = form.current?.querySelector('details'); if (advanced) advanced.open = true;
        form.current?.querySelector<HTMLInputElement>('[name="credentialName"]')?.focus(); return;
      }
      running.current = true; setSaving(true); setError('');
      void save(parsed.data, server?.revision ?? 0, draft.clearCredential ? '' : draft.credential || undefined).catch(cause => setError(errorText(cause))).finally(() => { running.current = false; setSaving(false); });
    }}>
      <div className="bot-mcp-shared-note"><PlugsConnected size={18} /><div><strong>本应用共用的连接</strong><p>{server ? '修改将影响已分配此连接的 ' + usage + ' 个 Bot。' : '保存后再为各 Bot 分配工具。'}</p></div></div>
      <label>连接名称<input name="name" autoFocus disabled={busy} maxLength={80} value={draft.name} onChange={event => patch({ name: event.target.value })} /></label>
      <label>连接方式<Select aria-label="连接方式" disabled={busy} matchTriggerWidth value={draft.transport} options={[{ value: 'http', label: '远程 HTTP' }, { value: 'stdio', label: '本地程序' }]}
        onChange={value => patch({ transport: value as ConnectionDraft['transport'], address: '', credentialName: '', credentialPrefix: value === 'http' ? 'Bearer ' : '' })} /></label>
      <label>{draft.transport === 'http' ? '服务地址' : '程序路径'}<input name="address" disabled={busy} placeholder={draft.transport === 'http' ? 'https://example.com/mcp' : '程序完整路径或命令'} value={draft.address} onChange={event => patch({ address: event.target.value })} /></label>
      {draft.transport === 'stdio' && <><label>启动参数（每行一个）<textarea rows={3} disabled={busy} value={draft.args} onChange={event => patch({ args: event.target.value })} /></label><p className="bot-settings-help">本地程序按当前电脑用户的权限运行。这里只添加你信任的 MCP 服务。</p></>}
      <label>密钥<span className="bot-mcp-secret"><input aria-label="连接密钥" type={visible ? 'text' : 'password'} autoComplete="new-password" disabled={busy || draft.clearCredential} placeholder={server?.hasCredential ? '已保存，留空保留' : '不需要可留空'} value={draft.credential} onChange={event => patch({ credential: event.target.value })} />
        <IconButton label={visible ? '隐藏密钥' : '显示密钥'} disabled={busy || draft.clearCredential} onClick={() => setVisible(value => !value)}>{visible ? <EyeSlash size={17} /> : <Eye size={17} />}</IconButton></span></label>
      <p className="bot-settings-help">密钥独立加密保存，不写入 Bot 的文件或说明。</p>
      <details className="bot-mcp-advanced"><summary>更多连接设置</summary><div>
        <label>{draft.transport === 'http' ? '密钥请求头（默认 Authorization）' : '密钥环境变量名'}<input name="credentialName" disabled={busy} value={draft.credentialName} onChange={event => patch({ credentialName: event.target.value })} /></label>
        <label>密钥前缀（可留空）<input disabled={busy} value={draft.credentialPrefix} onChange={event => patch({ credentialPrefix: event.target.value })} /></label>
        {server?.hasCredential && <label className="bot-mcp-check"><input type="checkbox" disabled={busy} checked={draft.clearCredential} onChange={event => patch({ clearCredential: event.target.checked })} />清除已保存密钥</label>}
        <label className="bot-mcp-check"><input type="checkbox" disabled={busy} checked={draft.enabled} onChange={event => patch({ enabled: event.target.checked })} />启用连接</label>
      </div></details>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="bot-mcp-editor-footer">{server && <button type="button" className="bot-settings-link bot-settings-danger" disabled={busy} onClick={() => remove(server)}>删除连接</button>}
        <div className="actions"><button type="button" disabled={busy} onClick={() => form.current?.closest('dialog')?.requestClose()}>取消</button>
          <button type="submit" className="primary" disabled={busy || !dirty}>{busy ? '保存中…' : '保存连接'}</button></div></div>
    </form>
  </Modal>;
}
