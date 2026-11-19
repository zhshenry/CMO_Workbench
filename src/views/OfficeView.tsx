import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowClockwise, ArrowRight, CalendarBlank, ChatCircleText, ChatTeardropText, EnvelopeSimple, LinkSimple, SlidersHorizontal, FolderSimple, TextAlignLeft, Tray } from '@phosphor-icons/react';
import type { BotAction } from '../../shared/bot-contracts';
import { officeBriefSections, type OfficeAutomation, type OfficeBriefMeeting, type OfficeCoverage, type OfficeDailyBrief, type OfficeItem, type OfficeMaterial, type OfficeMaterialKind, type OfficeRef, type OfficeScene, type OfficeSearch, type OfficeSearchResult, type OfficeSnapshot, type OfficeWorkflow } from '../../shared/office-workbench';
import { chinaDay, nextDay } from '../../shared/welink-agenda';
import { DatePicker, errorText, Segmented, Select, TimePicker } from '../ui/controls';
import './office-workbench.css';

type Tab = 'inbox' | 'brief' | 'materials' | 'commitments';
const kinds = {
  direct: { name: '私聊', icon: ChatTeardropText },
  group: { name: '群消息', icon: ChatCircleText },
  mail: { name: '邮件', icon: EnvelopeSimple },
  meeting: { name: '日程', icon: CalendarBlank },
};
const itemLabels: Record<OfficeItem['kind'], string> = { awaiting: '待回复', commitment: '承诺待核对', mail: '邮件待核对' };
const itemLabel = (item: OfficeItem) => item.needsReplyReview ? '回复待核对' : itemLabels[item.kind];
const displayTime = new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
const clockTime = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Shanghai' });
const stamp = (at: number | null) => at === null ? '时间未提供' : displayTime.format(at);
const dayText = (value: string) => Number(value.slice(5, 7)) + '月' + Number(value.slice(8, 10)) + '日';
const dueText = (value: string | null) => value === null ? '截止时间待核对' : value.includes('T') ? stamp(Date.parse(value)) + ' 前' : dayText(value);
const listLimit = 80;
const briefSectionTitles = { awaiting: '待回复', commitments: '承诺跟进', groups: '相关群消息', mail: '重要邮件' };

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

function BriefSection({ title, rows }: { title: string; rows: ReactNode[] }) {
  if (!rows.length) return null;
  return <section aria-label={title}>
    <h3>{title}</h3>{rows.slice(0, 2)}
    {rows.length > 2 && <details className="office-brief-more"><summary>查看其余 {rows.length - 2} 条</summary>{rows.slice(2)}</details>}
  </section>;
}

function meetingTime(row: OfficeBriefMeeting, day: string) {
  const meeting = row.meeting;
  if (!meeting) return row.at === null ? '时间待核对' : stamp(row.at);
  if (!meeting.dateAt.includes('T')) return '全天';
  const time = (value: string) => {
    const instant = Date.parse(value);
    return Number.isFinite(instant) ? chinaDay(instant) === day ? clockTime.format(instant) : stamp(instant) : '时间待核对';
  };
  return [time(meeting.dateAt), meeting.endAt && time(meeting.endAt)].filter(Boolean).join('–');
}

interface Props {
  workspaceHeader?: HTMLElement | null;
  settingsOpen: boolean;
  sourceRequest?: { source: OfficeRef; nonce: number };
  onSettings(): void;
  onMeeting(taskId: string): void;
  onTask(taskId: string): void;
  onAnalyze(scene: OfficeScene, label: string): void;
  onPrepared(action: BotAction): void;
}

