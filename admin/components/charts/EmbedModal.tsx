'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy } from 'lucide-react';
import { tokensApi, usersApi } from '@/lib/api';
import type { ChartSummary, User, UserToken } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';

// S3 임베드 코드 모달(273:366). 코드 조립·복사만 담당(토큰 발급/회수는 S7).
// SDK 배포 경로: NEXT_PUBLIC_SDK_SRC 우선, 없으면 현재 출처 기준(/sdk.js).
function sdkSrc() {
  if (process.env.NEXT_PUBLIC_SDK_SRC) return process.env.NEXT_PUBLIC_SDK_SRC;
  return typeof window !== 'undefined' ? `${window.location.origin}/sdk.js` : '/sdk.js';
}

// SDK 파일을 Admin/CDN에서 내려도 데이터는 Spring API에서 읽어야 한다.
// E2E의 MSW 모드는 현재 출처가 API 역할까지 하므로 실제 API 환경변수를 의도적으로 무시한다.
function apiBase() {
  const configured = process.env.NEXT_PUBLIC_E2E_MSW === 'true'
    ? ''
    : process.env.NEXT_PUBLIC_API_BASE;
  if (configured) return configured.replace(/\/+$/, '');
  return typeof window !== 'undefined' ? window.location.origin : '';
}

function snippet(chartId: number, token: string) {
  return `<div data-chart-id="${chartId}"\n     data-auth-token="${token}"></div>\n<script src="${sdkSrc()}"\n        data-api-base="${apiBase()}"></script>`;
}

export function EmbedModal({ chart, onClose }: { chart: Pick<ChartSummary, 'id'>; onClose: () => void }) {
  const [tokens, setTokens] = useState<UserToken[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [tokenId, setTokenId] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void Promise.all([tokensApi.list(), usersApi.list()]).then(([t, u]) => {
      setTokens(t);
      setUsers(u);
      const active = t.find((x) => x.isActive);
      if (active) setTokenId(active.tokenId);
    });
  }, []);

  const active = tokens.filter((t) => t.isActive);
  const selected = tokens.find((t) => t.tokenId === tokenId);
  const userName = (uid: number) => users.find((u) => u.id === uid)?.username ?? `user#${uid}`;
  const code = selected?.token ? snippet(chart.id, selected.token) : '';

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
  };
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Modal title="임베드 코드" width={520} onClose={onClose}>
      {active.length === 0 ? (
        <div className="flex flex-col items-start gap-3 py-2">
          <p className="text-[13px] text-text-secondary">활성 토큰이 없습니다. 임베드하려면 먼저 토큰을 발급하세요.</p>
          <Link href="/tokens">
            <Button size="sm" className="h-8">토큰 관리로 이동</Button>
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <Field label="사용자 토큰">
            <Select
              aria-label="사용자 토큰"
              value={tokenId ?? ''}
              onChange={(e) => setTokenId(Number(e.target.value))}
              options={active.map((t) => ({ value: t.tokenId, label: `${userName(t.userId)} — 만료 ${t.expiresAt.slice(0, 10)} · 활성` }))}
            />
          </Field>
          <p className="text-sm text-text-secondary">선택한 토큰이 포함된 코드를 페이지에 붙여넣으세요</p>
          <pre className="overflow-x-auto rounded-md bg-muted px-3.5 py-3 font-mono text-[13px] leading-[22px] text-text-primary">{code}</pre>
          <div className="flex justify-end">
            <Button variant="secondary" size="sm" className="h-8" icon={<Copy className="size-3.5" />} onClick={copy}>
              {copied ? '복사되었습니다' : '복사'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
