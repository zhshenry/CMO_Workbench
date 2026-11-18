import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { ArrowRight, CalendarBlank, CheckCircle, DotsSixVertical, PencilSimple, Plus, Sparkle, X } from '@phosphor-icons/react';
import type { ViewId } from '../../shared/contracts';
import { DASHBOARD_KEY, WIDGET_IDS, WIDGET_ROWS, WIDGET_STYLES, WIDGET_WIDTHS, dashboardPlacements, defaultDashboard, defaultWidget, findDashboardSlot, moveDashboardWidget, readDashboard, resizeDashboardHeight, type DashboardLayout, type DashboardWidget, type WidgetId, type WidgetRows, type WidgetStyle, type WidgetWidth } from '../../shared/dashboard-layout';
import { dashboardSummary } from '../../shared/dashboard-summary';
import type { TodoState } from '../../shared/workbench-api';
import { IconButton, Segmented } from '../ui/controls';
import { HomeQuotaCard, HomeQuotaContent, useHomeQuota } from './HomeQuotaCard';
import { GameOptionsMenu } from './GameOptionsMenu';
import './home-dashboard.css';

const widgetNames: Record<WidgetId, string> = { today: '日程和待办', quota: 'AI 额度' };
const widgetIcons = { today: CalendarBlank, quota: Sparkle };
const CATALOG_IDS = WIDGET_IDS;
type CatalogWidgetId = WidgetId;
const styleNames: Record<WidgetStyle, string> = { history: '完成与待办堆叠图', counts: '日程与待办对比图', list: '今日 Token 消耗' };
const widthOptions = WIDGET_WIDTHS.map((width, index) => ({ value: String(width), label: `${width} 列 · ${['1/3', '1/2', '2/3', '整行'][index]}` }));
const rowOptions = WIDGET_ROWS.map(rows => ({ value: String(rows), label: `${rows} 行` }));
const resizeEdges = { left: '左', right: '右', top: '上', bottom: '下' } as const;
type ResizeEdge = keyof typeof resizeEdges;
const noAction = () => {};

