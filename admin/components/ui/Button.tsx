import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';

// Figma App Bar / 카드 액션 기준. variant·size 외형만 담당하고 동작은 호스트가 결정한다.
type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
type Size = 'md' | 'sm';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary/90',
  secondary: 'bg-bg-panel border border-border text-text-primary hover:bg-muted',
  danger: 'bg-danger text-white hover:bg-danger/90',
  ghost: 'text-text-secondary hover:bg-muted',
};

const SIZES: Record<Size, string> = {
  md: 'h-9 gap-1.5 px-4 text-sm', // Figma 새 차트 버튼: h-36, gap-6, text-14
  sm: 'h-8 gap-1 px-3 text-[13px]', // 카드 액션(편집·임베드)
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function Button({ variant = 'primary', size = 'md', icon, className, children, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30',
        'disabled:pointer-events-none disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
