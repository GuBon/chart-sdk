'use client';

import { useState } from 'react';
import { ApiError, tokensApi } from '@/lib/api';
import type { User, UserToken } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

// S7 회수확인(280:439). 회수 시 해당 사용자의 모든 임베드가 무효화된다(API 4.3).
export function RevokeTokenModal({ token, users, onClose, onRevoked }: { token: UserToken; users: User[]; onClose: () => void; onRevoked: () => void }) {
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = users.find((u) => u.id === token.userId)?.username ?? `user#${token.userId}`;

  const revoke = async () => {
    setRevoking(true);
    setError(null);
    try {
      await tokensApi.revoke(token.tokenId);
      onRevoked();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '회수에 실패했습니다.');
      setRevoking(false);
    }
  };

  return (
    <Modal
      title="토큰 회수"
      width={440}
      divided={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" className="h-[34px]" onClick={onClose}>
            취소
          </Button>
          <Button variant="danger" size="sm" className="h-[34px]" disabled={revoking} onClick={revoke}>
            {revoking ? '회수 중…' : '회수'}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-text-secondary">
        ‘{name}’ 사용자의 토큰을 회수합니다. 이 사용자의 토큰으로 임베드된 모든 차트가 표시되지 않게 됩니다. 회수는 되돌릴 수 없습니다.
      </p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Modal>
  );
}
