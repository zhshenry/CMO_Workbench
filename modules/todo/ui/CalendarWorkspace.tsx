import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { CalendarBlank, CaretLeft, CaretRight, CheckSquare } from '@phosphor-icons/react';
import { hasTaskTime, localDay, type Task } from '../../../shared/todo-contracts';
import { dateText, dateTimeText, meetingEndAt, scheduleStamp, scheduledInRange, scheduleTimeRange, timeText } from '../../../shared/todo-format';
import { DatePicker, Segmented } from './ui';
import './calendar-workspace.css';

export type ScheduleTab = 'calendar' | 'todo' | 'records';

export interface ScheduleNavigation {
  tab: ScheduleTab;
  onTab(tab: ScheduleTab): void;
  details(task: Task): ReactNode;
  records?: ReactNode;
}

const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const dayModes = [{ value: 'day', label: '日' }, { value: 'week', label: '周' }];
const minutesPerDay = 24 * 60;

function shiftDay(day: string, days: number) {
  const date = new Date(day + 'T12:00:00');
  date.setDate(date.getDate() + days);
  return localDay(date);
}

function calendarDateText(day: string) {
  return Number(day.slice(5, 7)) + '月' + Number(day.slice(-2)) + '日';
}

function meetingStamp(task: Task) {
  if (!hasTaskTime(task.dateAt) || !task.endAt) return scheduleStamp(task);
  const start = localDay(new Date(task.dateAt));
  if (task.external?.isAllDay) {
    const lastDay = localDay(new Date(Date.parse(task.endAt) - 1));
    return start === lastDay ? scheduleStamp(task) : dateText(start) + '—' + dateText(lastDay) + ' · 全天';
  }
  return start === localDay(new Date(task.endAt)) ? scheduleStamp(task) : dateTimeText(task.dateAt) + ' — ' + dateTimeText(task.endAt);
}

