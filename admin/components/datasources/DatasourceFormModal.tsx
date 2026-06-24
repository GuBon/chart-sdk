'use client';

import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { ApiError, datasourcesApi } from '@/lib/api';
import type { Datasource, DatasourceInput } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

// Figma S5 추가/수정 모달(277:374). 수정 시 비밀번호는 빈 값이면 변경하지 않는다(API 4A).
interface Props {
  mode: 'create' | 'edit';
  initial?: Datasource;
  onClose: () => void;
  onSaved: () => void;
}

type TestResult = { ok: boolean; message: string } | null;

export function DatasourceFormModal({ mode, initial, onClose, onSaved }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [host, setHost] = useState(initial?.host ?? '');
  const [port, setPort] = useState(String(initial?.port ?? 5432));
  const [databaseName, setDatabaseName] = useState(initial?.databaseName ?? '');
  const [dbUser, setDbUser] = useState(initial?.dbUser ?? '');
  const [dbPassword, setDbPassword] = useState('');
  const [maxPoolSize, setMaxPoolSize] = useState(String(initial?.maxPoolSize ?? 5));
  const [advanced, setAdvanced] = useState(false);

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = name.trim() && host.trim() && databaseName.trim() && dbUser.trim() && (mode === 'edit' || dbPassword.trim());

  const buildInput = (): DatasourceInput => ({
    name: name.trim(),
    host: host.trim(),
    port: Number(port) || 5432,
    databaseName: databaseName.trim(),
    dbUser: dbUser.trim(),
    maxPoolSize: Number(maxPoolSize) || 5,
    ...(dbPassword ? { dbPassword } : {}),
  });

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const { name: _drop, ...creds } = buildInput();
      setTestResult(await datasourcesApi.test(creds));
    } catch (e) {
      setTestResult({ ok: false, message: e instanceof ApiError ? e.message : '연결 실패' });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      if (mode === 'create') await datasourcesApi.create(buildInput());
      else await datasourcesApi.update(initial!.id, buildInput());
      onSaved();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '저장에 실패했습니다.');
      setSaving(false);
    }
  };

  return (
    <Modal
      title={mode === 'create' ? '데이터소스 추가' : '데이터소스 수정'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" size="sm" className="h-[34px]" onClick={onClose}>
            취소
          </Button>
          <Button size="sm" className="h-[34px]" disabled={!valid || saving} onClick={handleSave}>
            {saving ? '저장 중…' : '저장'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="이름">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="analytics-db" />
        </Field>

        <div className="flex gap-3">
          <Field label="호스트" className="flex-1">
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="db.internal" />
          </Field>
          <Field label="포트" className="w-32">
            <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" placeholder="5432" />
          </Field>
        </div>

        <Field label="데이터베이스">
          <Input value={databaseName} onChange={(e) => setDatabaseName(e.target.value)} placeholder="analytics" />
        </Field>

        <div className="flex gap-3">
          <Field label="계정" className="flex-1">
            <Input value={dbUser} onChange={(e) => setDbUser(e.target.value)} placeholder="reader" />
          </Field>
          <Field label="비밀번호" className="flex-1">
            <Input
              type="password"
              value={dbPassword}
              onChange={(e) => setDbPassword(e.target.value)}
              placeholder={mode === 'edit' ? '변경 시에만 입력' : ''}
            />
          </Field>
        </div>

        <p className="rounded-md bg-info/10 px-3 py-2.5 text-xs text-info">
          읽기 전용(SELECT 권한만 있는) 계정을 권장합니다. 비밀번호는 암호화되어 저장되며 다시 표시되지 않습니다.
        </p>

        <button type="button" onClick={() => setAdvanced((v) => !v)} className="flex items-center gap-1.5 text-xs">
          <ChevronRight className={`size-4 text-text-secondary transition-transform ${advanced ? 'rotate-90' : ''}`} />
          <span className="font-medium text-[#484848]">고급 설정</span>
          <span className="text-text-tertiary">커넥션 상한(max_pool_size) · 기본 5 — 운영 DB 보호</span>
        </button>
        {advanced && (
          <Field label="커넥션 상한 (max_pool_size)" className="w-40">
            <Input value={maxPoolSize} onChange={(e) => setMaxPoolSize(e.target.value)} inputMode="numeric" />
          </Field>
        )}

        <div className="flex items-center gap-2.5">
          <Button variant="secondary" size="sm" className="h-[34px]" disabled={testing} onClick={handleTest}>
            {testing ? '테스트 중…' : '연결 테스트'}
          </Button>
          {testResult && (
            <span className="flex items-center gap-1.5 text-xs">
              <span className={`size-2 rounded-full ${testResult.ok ? 'bg-success' : 'bg-danger'}`} />
              <span className={testResult.ok ? 'text-success' : 'text-danger'}>{testResult.message}</span>
            </span>
          )}
        </div>

        {error && <p className="text-xs text-danger">{error}</p>}
      </div>
    </Modal>
  );
}
