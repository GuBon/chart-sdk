import { cn } from '@/lib/cn';

// 연결 상태 점 + 라벨. lastTestOk: true=연결됨 / false=연결 실패 / null=미확인.
export function StatusDot({ ok }: { ok: boolean | null }) {
  const meta =
    ok === true
      ? { color: 'bg-success', label: '연결됨' }
      : ok === false
        ? { color: 'bg-danger', label: '연결 실패' }
        : { color: 'bg-text-tertiary', label: '미확인' };
  return (
    <span className="flex items-center gap-1.5 text-[13px] text-text-primary">
      <span className={cn('size-2 rounded-full', meta.color)} />
      {meta.label}
    </span>
  );
}
