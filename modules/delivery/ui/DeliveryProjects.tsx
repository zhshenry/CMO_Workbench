import { Package } from '@phosphor-icons/react';

export function DeliveryProjects() {
  return (
    <section className="view on panel glass" id="view-delivery-projects" aria-label="项目交付件管理">
      <div className="greet">
        <div>
          <h1>项目交付件管理</h1>
          <div className="gsub">管理项目交付物的全生命周期</div>
        </div>
      </div>
      <div className="perm-result-empty">
        <Package size={40} className="perm-result-icon" />
        页面建设中
      </div>
    </section>
  );
}
