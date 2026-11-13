import { Package } from '@phosphor-icons/react';
import { WorkbenchPage } from '../../../src/ui/WorkbenchPage';

export function DeliveryProjects() {
  return (
    <WorkbenchPage id="view-delivery-projects" title="交付件管理">
      <div className="workbench-empty" role="status">
        <span className="workbench-empty-icon" aria-hidden="true"><Package size={28} /></span>
        <p>页面建设中</p>
      </div>
    </WorkbenchPage>
  );
}
