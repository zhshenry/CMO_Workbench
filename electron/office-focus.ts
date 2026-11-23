import type { OfficeMatchRange, OfficeMaterial, OfficeMaterialFocus } from '../shared/office-workbench';
import type { WelinkMessage } from '../shared/welink-reminders';
import { welinkCommitments } from './welink-commitments';
import { welinkRequestWords } from './welink-message-reminders';

const span = (match: RegExpMatchArray): OfficeMatchRange => ({ start: match.index!, end: match.index! + match[0].length });

export function officeMessageFocus(thread: WelinkMessage[], account: string, keywords: string[]) {
  const { commitments, unclear } = welinkCommitments(thread);
  const promises = new Map([...commitments, ...unclear].map(item => [item.message.id, item.triggers]));
  const settled = new Set(commitments.filter(item => item.completedBy).map(item => item.message.id));
  const focus = new Map<string, { focus: OfficeMaterialFocus; settled?: boolean }>();
  for (const message of thread) {
    const rules: OfficeMaterialFocus['rules'] = [], text: OfficeMatchRange[] = [];
    if (!message.mine && !message.group) {
      const request = welinkRequestWords(message.text, true);
      if (request.length) { rules.push('direct-request'); text.push(...request.map(span)); }
    }
    if (!message.mine && message.group && message.atMe) {
      rules.push('mention');
      text.push(...welinkRequestWords(message.text).map(span));
      text.push(...[...message.text.matchAll(/(?<![\w@＠])[@＠]([a-z0-9_.-]+)/gi)]
        .filter(match => match[1].toLowerCase() === account.toLowerCase()).map(span));
    }
    const promise = promises.get(message.id);
    if (promise) { rules.push('commitment'); text.push(...promise); }
    if (!message.mine) for (const word of keywords) {
      if (!word) continue;
      for (let start = message.text.indexOf(word); start >= 0; start = message.text.indexOf(word, start + word.length)) {
        if (!rules.includes('keyword')) rules.push('keyword');
        text.push({ start, end: start + word.length });
      }
    }
    if (rules.length) focus.set(message.id, { focus: { rules, text }, ...(settled.has(message.id) && { settled: true }) });
  }
  return focus;
}

const mailRequest = /(请|麻烦|务必|需要您|需要你).{0,32}?(回复|确认|提交|发|补|提供|完成|处理)/g;
const meetingRequest = /(请|麻烦|务必|需要您|需要你).{0,32}?(回复|确认|提交|提供|完成|处理|准备|参加|出席|跟进)|(会前准备|会后跟进|出席确认)\s*[:：]/g;

function requestSpans(text: string, rule: RegExp) {
  return [...text.matchAll(rule)].flatMap(match => {
    const start = match.index!;
    if (match[3]) return [{ start, end: start + match[3].length }];
    const end = start + match[0].length;
    return [{ start, end: start + match[1].length }, { start: end - match[2].length, end }];
  });
}

export function officeMailFocus(row: Pick<OfficeMaterial, 'title' | 'text' | 'preview'>): OfficeMaterialFocus | undefined {
  const body = row.text || row.preview || '', bodyAt = row.title.length + 1;
  const spans = requestSpans(`${row.title}。${body.slice(0, 800)}`, mailRequest);
  if (!spans.length) return;
  const title = spans.filter(span => span.end <= row.title.length);
  const content = spans.filter(span => span.start >= bodyAt).map(span => ({ start: span.start - bodyAt, end: span.end - bodyAt }));
  return { rules: ['mail-request'], title, ...(row.text ? { text: content } : { preview: content }) };
}

export function officeMeetingFocus(row: Pick<OfficeMaterial, 'title' | 'text'>): OfficeMaterialFocus | undefined {
  const title = requestSpans(row.title, meetingRequest), text = requestSpans(row.text, meetingRequest);
  if (title.length || text.length) return { rules: ['meeting-request'], title, text };
}
