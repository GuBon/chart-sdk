import type { UserToken } from '@/lib/api';
import { cn } from '@/lib/cn';

export type TokenStatus = 'active' | 'expired' | 'revoked';

export function tokenStatus(t: UserToken): TokenStatus {
  if (!t.isActive) return 'revoked';
  if (new Date(t.expiresAt).getTime() < Date.now()) return 'expired';
  return 'active';
}

const META: Record<TokenStatus, { label: string; box: string; dot: string; text: string }> = {
  active: { label: '활성', box: 'bg-success/10', dot: 'bg-success', text: 'text-success' },
  expired: { label: '만료', box: 'bg-muted', dot: 'bg-text-tertiary', text: 'text-text-secondary' },
  revoked: { label: '회수됨', box: 'bg-danger/10', dot: 'bg-danger', text: 'text-danger' },
};

// S7 토큰 상태 뱃지(활성/만료/회수됨).
export function TokenStatusBadge({ status }: { status: TokenStatus }) {
  const m = META[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium', m.box, m.text)}>
      <span className={cn('size-1.5 rounded-full', m.dot)} />
      {m.label}
    </span>
  );
}
