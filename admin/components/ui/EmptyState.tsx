import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Props {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: Props) {
  return (
    <div className={cn('flex flex-col items-center gap-3 rounded-[10px] border border-dashed border-border bg-bg-panel py-20 text-center', className)}>
      {icon}
      <p className="text-base font-semibold text-text-primary">{title}</p>
      {description && <div className="text-[13px] text-text-secondary">{description}</div>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
