import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowClockwise, ArrowRight, CalendarBlank, ChatCircleText, ChatTeardropText, EnvelopeSimple, LinkSimple } from '@phosphor-icons/react';
import type { BotAction } from '../../shared/bot-contracts';
import type { OfficeCoverage, OfficeItem, OfficeMaterial, OfficeMaterialKind, OfficeRef, OfficeSnapshot } from '../../shared/office-workbench';
import { errorText, Segmented } from '../ui/controls';
import './office-workbench.css';

type Tab = 'inbox' | 'brief' | 'materials';
const kinds = {
  direct: { name: '私聊', icon: ChatTeardropText },
  group: { name: '群消息', icon: ChatCircleText },
  mail: { name: '邮件', icon: EnvelopeSimple },
  meeting: { name: '日程', icon: CalendarBlank },
};
const itemLabels: Record<OfficeItem['kind'], string> = { awaiting: '待回复', commitment: '承诺待核对', mail: '邮件待核对' };
const displayTime = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
const clockTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
const stamp = (at: number | null) => at === null ? '时间未提供' : displayTime.format(at);
const dayText = (value: string) => Number(value.slice(5, 7)) + '月' + Number(value.slice(8, 10)) + '日';
const dueText = (value: string | null) => value === null ? '截止时间待核对' : value.includes('T') ? stamp(Date.parse(value)) + ' 前' : dayText(value);
const listLimit = 80;

function Coverage({ label, coverage }: { label: string; coverage: OfficeCoverage }) {
  const updated = coverage.lastSuccessAt === null ? '' : stamp(coverage.lastSuccessAt);
  if (label === '日程' && coverage.state === 'fresh' && !updated) return <span title={coverage.scope}>日程待办</span>;
  const title = coverage.state === 'cached' ? '沿用' : coverage.state === 'partial' ? '部分读取' : coverage.state === 'unavailable' ? '暂不可用'
    : coverage.state === 'unread' ? '等待读取' : updated ? '更新于' : '本地日程';
  return <span data-state={coverage.state} title={[coverage.scope, coverage.detail].filter(Boolean).join(' · ')}>{label} {title}{updated && ' ' + updated}</span>;
}

function SourceLink({ source, open }: { source: OfficeRef; open(source: OfficeRef): void }) {
  return <button type="button" className="office-ref" onClick={() => open(source)}><LinkSimple size={14} />{source.label}</button>;
}

interface Props {
  settingsOpen: boolean;
  sourceRequest?: { source: OfficeRef; nonce: number };
  onSettings(): void;
  onMeeting(taskId: string): void;
  onPrepared(action: BotAction): void;
}

