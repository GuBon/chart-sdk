'use client';

import { useCallback, useEffect, useState } from 'react';
import { Database, Plus } from 'lucide-react';
import { datasourcesApi } from '@/lib/api';
import type { Datasource } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { DatasourceTable } from '@/components/datasources/DatasourceTable';
import { DatasourceFormModal } from '@/components/datasources/DatasourceFormModal';
import { DeleteDatasourceModal } from '@/components/datasources/DeleteDatasourceModal';
import { EmptyState } from '@/components/ui/EmptyState';

type Modal = null | { type: 'create' } | { type: 'edit'; ds: Datasource } | { type: 'delete'; ds: Datasource };

export default function DatasourcesPage() {
  const [list, setList] = useState<Datasource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [testingId, setTestingId] = useState<number | null>(null);

  const reload = useCallback(async () => {
    try {
      setList(await datasourcesApi.list());
    } catch {
      setError('데이터소스를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleTest = async (ds: Datasource) => {
    setTestingId(ds.id);
    try {
      const { ok } = await datasourcesApi.test({ id: ds.id, host: ds.host, port: ds.port, databaseName: ds.databaseName, dbUser: ds.dbUser });
      setList((prev) => prev?.map((d) => (d.id === ds.id ? { ...d, lastTestOk: ok } : d)) ?? prev);
    } finally {
      setTestingId(null);
    }
  };

  const closeAndReload = () => {
    setModal(null);
    void reload();
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] pt-2">
      <header className="mb-5 flex items-center gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold text-text-primary">데이터소스</h1>
          <p className="text-[13px] text-text-secondary">
            차트가 데이터를 조회할 PostgreSQL 데이터베이스를 등록·관리합니다. 읽기 전용 계정을 권장합니다.
          </p>
        </div>
        <div className="flex-1" />
        <Button size="sm" className="h-9" icon={<Plus className="size-4" />} onClick={() => setModal({ type: 'create' })}>
          데이터소스 추가
        </Button>
      </header>

      {error && <p className="text-[13px] text-danger">{error}</p>}

      {list && list.length === 0 && (
        <EmptyState
          icon={<Database className="size-8 text-text-tertiary" />}
          title="데이터소스를 먼저 등록하세요"
          description="차트를 만들려면 조회할 데이터베이스가 최소 1개 필요합니다."
          action={<Button size="sm" className="h-9" icon={<Plus className="size-4" />} onClick={() => setModal({ type: 'create' })}>데이터소스 추가</Button>}
        />
      )}

      {list && list.length > 0 && (
        <DatasourceTable
          datasources={list}
          testingId={testingId}
          onTest={handleTest}
          onEdit={(ds) => setModal({ type: 'edit', ds })}
          onDelete={(ds) => setModal({ type: 'delete', ds })}
        />
      )}

      {modal?.type === 'create' && <DatasourceFormModal mode="create" onClose={() => setModal(null)} onSaved={closeAndReload} />}
      {modal?.type === 'edit' && <DatasourceFormModal mode="edit" initial={modal.ds} onClose={() => setModal(null)} onSaved={closeAndReload} />}
      {modal?.type === 'delete' && <DeleteDatasourceModal datasource={modal.ds} onClose={() => setModal(null)} onDeleted={closeAndReload} />}
    </div>
  );
}
