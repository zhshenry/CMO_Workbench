import { Bug } from '@phosphor-icons/react';

export function DtsQuery() {
  return (
    <section className="view on panel glass" id="view-dts-query" aria-label="DTS查询">
      <div className="greet">
        <div>
          <h1>DTS查询</h1>
          <div className="gsub">查询和跟踪 DTS 单的状态与处理进展</div>
        </div>
      </div>
      <div className="perm-result-empty">
        <Bug size={40} className="perm-result-icon" />
        页面建设中
      </div>
    </section>
  );
}
