import type { WebContents } from 'electron';
import type { BrowserAutomation } from '../../electron/browser/tasks';
import type { BrowserElement, BrowserQuery, BrowserSelector, BrowserTask } from '../../shared/browser-automation-contracts';
import { browserActionSchema, browserQuerySchema } from '../../shared/browser-automation-contracts';
import { GROUP_APPLICATIONS, groupInputSchema, prepareGroup, type GroupWorkflowState } from '../../shared/permission-group-contracts';

type Confirm = (ask: { id: string; intent: string; target: string }) => Promise<'confirmed' | 'cancelled' | 'pending'>;
const css = (value: string): BrowserSelector => ({ by: 'css', value, exact: true, ignoreCase: false });
const role = (value: string, name: string): BrowserSelector => ({ by: 'role', value, name, exact: true, ignoreCase: false });
const normalize = (value: string) => value.replace(/\s+/g, '').toLowerCase();
const offeringText = (element: BrowserElement) => (element.cells?.map(cell => cell.text).join(' ') || element.name).replace(/\s*(\d{8,})$/, ' $1').trim();
const offeringName = (value: string) => normalize(value.replace(/^\[[^\]]+\]\s*/, '').replace(/\s+\d{8,}$/, ''));
const offeringId = (value: string) => value.match(/\d{8,}$/)?.[0];
class OfferingNeedsChoice extends Error {
  constructor(readonly options: string[]) {
    super('Offering 未唯一匹配：' + (options.join('；') || '未找到') + '。请确认名称或编号。');
  }
}
const personPresent = (text: string, id: string) => new RegExp(`(^|[^a-zA-Z0-9])${id}([^a-zA-Z0-9]|$)`, 'i').test(text);
const namedPersonValue = (value: string) => value.replace(/[a-zA-Z]?\d{5,10}/g, '').replace(/[;；,，\s()（）]/g, '').length > 0;
const expectedHeaders = ['群组名称', '群组描述', '群组Owner', '群组成员', '群组管理员', '群组应用类型', '有效期'];
const popup = '.el-select-dropdown,.el-autocomplete-suggestion,[role="listbox"]';
const receiptArea = '[role="alert"],[role="status"],.el-message-box,.el-message,.el-notification';
const namesGroup = (text: string, name: string) => new RegExp(`(^|[^\\p{L}\\p{N}_-])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}_-])`, 'u').test(text);
const successfulReceipt = (text: string) => /提交成功|申请已提交|申请提交成功/.test(text) && !/失败|错误|(?:未|不|没有).{0,3}(?:提交成功|申请已提交|申请提交成功)/.test(text);

