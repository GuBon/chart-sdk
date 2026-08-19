'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Copy } from 'lucide-react';
import { apiErrorMessage, embedKeysApi } from '@/lib/api';
import type { ChartSummary, EmbedKeySummary, IssuedEmbedKey } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

// S3 임베드 코드 모달(273:366). 임베드 키 발급·코드 조립·복사 담당.
// 차트 ID는 임베드 코드에 넣지 않는다 — (사용자, 차트)에 묶인 불투명 임베드 키만 노출한다(계약 6.1).
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

function snippet(embedKey: string) {
  return `<div data-embed-key="${embedKey}"></div>\n<script src="${sdkSrc()}"\n        data-api-base="${apiBase()}"></script>`;
}

function summaryFromIssued(issued: IssuedEmbedKey): EmbedKeySummary {
  return {
    id: issued.id,
    chartId: issued.chartId,
    userId: issued.userId,
    expiresAt: issued.expiresAt,
    status: issued.status,
    createdAt: issued.createdAt,
    revokedAt: issued.revokedAt,
    revokedReason: issued.revokedReason,
  };
}

export function EmbedModal({ chart, onClose }: {
  chart: Pick<ChartSummary, 'id'>;
  onClose: () => void;
  /** 내부 이동 훅 — 차트 에디터처럼 미저장 이탈 가드가 필요한 호스트가 주입한다. 없으면 일반 링크. */
  onNavigate?: (path: string) => void;
}) {
  const [summaries, setSummaries] = useState<EmbedKeySummary[]>([]);
  // 원문 키는 발급한 이 모달 인스턴스의 메모리에만 둔다. 목록·스토리지에서는 복원하지 않는다.
  const [revealed, setRevealed] = useState<IssuedEmbedKey | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mutation, setMutation] = useState<'idle' | 'issuing' | 'revoking'>('idle');
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [refreshWarning, setRefreshWarning] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const codeRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(false);
    void embedKeysApi.listForChart(chart.id)
      .then((keys) => {
        if (!alive) return;
        setSummaries(keys);
      })
      // 로딩/실패를 "키 없음"으로 오표시하지 않도록 상태를 분리한다.
      .catch(() => { if (alive) setLoadError(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [chart.id]);

  const activeKey = summaries.find((key) => key.status === 'ACTIVE');
  const revealedKey = revealed?.status === 'ACTIVE' ? revealed : null;
  const code = revealedKey ? snippet(revealedKey.embedKey) : '';

  const optimisticIssue = useCallback((issued: IssuedEmbedKey) => {
    setSummaries((current) => [
      ...current.map((key) => key.chartId === issued.chartId && key.userId === issued.userId && key.status === 'ACTIVE'
        ? { ...key, status: 'REVOKED' as const, revokedReason: 'ROTATED', revokedAt: new Date().toISOString() }
        : key),
      summaryFromIssued(issued),
    ]);
  }, []);

  const issue = useCallback(async () => {
    if (mutation !== 'idle') return;
    if (activeKey && !window.confirm('재발급하면 현재 배포된 임베드 키가 즉시 무효화됩니다. 새 키를 발급할까요?')) return;
    setMutation('issuing');
    setMutationError(null);
    setRefreshWarning(null);
    try {
      const issued = await embedKeysApi.issue(chart.id);
      setRevealed(issued);
      optimisticIssue(issued);
      // 발급 성공과 후속 목록 동기화는 별개다. GET 실패가 이미 받은 원문 키를 지우면 안 된다.
      try {
        setSummaries(await embedKeysApi.listForChart(chart.id));
      } catch {
        setRefreshWarning('키는 발급됐지만 목록을 새로고침하지 못했습니다. 지금 표시된 코드는 복사할 수 있습니다.');
      }
    } catch (e) {
      setMutationError(apiErrorMessage(e, '임베드 키 발급에 실패했습니다.'));
    } finally {
      setMutation('idle');
    }
  }, [activeKey, chart.id, mutation, optimisticIssue]);

  const revoke = useCallback(async () => {
    if (!activeKey || mutation !== 'idle') return;
    if (!window.confirm('이 키를 회수하면 현재 배포된 임베드가 즉시 중단됩니다. 계속할까요?')) return;
    setMutation('revoking');
    setMutationError(null);
    setRefreshWarning(null);
    try {
      await embedKeysApi.revoke(activeKey.id);
      setSummaries((current) => current.map((key) => key.id === activeKey.id
        ? { ...key, status: 'REVOKED', revokedReason: 'MANUAL', revokedAt: new Date().toISOString() }
        : key));
      setRevealed((current) => current?.id === activeKey.id ? null : current);
    } catch (error) {
      setMutationError(apiErrorMessage(error, '임베드 키 회수에 실패했습니다.'));
    } finally {
      setMutation('idle');
    }
  }, [activeKey, mutation]);

  const copy = async () => {
    if (!code) return;
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // 클립보드 접근이 거부되는 환경(엄격한 브라우저 정책 등)에서 조용히 실패하지 않도록,
      // 코드 블록 전체를 선택해 사용자가 바로 Ctrl+C 할 수 있게 하고 안내를 띄운다(설계 L2).
      selectCode();
      setCopyFailed(true);
    }
  };
  const selectCode = () => {
    const pre = codeRef.current;
    const selection = window.getSelection();
    if (!pre || !selection) return;
    const range = document.createRange();
    range.selectNodeContents(pre);
    selection.removeAllRanges();
    selection.addRange(range);
  };
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <Modal title="임베드 코드" width={520} onClose={onClose}>
      {loading ? (
        <p className="py-6 text-center text-[13px] text-text-secondary">임베드 키를 불러오는 중…</p>
      ) : loadError ? (
        <p className="py-6 text-center text-[13px] text-danger">임베드 키 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>
      ) : (
        <div className="flex flex-col gap-3.5">
          {revealedKey ? (
            <>
              <p className="text-sm text-text-secondary">
                방금 발급한 키입니다. 이 창을 닫으면 원문을 다시 볼 수 없습니다 (만료 {revealedKey.expiresAt.slice(0, 10)}).
              </p>
              <pre ref={codeRef} className="overflow-x-auto rounded-md bg-muted px-3.5 py-3 font-mono text-[13px] leading-[22px] text-text-primary">{code}</pre>
              {copyFailed && (
                <p className="text-xs text-danger" role="alert">
                  클립보드 접근이 차단되어 자동 복사에 실패했습니다. 위 코드가 선택되어 있으니 Ctrl+C로 복사하세요.
                </p>
              )}
              <div className="flex items-center justify-between gap-2">
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" className="h-8" disabled={mutation !== 'idle'} onClick={revoke}>
                    {mutation === 'revoking' ? '회수 중…' : '키 회수'}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-8" disabled={mutation !== 'idle'} onClick={issue}>
                    {mutation === 'issuing' ? '재발급 중…' : '재발급'}
                  </Button>
                </div>
                <Button variant="secondary" size="sm" className="h-8" icon={<Copy className="size-3.5" />} onClick={copy}>
                  {copied ? '복사되었습니다' : '복사'}
                </Button>
              </div>
              <p className="text-xs text-text-secondary">재발급하면 내 기존 키는 즉시 무효화됩니다.</p>
            </>
          ) : activeKey ? (
            <div className="flex flex-col items-start gap-3 py-1">
              <p className="text-[13px] text-text-secondary">
                내 임베드 키가 활성 상태입니다 (만료 {activeKey.expiresAt.slice(0, 10)}). 보안을 위해 기존 키 원문은 다시 표시하지 않습니다.
              </p>
              <div className="flex gap-2">
                <Button size="sm" className="h-8" disabled={mutation !== 'idle'} onClick={issue}>
                  {mutation === 'issuing' ? '재발급 중…' : '새 키 발급'}
                </Button>
                <Button variant="secondary" size="sm" className="h-8 text-danger" disabled={mutation !== 'idle'} onClick={revoke}>
                  {mutation === 'revoking' ? '회수 중…' : '키 회수'}
                </Button>
              </div>
              <p className="text-xs text-text-secondary">새 키를 발급하면 기존 키는 즉시 무효화됩니다.</p>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-3 py-1">
              <p className="text-[13px] text-text-secondary">이 차트에 발급된 내 임베드 키가 없습니다.</p>
              <Button size="sm" className="h-8" disabled={mutation !== 'idle'} onClick={issue}>
                {mutation === 'issuing' ? '발급 중…' : '임베드 키 발급'}
              </Button>
            </div>
          )}
          {mutationError && (
            <p className="text-xs text-danger" role="alert">{mutationError}</p>
          )}
          {refreshWarning && (
            <p className="text-xs text-amber-700" role="status">{refreshWarning}</p>
          )}
        </div>
      )}
    </Modal>
  );
}
