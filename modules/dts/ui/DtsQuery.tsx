import { Bug } from '@phosphor-icons/react';
import { WorkbenchPage } from '../../../src/ui/WorkbenchPage';

export function DtsQuery() {
  return (
    <WorkbenchPage id="view-dts-query" title="DTS系统">
      <div className="workbench-empty" role="status">
        <span className="workbench-empty-icon" aria-hidden="true"><Bug size={28} /></span>
        <p>页面建设中</p>
      </div>
    </WorkbenchPage>
  );
}
