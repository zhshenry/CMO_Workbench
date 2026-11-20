import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { WelinkMessage } from '../shared/welink-reminders';

type Action = { verb: string; object: string; text: string };
type Commitment = { message: WelinkMessage; evidence: string; timing: string; action: Action; context?: string; completedBy?: WelinkMessage };
type Unclear = { key: string; evidence: string; context: WelinkMessage[] };
export const welinkCommitmentReviewSchema = z.object({
  sourceId: z.string().regex(/^\d+$/),
  verb: z.string().trim().min(1).max(12),
  object: z.string().trim().min(1).max(100),
}).strict().nullable();
export type WelinkCommitmentReviews = Readonly<Record<string, z.infer<typeof welinkCommitmentReviewSchema>>>;

const actor = '(?:我(?:这边|这里|本人)?(?!们|的|方|司)|这边)';
const date = '(?:(?:下周|本周|这周|周|星期)[一二三四五六日天]|今[天晚早]|明[天晚早]|后天|(?:20\\d{2}[年/-])?\\d{1,2}[月/-]\\d{1,2}日?)';
const time = `(?:${date}(?:之前|以前|前)?|(?:上午|下午|晚上|中午|凌晨)?\\d{1,2}(?:[:：]\\d{2}|点(?:半|\\d{1,2}分)?)(?:之前|以前|前)?|上午|下午|晚上|中午|本周|这周|下周|月底|会后|下班前|晚点|稍后|尽快|马上|一会儿)`;
const self = new RegExp(`^(?:好的?|那就|那|没问题|收到|行|可以)?\\s*${actor}\\s*`);
const timing = new RegExp(`^(?:${time}\\s*)+`);
const intention = new RegExp(`^(?:${time}\\s*|会|来(?=\\S)|将|就|先|再|答应|保证)+`);
const verbs = '提交|补充|补齐|补上|发送|发给|发到|发个|发份|发布|确认|更新|整理|提供|交付|完成|回复|核对|安排|负责|同步|处理|准备|修改|修复|检查|汇总|跟进|看一下';
const actions = new RegExp(`^(?:${verbs})`);
const objectFirst = new RegExp(`^把(.+?)(${verbs}|发|给|补|写)(?:(?:给|到)?(?:你|您|大家|群里|群|客户))?(?:一下|好|完)?$`);
const finishedAction = new RegExp(`^(${verbs}|发|给|补|写)(?:了|过)`);
const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const conditional = /^(?:如果|要是|假如|等有空|视情况)/;
const pendingAlternatives = /或者|还是|二选一|哪个|哪份/;
const shortAcceptance = /^(?:就|先)?(?:来负责|来处理|来|负责|接手|处理)(?:吧|就好)?$/;

function leadingVerb(text: string): string {
  const complete = actions.exec(text)?.[0];
  if (complete) return complete;
  const token = segmenter.segment(text)[Symbol.iterator]().next().value?.segment;
  return token && ['发', '给', '补', '写'].includes(token) ? token : '';
}

function workAction(value: string): Action | undefined {
  const text = value.trim().replace(/[呢吧。！!？?]+$/, '');
  const rearranged = objectFirst.exec(text);
  const verb = rearranged?.[2] ?? leadingVerb(text);
  if (!verb || pendingAlternatives.test(text)) return;
  const object = (rearranged?.[1] ?? text.slice(verb.length)).trim()
    .replace(/^(?:给你|给您|给大家|到群里|到群|你|您|给|到)\s*/, '')
    .replace(/^(?:这|那|一)(?:个|份|封|张|条)\s*/, '')
    .replace(/(?:给你|给您|给大家|到群里|到群)$/, '');
  if (!object || /^(?:的|了|过)|(?:了|过)$/.test(object) || /^(?:它|这个|那个|一下|这件事)$/.test(object)) return;
  return { verb, object, text };
}

