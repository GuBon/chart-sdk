import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

// 네이티브 select 래퍼 — 접근성·키보드 기본 동작을 그대로 쓰고 chevron 만 덧붙인다.
// MVP 전반의 드롭다운(빌더 폼·옵션 패널)이 공유한다.
interface Option {
  value: string | number;
  label: string;
}

interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'children'> {
  options: Option[];
  placeholder?: string;
}

export function Select({ options, placeholder, className, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        className={cn(
          'h-8 w-full appearance-none rounded-md border border-border bg-bg-panel pl-3 pr-8 text-[13px] text-text-primary outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50',
          className,
        )}
        {...props}
      >
        {placeholder != null && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-text-secondary" />
    </div>
  );
}
