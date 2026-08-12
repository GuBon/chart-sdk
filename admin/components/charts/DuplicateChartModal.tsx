'use client';

import { useState } from 'react';
import { apiErrorMessage, chartsApi } from '@/lib/api';
import type { Chart, ChartSummary } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

// 차트 복제 확인(설계 M3, 옵션1). 삭제와 달리 비파괴 액션이라 경고 문구는 가볍게 둔다.
// 복제 아이콘이 삭제 아이콘 바로 옆이라 오클릭 방지를 위해 확인 한 번만 받는다.
export function DuplicateChartModal({
  chart,
  onClose,
  onDuplicated,
}: {
  chart: ChartSummary;
  onClose: () => void;
  onDuplicated: (copy: Chart) => void;
}) {
  const [duplicating, setDuplicating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDuplicate = async () => {
    setDuplicating(true);
    setError(null);
    try {
      const copy = await chartsApi.duplicate(chart.id);
      onDuplicated(copy);
    } catch (e) {
      setError(apiErrorMessage(e, '복제에 실패했습니다.'));
      setDuplicating(false);
    }
  };

  return (
    <Modal
      title="차트 복제"
      width={400}
      divided={false}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" className="h-[34px]" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" className="h-[34px]" disabled={duplicating} onClick={handleDuplicate}>
            {duplicating ? '복사 중…' : '복사'}
          </Button>
        </>
      }
    >
      <p className="break-words text-[13px] text-text-secondary">
        ‘{chart.name}’을(를) 복사할까요? 같은 구성의 사본이 목록에 추가됩니다.
      </p>
      {error && <p className="mt-2 text-xs text-danger">{error}</p>}
    </Modal>
  );
}
