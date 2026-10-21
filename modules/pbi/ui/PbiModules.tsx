import { TreeStructure } from '@phosphor-icons/react';

export function PbiModules() {
  return (
    <section className="view on panel glass" id="view-pbi-modules" aria-label="子系统&模块">
      <div className="greet">
        <div>
          <h1>子系统&amp;模块</h1>
          <div className="gsub">管理子系统与模块的划分和归属关系</div>
        </div>
      </div>
      <div className="perm-result-empty">
        <TreeStructure size={40} className="perm-result-icon" />
        页面建设中
      </div>
    </section>
  );
}