/** PIC single-row workflow. All input still goes through the existing authorized browser driver. */
export class GroupWorkflow {
  private columns = new Map<string, number>();
  private table = '';
  private row = '';
  private field = '准备';
  private failures = 0;
  private confirmationCancelled = false;
  constructor(private readonly automation: BrowserAutomation, private readonly owner: WebContents, private readonly task: BrowserTask, private readonly confirm?: Confirm) {}
  private state(): GroupWorkflowState | undefined { return this.automation.taskFor(this.owner, this.task.id).permissionGroup; }
  private save(change: Partial<GroupWorkflowState>): GroupWorkflowState {
    const state = { ...this.state()!, ...change };
    this.automation.setGroupState(this.owner, this.task.id, state); return state;
  }
  private prepare(raw: unknown) {
    const parsed = prepareGroup(raw);
    if (!parsed.draft) return { status: 'needs-information', ...parsed };
    const tabs = this.automation.tabs(this.owner, this.task.id), tab = tabs.find(item => item.active) ?? tabs[0];
    if (!tab) return { status: 'blocked', error: '请先打开群组创建页面并完成登录。' };
    const previous = this.state();
    if (previous && ['submitting', 'unknown', 'submitted'].includes(previous.phase)) return { status: previous.phase, progress: previous, message: '请先读取上次提交结果，不重新填写或重复提交。' };
    if (previous?.rejectedName === `${parsed.draft.prefix}-${parsed.draft.name}`) return { status: 'needs-information', message: '该组名已被平台判定重复，请先向用户确认不同的新名称，不重复提交原名称。' };
    const unchanged = previous?.tabId === tab.id && JSON.stringify(previous.draft) === JSON.stringify(parsed.draft);
    const state: GroupWorkflowState = unchanged ? previous : { draft: parsed.draft, tabId: tab.id, phase: 'prepared', completed: [], ...(previous?.tabId === tab.id ? { rowRequested: previous.rowRequested, error: previous.error, rejectedName: previous.rejectedName, offeringLabel: previous.draft.offering === parsed.draft.offering ? previous.offeringLabel : undefined } : {}) };
    this.automation.setGroupState(this.owner, this.task.id, state);
    return { status: state.phase, progress: state, next: 'group_fill' };
  }
  private query(selector: BrowserSelector, within?: string, extra: Partial<BrowserQuery> = {}): BrowserQuery {
    return browserQuerySchema.parse({ selector, ...(within ? { within: [css(within)] } : {}), visible: true, limit: 100, textLimit: 2000, ...extra });
  }
  private async read(query: BrowserQuery) {
    const state = this.state();
    if (!state) throw new Error('建群信息尚未齐全，请调用 group_fill 传入参数。');
    this.automation.signal(this.owner, this.task.id).throwIfAborted();
    const observation = await this.automation.observe(this.owner, this.task.id, state.tabId, false, false, query, false);
    if (observation.queryIncomplete || observation.page?.nextOffset !== undefined) throw new Error('当前局部结果不完整，请缩小定位范围。');
    return observation;
  }
  private unique(elements: BrowserElement[], label: string): BrowserElement {
    if (elements.length !== 1) throw new Error(`${label}应唯一匹配，实际 ${elements.length} 项；未执行点击或填写。`);
    return elements[0];
  }
  private async action(query: BrowserQuery, action: { type: 'click' } | { type: 'fill'; text: string } | { type: 'select'; values: string[]; by: 'label' }) {
    const element = this.unique((await this.read(query)).elements, this.field);
    return this.automation.act(this.owner, this.task.id, this.state()!.tabId, browserActionSchema.parse({ ...action, ref: element.ref }), query);
  }
  private async waitFor(query: BrowserQuery, accept: (elements: BrowserElement[]) => boolean) {
    const deadline = Date.now() + 5000;
    do {
      const value = await this.read(query);
      if (accept(value.elements)) return value;
      if (Date.now() >= deadline) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    throw new Error(`${this.field}等待结果超时；保留当前填写内容，请核对当前控件。`);
  }
  private async locateTable() {
    this.field = '编辑行';
    const tables = await this.read(this.query(css('.el-table,table:not(.el-table table)'), undefined, { hasText: '群组Owner', limit: 3 }));
    const table = this.unique(tables.elements, '群组表格');
    this.table = table.tag === 'table' ? 'table:not(.el-table table)' : '.el-table';
    const headers = await this.read(this.query(css(table.tag === 'table' ? 'thead th' : '.el-table__header-wrapper th'), this.table));
    this.columns.clear();
    for (const label of expectedHeaders) {
      const matches = headers.elements.flatMap((header, index) => normalize(header.name) === normalize(label) ? [index + 1] : []);
      if (matches.length !== 1) throw new Error(`表头「${label}」未唯一确认，停止自动填写，避免填错列。`);
      this.columns.set(label, matches[0]);
    }
    const rows = table.tag === 'table' ? 'tbody tr' : '.el-table__body-wrapper tbody tr';
    this.row = `${this.table} ${rows}:has(input:not([type="checkbox"]):not([type="hidden"]),textarea,select,[role="combobox"])`;
  }
  private cell(label: string) { return `${this.row} > td:nth-child(${this.columns.get(label)})`; }
  private async fieldValue(label: string) {
    const observation = await this.read(this.query(css('input,textarea,select,[role="combobox"]'), this.cell(label)));
    const selected = await this.read(this.query(css('.el-tag,.el-select__selected-item:not(:has(.el-tag)),option:checked'), this.cell(label), { visible: undefined, limit: 250, textLimit: 14000 }));
    return { text: selected.text, elements: observation.elements, values: observation.elements.map(element => element.value ?? '') };
  }
  private async offering(verifyOnly = false) {
    this.field = 'Offering';
    const draft = this.state()!.draft;
    const valueQuery = this.query(css('input,[role="combobox"]'), undefined, { or: [], limit: 100 });
    const isOffering = (element: BrowserElement) => /offering/i.test(element.name + (element.attributes?.placeholder ?? ''));
    const selected = (element: BrowserElement) => {
      if (!isOffering(element) || !element.value || element.valueTruncated) return false;
      const chosen = this.state()!.offeringLabel;
      const expected = chosen ?? draft.offering;
      const actualId = offeringId(element.value), expectedId = offeringId(expected);
      if (actualId && expectedId && actualId !== expectedId) return false;
      if (!chosen && (expectedId || expected.startsWith('['))) return normalize(element.value) === normalize(expected) || /^\d+$/.test(expected) && actualId === expected;
      return offeringName(element.value) === offeringName(expected);
    };
    if ((await this.read(valueQuery)).elements.some(selected)) return;
    if (verifyOnly) throw new Error('Offering 的实际回填值与本次归属不符，请重新核对；未提交申请。');
    const dialogQuery = this.query(css('.el-dialog,[role="dialog"]'), undefined, { hasText: '请选择Offering信息', limit: 3 });
    if (!(await this.read(dialogQuery)).elements.length) {
      const products = (await this.read(this.query(role('radio', '产品')))).elements;
      if (products.length > 1) throw new Error(`产品归属应唯一匹配，实际 ${products.length} 项；未执行点击或填写。`);
      if (products.length === 1 && !products[0].checked) await this.automation.act(this.owner, this.task.id, this.state()!.tabId, { type: 'click', ref: products[0].ref, button: 'left', count: 1 }, dialogQuery);
      if (!(await this.read(dialogQuery)).elements.length) {
        const control = this.unique((await this.read(valueQuery)).elements.filter(isOffering), 'Offering 选择器');
        await this.automation.act(this.owner, this.task.id, this.state()!.tabId, { type: 'click', ref: control.ref, button: 'left', count: 1 }, dialogQuery);
      }
    }
    this.unique((await this.waitFor(dialogQuery, elements => elements.length === 1)).elements, 'Offering 弹窗');
    const entryQuery = (searchTerm: string) => this.query(css('tr,[role="row"],[role="treeitem"],.el-tree-node__content,li'), '.el-dialog,[role="dialog"]', { hasText: searchTerm });
    const matches = (elements: BrowserElement[]) => elements.filter(element => {
      const text = offeringText(element);
      return normalize(text) === normalize(draft.offering) || offeringName(text) === normalize(draft.offering) || /^\d+$/.test(draft.offering) && text.endsWith(draft.offering);
    });
    let candidates = matches((await this.read(entryQuery(offeringId(draft.offering) ?? draft.offering))).elements);
    if (!candidates.length) {
      const searchTerm = draft.offering.replace(/^\[[^\]]+\]\s*/, '').replace(/\s+\d{8,}$/, '').replace(/\s+/g, ' ').trim() || draft.offering;
      if (searchTerm.length >= 3) {
        const searchQuery = this.query({ by: 'placeholder', value: '请输入至少三个关键字', exact: true, ignoreCase: false }, '.el-dialog,[role="dialog"]');
        const search = this.unique((await this.read(searchQuery)).elements, 'Offering 搜索框');
        await this.automation.act(this.owner, this.task.id, this.state()!.tabId, { type: 'fill', ref: search.ref, text: searchTerm });
        candidates = matches((await this.waitFor(entryQuery(offeringId(draft.offering) ?? draft.offering), elements => matches(elements).length > 0)).elements);
      }
    }
    if (!/^\[/.test(draft.offering) && candidates.some(element => /^\[Offering R\]/i.test(offeringText(element)))) candidates = candidates.filter(element => /^\[Offering R\]/i.test(offeringText(element)));
    const labels = [...new Set(candidates.map(offeringText))];
    if (labels.length !== 1) throw new OfferingNeedsChoice(labels.filter(label => label.length <= 200).slice(0, 5));
    const chosen = candidates[0];
    await this.automation.act(this.owner, this.task.id, this.state()!.tabId, { type: 'click', ref: chosen.ref, button: 'left', count: 1 }, dialogQuery);
    await this.action(this.query(role('button', '确定'), '.el-dialog,[role="dialog"]'), { type: 'click' });
    this.save({ offeringLabel: offeringText(chosen) });
    await this.waitFor(valueQuery, elements => elements.some(selected));
  }
  private async dropdown(label: string, values: string[]) {
    this.field = label;
    const current = await this.fieldValue(label);
    const has = (value: string) => current.values.includes(value) || normalize(current.text).includes(normalize(value));
    if (label === '群组应用类型') {
      const extra = GROUP_APPLICATIONS.filter(value => has(value) && !values.includes(value));
      if (extra.length) throw new Error(`当前应用类型含未要求的 ${extra.join('、')}，请先核对，避免静默扩大权限。`);
    }
    if (values.every(has)) return;
    const native = this.query(css('select'), this.cell(label));
    if ((await this.read(native)).elements.length) {
      await this.action(native, { type: 'select', values, by: 'label' });
    } else {
      for (const value of values.filter(value => !has(value))) {
        const wrapper = this.query(css('.el-select'), this.cell(label));
        const opener = (await this.read(wrapper)).elements.length ? wrapper : this.query(css('input,[role="combobox"]'), this.cell(label));
        await this.action(opener, { type: 'click' });
        const options = await this.waitFor(this.query(css('[role="option"],li'), popup), elements => elements.some(element => normalize(element.name) === normalize(value)));
        const option = this.unique(options.elements.filter(element => normalize(element.name) === normalize(value)), `选项 ${value}`);
        await this.automation.act(this.owner, this.task.id, this.state()!.tabId, { type: 'click', ref: option.ref, button: 'left', count: 1 }, this.query(css('input,.el-tag,.el-select__selected-item'), this.cell(label)));
        await this.automation.act(this.owner, this.task.id, this.state()!.tabId, { type: 'press', key: 'Escape' }, this.query(css('input,.el-tag'), this.cell(label)));
      }
    }
    const after = await this.fieldValue(label);
    if (!values.every(value => after.values.includes(value) || normalize(after.text).includes(normalize(value)))) throw new Error(`${label}回填未确认。`);
  }
  private async text(label: string, value: string, selector = 'input,textarea') {
    this.field = label;
    const query = this.query(css(selector), this.cell(label));
    const input = this.unique((await this.read(query)).elements, label);
    if (input.value === value) return;
    const result = await this.automation.act(this.owner, this.task.id, this.state()!.tabId, { type: 'fill', ref: input.ref, text: value }, query);
    if (this.unique(result.elements, label).value !== value) throw new Error(`${label}实际值未回填为要求内容。`);
  }
  private async people(label: string, ids: string[]) {
    this.field = label;
    const selected = async () => {
      const value = await this.fieldValue(label);
      return ids.filter(id => personPresent(value.text, id) || value.elements.some(element => element.value && namedPersonValue(element.value) && personPresent(element.value, id)));
    };
    const awaitedSelected = await selected();
    const remaining = ids.filter(id => !awaitedSelected.includes(id));
    if (!remaining.length) return;
    const input = this.query(css('input:not([type="hidden"]),textarea'), this.cell(label));
    await this.action(input, { type: 'fill', text: remaining.join(';') });
    for (const id of remaining) {
      const candidates = this.query(css('[role="option"],li'), popup, { hasText: id, limit: 5 });
      let options = await this.read(candidates);
      if (!options.elements.some(element => personPresent(element.name, id))) {
        if (id !== remaining[0]) await this.action(input, { type: 'fill', text: id });
        options = await this.waitFor(candidates, elements => elements.some(element => personPresent(element.name, id)));
      }
      const option = this.unique(options.elements.filter(element => personPresent(element.name, id)), `${label}人员 ${id}`);
      await this.automation.act(this.owner, this.task.id, this.state()!.tabId, { type: 'click', ref: option.ref, button: 'left', count: 1 }, input);
      if (!(await selected()).includes(id)) throw new Error(`${label}的 ${id} 尚未确认为已选择人员，输入工号不等于选中。`);
    }
  }
  private async validate() {
    const draft = this.state()!.draft, mismatches: string[] = [];
    const expected: [string, string[]][] = [['群组名称', [draft.prefix]], ['群组应用类型', draft.applications], ['有效期', [['', '一年', '两年', '三年'][draft.years]]]];
    for (const [label, values] of expected) {
      const field = await this.fieldValue(label);
      if (!values.every(value => field.values.includes(value) || normalize(field.text).includes(normalize(value)))) mismatches.push(label);
      if (label === '群组应用类型' && GROUP_APPLICATIONS.some(value => normalize(field.text).includes(normalize(value)) && !draft.applications.includes(value))) mismatches.push('未确认的应用类型');
      if (label === '群组应用类型') {
        let remaining = normalize(field.text);
        for (const value of GROUP_APPLICATIONS) remaining = remaining.replaceAll(normalize(value), '');
        if (remaining.replace(/[×✕;,，；]/g, '')) mismatches.push('无法确认的应用类型标签');
      }
    }
    const name = await this.read(this.query(css('input:not(.el-select input)'), this.cell('群组名称')));
    if (name.elements.length !== 1 || name.elements[0].value !== draft.name) mismatches.push('名称主体');
    const description = await this.fieldValue('群组描述');
    if (!description.values.includes(draft.description)) mismatches.push('群组描述');
    for (const [label, ids] of [['群组Owner', [draft.owner]], ['群组成员', draft.members], ['群组管理员', [draft.administrator]]] as const) {
      const field = await this.fieldValue(label);
      const selected = [field.text, ...field.elements.map(element => element.value && namedPersonValue(element.value) ? element.value : '')].join(';');
      const actual = [...new Set(selected.match(/[a-zA-Z]?\d{5,10}/g) ?? [])];
      if (actual.length !== ids.length || !ids.every(id => actual.some(value => value.toLowerCase() === id.toLowerCase()))) mismatches.push(label);
    }
    if (mismatches.length) throw new Error(`字段核对未通过：${mismatches.join('、')}。请读取进度后修正，未提交申请。`);
  }
  async fill(raw: unknown = {}) {
    const previous = this.state();
    if (previous && ['submitting', 'unknown', 'submitted'].includes(previous.phase)) return this.inspect();
    const resume = previous && raw && typeof raw === 'object' && !Array.isArray(raw) && Object.keys(raw).length === 0;
    if (!resume) {
      const result = this.prepare(raw);
      if (result.status === 'needs-information' || result.status === 'blocked') return result;
    }
    const state = this.state()!;
    if (state.rejectedName === `${state.draft.prefix}-${state.draft.name}`) return { status: 'needs-information', progress: state, message: '原组名已重复，请先确认新名字，不重新填写或提交原名。' };
    if (this.failures >= 2) return { status: 'blocked', progress: state, message: '本轮两次自动填写未完成，请向用户说明具体卡点；保留已填内容，不重复循环。' };
    try {
      this.save({ phase: 'filling', error: undefined });
      if (state.rowRequested && state.error && /已存在|重名/.test(state.error)) {
        const duplicate = await this.read(this.query(css('.el-message-box,[role="dialog"]'), undefined, { hasText: state.error }));
        if (duplicate.elements.length) await this.action(this.query(role('button', '确定'), '.el-message-box,[role="dialog"]'), { type: 'click' });
      }
      await this.offering(); await this.locateTable();
      let rows = await this.read(this.query(css(this.row)));
      if (!rows.elements.length) {
        if (state.rowRequested) throw new Error('已请求新增编辑行但未找到，停止重复添加，请确认页面是否刷新。');
        this.save({ rowRequested: true });
        await this.action(this.query(role('button', '单个添加')), { type: 'click' });
        rows = await this.waitFor(this.query(css(this.row)), elements => elements.length > 0);
      } else if (!state.rowRequested) throw new Error('页面已有编辑行，尚未确认属于本次任务，请先核对现有草稿。');
      this.unique(rows.elements, '编辑行');
      const draft = state.draft;
      const steps: [string, () => Promise<void>][] = [
        ['前缀', () => this.dropdown('群组名称', [draft.prefix])],
        ['名称主体', () => this.text('群组名称', draft.name, 'input:not(.el-select input)')],
        ['群组描述', () => this.text('群组描述', draft.description)],
        ['群组Owner', () => this.people('群组Owner', [draft.owner])],
        ['群组成员', () => this.people('群组成员', draft.members)],
        ['群组管理员', () => this.people('群组管理员', [draft.administrator])],
        ['群组应用类型', () => this.dropdown('群组应用类型', draft.applications)],
        ['有效期', () => this.dropdown('有效期', [['', '一年', '两年', '三年'][draft.years]])],
      ];
      for (const [field, run] of steps) {
        await run(); this.save({ completed: [...new Set([...this.state()!.completed, field])] });
      }
      await this.validate();
      return { status: 'ready', progress: this.save({ phase: 'ready', field: undefined, error: undefined }), next: 'group_submit：将由工具内部弹确认卡' };
    } catch (error) {
      this.failures++;
      const progress = this.save({ phase: 'blocked', field: this.field, error: error instanceof Error ? error.message : String(error) });
      this.automation.signal(this.owner, this.task.id).throwIfAborted();
      if (error instanceof OfferingNeedsChoice) {
        const values = groupInputSchema.parse({ ownership: 'product', ...progress.draft });
        return { status: 'blocked', progress, message: error.message, groupQuestion: { fields: ['offering'] as const, values, offeringOptions: error.options } };
      }
      return { status: 'blocked', progress, message: '请根据具体字段处理卡点；不要自动从头重填或重复观察整页。' };
    }
  }
  private async result() {
    const state = this.state()!, name = `${state.draft.prefix}-${state.draft.name}`;
    const observed = await this.read(this.query(css(receiptArea), undefined, { limit: 30 }));
    const texts: string[] = [];
    for (const [index, element] of observed.elements.entries()) {
      texts.push(element.name || (await this.read(this.query(css(receiptArea), undefined, { nth: index, limit: 1 }))).text);
    }
    const duplicate = texts.find(text => namesGroup(text, name) && /已存在|重名/.test(text));
    if (duplicate) return { status: 'blocked', progress: this.save({ phase: 'blocked', field: '群组名称', error: duplicate, rejectedName: name }), message: '组名重复，已保留填写内容；先确认新名字，再修改并重新确认提交。' };
    const receipt = texts.find(text => namesGroup(text, name) && successfulReceipt(text));
    if (receipt) {
      const start = Math.max(0, receipt.indexOf(name) - 200), proof = receipt.slice(start, start + Math.min(1000, name.length + 400));
      if (!namesGroup(proof, name) || !successfulReceipt(proof)) return { status: 'unknown', progress: this.save({ phase: 'unknown', error: '回执过长，无法将成功提示与本群组名称同时核验，请检查申请记录，不重复提交。' }) };
      const condition = { type: 'text' as const, text: proof, present: true };
      this.automation.plan(this.owner, this.task.id, state.tabId, [{ id: 'group-submission', label: `群组 ${name} 的申请提交成功`, condition }]);
      const verification = await this.automation.verify(this.owner, this.task.id, state.tabId);
      if (verification.passed) return { status: 'submitted', progress: this.save({ phase: 'submitted', receipt: proof }), message: '申请提交成功；审批是否生效是后续状态。' };
    }
    return { status: 'unknown', progress: this.save({ phase: 'unknown', error: '未读取到包含本群组名称的明确提交成功凭据，请核对页面或申请记录；不要重复点击提交。' }) };
  }
  async inspect() {
    const state = this.state();
    if (!state) return { status: 'needs-information', message: '尚未准备建群信息。' };
    if (['submitting', 'unknown'].includes(state.phase)) return this.result();
    if (state.rowRequested && state.phase !== 'submitted') {
      try {
        await this.locateTable(); await this.offering(true); await this.validate();
        return { status: 'ready', progress: this.save({ phase: 'ready', field: undefined, error: undefined }) };
      } catch (error) {
        this.automation.signal(this.owner, this.task.id).throwIfAborted();
        return { status: 'blocked', progress: this.save({ phase: 'blocked', field: this.field, error: error instanceof Error ? error.message : String(error) }) };
      }
    }
    return { status: state.phase, progress: state };
  }
  async submit() {
    const state = this.state();
    if (!state) return { status: 'needs-information', message: '先准备并填写群组表单。' };
    if (state.phase === 'submitted') return { status: 'submitted', progress: state };
    if (['submitting', 'unknown'].includes(state.phase)) return this.result();
    if (state.phase !== 'ready' || this.confirmationCancelled || !this.confirm) return { status: 'blocked', progress: state, message: '填写核对通过且用户确认后才能提交；用户取消后本轮不再弹确认卡。' };
    try {
      await this.locateTable(); await this.offering(true); await this.validate();
      const draft = JSON.stringify(state.draft);
      const name = `${state.draft.prefix}-${state.draft.name}`;
      const answer = await this.confirm({ id: this.task.id, intent: '提交群组申请', target: `${name}；Offering ${state.draft.offering}；描述 ${state.draft.description}；Owner ${state.draft.owner}；成员 ${state.draft.members.join(';')}；管理员 ${state.draft.administrator}；${state.draft.applications.join('、')}；${state.draft.years}年` });
      if (answer === 'pending') return { status: 'waiting_confirmation', progress: state, message: '已交付用户确认，尚未提交；表单与原申请保持。' };
      if (answer !== 'confirmed') { this.confirmationCancelled = true; return { status: 'cancelled', message: '用户取消提交，表单内容保留；本轮不要再次请求提交。' }; }
      await this.locateTable(); await this.offering(true); await this.validate();
      const current = this.state();
      if (current?.tabId !== state.tabId || JSON.stringify(current.draft) !== draft) {
        throw new Error('表单目标或内容已变化，请重新核对后确认。');
      }
      this.field = '提交申请'; this.save({ phase: 'submitting' });
      await this.action(this.query(role('button', '提交申请')), { type: 'click' });
      return await this.result();
    } catch (error) {
      const unknown = this.state()!.phase === 'submitting';
      const progress = this.save({ phase: unknown ? 'unknown' : 'blocked', field: this.field, error: error instanceof Error ? error.message : String(error) });
      this.automation.signal(this.owner, this.task.id).throwIfAborted();
      return { status: progress.phase, progress, message: unknown ? '提交结果待核验，不自动重新点击提交。' : '提交前核对未通过，未提交申请。' };
    }
  }
}
