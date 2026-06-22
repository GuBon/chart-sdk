import type { InputHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Figma 입력 — 모달 폼(h-36=md) / 빌더·툴바 행(h-32=sm). icon 지정 시 좌측 슬롯 래퍼.
interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  icon?: ReactNode;
  wrapperClassName?: string;
  size?: 'sm' | 'md';
}

const HEIGHTS = { sm: 'h-8', md: 'h-9' } as const;

export function Input({ icon, className, wrapperClassName, size = 'md', ...props }: InputProps) {
  const field = cn(
    'rounded-md border border-border bg-bg-panel px-3 text-[13px] text-text-primary placeholder:text-text-secondary',
    HEIGHTS[size],
  );

  if (!icon) {
    return (
      <input className={cn(field, 'w-full outline-none focus-visible:ring-2 focus-visible:ring-primary/20', className)} {...props} />
    );
  }
  return (
    <div className={cn(field, 'flex items-center gap-2 focus-within:ring-2 focus-within:ring-primary/20', wrapperClassName)}>
      <span className="shrink-0 text-text-secondary opacity-45">{icon}</span>
      <input
        className={cn('min-w-0 flex-1 bg-transparent text-[13px] text-text-primary placeholder:text-text-secondary outline-none', className)}
        {...props}
      />
    </div>
  );
}
