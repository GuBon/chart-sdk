import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

// 폼 필드 래퍼 — 라벨(12px Medium #737373) + 컨트롤. Figma 모달 field/* 와 동일.
export function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
      {children}
    </div>
  );
}