function ActionLink({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return onClick ? <button className="dashboard-link" onClick={onClick}>{children}<ArrowRight size={15} /></button> : <span className="dashboard-link">{children}<ArrowRight size={15} /></span>;
}
function TodayContent({ data, clock, navigate }: { data: TodoState | null; clock: Date; navigate?: () => void }) {
  const summary = dashboardSummary(data?.tasks ?? [], clock), maximum = Math.max(1, ...summary.days.map(day => day.completed + day.pending));
  return <div className="dashboard-today dashboard-history">
    {!data ? <p className="dashboard-muted">正在读取日程待办…</p> : <>
      <div className="dashboard-summary-heading"><strong>近7天 · 按事项日期</strong><div className="dashboard-chart-legend"><span data-series="completed">已完成 {summary.plannedCompleted}</span><span data-series="pending">待办 {summary.plannedPending}</span></div></div>
      <div className="dashboard-history-bars" role="img" aria-label={`按事项日期，${summary.days.map(day => `${day.date} 已完成 ${day.completed} 项、待办 ${day.pending} 项`).join('；')}`}>
        {summary.days.map(day => <div className="dashboard-history-day" key={day.date} data-date={day.date} data-today={day.date === summary.today} title={`${day.date} · 已完成 ${day.completed} 项 · 待办 ${day.pending} 项`}><span>{day.completed + day.pending}</span><div className="dashboard-history-stack" data-empty={!day.completed && !day.pending} style={{ '--bar-share': (day.completed + day.pending) / maximum } as CSSProperties}>{day.pending ? <i data-series="pending" style={{ flex: day.pending }} /> : null}{day.completed ? <i data-series="completed" style={{ flex: day.completed }} /> : null}</div><small>{day.date === summary.today ? '今' : ['日', '一', '二', '三', '四', '五', '六'][day.weekday]}</small></div>)}
      </div>
    </>}
    <footer><span>{summary.earlierPending ? `更早待办 ${summary.earlierPending} 项` : `今天已完成 ${summary.days[6].completed} · 待办 ${summary.days[6].pending}`}</span><ActionLink onClick={navigate}>日程和待办</ActionLink></footer>
  </div>;
}

function ScheduleStatsContent({ data, clock, navigate }: { data: TodoState | null; clock: Date; navigate?: () => void }) {
  const summary = dashboardSummary(data?.tasks ?? [], clock), days = summary.upcomingDays, maximum = Math.max(1, ...days.flatMap(day => [day.meetings, day.tasks]));
  return <div className="dashboard-today dashboard-schedule-stats">
    {!data ? <p className="dashboard-muted">正在读取日程待办…</p> : <>
      <div className="dashboard-summary-heading"><strong>未来7天</strong><div className="dashboard-chart-legend"><span data-series="meetings">日程 {days.reduce((sum, day) => sum + day.meetings, 0)}</span><span data-series="pending">待办 {days.reduce((sum, day) => sum + day.tasks, 0)}</span></div></div>
      <div className="dashboard-history-bars" role="img" aria-label={`未完成事项，${days.map(day => `${day.date} 日程 ${day.meetings} 项、待办 ${day.tasks} 项`).join('；')}`}>
        {days.map(day => <div className="dashboard-history-day" key={day.date} data-date={day.date} title={`${day.date} · 未完成日程 ${day.meetings} 项 · 待办 ${day.tasks} 项`}><div className="dashboard-count-pair">{(['meetings', 'tasks'] as const).map(kind => <div className="dashboard-count-series" key={kind}><span>{day[kind]}</span><i data-series={kind === 'tasks' ? 'pending' : 'meetings'} data-empty={!day[kind]} style={{ '--bar-share': day[kind] / maximum } as CSSProperties} /></div>)}</div><small>{day.date === summary.today ? '今' : ['日', '一', '二', '三', '四', '五', '六'][day.weekday]}</small></div>)}
      </div>
    </>}
    <footer><span>{days[0].date.slice(5).replace('-', '/')}–{days[6].date.slice(5).replace('-', '/')} · 未完成事项</span><ActionLink onClick={navigate}>日程和待办</ActionLink></footer>
  </div>;
}

function DashboardCard({ widget, children, drag, tools, resize, ...props }: { widget: DashboardWidget; children: ReactNode; drag?: ReactNode; tools?: ReactNode; resize?: ReactNode } & HTMLAttributes<HTMLElement>) {
  const Icon = widgetIcons[widget.id];
  return <article {...props} className="dashboard-widget" data-widget={widget.id} data-width={widget.width} data-rows={widget.rows} data-style={widget.style} style={{ '--widget-span': widget.width, '--widget-rows': widget.rows, '--widget-top-offset': widget.topOffset ?? 0, ...props.style } as CSSProperties}>
    <header className="dashboard-widget-heading"><Icon size={19} /><h2 title={widgetNames[widget.id]}>{widgetNames[widget.id]}</h2><div className="dashboard-widget-tools">{drag}{tools}</div></header>
    <div className="dashboard-widget-body" inert={!!drag}>{children}</div>{resize}
  </article>;
}

function widgetPixelWidth(grid: HTMLDivElement, width: WidgetWidth) {
  const style = getComputedStyle(grid), tracks = style.display === 'grid' ? style.gridTemplateColumns.split(' ').map(Number.parseFloat) : [];
  const span = tracks.length === 2 ? width >= 4 ? 2 : 1 : width;
  return tracks.length ? tracks.slice(0, span).reduce((total, track) => total + track, 0) + parseFloat(style.columnGap) * (span - 1) : grid.clientWidth;
}

function DashboardPreview({ widget, grid, children }: { widget: DashboardWidget; grid: HTMLDivElement; children: ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null), canvas = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    function fit() {
      const stage = viewport.current!, surface = canvas.current!, card = surface.firstElementChild as HTMLElement;
      const width = widgetPixelWidth(grid, widget.width);
      card.style.width = `${width}px`;
      const height = card.offsetHeight, scale = Math.min(1, stage.clientWidth / width, stage.clientHeight / height);
      surface.style.width = `${width * scale}px`; surface.style.height = `${height * scale}px`;
      card.style.transform = `scale(${scale})`;
    }
    fit(); const observer = new ResizeObserver(fit); observer.observe(grid); observer.observe(viewport.current!);
    return () => observer.disconnect();
  }, [grid, widget.width, widget.rows]);
  return <div ref={viewport} className="dashboard-style-preview" inert aria-hidden="true"><div ref={canvas} className="dashboard-preview-canvas"><DashboardCard widget={widget}>{children}</DashboardCard></div></div>;
}

