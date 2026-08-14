'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Database, Plus } from 'lucide-react';
import { apiErrorMessage, datasourcesApi } from '@/lib/api';
import type { Datasource } from '@/lib/api';

/** 연결 테스트 결과(성공·실패 공통) — 서버가 준 안전한 사유 message 를 그대로 담는다. */
type TestResult = { datasourceId: number; ok: boolean; message: string };
import { Button } from '@/components/ui/Button';
import { DatasourceTable } from '@/components/datasources/DatasourceTable';
import { DatasourceFormModal } from '@/components/datasources/DatasourceFormModal';
import { DeleteDatasourceModal } from '@/components/datasources/DeleteDatasourceModal';
import { EmptyState } from '@/components/ui/EmptyState';

type Modal = null | { type: 'create' } | { type: 'edit'; ds: Datasource } | { type: 'delete'; ds: Datasource };

export default function DatasourcesPage() {
  const [list, setList] = useState<Datasource[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [testingId, setTestingId] = useState<number | null>(null);
  // state(testingId) 반영 전 같은 틱 연속 클릭까지 막는 ref 잠금.
  const testLock = useRef(false);

  const reload = useCallback(async () => {
    try {
      setList(await datasourcesApi.list());
      setLoadError(null); // 이전 실패 후 재로드가 성공하면 오류 문구를 걷어낸다.
    } catch {
      setLoadError('데이터소스를 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleTest = async (ds: Datasource) => {
    if (testLock.current) return;
    testLock.current = true;
    setTestingId(ds.id);
    setTestResult(null); // 이전 결과 문구 제거
    try {
      const result = await datasourcesApi.test({ id: ds.id, host: ds.host, port: ds.port, databaseName: ds.databaseName, dbUser: ds.dbUser });
      setList((prev) => prev?.map((d) => (d.id === ds.id ? { ...d, lastTestOk: result.ok } : d)) ?? prev);
      // ok:false 는 HTTP 오류가 아니라 서버가 정상 분류한 연결 실패(HTTP 200)다. catch 에 오지 않으므로
      // 여기서 서버가 준 안전한 사유(자격 증명·DB 부재·연결 불가 등)를 반드시 그대로 표시한다.
      setTestResult({
        datasourceId: ds.id,
        ok: result.ok,
        message: result.message.trim() || (result.ok ? '연결에 성공했습니다.' : '연결 테스트에 실패했습니다.'),
      });
    } catch (e) {
      // HTTP 오류·네트워크 실패만 이 경로로 온다 — Admin API 에 도달하지 못했거나 서버가 5xx 로
      // 실패한 경우라 실제 고객 DB 연결은 시도되지 않았을 수 있다. 여기서 lastTestOk 배지를
      // 뒤집으면 멀쩡한 연결이 "실패"로 오표시되므로 배지는 유지하고 요청 실패만 알린다.
      const detail = apiErrorMessage(e, '');
      setTestResult({
        datasourceId: ds.id,
        ok: false,
        message: detail
          ? `연결 테스트 요청이 실패해 결과를 확인하지 못했습니다(${detail}). 기존 연결 상태 표시는 유지됩니다.`
          : '연결 테스트 요청이 실패해 결과를 확인하지 못했습니다. 기존 연결 상태 표시는 유지됩니다.',
      });
    } finally {
      setTestingId(null);
      testLock.current = false;
    }
  };

  // 편집·삭제·목록 재조회 시 오래된 테스트 문구는 걷어낸다.
  const openModal = (next: Modal) => {
    setTestResult(null);
    setModal(next);
  };

  const closeAndReload = () => {
    setModal(null);
    setTestResult(null);
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
        <Button size="sm" className="h-9" icon={<Plus className="size-4" />} onClick={() => openModal({ type: 'create' })}>
          데이터소스 추가
        </Button>
      </header>

      {loadError && <p className="text-[13px] text-danger">{loadError}</p>}

      {list && list.length === 0 && (
        <EmptyState
          icon={<Database className="size-8 text-text-tertiary" />}
          title="데이터소스를 먼저 등록하세요"
          description="차트를 만들려면 조회할 데이터베이스가 최소 1개 필요합니다."
          action={<Button size="sm" className="h-9" icon={<Plus className="size-4" />} onClick={() => openModal({ type: 'create' })}>데이터소스 추가</Button>}
        />
      )}

      {list && list.length > 0 && (
        <DatasourceTable
          datasources={list}
          testingId={testingId}
          testResult={testResult}
          onTest={handleTest}
          onEdit={(ds) => openModal({ type: 'edit', ds })}
          onDelete={(ds) => openModal({ type: 'delete', ds })}
        />
      )}

      {modal?.type === 'create' && <DatasourceFormModal mode="create" onClose={() => setModal(null)} onSaved={closeAndReload} />}
      {modal?.type === 'edit' && <DatasourceFormModal mode="edit" initial={modal.ds} onClose={() => setModal(null)} onSaved={closeAndReload} />}
      {modal?.type === 'delete' && <DeleteDatasourceModal datasource={modal.ds} onClose={() => setModal(null)} onDeleted={closeAndReload} />}
    </div>
  );
}