function undertaking(text: string): { evidence: string; timing: string; action?: Action } | undefined {
  let unclear: { evidence: string; timing: string } | undefined;
  for (const sentence of text.match(/[^。；;！!？?\n]+[。；;！!？?]?/g) ?? []) {
    if (/[?？]$/.test(sentence.trim())) continue;
    for (const raw of sentence.replace(/[。；;！!\s]+$/, '').split(/[，,]/)) {
      const evidence = raw.trim();
      if (conditional.test(evidence)) break;
      const spoken = evidence.replace(timing, '');
      const prefix = self.exec(spoken);
      if (!prefix) continue;
      const rest = spoken.slice(prefix[0].length);
      // A past result or another person's action is never a new promise.
      if (/^(?:已经|已|刚刚?|昨天|昨晚|之前|看到|看见|听说|发现|认为|觉得|建议|可能|尽量|争取|不一定|不会|不能|无法|取消)/.test(rest.replace(timing, ''))) continue;
      const action = workAction(rest.replace(intention, '').trim());
      if (action) return { evidence, action, timing: evidence.slice(0, evidence.lastIndexOf(action.text)) };
      if (shortAcceptance.test(rest.replace(timing, '').trim())) unclear ??= { evidence, timing: evidence };
    }
  }
  return unclear;
}

function requestAction(text: string) {
  const prefix = /^(?:谁来|谁负责|谁能|(?:请|麻烦)(?:你|您|大家|谁)?|你(?:能否|能不能|可以|能|方便|来))\s*/;
  const clause = text.trim().split(/[。！!？?，,；;\n]/).filter(Boolean);
  if (clause.length !== 1 || !prefix.test(clause[0])) return;
  return workAction(clause[0].replace(prefix, '').trim().replace(timing, ''));
}

export function welinkCommitmentProof(review: z.infer<typeof welinkCommitmentReviewSchema>, context: readonly { id: string; text: string }[]) {
  if (!review) return;
  const source = context.find(row => row.id === review.sourceId);
  const clause = source?.text.split(/[。；;！!？?，,\n]/).find(value => value.includes(review.object) &&
    (review.verb.length === 1 ? [...segmenter.segment(value)].some(token => token.segment === review.verb) : value.includes(review.verb)));
  const action = clause && workAction(review.verb + review.object);
  if (action && action.verb === review.verb && source) return { action, context: source.text };
}

function completion(messages: readonly WelinkMessage[], start: WelinkMessage, action: Action): WelinkMessage | undefined {
  const actionFamily = (verb: string) => /^(?:发|给|提供)/.test(verb) ? '发' : verb;
  return messages.find(message => {
    if (!message.mine) return false;
    const rest = (message.text.trim().split(/[。；;！!？?，,\n]/)[0] ?? '').replace(self, '');
    const past = /^(?:已经|已|刚刚?|昨天|昨晚)\s*/.exec(rest);
    if (!past || /^(?:完成前|发前|看到|看见|听说|发现|说|问|请|让|没|不|无法)/.test(rest.slice(past[0].length))) return false;
    const done = rest.slice(past[0].length).replace(/(?:好|完)?(?:了|过)$/, '').replace(finishedAction, '$1');
    const performed = workAction(done);
    const verb = performed?.verb ?? leadingVerb(done);
    if (!verb || actionFamily(verb) !== actionFamily(action.verb) && verb !== '完成') return false;
    return message.replyTo === start.id && !performed?.object || action.object.length >= 2 && performed?.object === action.object;
  });
}

/** Call with one chronological conversation. A review can select only a literal action from the offered context. */
export function welinkCommitments(thread: readonly WelinkMessage[], reviews: WelinkCommitmentReviews = {}) {
  const commitments: Commitment[] = [], unclear: Unclear[] = [];
  for (const [index, message] of thread.entries()) {
    if (!message.mine) continue;
    const promise = undertaking(message.text);
    if (!promise) continue;
    let action = promise.action, context: string | undefined;
    if (!action) {
      const previous = thread.slice(0, index);
      const quoted = message.replyTo && previous.find(row => row.id === message.replyTo && !row.mine);
      const nearby = quoted ? [quoted] : message.replyTo ? [] : previous.slice(-3).filter(row => !row.mine && message.at - row.at <= 10 * 60000);
      const immediate = quoted || previous.at(-1);
      const clear = immediate && nearby.includes(immediate) && requestAction(immediate.text);
      if (clear && immediate) {
        action = clear;
        context = immediate.text;
      } else if (nearby.length) {
        const key = createHash('sha256').update(JSON.stringify([message.conversation, message.id, promise.evidence, nearby.map(row => [row.id, row.text])])).digest('hex');
        if (!(key in reviews)) { unclear.push({ key, evidence: promise.evidence, context: nearby }); continue; }
        const proof = welinkCommitmentProof(reviews[key], nearby);
        if (proof) ({ action, context } = proof);
      }
    }
    if (action) commitments.push({ message, evidence: promise.evidence, timing: promise.timing, action, context,
      completedBy: completion(thread.slice(index + 1), message, action) });
  }
  return { commitments, unclear };
}
