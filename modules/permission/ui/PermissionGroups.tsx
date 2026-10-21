import { useState } from 'react';
import { Plus, UsersThree } from '@phosphor-icons/react';
import './permission.css';

interface GroupDraft {
  name: string;
  desc: string;
}

const emptyDraft: GroupDraft = { name: '', desc: '' };

export function PermissionGroups() {
  const [draft, setDraft] = useState<GroupDraft>(emptyDraft);
  const [groups] = useState<GroupDraft[]>([]);

  const canSubmit = draft.name.trim().length > 0;

  return (
    <section className="view on panel glass" id="view-permission-groups" aria-label="群组创建">
      <div className="perm-groups-layout">
        <div className="greet">
          <div>
            <h1>群组创建</h1>
            <div className="gsub">创建和管理权限群组，便于批量分配权限</div>
          </div>
        </div>

        <div className="perm-form-card panel glass">
          <div>
            <div className="form-label">群组名称</div>
            <input
              className="form-input"
              type="text"
              placeholder="输入群组名称"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div>
            <div className="form-label">描述</div>
            <textarea
              className="form-textarea"
              placeholder="补充群组用途说明（可选）"
              value={draft.desc}
              onChange={(e) => setDraft({ ...draft, desc: e.target.value })}
            />
          </div>
          <div className="form-actions">
            <button className="btn btn-sec" type="button" onClick={() => setDraft(emptyDraft)}>重置</button>
            <button className="btn btn-pri" type="button" disabled={!canSubmit}>
              <Plus size={15} weight="bold" />创建群组
            </button>
          </div>
        </div>

        {groups.length > 0 ? (
          <div className="perm-group-list">
            {groups.map((g, i) => (
              <div className="perm-group-row" key={i}>
                <div className="group-icon"><UsersThree size={18} /></div>
                <div className="group-info">
                  <div className="group-name">{g.name}</div>
                  {g.desc && <div className="group-desc">{g.desc}</div>}
                </div>
                <div className="group-meta">0 成员</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="perm-result-empty">
            <UsersThree size={40} className="perm-result-icon" />
            暂无群组，在上方创建第一个
          </div>
        )}
      </div>
    </section>
  );
}