export function OfficeView({ settingsOpen, sourceRequest, onSettings, onMeeting, onPrepared }: Props) {
  const api = window.workbench.officeWorkbench;
  const [snapshot, setSnapshot] = useState<OfficeSnapshot>();
  const [tab, setTab] = useState<Tab>('inbox');
  const [itemId, setItemId] = useState<string>();
  const [sourceId, setSourceId] = useState<string>();
  const [material, setMaterial] = useState<OfficeMaterial>();
  const [sourceError, setSourceError] = useState('');
  const [sourceRetry, setSourceRetry] = useState(0);
  const [filter, setFilter] = useState<OfficeMaterialKind | 'all'>('all');
  const [search, setSearch] = useState(''), [limit, setLimit] = useState(listLimit);
  const [busy, setBusy] = useState<'refresh' | 'propose' | 'dismiss'>();
  const operation = useRef(false), version = useRef(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const rows = useMemo(() => new Map(snapshot?.materials.map(row => [row.id, row])), [snapshot]);
  const items = useMemo(() => new Map(snapshot?.items.map(item => [item.id, item])), [snapshot]);
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return snapshot?.materials.filter(row => (filter === 'all' || row.kind === filter)
      && (!query || [row.title, row.byline, row.preview].some(value => value?.toLowerCase().includes(query)))) ?? [];
  }, [snapshot, filter, search]);
  const selectedItem = items.get(itemId ?? '') ?? snapshot?.items[0];
  const selectedSource = sourceId ?? filtered[0]?.id;
  const selectedRow = rows.get(selectedSource ?? '');
  const visibleRows = filtered.slice(0, limit);
  if (selectedRow && !visibleRows.some(row => row.id === selectedSource) && filtered.some(row => row.id === selectedSource)) visibleRows.unshift(selectedRow);
  const materialVisible = material?.id === selectedSource ? material : undefined;

  const read = useCallback(async () => {
    if (operation.current) return;
    const request = ++version.current;
    try {
      const result = await api.state();
      if (request === version.current && !operation.current) { setSnapshot(result); setError(''); }
    } catch (cause) { if (request === version.current && !operation.current) setError(errorText(cause)); }
  }, [api]);

  useEffect(() => {
    if (settingsOpen) { setSnapshot(undefined); setMaterial(undefined); return; }
    void read();
    const refresh = () => { void read(); };
    const offTodo = window.workbench.todo.onChanged(refresh);
    const offMessages = window.workbench.island.onWelinkMessagesChanged(refresh);
    const offAgenda = window.workbench.island.onWelinkSyncChanged(refresh);
    return () => { version.current++; offTodo(); offMessages(); offAgenda(); };
  }, [read, settingsOpen]);

  function openSource(source: OfficeRef) {
    setSourceId(source.id);
    setSearch('');
    setFilter('all');
    setTab('materials');
    requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }));
  }
  useEffect(() => { if (sourceRequest) openSource(sourceRequest.source); }, [sourceRequest]);

  useEffect(() => {
    if (tab !== 'materials' || !selectedSource || !selectedRow || settingsOpen) return;
    let active = true;
    setSourceError('');
    void api.material(selectedSource).then(value => {
      if (!active) return;
      setMaterial(value);
      if (value.kind === 'mail' && value.text) void read();
    }, cause => { if (active) setSourceError(errorText(cause)); });
    return () => { active = false; };
  }, [api, read, selectedSource, selectedRow?.id, sourceRetry, tab, settingsOpen]);

  function openItem(item: OfficeItem) {
    setItemId(item.id);
    setTab('inbox');
    requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }));
  }
  async function act(action: 'refresh' | 'propose' | 'dismiss', item?: OfficeItem) {
    if (operation.current) return;
    operation.current = true;
    version.current++;
    setBusy(action); setError(''); setNotice('');
    try {
      if (action === 'refresh') {
        const next = await api.refresh();
        setSnapshot(next);
        setMaterial(undefined); setSourceRetry(value => value + 1);
        if (!next.connected) setNotice('请登录 WeLink 后读取消息和邮件。');
        else if (Object.values(next.coverage).some(source => ['unavailable', 'partial', 'cached'].includes(source.state))) setNotice('已更新可用资料。请核对各来源的读取状态。');
        else setNotice('办公资料已更新。');
      } else if (item && action === 'dismiss') {
        setSnapshot(await api.dismiss(item.id));
        setNotice('已标为已处理。');
      } else if (item) {
        const prepared = await api.proposeTodo(item.id);
        onPrepared(prepared);
        setNotice(prepared.status === 'applied' ? '这条待办建议已应用，可在原对话查看回执。' : '待办建议已放到办公助理对话。');
      }
    } catch (cause) { setError(errorText(cause)); }
    finally { operation.current = false; setBusy(undefined); }
  }

  const availableItem = selectedSource && snapshot?.items.find(item => item.source.id === selectedSource || item.related?.id === selectedSource);
  const itemRow = selectedItem ? rows.get(selectedItem.source.id) : undefined;
  return <section id="view-office" className="view on office-workspace" aria-label="办公助理工作区">
    <header className="office-header">
      <h1>办公助理</h1>
      <button type="button" className="btn btn-sec btn-sm" disabled={!!busy} onClick={() => void act('refresh')}><ArrowClockwise size={15} />{busy === 'refresh' ? '正在更新…' : '更新资料'}</button>
    </header>
    <div className="office-panel">
      <div className="office-tabs">
        <Segmented aria-label="办公助理视图" variant="content" value={tab} onChange={value => setTab(value as Tab)}
          options={[{ value: 'inbox', label: '待处理' + (snapshot?.items.length ? ' ' + snapshot.items.length : '') }, { value: 'brief', label: '简报' }, { value: 'materials', label: '工作资料' }]} />
      </div>
      {snapshot && <>
        <div className="office-coverage" aria-label="数据来源和更新时间">
          <span>消息范围 近 36 小时</span>
          <Coverage label="WeLink" coverage={snapshot.coverage.messages} />
          <Coverage label="邮件" coverage={snapshot.coverage.mail} />
          <Coverage label="日程" coverage={snapshot.coverage.agenda} />
        </div>
        {!snapshot.connected && <div className="office-connect">
          <span>登录 WeLink 后可读取工作消息和邮件。</span><button type="button" className="text-button" onClick={onSettings}>打开 W3 接入</button>
        </div>}
      </>}
      {(error || notice) && <p className={error ? 'office-notice is-error' : 'office-notice'} role={error ? 'alert' : 'status'}>{error || notice}</p>}
      {!snapshot ? <p className="office-empty" role="status">{error ? '使用「更新资料」重试。' : '正在读取办公资料…'}</p> : tab === 'inbox' ? (
        snapshot.items.length ? <div className="office-split">
          <div className="office-list" aria-label="待处理事项">{snapshot.items.map(item =>
            <button type="button" className="office-row" aria-pressed={item.id === selectedItem?.id} key={item.id} onClick={() => setItemId(item.id)}>
              <strong>{item.title}</strong><span>{itemLabels[item.kind]}{item.deadline ? ' · ' + dueText(item.deadline) : ''}</span>
            </button>)}</div>
          {selectedItem && <article className="office-detail" aria-label="待处理详情">
            <h2 tabIndex={-1} ref={detailHeading}>{selectedItem.title}</h2>
            <p className="office-byline">{itemLabels[selectedItem.kind]}{itemRow && ' · ' + itemRow.title + ' · ' + itemRow.byline + ' · ' + stamp(itemRow.at)}</p>
            <p className="office-deadline">{dueText(selectedItem.deadline)}</p>
            <p className="office-reason">{selectedItem.reason}</p>
            <div className="office-links"><SourceLink source={selectedItem.source} open={openSource} />
              {selectedItem.related && <button type="button" className="text-button" onClick={() => openSource(selectedItem.related!)}>
                {selectedItem.related.at === null ? '关联会议' : clockTime.format(selectedItem.related.at)} · {selectedItem.related.title} <ArrowRight size={14} />
              </button>}
              {snapshot.brief.priorities.includes(selectedItem.id) && <button type="button" className="text-button" onClick={() => {
                setTab('brief');
                requestAnimationFrame(() => document.getElementById('office-brief-' + selectedItem.id)?.focus());
              }}>在简报查看 <ArrowRight size={14} /></button>}
            </div>
            <div className="office-actions">
              <button type="button" className="btn btn-pri btn-sm" disabled={!!busy} onClick={() => void act('propose', selectedItem)}>{busy === 'propose' ? '正在生成…' : '生成待办建议'}</button>
              <button type="button" className="text-button" disabled={!!busy} onClick={() => void act('dismiss', selectedItem)}>标为已处理</button>
            </div>
          </article>}
        </div> : <p className="office-empty">{snapshot.coverage.messages.state === 'unread' ? '更新资料后，查看可能需要你跟进的消息和邮件。' : '已读取的资料中暂无待处理事项。'}</p>
      ) : tab === 'brief' ? (
        <div className="office-brief">
          <h2>{dayText(snapshot.day)}简报</h2>
          <h3>优先处理</h3>
          {!snapshot.brief.priorities.length && <p className="office-empty">当前资料中暂无今日优先事项。</p>}
          {snapshot.brief.priorities.map(id => items.get(id)).filter((item): item is OfficeItem => !!item).map(item =>
            <article className="office-brief-card" id={'office-brief-' + item.id} tabIndex={-1} key={item.id}>
              <div className="office-byline">{dueText(item.deadline)} · {itemLabels[item.kind]}</div><h4>{item.title}</h4>
              {item.related && <p>关联会议 · {item.related.title}{item.related.at !== null && ' · ' + clockTime.format(item.related.at)}</p>}
              <div className="office-links"><button type="button" className="text-button" onClick={() => openItem(item)}>查看待处理 <ArrowRight size={14} /></button><SourceLink source={item.source} open={openSource} /></div>
            </article>)}
          <h3>今日日程</h3>
          {!snapshot.brief.meetings.length && <p className="office-empty">当前日程中暂无今天的会议。</p>}
          {snapshot.brief.meetings.map(id => rows.get(id)).map(row => row && (
            <button type="button" className="office-brief-meeting" key={row.id} onClick={() => openSource(row)}>
              <CalendarBlank size={17} /><strong>{row.title}</strong><span>{row.at !== null && clockTime.format(row.at)} · {row.byline}</span><ArrowRight size={14} />
            </button>))}
        </div>
      ) : (
        <>
          <div className="office-searchbar">
            <input type="search" value={search} aria-label="搜索工作资料" placeholder="搜索已有资料" onChange={event => { setSearch(event.target.value); setSourceId(undefined); setLimit(listLimit); }} />
            <Segmented aria-label="工作资料来源" value={filter} onChange={value => { setFilter(value as typeof filter); setSourceId(undefined); setLimit(listLimit); }}
              options={[{ value: 'all', label: '全部' }, ...Object.entries(kinds).map(([value, kind]) => ({ value, label: kind.name }))]} />
          </div>
          <div className="office-split">
            <div className="office-list" aria-label="工作资料列表">
              {!visibleRows.length && <p className="office-empty">{search ? '未找到匹配资料。' : '当前范围暂无资料。'}</p>}
              {visibleRows.map(row => {
                const Icon = kinds[row.kind].icon;
                return <button type="button" key={row.id} className="office-row has-icon" aria-pressed={row.id === selectedSource} onClick={() => setSourceId(row.id)}>
                  <Icon className="office-source-icon" size={17} aria-hidden="true" /><span><strong>{row.title}</strong><span>{kinds[row.kind].name} · {row.byline} · {stamp(row.at)}</span>{row.preview && <span className="office-preview">{row.preview}</span>}</span>
                </button>;
              })}
              {filtered.length > limit && <button type="button" className="text-button office-more" onClick={() => setLimit(value => value + listLimit)}>查看更多资料</button>}
            </div>
            <article className="office-detail" aria-label="资料详情">
              <h2 ref={detailHeading} tabIndex={-1}>{selectedRow?.title ?? '资料详情'}</h2>
              {selectedSource && !selectedRow ? <p className="office-empty">这条资料已离开当前读取范围，或当前账号无法访问。</p> : !selectedRow ? <p className="office-empty">选择一条资料查看来源。</p> : <>
                <p className="office-byline">{kinds[selectedRow.kind].name} · {selectedRow.byline} · {stamp(selectedRow.at)}</p>
                {sourceError ? <p className="office-notice is-error" role="alert">{sourceError} <button type="button" className="text-button" onClick={() => setSourceRetry(value => value + 1)}>重试读取</button></p> :
                  !materialVisible ? <p className="office-empty" role="status">正在读取原文…</p> :
                    <MaterialDetail material={materialVisible} onMeeting={onMeeting} retry={() => setSourceRetry(value => value + 1)} />}
                {availableItem && <button type="button" className="text-button office-more" onClick={() => openItem(availableItem)}>查看关联事项 <ArrowRight size={14} /></button>}
              </>}
            </article>
          </div>
        </>
      )}
    </div>
  </section>;
}

