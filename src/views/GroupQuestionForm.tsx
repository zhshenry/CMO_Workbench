import { useState } from 'react';
import { GROUP_APPLICATIONS, GROUP_FIELDS, groupNeedsDomain, resolveGroupAnswer, type GroupInput, type GroupQuestion } from '../../shared/permission-group-contracts';

const textFields = [
  ['name', '输入群组名称'],
  ['owner', '输入工号'],
  ['offering', '名称或编号'],
  ['administrator', '输入工号'],
] as const;

export function GroupQuestionForm({ question, busy, submit }: { question: GroupQuestion; busy: boolean; submit(input: GroupInput): void }) {
  const { fields, values, offeringOptions } = question;
  const choosingOffering = !!offeringOptions?.length;
  const [answer, setAnswer] = useState<GroupInput>(() => fields.includes('offering') && values.offering && !choosingOffering ? { offering: values.offering } : {});
  const [memberIds, setMemberIds] = useState('');
  const [later, setLater] = useState(false);
  const [validation, setValidation] = useState<{ error: string; field?: keyof typeof GROUP_FIELDS }>();
  const department = (answer.ownership ?? values.ownership) === 'department';
  const knownName = values.name && values.prefix && !values.name.toUpperCase().startsWith(values.prefix.toUpperCase() + '-') ? values.prefix + '-' + values.name : values.name;
  const applications = answer.applications ?? [];
  const needsDomain = groupNeedsDomain(applications);
  const invalid = (field: keyof typeof GROUP_FIELDS) => validation?.field === field || undefined;
  const edit = <K extends keyof GroupInput,>(field: K, value: GroupInput[K]) => {
    setAnswer(previous => ({ ...previous, [field]: value }));
    setValidation(undefined);
  };

  return <form className="bot-group-question" noValidate onKeyDown={event => {
    if (event.key === 'Enter' && event.nativeEvent.isComposing) event.preventDefault();
  }} onSubmit={event => {
    event.preventDefault();
    if (busy || later) return;
    const input: GroupInput = department ? (fields.includes('ownership') ? { ownership: 'department' } : {}) : { ...answer };
    if (!department && fields.includes('members')) {
      const members = memberIds.split(/[;；\r\n]+/).map(id => id.trim()).filter(Boolean);
      if (members.length) input.members = members;
    }
    const result = resolveGroupAnswer(question, input);
    if ('error' in result) {
      setValidation(result);
      if (result.field) event.currentTarget.querySelector<HTMLElement>('[name="' + result.field + '"]')?.focus();
      return;
    }
    submit(input);
  }}>
    {((values.name && !fields.includes('name')) || (values.owner && !fields.includes('owner'))) && <div className="bot-group-known">
      {knownName && !fields.includes('name') && <span>群组名称 <strong>{knownName}</strong></span>}
      {values.owner && !fields.includes('owner') && <span>Owner <strong>{values.owner}</strong></span>}
    </div>}
    <div className="bot-group-fields" hidden={later}>
      {fields.includes('ownership') && <fieldset disabled={busy}>
        <legend>归属</legend>
        <div className="bot-group-choices">{(['product', 'department'] as const).map(value => <label key={value}>
          <input type="radio" name="ownership" value={value} checked={answer.ownership === value} aria-invalid={invalid('ownership')} onChange={() => edit('ownership', value)} />
          {value === 'product' ? '产品' : '部门'}
        </label>)}</div>
      </fieldset>}
      {department ? <p className="bot-help">部门群组沿用通用浏览器流程。</p> : <>
        <div className="bot-group-text-fields">{textFields.filter(([field]) => fields.includes(field) && (field !== 'offering' || !choosingOffering)).map(([field, placeholder]) => <label key={field}>
          <span>{field === 'offering' ? 'Offering' : GROUP_FIELDS[field]}</span>
          <input type="text" name={field} value={answer[field] ?? ''} placeholder={placeholder} disabled={busy} aria-invalid={invalid(field)} onChange={event => edit(field, event.target.value)} />
        </label>)}</div>
        {fields.includes('offering') && choosingOffering && <fieldset disabled={busy}>
          <legend>选择 Offering</legend>
          <div className="bot-group-choices bot-group-offering-options">{offeringOptions.map(label => <label key={label}>
            <input type="radio" name="offering" value={label} checked={answer.offering === label} aria-invalid={invalid('offering')} onChange={() => edit('offering', label)} />{label}
          </label>)}</div>
        </fieldset>}
        {fields.includes('members') && <label className="bot-group-members">
          <span>成员工号</span>
          <textarea name="members" rows={2} value={memberIds} placeholder="多个工号用分号或换行分隔" disabled={busy} aria-invalid={invalid('members')} onChange={event => { setMemberIds(event.target.value); setValidation(undefined); }} />
        </label>}
        {fields.includes('applications') && <fieldset disabled={busy}>
          <legend>应用类型</legend>
          <div className="bot-group-choices">{GROUP_APPLICATIONS.map(value => {
            const automatic = value === '域群组' && needsDomain;
            return <label key={value}><input type="checkbox" name="applications" value={value} checked={automatic || applications.includes(value)} disabled={automatic} aria-invalid={invalid('applications')} onChange={event => edit('applications', event.target.checked ? [...applications, value] : applications.filter(item => item !== value))} />
              {value === '域群组' ? value : value.replace(/群组$/, '')}
            </label>;
          })}</div>
          {needsDomain && <p className="bot-help" role="status">已按应用类型勾选域群组。</p>}
        </fieldset>}
      </>}
      {validation && <p role="alert" className="bot-error">{validation.error}</p>}
    </div>
    <div className="bot-action-buttons">
      <button type="button" disabled={busy} onClick={() => setLater(previous => !previous)}>{later ? '继续补充' : '稍后填写'}</button>
      {!later && <button type="submit" className="primary" disabled={busy}>{busy ? '提交中…' : department ? '进入通用流程' : '继续填写'}</button>}
    </div>
  </form>;
}
