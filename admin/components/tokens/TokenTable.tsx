import type { User, UserToken } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { TokenStatusBadge, tokenStatus } from './TokenStatusBadge';

// S7 토큰 테이블(279:455). 표시 전용 — 회수/재발급은 콜백.
interface Props {
  tokens: UserToken[];
  users: User[];
  onRevoke: (t: UserToken) => void;
  onReissue: (t: UserToken) => void;
}

const TH = 'px-0 text-left text-xs font-medium text-text-secondary';
const preview = (token?: string) => (token ? `${token.slice(0, 20)}…${token.slice(-4)}` : '—');

export function TokenTable({ tokens, users, onRevoke, onReissue }: Props) {
  const nameOf = (uid: number) => users.find((u) => u.id === uid)?.username ?? `user#${uid}`;
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
            return (
              <tr key={t.tokenId} className="h-[52px] border-t border-border">
                <td className="pl-5 text-[13px] font-medium text-text-primary">{nameOf(t.userId)}</td>
                <td className="font-mono text-xs text-text-secondary">{preview(t.token)}</td>
                <td className="text-[13px] text-text-secondary">{t.createdAt?.slice(0, 10) ?? '—'}</td>
                <td className="text-[13px] text-text-secondary">{t.expiresAt.slice(0, 10)}</td>
                <td>
                  <TokenStatusBadge status={status} />
                </td>
                <td className="pr-5">
                  {status === 'active' ? (
                    <div className="flex gap-1.5">
                      <Button variant="secondary" size="sm" className="h-7 rounded-[7px] border-danger/40 text-xs text-danger" onClick={() => onRevoke(t)}>
                        회수
                      </Button>
                      <Button variant="secondary" size="sm" className="h-7 rounded-[7px] text-xs" onClick={() => onReissue(t)}>
                        재발급
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
