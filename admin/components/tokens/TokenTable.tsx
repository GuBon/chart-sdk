import type { User, UserToken } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { TokenStatusBadge, tokenStatus } from './TokenStatusBadge';

// S7 토큰 테이블(279:455). 표시 전용 — 회수/재발급은 콜백.
interface Props {
  tokens: UserToken[];
  users: User[];
  onRevoke: (t: UserToken) => void;
  onReissue: (t: UserToken) => void;
  /** 재발급 진행 중인 토큰 id — 해당 버튼을 비활성화해 더블클릭 중복 발급을 막는다. */
  reissuingId?: number | null;
}

const TH = 'px-0 text-left text-xs font-medium text-text-secondary';
const preview = (token?: string) => (token ? `${token.slice(0, 20)}…${token.slice(-4)}` : '—');

export function TokenTable({ tokens, users, onRevoke, onReissue, reissuingId }: Props) {
  const nameOf = (uid: number) => users.find((u) => u.id === uid)?.username ?? `user#${uid}`;
  // 재발급이 하나라도 진행 중이면 모든 행의 재발급·회수 버튼을 비활성화한다(진행 중 행만 "재발급 중…").
  const busy = reissuingId != null;
  return (
    <div className="w-full overflow-hidden rounded-[10px] border border-border bg-bg-panel">
      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[150px]" />
          <col className="w-[320px]" />
          <col className="w-[140px]" />
          <col className="w-[140px]" />
          <col className="w-[130px]" />
          <col className="w-[180px]" />
        </colgroup>
        <thead>
          <tr className="h-10 bg-muted/60">
            <th className={`${TH} pl-5`}>사용자</th>
            <th className={TH}>토큰</th>
            <th className={TH}>발급일</th>
            <th className={TH}>만료</th>
            <th className={TH}>상태</th>
            <th className={`${TH} pr-5`}>작업</th>
          </tr>
        </thead>
        <tbody>
          {tokens.map((t) => {
            const status = tokenStatus(t);
            const name = nameOf(t.userId);
            return (
              <tr key={t.tokenId} className="h-[52px] border-t border-border">
                <td className="truncate pl-5 text-[13px] font-medium text-text-primary" title={name}>{name}</td>
                {/* 토큰은 마스킹이 설계(전체는 임베드 모달에서만) — title 로도 원문을 노출하지 않는다 */}
                <td className="truncate font-mono text-xs text-text-secondary">{preview(t.token)}</td>
                <td className="text-[13px] text-text-secondary">{t.createdAt?.slice(0, 10) ?? '—'}</td>
                <td className="text-[13px] text-text-secondary">{t.expiresAt.slice(0, 10)}</td>
                <td>
                  <TokenStatusBadge status={status} />
                </td>
                <td className="pr-5">
                  {status === 'active' ? (
                    <div className="flex gap-1.5">
                      <Button variant="secondary" size="sm" className="h-7 rounded-[7px] border-danger/40 text-xs text-danger" disabled={busy} onClick={() => onRevoke(t)}>
                        회수
                      </Button>
                      <Button variant="secondary" size="sm" className="h-7 rounded-[7px] text-xs" disabled={busy} onClick={() => onReissue(t)}>
                        {reissuingId === t.tokenId ? '재발급 중…' : '재발급'}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[13px] text-text-tertiary">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
