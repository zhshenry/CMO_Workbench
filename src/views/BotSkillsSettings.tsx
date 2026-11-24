import { useEffect, useState, type ReactNode } from 'react';
import { ArrowClockwise, BookOpen, CaretRight, FolderOpen } from '@phosphor-icons/react';
import type { BotSkillsView, BotSkillView } from '../../shared/bot-files';
import { errorText, IconButton, Modal, Select } from '../ui/controls';
import type { BotSettingsState } from './BotManagement';

const api = window.workbench.bot;
export function BotSkillsSettings({ botId, botName, picker, onStateChange }: { botId: string; botName: string; picker: ReactNode; onStateChange(state: BotSettingsState): void }) {
  const [data, setData] = useState<BotSkillsView>(), [scope, setScope] = useState('all'), [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [directory, setDirectory] = useState(false), [selected, setSelected] = useState<BotSkillView>(), [content, setContent] = useState<string>(), [detailError, setDetailError] = useState('');
  const [detailReload, setDetailReload] = useState(0);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    void api.getSkills(botId).then(value => { if (current) setData(value); }, cause => { if (current) setError(errorText(cause)); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [botId, reload]);
  useEffect(() => {
    if (!selected) return;
    let current = true; setContent(undefined); setDetailError('');
    void api.readSkill(botId, selected.source, selected.name).then(value => { if (current) setContent(value); }, cause => { if (current) setDetailError(errorText(cause)); });
    return () => { current = false; };
  }, [botId, selected, detailReload]);
  useEffect(() => { onStateChange({ dirty: false, busy }); }, [busy, onStateChange]);
  useEffect(() => () => onStateChange({ dirty: false, busy: false }), [onStateChange]);
  async function openFolder(folder: 'skills' | 'sharedSkills') {
    if (busy) return;
    setBusy(true); setError('');
    try { await api.openFiles(botId, folder); } catch (cause) { setError(errorText(cause)); } finally { setBusy(false); }
  }
  const skills = data?.skills.filter(skill => scope === 'all' || skill.source === scope) ?? [];
  return <section className="bot-skills-settings">
    <div className="bot-settings-heading"><div><h3>可用技能</h3><p>公共技能供本应用使用，专属技能只用于选中的 Bot。</p></div>{picker}</div>
    {error && <div className="bot-settings-feedback"><p className="error" role="alert">{error}</p><button type="button" className="set-btn" onClick={() => setReload(value => value + 1)}>重新读取技能</button></div>}
    <section className="bot-settings-card"><header className="bot-skills-toolbar"><div><Select aria-label="技能范围" matchTriggerWidth value={scope} options={[{ value: 'all', label: '全部技能' }, { value: 'shared', label: '公共技能' }, { value: 'private', label: '当前 Bot' }]} onChange={setScope} />
      {!loading && data && <span className="bot-settings-help">{skills.length} 个技能</span>}</div><div><IconButton label="刷新技能" disabled={loading || busy} onClick={() => setReload(value => value + 1)}><ArrowClockwise size={16} /></IconButton>
        <button type="button" className="bot-settings-link" onClick={() => setDirectory(true)}><FolderOpen size={16} />技能目录</button></div></header>
      {loading ? <p className="bot-settings-empty" role="status">正在读取技能…</p> : <>
        {skills.map(skill => <div key={skill.source + ':' + skill.name} className="bot-settings-row bot-skill-row" data-overridden={skill.overridden || undefined}>
          <span className="bot-settings-symbol"><BookOpen size={18} /></span><div className="bot-settings-copy"><div className="bot-settings-title"><strong>{skill.name}</strong><span className={'bot-settings-badge' + (skill.source === 'private' ? ' is-private' : '')}>{skill.source === 'private' ? botName + ' 专属' : '公共'}</span></div>
            <p>{skill.description}</p><small>{skill.overridden ? '当前使用同名专属版本' : skill.source === 'private' && data?.skills.some(item => item.source === 'shared' && item.name === skill.name) ? '专属版本优先' : '修改后下一轮生效'}</small></div>
          <button type="button" className="bot-settings-link" aria-label={'查看' + (skill.source === 'private' ? '专属' : '公共') + '技能 ' + skill.name} onClick={() => setSelected(skill)}>查看<CaretRight size={14} /></button></div>)}
        {!skills.length && data && <p className="bot-settings-empty">{data.skills.length ? '此范围内暂无技能。' : '还没有技能。可打开技能目录，添加带有有效名称和说明的 SKILL.md。'}</p>}
      </>}
      {data?.errors.map((message, index) => <p className="bot-settings-feedback error" role="status" key={index}>{message}</p>)}
      <footer className="bot-skills-note">技能的使用仍遵循工具权限；修改后从下一轮对话开始生效。</footer>
    </section>
    {selected && <Modal title={selected.name} className="bot-skill-detail-modal" close={() => setSelected(undefined)}>
      <div className="bot-skill-detail"><span className="bot-settings-badge">{selected.source === 'private' ? botName + ' 专属' : '本应用公共技能'}</span>
        {detailError ? <div className="bot-settings-feedback"><p className="error" role="alert">{detailError}</p><button type="button" className="set-btn" onClick={() => setDetailReload(value => value + 1)}>重新读取正文</button></div>
          : content === undefined ? <p className="bot-settings-help" role="status">正在读取技能正文…</p> : <pre>{content}</pre>}
        <div className="actions"><button type="button" onClick={() => setDirectory(true)}><FolderOpen size={16} />查看目录位置</button><button type="button" onClick={() => setSelected(undefined)}>关闭</button></div></div>
    </Modal>}
    {directory && <Modal title="技能目录" className="bot-skill-directories-modal" busy={busy} close={() => setDirectory(false)}><div className="bot-skill-detail">
      <p className="bot-settings-help">在目录中编辑 SKILL.md，保存后从下一轮对话开始读取。专属同名技能优先，技能不会授予新工具权限。</p>
      <div className="bot-settings-row"><div className="bot-settings-copy"><strong>本应用公共技能</strong><small>skills/&lt;技能名称&gt;/SKILL.md</small></div><button type="button" className="set-btn" disabled={busy} onClick={() => void openFolder('sharedSkills')}>打开目录</button></div>
      <div className="bot-settings-row"><div className="bot-settings-copy"><strong>{botName} 专属技能</strong><small>bots/{botId}/skills/</small></div><button type="button" className="set-btn" disabled={busy} onClick={() => void openFolder('skills')}>打开目录</button></div>
      {error && <p className="error" role="alert">{error}</p>}
    </div></Modal>}
  </section>;
}