function MaterialDetail({ material, onMeeting, retry }: { material: OfficeMaterial; onMeeting(id: string): void; retry(): void }) {
  return <>
    {material.capturedAt !== null && <p className="office-byline">{material.context ? '消息缓存更新于' : '资料读取于'} {stamp(material.capturedAt)}</p>}
    {material.meeting && <div className="office-meeting-details">
      <p>{material.meeting.dateAt.includes('T') ? stamp(Date.parse(material.meeting.dateAt)) : dayText(material.meeting.dateAt)}{material.meeting.endAt && ' — ' + stamp(Date.parse(material.meeting.endAt))}</p>
      <p className="office-byline">{material.meeting.providers.join(' + ')}</p>
      <button type="button" className="office-ref" onClick={() => onMeeting(material.meeting!.taskId)}><CalendarBlank size={15} />打开日程详情</button>
    </div>}
    {material.text && <blockquote className="office-quote">{material.text}</blockquote>}
    {material.note && <p className="office-notice" role="status">{material.note}{material.kind === 'mail' && <button type="button" className="text-button" onClick={retry}>重试读取</button>}</p>}
    {!!material.context?.length && <div className="office-context"><h3>同一会话的前后文</h3><ul>{material.context.map((line, index) =>
      <li key={index}><span>{stamp(line.at)} · {line.sender}</span><p>{line.text}</p></li>)}</ul></div>}
  </>;
}
