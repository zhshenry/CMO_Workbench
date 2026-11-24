import { useId, useRef, useState } from 'react';
import { TaskDeadlineFields, taskPriorityOptions } from '../../modules/todo/ui/TaskFormFields';
import { officeTodoFieldsSchema, type OfficeTodoFields } from '../../shared/office-workbench';
import type { Category } from '../../shared/todo-contracts';
import { errorText, Modal, Select } from '../ui/controls';

export function OfficeTodoEditor({ fields, categories, close, save }: {
  fields: OfficeTodoFields;
  categories: Category[];
  close(): void;
  save(fields: OfficeTodoFields): Promise<void>;
}) {
  const id = useId(), submitting = useRef(false);
  const [draft, setDraft] = useState(fields), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const dirty = Object.keys(draft).some(key => draft[key as keyof OfficeTodoFields] !== fields[key as keyof OfficeTodoFields]);
  const edit = (update: Partial<OfficeTodoFields>) => { setDraft(value => ({ ...value, ...update })); setError(''); };
  const submit = async () => {
    if (submitting.current) return;
    const parsed = officeTodoFieldsSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0].message); return; }
    submitting.current = true; setBusy(true);
    try { await save(parsed.data); close(); }
    catch (cause) { setError(errorText(cause)); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <Modal title="编辑待办" className="task-modal office-todo-editor" dirty={dirty} busy={busy} close={close}>
    <form className="form-body" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={busy}>
        <label>名称 <input value={draft.title} required maxLength={200} onChange={event => edit({ title: event.target.value })} /></label>
        <label>说明 <textarea value={draft.note} rows={3} maxLength={5000} onChange={event => edit({ note: event.target.value })} /></label>
        <TaskDeadlineFields id={id} value={draft.dateAt} onChange={dateAt => edit({ dateAt })} />
        <div className="office-todo-editor-options">
          <label>标签 <Select aria-label="标签" value={draft.categoryId ?? ''} options={[{ value: '', label: '无标签' }, ...categories.map(category => ({ value: category.id, label: category.name }))]}
            onChange={categoryId => edit({ categoryId: categoryId || null })} /></label>
          <label>优先级 <Select aria-label="优先级" value={draft.priority} options={taskPriorityOptions}
            onChange={priority => edit({ priority: priority as OfficeTodoFields['priority'] })} /></label>
        </div>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="actions">
          <button className="btn btn-sec" type="button" onClick={close}>取消</button>
          <button className="btn btn-pri" type="submit">{busy ? '保存中…' : '保存'}</button>
        </div>
      </fieldset>
    </form>
  </Modal>;
}