function DashboardCatalog({ initial, trigger, panelId, grid, layout, data, clock, close, apply }: { initial: CatalogWidgetId; trigger: HTMLButtonElement; panelId: string; grid: HTMLDivElement; layout: DashboardLayout; data: TodoState | null; clock: Date; close(): void; apply(widget: DashboardWidget): void }) {
  const panel = useRef<HTMLDivElement>(null);
  const [id, setId] = useState(initial);
  const [choices, setChoices] = useState(() => Object.fromEntries(CATALOG_IDS.map(key => {
    const widget = layout.widgets.find(widget => widget.id === key) ?? defaultWidget(key);
    return [key, { ...widget }];
  })) as Record<CatalogWidgetId, DashboardWidget>);
  const quota = useHomeQuota(), selected = choices[id], exists = layout.widgets.some(widget => widget.id === id);
  const schedule = id === 'today', name = widgetNames[id];
  const styles = schedule ? ['history', 'counts'] as const : WIDGET_STYLES[id];
  const sourceError = id === 'quota' ? quota.error : '';
  const dismiss = () => { close(); trigger.focus({ preventScroll: true }); };
  useLayoutEffect(() => {
    const element = panel.current!;
    element.showPopover();
    function place() {
      const anchor = trigger.getBoundingClientRect(), gap = 8, edge = 12;
      element.style.maxHeight = '';
      const below = window.innerHeight - anchor.bottom - gap - edge, above = anchor.top - gap - edge;
      const up = element.offsetHeight > below && above > below;
      element.style.maxHeight = `${Math.max(0, Math.min(440, up ? above : below))}px`;
      element.style.left = `${Math.max(edge, Math.min(anchor.right - element.offsetWidth, window.innerWidth - element.offsetWidth - edge))}px`;
      element.style.top = `${up ? anchor.top - element.offsetHeight - gap : anchor.bottom + gap}px`;
    }
    place();
    element.querySelector<HTMLButtonElement>('.dashboard-catalog-nav [aria-pressed="true"]')?.focus({ preventScroll: true });
    const openedAt = trigger.getBoundingClientRect();
    const pointer = (event: globalThis.PointerEvent) => { if (!element.contains(event.target as Node) && !trigger.contains(event.target as Node)) close(); };
    const escape = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); trigger.focus({ preventScroll: true }); } };
    const scroll = (event: Event) => {
      if (element.contains(event.target as Node)) return;
      const anchor = trigger.getBoundingClientRect();
      if (Math.abs(anchor.top - openedAt.top) > 1 || Math.abs(anchor.left - openedAt.left) > 1) close();
    };
    const observer = new ResizeObserver(place);
    observer.observe(element); observer.observe(trigger.closest('.content')!);
    document.addEventListener('pointerdown', pointer);
    window.addEventListener('keydown', escape, true);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', scroll, true);
    return () => {
      observer.disconnect();
      document.removeEventListener('pointerdown', pointer);
      window.removeEventListener('keydown', escape, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', scroll, true);
      if (element.matches(':popover-open')) element.hidePopover();
    };
  }, [trigger]);
  function update(patch: Partial<DashboardWidget>, key = id) {
    setChoices(current => ({ ...current, [key]: { ...current[key], ...patch } })); setId(key);
  }
  function preview(widget: DashboardWidget) {
    if (widget.id === 'today') return widget.style === 'counts' ? <ScheduleStatsContent data={data} clock={clock} navigate={noAction} /> : <TodayContent data={data} clock={clock} navigate={noAction} />;
    return <HomeQuotaContent {...quota} clock={clock} />;
  }
  return <div ref={panel} id={panelId} className="dashboard-catalog-popover" popover="manual" role="dialog" aria-label="添加卡片">
    <header className="dashboard-catalog-heading"><h2>添加卡片</h2><IconButton label="关闭" onClick={dismiss}><X size={18} /></IconButton></header>
    <div className="dashboard-catalog"><nav className="dashboard-catalog-nav" aria-label="卡片类型">{CATALOG_IDS.map(key => { const Icon = widgetIcons[key]; return <button key={key} type="button" aria-pressed={id === key} onClick={() => setId(key)}><Icon size={18} />{widgetNames[key]}</button>; })}</nav>
      <div className="dashboard-catalog-content"><h3>{name}</h3><div className="dashboard-style-options" style={{ '--style-count': styles.length } as CSSProperties} role="group" aria-label="展示样式">{styles.map(style => {
        const key = id, widget = { ...choices[key], style };
        return <div className="dashboard-style-option" key={style}><DashboardPreview widget={widget} grid={grid}>{preview(widget)}</DashboardPreview><button className="dashboard-style-choice" type="button" aria-label={`${name}，${styleNames[style]}样式`} aria-pressed={selected.style === style} onClick={() => update({ style }, key)}><span>{styleNames[style]}</span><CheckCircle size={15} weight="fill" aria-hidden="true" /></button></div>;
      })}</div>
        {sourceError ? <p className="field-error" role="alert">{sourceError}</p> : null}
        <div className="dashboard-size-controls"><div><span>卡片宽度</span><Segmented aria-label="卡片宽度" value={String(selected.width)} onChange={value => update({ width: Number(value) as WidgetWidth })} options={widthOptions} /></div><div><span>卡片高度</span><Segmented aria-label="卡片高度" value={String(selected.rows)} onChange={value => update({ rows: Number(value) as DashboardWidget['rows'] })} options={rowOptions} /></div></div>
      </div>
    </div><div className="dashboard-catalog-actions"><button type="button" className="btn btn-sec btn-sm" onClick={dismiss}>取消</button><button type="button" className="btn btn-pri btn-sm" onClick={() => apply(selected)}>{exists ? '应用设置' : '添加到看板'}</button></div>
  </div>;
}