export function OfficeView({ workspaceHeader, settingsOpen, sourceRequest, onSettings, onMeeting, onTask, onAnalyze, onPrepared }: Props) {
  const api = window.workbench.officeWorkbench;
  const [snapshot, setSnapshot] = useState<OfficeSnapshot>();
  const [workflow, setWorkflow] = useState<OfficeWorkflow>(), [brief, setBrief] = useState<OfficeDailyBrief | null>(null);
  const [briefDay, setBriefDay] = useState(''), [job, setJob] = useState('');
  const briefFocus = useRef('');
  const [tab, setTab] = useState<Tab>('inbox');
  const [itemId, setItemId] = useState<string>();
  const [sourceId, setSourceId] = useState<string>();
  const [material, setMaterial] = useState<OfficeMaterial>();
  const [sourceError, setSourceError] = useState('');
  const [sourceRetry, setSourceRetry] = useState(0);
  const [query, setQuery] = useState<OfficeSearch>({});
  const [showFilters, setShowFilters] = useState(false);
  const [results, setResults] = useState<OfficeSearchResult & { query: OfficeSearch }>();
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState('');
  const searchVersion = useRef(0);
  const [busy, setBusy] = useState<'refresh' | 'propose' | 'dismiss'>();
  const operation = useRef(false), version = useRef(0);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const rows = useMemo(() => new Map(snapshot?.materials.map(row => [row.id, row])), [snapshot]);
  const items = useMemo(() => new Map(snapshot?.items.map(item => [item.id, item])), [snapshot]);
  const selectedItem = items.get(itemId ?? '') ?? snapshot?.items[0];
  const visibleRows = results?.rows ?? [];
  const selectedSource = sourceId ?? visibleRows[0]?.id;
  const materialVisible = material?.id === selectedSource ? material : undefined;
  const selectedRow = materialVisible ?? (sourceId ? rows.get(sourceId) : undefined) ?? visibleRows.find(row => row.id === selectedSource);

  const read = useCallback(async () => {
    if (operation.current) return;
    const request = ++version.current;
    try {
      const result = await api.state(tab === 'brief');
      if (request === version.current && !operation.current) { setSnapshot(result); setError(''); }
    } catch (cause) { if (request === version.current && !operation.current) setError(errorText(cause)); }
  }, [api, tab]);

  useEffect(() => {
    if (settingsOpen) { setSnapshot(undefined); setMaterial(undefined); return; }
    void read();
    const refresh = () => { void read(); };
    const offTodo = window.workbench.todo.onChanged(refresh);
    const offMessages = window.workbench.island.onWelinkMessagesChanged(refresh);
    const offAgenda = window.workbench.island.onWelinkSyncChanged(refresh);
    const offOffice = api.onChanged(refresh);
    return () => { version.current++; offTodo(); offMessages(); offAgenda(); offOffice(); };
  }, [api, read, settingsOpen]);

  useEffect(() => {
    if (settingsOpen || !snapshot?.connected) { setWorkflow(undefined); setBrief(null); return; }
    let active = true;
    const update = () => {
      void api.workflow().then(value => { if (active) setWorkflow(value); }, cause => { if (active) setError(errorText(cause)); });
      if (tab === 'brief') void api.brief(briefDay || undefined).then(value => { if (active) setBrief(value); }, cause => { if (active) setError(errorText(cause)); });
    };
    update();
    const off = api.onChanged(update), offTodo = window.workbench.todo.onChanged(update);
    return () => { active = false; off(); offTodo(); };
  }, [api, tab, briefDay, settingsOpen, snapshot?.connected]);

  async function runJob(label: string, work: () => Promise<void>) {
    if (job) return;
    setJob(label); setError(''); setNotice('');
    try { await work(); setWorkflow(await api.workflow()); }
    catch (cause) { setError(errorText(cause)); }
    finally { setJob(''); }
  }

  function configure(update: Partial<OfficeAutomation>) {
    if (!workflow || job) return;
    const previous = workflow.settings, settings = { ...previous, ...update };
    setWorkflow({ ...workflow, settings });
    void runJob('正在保存设置', async () => {
      try { await api.configure(settings); }
      catch (cause) { setWorkflow(current => current && { ...current, settings: previous }); throw cause; }
    });
  }

  const readSearch = useCallback(async (input: OfficeSearch, append = false) => {
    const version = ++searchVersion.current;
    setSearchBusy(true); setSearchError('');
    try {
      const next = await api.search({ ...input, limit: listLimit });
      if (version !== searchVersion.current) return;
      setResults(previous => {
        if (!append || !previous) return { ...next, query: input };
        const byId = new Map([...previous.rows, ...next.rows].map(row => [row.id, row]));
        return { ...previous, rows: [...byId.values()], total: next.total };
      });
    } catch (cause) {
      if (version === searchVersion.current) setSearchError(errorText(cause));
    } finally { if (version === searchVersion.current) setSearchBusy(false); }
  }, [api]);

  useEffect(() => {
    if (tab !== 'materials' || settingsOpen) return;
    const scheduled = searchVersion.current;
    const timer = setTimeout(() => { if (scheduled === searchVersion.current) void readSearch(query); }, 180);
    return () => { clearTimeout(timer); searchVersion.current++; };
  }, [readSearch, query, tab, settingsOpen, snapshot?.connected, snapshot?.coverage.messages.lastSuccessAt, snapshot?.coverage.mail.lastSuccessAt,
    snapshot?.unreadMail.lastSuccessAt, snapshot?.coverage.agenda.lastSuccessAt, snapshot?.unreadMail.state, snapshot?.coverage.mail.state]);

  function changeQuery(next: OfficeSearch) {
    searchVersion.current++;
    setQuery(next); setSourceId(undefined); setSearchError(''); setNotice('');
    setResults(previous => previous && { ...previous, rows: [], total: 0, scope: '', live: undefined });
  }

  function openSource(source: OfficeRef) {
    changeQuery({});
    setSourceId(source.id);
    setTab('materials');
    requestAnimationFrame(() => detailHeading.current?.focus({ preventScroll: true }));
  }
  useEffect(() => { if (sourceRequest) openSource(sourceRequest.source); }, [sourceRequest]);

  useEffect(() => {
    if (tab !== 'materials' || !selectedSource || settingsOpen) return;
    let active = true;
    setSourceError('');
    void api.material(selectedSource).then(value => {
      if (!active) return;
      setMaterial(value);
      if (value.kind === 'mail' && value.text && !value.preserved) void read();
    }, cause => { if (active) setSourceError(errorText(cause)); });
    return () => { active = false; };
  }, [api, read, selectedSource, sourceRetry, tab, settingsOpen]);

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
        let next = await api.refresh();
        if (tab === 'brief') next = await api.state(true);
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

  const originalId = materialVisible?.originalId ?? selectedSource;
  const availableItem = originalId && snapshot?.items.find(item => item.source.id === originalId || item.related?.id === originalId);
  const itemRow = selectedItem ? rows.get(selectedItem.source.id) : undefined;
  const activeBrief = brief?.day === (briefDay || snapshot?.day) ? brief : null;
  const dailyItems: (OfficeItem & { why?: string })[] = activeBrief ? activeBrief.items : !briefDay
    ? (snapshot?.brief.priorities.map(id => items.get(id)).filter((item): item is OfficeItem => !!item) ?? []) : [];
  const dailyMeetings = activeBrief ? activeBrief.meetings : !briefDay
    ? (snapshot?.brief.meetings.flatMap(id => rows.get(id) ?? []) ?? []) : [];
  const briefSections = activeBrief?.sections;
  const todaySections = brief?.day === snapshot?.day ? brief?.sections : undefined;
  const coverage = tab === 'brief' ? activeBrief?.coverage ?? (!briefDay ? snapshot?.coverage : undefined) : snapshot?.coverage;
  const jobLabel = tab === 'brief' && activeBrief?.organizing ? '规则清单已就绪，AI 正在整理…' : job;
  const finishedCommitments = new Set(!briefDay ? workflow?.commitments.filter(item => item.status === 'done' || item.status === 'handled').map(item => item.id) : []);
  useEffect(() => {
    if (tab !== 'brief' || briefDay || !briefFocus.current) return;
    const item = document.getElementById('office-brief-' + briefFocus.current);
    if (!item) return;
    const more = item.closest('details');
    if (more) more.open = true;
    item.focus(); briefFocus.current = '';
  }, [tab, briefDay, activeBrief, snapshot]);

  const tabs = <Segmented aria-label="办公助理视图" variant="content" value={tab === 'commitments' ? 'inbox' : tab} onChange={value => setTab(value as Tab)}
    options={[
      { value: 'inbox', label: '待处理' + (snapshot?.items.length ? ' ' + snapshot.items.length : ''), icon: <Tray size={16} aria-hidden="true" /> },
      { value: 'brief', label: '简报', icon: <TextAlignLeft size={16} aria-hidden="true" /> },
      { value: 'materials', label: '工作资料', icon: <FolderSimple size={16} aria-hidden="true" /> },
    ]} />;

  return <section id="view-office" className="view on office-workspace" aria-label="办公助理工作区">
    {workspaceHeader && createPortal(tabs, workspaceHeader)}
    <header className="office-header">
      <h1>办公助理</h1>
      <button type="button" className="btn btn-sec btn-sm" disabled={!!busy} onClick={() => void act('refresh')}><ArrowClockwise size={15} />{busy === 'refresh' ? '正在更新…' : '更新资料'}</button>
    </header>
    <div className="office-panel">
      {!workspaceHeader && <div className="office-tabs">{tabs}</div>}
      {snapshot && <>
        {coverage && <div className="office-coverage" aria-label="数据来源和更新时间">
          <span>近期消息 36 小时</span>
          <Coverage label="WeLink" coverage={coverage.messages} />
          <Coverage label="邮件" coverage={coverage.mail} />
          <Coverage label="日程" coverage={coverage.agenda} />
        </div>}
        {!snapshot.connected && <div className="office-connect">
          <span>登录 WeLink 后可读取工作消息和邮件。</span><button type="button" className="text-button" onClick={onSettings}>打开 W3和Welink接入</button>
        </div>}
      </>}
      {(error || jobLabel || notice) && <p className={error ? 'office-notice is-error' : 'office-notice'} role={error ? 'alert' : 'status'}>{error || jobLabel || notice}</p>}
      {!snapshot ? <p className="office-empty" role="status">{error ? '使用「更新资料」重试。' : '正在读取办公资料…'}</p> : tab === 'commitments' ? (
        <div className="office-brief"><button type="button" className="text-button" onClick={() => setTab('inbox')}>返回待处理</button><h2>承诺台账</h2>
          {!workflow?.commitments.length && <p className="office-empty">暂无已记录的承诺。</p>}
          {workflow?.commitments.map(item => <article className="office-brief-card" key={item.id}>
            <div className="office-byline">{dueText(item.deadline)} · {{ open: '待跟进', handled: '已处理', linked: '已转待办', done: '待办已完成' }[item.status]}</div>
            <h4>{item.title}</h4><div className="office-links"><SourceLink source={item.source} open={openSource} />
              {item.taskId ? <button type="button" className="text-button" onClick={() => onTask(item.taskId!)}>打开关联待办</button> : item.status === 'open' && <>
                <button type="button" className="text-button" disabled={!!busy} onClick={() => void act('propose', item)}>生成待办建议</button>
                <button type="button" className="text-button" disabled={!!busy} onClick={() => void runJob('正在保存', async () => { setSnapshot(await api.dismiss(item.id)); })}>标为已处理</button></>}
            </div>
          </article>)}
        </div>
      ) : tab === 'inbox' ? (<>
        <div className="office-searchbar office-workflow-actions"><button type="button" className="text-button" onClick={() => setTab('commitments')}>承诺台账</button>
          {snapshot.items.some(item => item.needsReplyReview) && <button type="button" className="text-button" disabled={!!job} onClick={() => void runJob('正在复核待回复', async () => {
            const count = await api.review(); await read(); setNotice(count ? `已复核 ${count} 条待回复。` : '没有新增复核结果。');
          })}>AI 复核待回复</button>}</div>
        {snapshot.items.length ? <div className="office-split">
          <div className="office-list" aria-label="待处理事项">{snapshot.items.map(item =>
            <button type="button" className="office-row" aria-pressed={item.id === selectedItem?.id} key={item.id} onClick={() => setItemId(item.id)}>
              <strong>{item.title}</strong><span>{itemLabel(item)}{item.deadline ? ' · ' + dueText(item.deadline) : ''}</span>
            </button>)}</div>
          {selectedItem && <article className="office-detail" aria-label="待处理详情">
            <h2 tabIndex={-1} ref={detailHeading}>{selectedItem.title}</h2>
            <p className="office-byline">{itemLabel(selectedItem)}{itemRow && ' · ' + itemRow.title + ' · ' + itemRow.byline + ' · ' + stamp(itemRow.at)}</p>
            <p className="office-deadline">{dueText(selectedItem.deadline)}</p>
            <p className="office-reason">{selectedItem.reason}</p>
            {selectedItem.review && <p className="office-reason">AI 复核 · {{ reply: '需要回复', maybe: '可能要回复', no: '不用回' }[selectedItem.review.verdict]} · {selectedItem.review.reason}</p>}
            <div className="office-links"><SourceLink source={selectedItem.source} open={openSource} />
              {selectedItem.related && <button type="button" className="text-button" onClick={() => openSource(selectedItem.related!)}>
                {selectedItem.related.at === null ? '关联会议' : clockTime.format(selectedItem.related.at)} · {selectedItem.related.title} <ArrowRight size={14} />
              </button>}
              {(snapshot.brief.priorities.includes(selectedItem.id) || todaySections
                && officeBriefSections.some(key => todaySections[key].some(item => item.itemId === selectedItem.id))) && <button type="button" className="text-button" onClick={() => {
                briefFocus.current = selectedItem.id;
                setBriefDay(''); setTab('brief');
              }}>在简报查看 <ArrowRight size={14} /></button>}
            </div>
            <div className="office-actions">
              {selectedItem.kind !== 'commitment' && <button type="button" className="btn btn-sec btn-sm" onClick={() => onAnalyze({ kind: 'draft', sourceId: selectedItem.source.id }, `为「${selectedItem.title}」起草回复`)}>起草回复</button>}
              <button type="button" className="btn btn-pri btn-sm" disabled={!!busy} onClick={() => void act('propose', selectedItem)}>{busy === 'propose' ? '正在生成…' : '生成待办建议'}</button>
              <button type="button" className="text-button" disabled={!!busy} onClick={() => void act('dismiss', selectedItem)}>标为已处理</button>
            </div>
          </article>}
        </div> : <p className="office-empty">{snapshot.coverage.messages.state === 'unread' ? '更新资料后，查看可能需要你跟进的消息和邮件。' : '已读取的资料中暂无待处理事项。'}</p>}
      </>) : tab === 'brief' ? (
        snapshot.brief.sources ? <div className="office-brief">
          <div className="office-links office-workflow-actions">
            <Select aria-label="简报日期" value={briefDay} onChange={value => { setBriefDay(value); setBrief(null); }} options={[{ value: '', label: '今天' }, ...(workflow?.days ?? []).filter(day => day !== snapshot.day).map(day => ({ value: day, label: day }))]} />
            {!briefDay && <button type="button" className="btn btn-sec btn-sm" disabled={!snapshot.connected || !!job} onClick={() => void runJob('正在生成今日简报', async () => setBrief(await api.generateBrief()))}>生成今日简报</button>}
            <button type="button" className="text-button" onClick={() => onAnalyze({ kind: 'mail' }, '按要处理、知会和可忽略分拣未读邮件')}>邮件分拣</button>
            <button type="button" className="text-button" onClick={() => onAnalyze({ kind: 'weekly' }, '根据本周办公资料起草周报')}>周报草稿</button>
          </div>
          {workflow && <details className="office-automation"><summary>自动整理设置</summary><div className="office-links office-workflow-actions">
            <label><input type="checkbox" checked={workflow.settings.brief} disabled={!!job} onChange={event => configure({ brief: event.target.checked })} />工作日简报</label>
            <TimePicker value={workflow.settings.briefTime} onChange={value => configure({ briefTime: value })} />
            <label><input type="checkbox" checked={workflow.settings.review} disabled={!!job} onChange={event => configure({ review: event.target.checked })} />定期复核待回复</label>
            <label><input type="checkbox" checked={workflow.settings.reminders} disabled={!!job} onChange={event => configure({ reminders: event.target.checked })} />会议提示和下班小结</label>
            <label><input type="checkbox" checked={workflow.settings.archive} disabled={!!job} onChange={event => configure({ archive: event.target.checked })} />本机长期归档</label>
          </div></details>}
          <h2>{dayText(briefDay || snapshot.day)}简报</h2>
          {activeBrief?.note && <p className="office-byline">{activeBrief.note}</p>}
          {activeBrief?.coverage && <details className="office-brief-more">
            <summary>查看本次资料范围</summary>
            <ul>{Object.entries(activeBrief.coverage).map(([key, source]) => <li key={key}>{source.scope}{source.detail && ` · ${source.detail}`}</li>)}</ul>
          </details>}
          {briefSections && activeBrief ? <>
            <BriefSection title="今日会议" rows={activeBrief.meetings.map(row => <article className="office-brief-card" key={row.id}>
              <div className="office-byline">{meetingTime(row, activeBrief.day)} · {row.byline}</div><h4>{row.title}</h4>
              {row.preparation && <p>会前建议 · {row.preparation}</p>}
              <div className="office-links"><SourceLink source={row} open={openSource} /></div>
            </article>)} />
            {officeBriefSections.map(key => <BriefSection key={key} title={briefSectionTitles[key]} rows={briefSections[key]
              .filter(entry => !entry.itemId || !finishedCommitments.has(entry.itemId)).map(entry => {
                const item = entry.itemId && items.get(entry.itemId);
                return <article className="office-brief-card" key={entry.source.id} id={entry.itemId && 'office-brief-' + entry.itemId} tabIndex={-1}>
                  {(entry.deadline || entry.guess) && <div className="office-byline">{[entry.deadline && dueText(entry.deadline), entry.guess && '待核对'].filter(Boolean).join(' · ')}</div>}
                  <h4>{entry.title}</h4>{entry.text && <p>{entry.text}</p>}
                  <div className="office-links">
                    {!briefDay && item && <button type="button" className="text-button" onClick={() => openItem(item)}>查看待处理 <ArrowRight size={14} /></button>}
                    <SourceLink source={entry.source} open={openSource} />
                    {entry.evidence?.map(source => <SourceLink key={source.id} source={source} open={openSource} />)}
                  </div>
                </article>;
              })} />)}
            {!activeBrief.meetings.length && !officeBriefSections.some(key => briefSections[key].some(entry => !entry.itemId || !finishedCommitments.has(entry.itemId)))
              && <p className="office-empty">本次读取的资料中暂无简报条目。</p>}
          </> : <>
          <h3>优先处理</h3>
          {!dailyItems.length && <p className="office-empty">该简报暂无优先事项。</p>}
          {dailyItems.map(item =>
            <article className="office-brief-card" id={'office-brief-' + item.id} tabIndex={-1} key={item.id}>
              <div className="office-byline">{dueText(item.deadline)} · {itemLabel(item)}</div><h4>{item.title}</h4>
              {item.why && <p>{item.why}</p>}
              {item.related && <p>关联会议 · {item.related.title}{item.related.at !== null && ' · ' + clockTime.format(item.related.at)}</p>}
              <div className="office-links">{items.has(item.id) && <button type="button" className="text-button" onClick={() => openItem(item)}>查看待处理 <ArrowRight size={14} /></button>}<SourceLink source={snapshot.brief.sources?.[item.source.id] ?? item.source} open={openSource} /></div>
            </article>)}
          <h3>当日日程</h3>
          {!dailyMeetings.length && <p className="office-empty">当天暂无记录的会议。</p>}
          {dailyMeetings.map(row => (
            <button type="button" className="office-brief-meeting" key={row.id} onClick={() => openSource(snapshot.brief.sources?.[row.id] ?? row)}>
              <CalendarBlank size={17} /><strong>{row.title}</strong><span>{row.at !== null && clockTime.format(row.at)} · {row.byline}</span><ArrowRight size={14} />
            </button>))}
          </>}
          {!!workflow?.notices.length && !briefDay && <><h3>办公提醒</h3>{workflow.notices.slice(0, 10).map(notice => <article key={notice.id} className="office-brief-card"><h4>{notice.title}</h4><p>{notice.text}</p>{notice.source && <SourceLink source={notice.source} open={openSource} />}</article>)}</>}
        </div> : <p className="office-empty" role="status">{error ? '使用「更新资料」重试。' : '正在读取简报出处…'}</p>
      ) : (
        <>
          <div className="office-searchbar">
            <input type="search" maxLength={160} value={query.keyword ?? ''} aria-label="搜索工作资料" placeholder="搜关键词、人员或群名" onChange={event => changeQuery({ ...query, keyword: event.target.value })} />
            <button type="button" className="btn btn-sec btn-sm" aria-expanded={showFilters} aria-controls="office-filters" onClick={() => setShowFilters(value => !value)}><SlidersHorizontal size={15} />筛选与补查</button>
            <Segmented aria-label="工作资料来源" value={query.kind ?? 'all'} onChange={value => changeQuery({ ...query, kind: value === 'all' ? undefined : value as OfficeMaterialKind, conversation: undefined, mailbox: undefined })}
              options={[{ value: 'all', label: '全部' }, ...Object.entries(kinds).map(([value, kind]) => ({ value, label: kind.name }))]} />
          </div>
          {query.kind === 'mail' && !query.preserved && !query.archive && <div className="office-searchbar">
            <Segmented aria-label="收件箱范围" value={query.mailbox ?? 'recent'} onChange={value => changeQuery({ ...query, mailbox: value === 'unread' ? 'unread' : 'recent' })}
              options={[{ value: 'recent', label: '近期收件箱' }, { value: 'unread', label: '未读邮件' }]} />
            {query.mailbox === 'unread' && <Coverage label="未读邮件" coverage={snapshot.unreadMail} />}
          </div>}
          {showFilters && <div id="office-filters" className="office-searchbar office-filters">
            <button type="button" className="btn btn-sec btn-sm" aria-pressed={!!query.preserved} onClick={() => changeQuery({ ...query, archive: undefined, preserved: !query.preserved })}>出处快照</button>
            <button type="button" className="btn btn-sec btn-sm" aria-pressed={!!query.archive} onClick={() => changeQuery({ ...query, preserved: undefined, archive: !query.archive })}>长期档案</button>
            {query.archive && <button type="button" className="text-button" disabled={!snapshot.connected || !!job} onClick={() => void runJob('正在补充档案', async () => { await api.archive(); await readSearch(query); })}>补充档案</button>}
            {query.kind !== 'mail' && query.kind !== 'meeting' && <Select aria-label="会话" value={query.conversation ?? ''} onChange={value => changeQuery({ ...query, conversation: value || undefined })}
              options={[{ value: '', label: '全部会话' }, ...(results?.conversations ?? [])
                .filter(entry => query.kind === 'group' ? entry.key.startsWith('group:') : query.kind === 'direct' ? entry.key.startsWith('user:') : true)
                .map(entry => ({ value: entry.key, label: entry.name, group: entry.key.startsWith('group:') ? '群聊' : '私聊' }))]} />}
            <DatePicker aria-label="开始日期" value={query.from ?? ''} triggerContent={query.from || '开始日期'} onChange={value => changeQuery({ ...query, from: value || undefined })} />
            <DatePicker aria-label="结束日期" value={query.to ?? ''} triggerContent={query.to || '结束日期'} onChange={value => changeQuery({ ...query, to: value || undefined })} />
            {!query.preserved && !query.archive && query.kind !== 'mail' && query.kind !== 'meeting' && <button type="button" className="btn btn-sec btn-sm" disabled={!snapshot.connected || searchBusy}
              title="未选日期时补查昨天至今天的消息" onClick={() => {
                setSourceId(undefined);
                void readSearch({ ...query, live: true, from: query.from ?? (query.to ?? nextDay(snapshot.day, -1)),
                  to: query.to ?? (query.from && query.from > snapshot.day ? query.from : snapshot.day) });
              }}>{query.conversation ? '补读所选会话' : '跨会话补查'}</button>}
            {query.conversation?.startsWith('group:') && <button type="button" className="text-button" onClick={() => onAnalyze({ kind: 'group', conversation: query.conversation, from: query.from, to: query.to }, '整理所选群讨论摘要')}>群讨论摘要</button>}
          </div>}
          {searchError ? <p className="office-notice is-error" role="alert">{searchError}</p> : <div className="office-search-meta" aria-live="polite">
            {searchBusy ? '正在查询资料…' : results?.scope && <><span>{results.total} 条 · {results.scope}</span>
              {!!results.live?.incomplete.length && <details><summary>查看未取全的范围</summary><p>{results.live.incomplete.join('、')}</p></details>}</>}
          </div>}
          <div className="office-split">
            <div className="office-list" aria-label="工作资料列表">
              {!visibleRows.length && !searchBusy && <p className="office-empty">{query.keyword ? '未找到匹配资料。' : '当前范围暂无资料。'}</p>}
              {visibleRows.map(row => {
                const Icon = kinds[row.kind].icon;
                return <button type="button" key={row.id} className="office-row has-icon" aria-pressed={row.id === selectedSource} onClick={() => setSourceId(row.id)}>
                  <Icon className="office-source-icon" size={17} aria-hidden="true" /><span><strong>{row.title}</strong><span>{kinds[row.kind].name} · {row.byline} · {stamp(row.at)}</span>{row.preview && <span className="office-preview">{row.preview}</span>}</span>
                </button>;
              })}
              {!!results && results.total > visibleRows.length && <button type="button" className="text-button office-more" disabled={searchBusy}
                onClick={() => void readSearch({ ...results.query, live: false, offset: visibleRows.length }, true)}>查看更多资料</button>}
            </div>
            <article className="office-detail" aria-label="资料详情">
              <h2 ref={detailHeading} tabIndex={-1}>{selectedRow?.title ?? '资料详情'}</h2>
              {!selectedSource ? <p className="office-empty">选择一条资料查看来源。</p> : <>
                {selectedRow && <p className="office-byline">{kinds[selectedRow.kind].name} · {selectedRow.byline} · {stamp(selectedRow.at)}</p>}
                {sourceError ? <p className="office-notice is-error" role="alert">{sourceError} <button type="button" className="text-button" onClick={() => setSourceRetry(value => value + 1)}>重试读取</button></p> :
                  !materialVisible ? <p className="office-empty" role="status">正在读取原文…</p> :
                    <MaterialDetail material={materialVisible} onMeeting={onMeeting} retry={() => setSourceRetry(value => value + 1)} />}
                {availableItem && <button type="button" className="text-button office-more" onClick={() => openItem(availableItem)}>查看关联事项 <ArrowRight size={14} /></button>}
                {materialVisible?.kind === 'meeting' && <button type="button" className="btn btn-sec btn-sm" onClick={() => onAnalyze({ kind: 'prep', sourceId: materialVisible.id }, `整理「${materialVisible.title}」会前材料`)}>整理会前材料</button>}
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
    {material.capturedAt !== null && <p className="office-byline">资料读取于 {stamp(material.capturedAt)}</p>}
    {material.scope && <p className="office-byline">{material.preserved ? '引用时的读取范围' : '读取范围'} · {material.scope}</p>}
    {material.meeting && <div className="office-meeting-details">
      <p>{material.meeting.dateAt.includes('T') ? stamp(Date.parse(material.meeting.dateAt)) : dayText(material.meeting.dateAt)}{material.meeting.endAt && ' — ' + stamp(Date.parse(material.meeting.endAt))}</p>
      <p className="office-byline">{material.meeting.providers.join(' + ')}</p>
      <button type="button" className="office-ref" onClick={() => onMeeting(material.meeting!.taskId)}><CalendarBlank size={15} />打开日程详情</button>
    </div>}
    {(material.text || material.kind === 'mail' && material.preview) && <blockquote className="office-quote">{material.text || material.preview}</blockquote>}
    {material.note && <p className="office-notice" role="status">{material.note}{material.kind === 'mail' && !material.preserved && <button type="button" className="text-button" onClick={retry}>重试读取</button>}</p>}
    {!!material.context?.length && <div className="office-context"><h3>已读取的前后文</h3><ul>{material.context.map((line, index) =>
      <li key={index}><span>{stamp(line.at)} · {line.sender}</span><p>{line.text}</p></li>)}</ul></div>}
  </>;
}
