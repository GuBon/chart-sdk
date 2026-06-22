import { cn } from '@/lib/cn';

// Figma 세그먼트 컨트롤(옵션 패널 variant·위치 등). bg-muted 트랙 + 활성 흰색 칩.
interface Props<T extends string | number> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}

export function Segmented<T extends string | number>({ value, options, onChange }: Props<T>) {
  return (
    <div className="inline-flex rounded-md bg-muted p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          onClick={() => onChange(o.value)}
          className={cn(
            'rounded px-2.5 py-1 text-[13px] transition-colors',
            o.value === value ? 'bg-bg-panel font-medium text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
