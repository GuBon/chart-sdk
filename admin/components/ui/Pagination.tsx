import { Button } from './Button';

interface Props {
  page: number;
  totalPages: number;
  onChange: (page: number) => void;
  className?: string;
  compact?: boolean;
}

export function Pagination({ page, totalPages, onChange, className = 'mt-5', compact = false }: Props) {
  if (totalPages <= 1) return null;
  return (
    <div className={`${className} flex items-center justify-center gap-3`}>
      <Button variant="secondary" size="sm" className={compact ? 'h-7' : 'h-8'} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        이전
      </Button>
      <span className={`${compact ? 'min-w-16 text-xs' : 'min-w-24 text-[13px]'} text-center text-text-secondary`}>
        {page} / {totalPages}
      </span>
      <Button variant="secondary" size="sm" className={compact ? 'h-7' : 'h-8'} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        다음
      </Button>
    </div>
  );
}
