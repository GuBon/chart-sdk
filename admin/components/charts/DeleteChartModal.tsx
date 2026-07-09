'use client';

import { useState } from 'react';
import { ApiError, chartsApi } from '@/lib/api';
import type { ChartSummary } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

// S1 삭제확인(187:48). 토큰은 사용자 귀속이라 삭제되지 않음(화면설계 3.3).
export function DeleteChartModal({ chart, onClose, onDeleted }: { chart: ChartSummary; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await chartsApi.remove(chart.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '삭제에 실패했습니다.');
      setDeleting(false);
    }
  };

  return (
    <Modal
      title="차트 삭제"
      width={400}
      divided={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" className="h-[34px]" onClick={onClose}>
            취소
          </Button>
          <Button variant="danger" size="sm" className="h-[34px]" disabled={deleting} onClick={handleDelete}>
            {deleting ? '삭제 중…' : '삭제'}
          </Button>
        </>
      }
    >
      <p className="break-words text-[13px] text-text-secondary">
        ‘{chart.name}’ 차트를 삭제할까요? 이 차트를 임베드한 모든 페이지에서 차트가 더 이상 표시되지 않습니다. 발급된 토큰은 사용자에 귀속되어 삭제되지 않습니다.
      </p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Modal>
  );
}