export function HomeView({ data, clock, userName, onNavigate, onPending }: {
  data: TodoState | null; clock: Date; userName: string; onNavigate(view: ViewId): void; onPending(message: string): void;
}) {
  const [saved, setSaved] = useState(() => { try { return readDashboard(localStorage.getItem(DASHBOARD_KEY)); } catch { return defaultDashboard(); } });
  const [draft, setDraft] = useState<DashboardLayout | null>(null), [catalog, setCatalog] = useState<{ initial: CatalogWidgetId; trigger: HTMLButtonElement } | null>(null);
  const catalogId = useId();
  const addButton = useRef<HTMLButtonElement>(null);
  const [dragged, setDragged] = useState<WidgetId | null>(null), [dropTarget, setDropTarget] = useState<WidgetId | null>(null), [announcement, setAnnouncement] = useState('');
  const [gapTarget, setGapTarget] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const dragOrigin = useRef({ x: 0, y: 0 });
  const [canvas, setCanvas] = useState<{ width: number; columns: number; step: number; base: number; gap: number } | null>(null);
  const resizing = useRef<{ widget: DashboardWidget; anchor: DashboardWidget; edge: ResizeEdge; handle: HTMLButtonElement; pointerId: number; origin: number; pixels: number; value: number; stops: { value: number; pixels: number }[] } | null>(null), grid = useRef<HTMLDivElement>(null);
  const [activeResize, setActiveResize] = useState<{ id: WidgetId; edge: ResizeEdge } | null>(null);
  useLayoutEffect(() => {
    const element = grid.current!;
    const measure = () => {
      const style = getComputedStyle(element), next = { width: element.clientWidth, columns: style.display === 'grid' ? style.gridTemplateColumns.split(' ').length : 1, step: parseFloat(style.getPropertyValue('--widget-row-step')), base: parseFloat(style.getPropertyValue('--widget-base-height')), gap: parseFloat(style.columnGap) };
      setCanvas(current => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    measure(); const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!activeResize) return;
    const cancel = (event: globalThis.KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); endResize(true); } };
    window.addEventListener('keydown', cancel, true);
    return () => window.removeEventListener('keydown', cancel, true);
  }, [activeResize]);
  const layout = draft ?? saved, editing = draft !== null;
  const positioned = layout.widgets.some(widget => widget.position), placements = canvas ? dashboardPlacements(layout.widgets, canvas.columns, canvas.step, canvas.base, canvas.gap) : [];
  const beginEdit = () => setDraft(current => current ?? structuredClone(saved));
  const changeSize = (id: WidgetId, size: Partial<Pick<DashboardWidget, 'width' | 'rows' | 'topOffset' | 'position'>>) => setDraft(current => current ? { ...current, widgets: current.widgets.map(item => item.id === id ? { ...item, ...size } : item) } : current);
  function heightAnchor(widget: DashboardWidget): DashboardWidget {
    const place = placements.find(item => item.id === widget.id);
    return positioned && canvas && place ? { ...widget, topOffset: undefined, position: { column: widget.position?.column ?? Math.round(place.column * 6 / canvas.columns), top: place.top / canvas.step } } : widget;
  }
  function changeHeight(widget: DashboardWidget, rows: WidgetRows, edge: 'top' | 'bottom') {
    const next = resizeDashboardHeight(widget, rows, edge);
    changeSize(widget.id, { rows: next.rows, topOffset: next.topOffset, position: next.position });
  }
  function openCatalog(trigger: HTMLButtonElement) { if (catalog?.trigger === trigger) { setCatalog(null); return; } beginEdit(); setCatalog({ initial: CATALOG_IDS.find(key => !layout.widgets.some(widget => widget.id === key)) ?? 'today', trigger }); }
  function finish() {
    if (!draft) return;
    endResize();
    try { localStorage.setItem(DASHBOARD_KEY, JSON.stringify(draft)); setSaved(draft); setDraft(null); setAnnouncement('看板布局已保存'); } catch { onPending('看板布局保存失败，请重试'); }
  }
  function move(id: WidgetId, target: WidgetId) { setDraft(current => current ? moveDashboardWidget(current, id, target) : current); setAnnouncement(`${widgetNames[id]}已移动`); }
  function placeInCanvas(id: WidgetId, column: number, top: number, commit: boolean) {
    if (!canvas || !grid.current) return;
    const bounds = grid.current.getBoundingClientRect(), unit = (canvas.width + canvas.gap) / canvas.columns;
    const occupied = layout.widgets.map(widget => {
      const rect = grid.current!.querySelector<HTMLElement>(`[data-widget="${widget.id}"]`)!.getBoundingClientRect();
      return { id: widget.id, column: Math.round((rect.left - bounds.left) / unit), span: Math.round((rect.width + canvas.gap) / unit), top: rect.top - bounds.top, height: rect.height };
    });
    const source = occupied.find(item => item.id === id)!;
    const slot = findDashboardSlot(Math.max(0, Math.min(canvas.columns - source.span, column)), Math.max(0, top), source.span, source.height, occupied.filter(item => item.id !== id), canvas.gap);
    if (commit) {
      const widgets = layout.widgets.map(widget => {
        if (widget.id !== id && widget.position) return widget;
        const point = widget.id === id ? slot : occupied.find(item => item.id === widget.id)!;
        return { ...widget, topOffset: undefined, position: { column: Math.round(point.column * 6 / canvas.columns), top: Math.round(point.top / canvas.step * 10000) / 10000 } };
      }).sort((a, b) => a.position!.top - b.position!.top || a.position!.column - b.position!.column);
      setDraft(current => current ? { ...current, widgets } : current); setAnnouncement(`${widgetNames[id]}已放置，点击完成保存布局`); setDragged(null); setDropTarget(null); setGapTarget(null);
    } else {
      const width = unit * source.span - canvas.gap;
      setDropTarget(null); setGapTarget({ left: slot.column * unit + width / 2, top: slot.top + source.height / 2, width, height: source.height });
    }
  }
  function dropInGap(event: DragEvent<HTMLDivElement>, commit = false) {
    const target = (event.target as Element).closest<HTMLElement>('.dashboard-widget');
    if (!dragged || !canvas || (target && target.dataset.widget !== dragged)) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect(), unit = (canvas.width + canvas.gap) / canvas.columns;
    placeInCanvas(dragged, Math.round((event.clientX - bounds.left - dragOrigin.current.x) / unit), Math.round((event.clientY - bounds.top - dragOrigin.current.y) / canvas.step) * canvas.step, commit);
  }
  function moveByKey(event: KeyboardEvent, id: WidgetId) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    if (event.altKey && canvas && grid.current) {
      event.preventDefault(); const bounds = grid.current.getBoundingClientRect(), rect = grid.current.querySelector<HTMLElement>(`[data-widget="${id}"]`)!.getBoundingClientRect();
      placeInCanvas(id, Math.round((rect.left - bounds.left) / ((canvas.width + canvas.gap) / canvas.columns)) + (event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0), (Math.round((rect.top - bounds.top) / canvas.step) + (event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0)) * canvas.step, true); return;
    }
    event.preventDefault(); const index = layout.widgets.findIndex(item => item.id === id), delta = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
    const target = layout.widgets[index + delta]; if (target) move(id, target.id);
  }
  function heightStops(widget: DashboardWidget, edge: ResizeEdge) {
    return WIDGET_ROWS.filter(value => {
      if (edge !== 'top') return true;
      const place = placements.find(item => item.id === widget.id);
      if (value > widget.rows + (positioned && canvas && place ? place.top / canvas.step : widget.topOffset ?? 0)) return false;
      if (!positioned || !canvas || !place || value <= widget.rows) return true;
      const top = place.top - (value - widget.rows) * canvas.step;
      return findDashboardSlot(place.column, top, place.span, canvas.base + value * canvas.step, placements.filter(item => item.id !== widget.id), canvas.gap).top === top;
    });
  }
  function startResize(event: PointerEvent<HTMLButtonElement>, widget: DashboardWidget, edge: ResizeEdge) {
    if (event.button !== 0 || !grid.current || resizing.current) return;
    event.preventDefault(); event.currentTarget.focus({ preventScroll: true });
    const card = event.currentTarget.closest<HTMLElement>('.dashboard-widget')!, rect = card.getBoundingClientRect();
    const horizontal = edge === 'left' || edge === 'right', step = parseFloat(getComputedStyle(card).getPropertyValue('--widget-row-step'));
    const stops = horizontal ? WIDGET_WIDTHS.map(value => ({ value, pixels: widgetPixelWidth(grid.current!, value) })) : heightStops(widget, edge).map(value => ({ value, pixels: rect.height + (value - widget.rows) * step }));
    resizing.current = { widget, anchor: heightAnchor(widget), edge, handle: event.currentTarget, pointerId: event.pointerId, origin: horizontal ? event.clientX : event.clientY, pixels: horizontal ? rect.width : rect.height, value: horizontal ? widget.width : widget.rows, stops };
    event.currentTarget.setPointerCapture(event.pointerId); setActiveResize({ id: widget.id, edge });
  }
  function resize(event: PointerEvent<HTMLButtonElement>) {
    const current = resizing.current; if (!current || current.pointerId !== event.pointerId) return;
    const horizontal = current.edge === 'left' || current.edge === 'right', sign = current.edge === 'left' || current.edge === 'top' ? -1 : 1;
    const desired = current.pixels + ((horizontal ? event.clientX : event.clientY) - current.origin) * sign;
    const original = current.stops.find(stop => stop.value === (horizontal ? current.widget.width : current.widget.rows))!;
    const next = current.stops.reduce((a, b) => Math.abs(b.pixels - desired) < Math.abs(a.pixels - desired) ? b : a, original).value;
    if (next === current.value) return;
    current.value = next;
    if (horizontal) changeSize(current.widget.id, { width: next as WidgetWidth }); else changeHeight(next === current.widget.rows ? current.widget : current.anchor, next as WidgetRows, current.edge as 'top' | 'bottom');
  }
  function endResize(cancel = false) {
    const current = resizing.current; if (!current) return;
    resizing.current = null; setActiveResize(null);
    const horizontal = current.edge === 'left' || current.edge === 'right';
    if (cancel) changeSize(current.widget.id, { width: current.widget.width, rows: current.widget.rows, topOffset: current.widget.topOffset, position: current.widget.position });
    if (current.handle.hasPointerCapture(current.pointerId)) current.handle.releasePointerCapture(current.pointerId);
    setAnnouncement(cancel ? '已撤销本次尺寸调整' : `${widgetNames[current.widget.id]}尺寸：${horizontal ? current.value : current.widget.width}列 × ${horizontal ? current.widget.rows : current.value}行，点击完成保存布局`);
  }
  function resizeByKey(event: KeyboardEvent<HTMLButtonElement>, widget: DashboardWidget, edge: ResizeEdge) {
    if (event.key === 'Escape' && resizing.current) { event.preventDefault(); event.stopPropagation(); endResize(true); return; }
    if (resizing.current) return;
    const horizontal = edge === 'left' || edge === 'right', keys = horizontal ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    if (![...keys, 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const stops: readonly number[] = horizontal ? WIDGET_WIDTHS : heightStops(widget, edge);
    const index = stops.indexOf(horizontal ? widget.width : widget.rows);
    const next = stops[event.key === 'Home' ? 0 : event.key === 'End' ? stops.length - 1 : Math.max(0, Math.min(stops.length - 1, index + (event.key === keys[1] ? 1 : -1)))];
    if (horizontal) changeSize(widget.id, { width: next as WidgetWidth }); else changeHeight(heightAnchor(widget), next as WidgetRows, edge as 'top' | 'bottom');
  }
  function body(widget: DashboardWidget): ReactNode {
    if (widget.id === 'today') return widget.style === 'counts' ? <ScheduleStatsContent data={data} clock={clock} navigate={() => onNavigate('todo')} /> : <TodayContent data={data} clock={clock} navigate={() => onNavigate('todo')} />;
    return <HomeQuotaCard clock={clock} />;
  }
  const hour = clock.getHours(), greeting = hour < 5 ? '夜深了' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';
  return <section className="home-dashboard on" id="view-home" data-editing={editing}>
    <header className="dashboard-heading"><div><h1>{userName.trim() ? `${userName.trim()}的看板` : '我的看板'}<span className="dashboard-edit-label" aria-hidden={!editing}><PencilSimple size={13} />编辑布局</span></h1><p>{clock.getMonth() + 1}月{clock.getDate()}日 {['周日', '周一', '周二', '周三', '周四', '周五', '周六'][clock.getDay()]} · {greeting}{userName.trim() ? `，${userName.trim()}` : ''}</p></div><div className="dashboard-heading-actions"><button ref={addButton} className={`btn ${editing ? 'btn-sec' : 'btn-pri'}`} aria-haspopup="dialog" aria-expanded={catalog !== null} aria-controls={catalog ? catalogId : undefined} onClick={event => openCatalog(event.currentTarget)}><Plus size={16} />添加卡片</button>{editing ? <><button className="btn btn-sec" onClick={() => { endResize(true); setDraft(null); setDragged(null); setDropTarget(null); }}>取消</button><button className="btn btn-pri" onClick={finish}>完成</button></> : <button className="btn btn-sec" onClick={beginEdit}><PencilSimple size={16} />编辑布局</button>}</div></header>
    <div ref={grid} className="dashboard-grid" data-positioned={positioned} style={positioned ? { minHeight: Math.max(0, ...placements.map(item => item.top + item.height)) } : undefined} onDragOver={event => dropInGap(event)} onDrop={event => dropInGap(event, true)} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setGapTarget(null); }}>{layout.widgets.map(widget => {
      const { id, width, rows, style } = widget;
      const place = positioned ? placements.find(item => item.id === id) : undefined;
      return <DashboardCard key={id} widget={widget} data-dragging={dragged === id} data-drop-target={dropTarget === id} data-resizing={activeResize?.id === id}
        style={place && canvas ? { left: (canvas.width + canvas.gap) * place.column / canvas.columns, top: place.top, width: (canvas.width + canvas.gap) * place.span / canvas.columns - canvas.gap } : undefined}
        onDragOver={event => { if (dragged && dragged !== id) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDropTarget(id); setGapTarget(null); } }} onDrop={event => { if (dragged === id) return; event.preventDefault(); event.stopPropagation(); if (dragged) move(dragged, id); setDragged(null); setDropTarget(null); setGapTarget(null); }}
        drag={editing ? <button className="dashboard-drag" draggable aria-label={`移动${widgetNames[id]}卡片`} title="拖动放置；方向键排序；Alt＋方向键移到空白网格" onKeyDown={event => moveByKey(event, id)} onDragStart={event => { const rect = event.currentTarget.closest('.dashboard-widget')!.getBoundingClientRect(); dragOrigin.current = { x: event.clientX - rect.left, y: event.clientY - rect.top }; event.dataTransfer.setData('text/plain', id); event.dataTransfer.effectAllowed = 'move'; setDragged(id); }} onDragEnd={() => { setDragged(null); setDropTarget(null); setGapTarget(null); }}><DotsSixVertical size={19} /></button> : undefined}
        tools={<><span className="dashboard-style-control" aria-hidden={!editing}><GameOptionsMenu kind="dashboard" active={editing} context={style} label={`更换${widgetNames[id]}卡片样式`} disabled={!editing || !WIDGET_STYLES[id].some(option => option !== style)}>{close => <>
          <div className="dashboard-style-menu-title">更换样式</div><div className="dashboard-style-options" style={{ '--style-count': WIDGET_STYLES[id].length } as CSSProperties} role="group" aria-label="展示样式">{WIDGET_STYLES[id].map(option => {
            const preview = { ...widget, style: option };
            return <div className="dashboard-style-option" key={option}>
              <DashboardPreview widget={preview} grid={grid.current!}>{body(preview)}</DashboardPreview>
              <button className="dashboard-style-choice" type="button" role="menuitemradio" aria-label={`${widgetNames[id]}，${styleNames[option]}样式`} aria-checked={option === style} onClick={() => { setDraft(current => current ? { ...current, widgets: current.widgets.map(item => item.id === id ? { ...item, style: option } : item) } : current); setAnnouncement(`${widgetNames[id]}已切换为${styleNames[option]}，点击完成保存布局`); close(); }}><span>{styleNames[option]}</span><CheckCircle size={15} weight="fill" aria-hidden="true" /></button>
            </div>;
          })}</div>
        </>}</GameOptionsMenu></span><button className="ibtn dashboard-remove" disabled={!editing} aria-hidden={!editing} aria-label={`移除${widgetNames[id]}卡片`} title="从看板移除" onClick={() => setDraft(current => current ? { ...current, widgets: current.widgets.filter(item => item.id !== id) } : current)}><X size={16} /></button></>}
        resize={editing ? <>{(Object.entries(resizeEdges) as [ResizeEdge, string][]).map(([edge, label]) => {
          const horizontal = edge === 'left' || edge === 'right';
          return <button key={edge} type="button" className="dashboard-resize" data-edge={edge} data-active={activeResize?.id === id && activeResize.edge === edge} role="slider" aria-label={`${widgetNames[id]}卡片${horizontal ? '宽度' : '高度'}，${label}边缘`} aria-orientation={horizontal ? 'horizontal' : 'vertical'} aria-valuemin={horizontal ? 2 : 1} aria-valuemax={horizontal ? 6 : heightStops(widget, edge).at(-1)} aria-valuenow={horizontal ? width : rows} aria-valuetext={horizontal ? `${width}列` : `${rows}行`} title={horizontal ? `拖动${label}边调整宽度：2／3／4／6列；支持左右键及 Home／End` : `拖动${label}边调整高度：1／2／3／4行；支持上下键及 Home／End`} onPointerDown={event => startResize(event, widget, edge)} onPointerMove={resize} onPointerUp={() => endResize()} onPointerCancel={() => endResize(true)} onLostPointerCapture={() => endResize(true)} onKeyDown={event => resizeByKey(event, widget, edge)} />;
        })}{activeResize?.id === id ? <span className="dashboard-resize-hint" aria-hidden="true">{width}列 × {rows}行</span> : null}</> : undefined}>{body(widget)}</DashboardCard>;
    })}{gapTarget ? <span className="dashboard-gap-target" data-slot={!!gapTarget.width} aria-hidden="true" style={gapTarget}>松开放置</span> : null}</div>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    {catalog ? <DashboardCatalog initial={catalog.initial} trigger={catalog.trigger} panelId={catalogId} grid={grid.current!} layout={layout} data={data} clock={clock} close={() => setCatalog(null)} apply={widget => { setDraft(current => current ? { widgets: current.widgets.some(item => item.id === widget.id) ? current.widgets.map(item => item.id === widget.id ? widget : item) : [...current.widgets, widget] } : current); setCatalog(null); setAnnouncement(`${widgetNames[widget.id]}卡片设置已应用，点击完成保存布局`); requestAnimationFrame(() => addButton.current?.focus({ preventScroll: true })); }} /> : null}
  </section>;
}