function minutesAt(time: number) {
  const date = new Date(time);
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

type TimeBlock = { task: Task; start: number; end: number; drawnEnd: number; lane: number; lanes: number };

function calendarDay(day: string, meetings: Task[]) {
  const allDay: Task[] = [];
  const blocks: TimeBlock[] = [];
  const dayStart = Date.parse(day + 'T00:00:00');
  const nextStart = Date.parse(shiftDay(day, 1) + 'T00:00:00');

  for (const task of meetings) {
    if (!scheduledInRange(task, day)) continue;
    const endAt = meetingEndAt(task);
    if (task.external?.isAllDay || !hasTaskTime(task.dateAt) || !endAt) {
      allDay.push(task);
      continue;
    }
    const start = Date.parse(task.dateAt) <= dayStart ? 0 : minutesAt(Date.parse(task.dateAt));
    const end = Date.parse(endAt) >= nextStart ? minutesPerDay : minutesAt(Date.parse(endAt));
    // Short meetings still get a readable title, so the extra height counts toward overlap.
    const drawnEnd = Math.min(minutesPerDay, Math.max(end, start + 36));
    blocks.push({ task, start, end, drawnEnd, lane: 0, lanes: 1 });
  }

  blocks.sort((a, b) => a.start - b.start || b.end - a.end);
  let cluster: TimeBlock[] = [], laneEnds: number[] = [];
  function finishCluster() {
    for (const block of cluster) block.lanes = laneEnds.length;
    cluster = [];
    laneEnds = [];
  }
  for (const block of blocks) {
    if (laneEnds.every(end => end <= block.start)) finishCluster();
    const lane = laneEnds.findIndex(end => end <= block.start);
    block.lane = lane < 0 ? laneEnds.length : lane;
    laneEnds[block.lane] = block.drawnEnd;
    cluster.push(block);
  }
  finishCluster();
  return { day, allDay, blocks };
}

type MeetingSource = { meetings: Task[]; mergeMeetings?(items: Task[]): Task[] };

export function CalendarWorkspace({ tab, onTab, details, records, meetings, mergeMeetings, today, todoCount, todo }: ScheduleNavigation & MeetingSource & {
  today: string; todoCount: number; todo: ReactNode;
}) {
  const todoTab = useRef<HTMLButtonElement>(null);

  return <div className="today-board calendar-board">
    <nav className="calendar-tabs" aria-label="日程待办视图">
      <button type="button" aria-pressed={tab === 'calendar'} onClick={() => onTab('calendar')}>日程</button>
      <button ref={todoTab} type="button" aria-pressed={tab === 'todo'} onClick={() => onTab('todo')}>待办</button>
      {records && <button type="button" aria-pressed={tab === 'records'} onClick={() => onTab('records')}>会议记录</button>}
    </nav>
    <div className="calendar-tab-panel calendar-overview" hidden={tab !== 'calendar'}>
      <WeekCalendar meetings={meetings} mergeMeetings={mergeMeetings} today={today} details={details} />
      <div className="calendar-footer">
        <button type="button" className="calendar-todo-shortcut" onClick={() => { onTab('todo'); todoTab.current?.focus(); }}>
          <CheckSquare size={17} aria-hidden="true" />待办 {todoCount} 项<CaretRight size={13} aria-hidden="true" />
        </button>
      </div>
    </div>
    <div className="calendar-tab-panel calendar-todos" hidden={tab !== 'todo'}>{todo}</div>
    {records && <div className="calendar-tab-panel" hidden={tab !== 'records'}>{records}</div>}
  </div>;
}

function WeekCalendar({ meetings, mergeMeetings, today, details }: MeetingSource & { today: string; details: ScheduleNavigation['details'] }) {
  const [view, setView] = useState<'day' | 'week'>('week');
  const [pickedDay, setPickedDay] = useState<string | null>(null);
  const [selection, setSelection] = useState<{ id: string; day: string } | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null), back = useRef<HTMLButtonElement>(null);
  const dateHeaders = useRef<HTMLDivElement>(null), eventButton = useRef<HTMLButtonElement | null>(null);
  const viewport = useRef<HTMLDivElement>(null), returnScroll = useRef(0);
  const detailId = useId();
  const day = pickedDay ?? today;
  const date = new Date(day + 'T12:00:00');
  const weekDay = (date.getDay() + 6) % 7;
  const week = weekdays.map((_, index) => shiftDay(day, index - weekDay));
  const days = view === 'week' ? week : [day];
  const inRange = meetings.filter(task => scheduledInRange(task, days[0], days[days.length - 1]));
  const visibleMeetings = mergeMeetings?.(inRange) ?? inRange;
  const columns = days.map(value => calendarDay(value, visibleMeetings));
  const visible = columns.flatMap(column => [...column.allDay, ...column.blocks.map(block => block.task)]
    .map(task => ({ day: column.day, task })));
  const selected = visible.find(entry => entry.task.id === selection?.id && entry.day === selection.day)
    ?? visible.find(entry => entry.day === day) ?? visible[0];
  const hasAllDay = columns.some(column => column.allDay.length > 0);
  let firstHour = 8, lastHour = 18;
  for (const { blocks } of columns) for (const block of blocks) {
    firstHour = Math.min(firstHour, Math.floor(block.start / 60));
    lastHour = Math.max(lastHour, Math.ceil(block.drawnEnd / 60));
  }
  const hours = Array.from({ length: lastHour - firstHour }, (_, index) => firstHour + index);
  const end = week[6];
  const sameMonth = week[0].slice(0, 7) === end.slice(0, 7);
  const sameYear = week[0].slice(0, 4) === end.slice(0, 4);
  const rangeEnd = sameMonth ? Number(end.slice(-2)) + '日' : calendarDateText(end);
  const range = calendarDateText(week[0]) + '—' + (sameYear ? '' : end.slice(0, 4) + '年') + rangeEnd;

  function moveTo(value: string) {
    setPickedDay(value === today ? null : value);
    setSelection(null);
    setDetailOpen(false);
    if (viewport.current) viewport.current.scrollTop = 0;
  }
  function moveDateByKey(event: KeyboardEvent<HTMLButtonElement>, value: string, index: number) {
    const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, Home: -index, End: 6 - index };
    const offset = offsets[event.key];
    if (offset === undefined) return;
    event.preventDefault();
    const next = shiftDay(value, offset);
    moveTo(next);
    requestAnimationFrame(() => dateHeaders.current?.querySelector<HTMLButtonElement>('[data-date="' + next + '"]')?.focus());
  }
  function openDetail(task: Task, value: string, button: HTMLButtonElement) {
    eventButton.current = button;
    returnScroll.current = viewport.current?.scrollTop ?? 0;
    setSelection({ id: task.id, day: value });
    setDetailOpen(true);
    requestAnimationFrame(() => {
      if (back.current?.getClientRects().length) heading.current?.focus({ preventScroll: true });
    });
  }
  function backToCalendar() {
    setDetailOpen(false);
    requestAnimationFrame(() => {
      if (viewport.current) viewport.current.scrollTop = returnScroll.current;
      if (eventButton.current?.isConnected) eventButton.current.focus({ preventScroll: true });
    });
  }
  function event(task: Task, value: string, block?: TimeBlock) {
    const minutes = hours.length * 60;
    const area = block ? {
      '--event-y': (block.start - firstHour * 60) / minutes * 100 + '%',
      '--event-height': (block.drawnEnd - block.start) / minutes * 100 + '%',
      '--event-x': block.lane / block.lanes * 100 + '%',
      '--event-width': 100 / block.lanes + '%',
    } as CSSProperties : undefined;
    return <button key={task.id} type="button" style={area}
      className={block ? 'calendar-event is-timed' : 'calendar-event'}
      data-task-id={task.id} aria-controls={detailId}
      aria-label={'查看日程 ' + task.title + '，' + scheduleTimeRange(task)}
      aria-pressed={task.id === selected?.task.id && value === selected.day}
      title={task.title + ' · ' + scheduleTimeRange(task)}
      onClick={e => openDetail(task, value, e.currentTarget)}>
      {block && block.end - block.start >= 60 && <span className="calendar-event-time">{block.start === 0 ? '00:00' : timeText(task.dateAt)}</span>}
      <span className="calendar-event-title">{task.title}</span>
    </button>;
  }
  return <section className="calendar-workspace" aria-label="日程" data-detail-open={detailOpen}>
    <div className="calendar-main">
      <header className="calendar-toolbar">
        <div className="calendar-pager">
          <button type="button" className="calendar-step" aria-label={view === 'week' ? '上一周' : '上一天'} onClick={() => moveTo(shiftDay(day, view === 'week' ? -7 : -1))}><CaretLeft size={16} /></button>
          <DatePicker aria-label="选择日程日期" value={day} clearable={false}
            yearRange={{ min: Math.min(2000, date.getFullYear()), max: Math.max(2100, date.getFullYear()) }}
            triggerContent={<span>{view === 'week' ? range : calendarDateText(day) + ' 周' + weekdays[weekDay]}</span>}
            onChange={value => moveTo(value || today)} />
          <button type="button" className="calendar-step" aria-label={view === 'week' ? '下一周' : '下一天'} onClick={() => moveTo(shiftDay(day, view === 'week' ? 7 : 1))}><CaretRight size={16} /></button>
        </div>
        <div className="calendar-quick">
          <button type="button" className="calendar-today" onClick={() => moveTo(today)}>今天</button>
          <Segmented aria-label="日程显示方式" value={view} options={dayModes} onChange={value => { setView(value === 'day' ? 'day' : 'week'); setDetailOpen(false); }} />
        </div>
      </header>
      <div className="calendar-viewport" ref={viewport} role="region" aria-label={view === 'week' ? '周历' : '单日日历'}
        style={{ '--calendar-days': days.length } as CSSProperties}>
        <div ref={dateHeaders} className="calendar-date-headers">
          <span aria-hidden="true" />
          {columns.map(column => <button key={column.day} type="button" data-date={column.day}
            aria-label={column.day} aria-current={column.day === today ? 'date' : undefined}
            aria-pressed={column.day === day}
            onClick={() => { moveTo(column.day); setView('day'); }}
            onKeyDown={event => moveDateByKey(event, column.day, week.indexOf(column.day))}>
            <span>周{weekdays[week.indexOf(column.day)]}</span>
            <strong>{Number(column.day.slice(-2))}{column.day === today && <small> 今天</small>}</strong>
          </button>)}
        </div>
        {hasAllDay && <div className="calendar-all-day">
          <span className="calendar-clock">全天</span>
          {columns.map(column => <div key={column.day} className="calendar-all-day-column" data-today={column.day === today}>
            {column.allDay.map(task => event(task, column.day))}
          </div>)}
        </div>}
        <div className="calendar-hours">
          <div className="calendar-clock">
            {hours.map(hour => <div key={hour}>{String(hour).padStart(2, '0')}:00</div>)}
          </div>
          {columns.map(column => <div key={column.day} className="calendar-day-column" data-today={column.day === today}>
            {column.blocks.map(block => event(block.task, column.day, block))}
          </div>)}
          {!visible.length && <p className="calendar-empty">{view === 'week' ? '本周没有日程' : '当天没有日程'}</p>}
        </div>
      </div>
    </div>
    <aside className="calendar-detail" id={detailId} aria-label="日程详情" onKeyDown={event => {
      if (event.key === 'Escape' && back.current?.getClientRects().length) { event.stopPropagation(); backToCalendar(); }
    }}>
      <button ref={back} type="button" className="calendar-back" onClick={backToCalendar}><CaretLeft size={15} />{view === 'week' ? '返回周历' : '返回日历'}</button>
      {selected ? <>
        <h2 ref={heading} tabIndex={-1}>{selected.task.title}</h2>
        <p className="calendar-detail-time"><CalendarBlank aria-hidden="true" size={17} />{meetingStamp(selected.task)}</p>
        {details(selected.task)}
        {selected.task.note && <p className="calendar-detail-note">{selected.task.note}</p>}
      </> : <p className="calendar-detail-empty">选择一项日程查看详情。</p>}
    </aside>
  </section>;
}
