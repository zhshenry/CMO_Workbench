import type { ReactNode } from 'react';

export function WorkbenchPage({ id, title, className = '', children }: {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return <section className={`view on workbench-view ${className}`} id={id} aria-label={title}>
    {children}
  </section>;
}
