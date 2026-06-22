'use client';

import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { ApiError, datasourcesApi } from '@/lib/api';
import type { Datasource } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';

// Figma S5 삭제확인(276:459). 사용 중 차트가 있으면 서버가 409 로 거부 → 메시지 인라인.
export function DeleteDatasourceModal({ datasource, onClose, onDeleted }: { datasource: Datasource; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleDelete = async () => {
    setDeleting(true);
    setError(null);
    try {
      await datasourcesApi.remove(datasource.id);
      onDeleted();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '삭제에 실패했습니다.');
      setDeleting(false);
    }
  };

  return (
    <Modal
      title="데이터소스를 삭제할까요?"
      onClose={onClose}
      width={460}
      divided={false}
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
      <div className="flex flex-col gap-3">
        <p className="text-[13px] text-text-secondary">
          ‘{datasource.name}’ 데이터소스를 삭제합니다. 저장된 접속 정보가 제거되며 복구할 수 없습니다.
        </p>
        <div className="flex items-start gap-2 rounded-md border border-danger/30 bg-danger/5 px-3 py-2.5 text-xs text-danger">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
          <span>{error ?? '이 소스를 사용하는 차트가 데이터를 불러오지 못하게 됩니다.'}</span>
        </div>
      </div>
    </Modal>
  );
}
