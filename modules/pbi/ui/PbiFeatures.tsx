import { ClipboardText } from '@phosphor-icons/react';

export function PbiFeatures() {
  return (
    <section className="view on panel glass" id="view-pbi-features" aria-label="特性管理">
      <div className="greet">
        <div>
          <h1>特性管理</h1>
          <div className="gsub">管理 PBI 特性的规划、跟踪与交付</div>
        </div>
      </div>
      <div className="perm-result-empty">
        <ClipboardText size={40} className="perm-result-icon" />
        页面建设中
      </div>
    </section>
  );
}
