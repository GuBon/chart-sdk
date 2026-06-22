import { cn } from '@/lib/cn';

// Figma Switch (옵션 패널 토글). checked/unchecked 상태만.
export function Switch({ checked, onChange, 'aria-label': ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; 'aria-label'?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      className={cn('relative h-[18px] w-8 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-border')}
    >
      <span className={cn('absolute top-0.5 size-3.5 rounded-full bg-white transition-all', checked ? 'left-[15px]' : 'left-0.5')} />
    </button>
  );
}
