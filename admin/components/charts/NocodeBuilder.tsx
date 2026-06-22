'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Play, X } from 'lucide-react';
import type { BuilderConfig, SchemaTable, WhereCond, YAxisField } from '@/lib/api';
import { AGG_CHOICES, BUCKET_CHOICES, OP_CHOICES, VALUELESS_OPS, isDateType, orderTargets } from '@/lib/builder';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';

// S2 중앙 노코드 구성 폼(259:191). builderConfig 를 편집하고 [실행]을 트리거한다.
interface Props {
  config: BuilderConfig;
  tables: SchemaTable[];
  onChange: (next: BuilderConfig) => void;
  onRun: () => void;
  running: boolean;
  generatedSql: string | null;
  sqlOpen: boolean;
  onToggleSql: () => void;
}

export function NocodeBuilder({ config, tables, onChange, onRun, running, generatedSql, sqlOpen, onToggleSql }: Props) {
  const columns = tables.find((t) => t.name === config.table)?.columns ?? [];
  const colOptions = columns.map((c) => ({ value: c.name, label: c.name }));
  const xType = columns.find((c) => c.name === config.xAxis)?.type;
  const canRun = !!config.table && !!config.xAxis && config.yAxis.length > 0;

  const patch = (p: Partial<BuilderConfig>) => onChange({ ...config, ...p });

  // 테이블 변경 시 컬럼 참조가 모두 무효 → 구성 초기화
  const changeTable = (table: string) =>
    onChange({ table, xAxis: null, xAxisBucket: null, yAxis: [], where: [], orderBy: null });

  const changeXAxis = (xAxis: string) => {
    const isDate = isDateType(columns.find((c) => c.name === xAxis)?.type);
    patch({ xAxis, xAxisBucket: isDate ? 'month' : null });
  };

  const setY = (i: number, p: Partial<YAxisField>) =>
    patch({ yAxis: config.yAxis.map((y, idx) => (idx === i ? { ...y, ...p } : y)) });
  const addY = () => patch({ yAxis: [...config.yAxis, { column: columns[0]?.name ?? '', agg: 'sum' }] });
  const removeY = (i: number) => patch({ yAxis: config.yAxis.filter((_, idx) => idx !== i) });

  const setW = (i: number, p: Partial<WhereCond>) =>
    patch({ where: config.where.map((w, idx) => (idx === i ? { ...w, ...p } : w)) });
  const addW = () => patch({ where: [...config.where, { column: columns[0]?.name ?? '', op: 'eq', value: '' }] });
  const removeW = (i: number) => patch({ where: config.where.filter((_, idx) => idx !== i) });

  return (
    <div
      className="flex flex-col"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canRun && !running) onRun();
      }}
    >
      {/* 구성 헤더 */}
      <div className="flex h-12 items-center gap-3 border-b border-border px-4">
        <span className="text-sm font-medium text-text-primary">노코드 구성</span>
        <div className="flex-1" />
        <span className="text-xs text-text-tertiary">Ctrl + Enter</span>
        <Button size="sm" icon={<Play className="size-3.5" />} disabled={!canRun || running} onClick={onRun}>
          {running ? '실행 중…' : '실행'}
        </Button>
      </div>

      {/* 구성 폼 */}
      <div className="flex flex-col gap-4 p-4">
        <Row label="테이블">
          <div className="w-60">
            <Select
              aria-label="테이블"
              value={config.table ?? ''}
              onChange={(e) => changeTable(e.target.value)}
              options={tables.map((t) => ({ value: t.name, label: t.name }))}
              placeholder="테이블 선택"
            />
          </div>
        </Row>

        <Row label="X축">
          <div className="w-60">
            <Select aria-label="X축" value={config.xAxis ?? ''} onChange={(e) => changeXAxis(e.target.value)} options={colOptions} placeholder="컬럼 선택" />
          </div>
          {isDateType(xType) && (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-text-secondary">묶기</span>
              <div className="w-28">
                <Select
                  value={config.xAxisBucket ?? 'month'}
                  onChange={(e) => patch({ xAxisBucket: e.target.value as BuilderConfig['xAxisBucket'] })}
                  options={BUCKET_CHOICES}
                />
              </div>
            </div>
          )}
        </Row>

        <Row label="Y축 · 집계">
          <div className="flex flex-col gap-2">
            {config.yAxis.map((y, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-44">
                  <Select value={y.column} onChange={(e) => setY(i, { column: e.target.value })} options={colOptions} placeholder="컬럼" />
                </div>
                <div className="w-36">
                  <Select value={y.agg} onChange={(e) => setY(i, { agg: e.target.value as YAxisField['agg'] })} options={AGG_CHOICES} />
                </div>
                <span className="text-[13px] text-text-secondary">별칭</span>
                <div className="w-28">
                  <Input size="sm" value={y.alias ?? ''} onChange={(e) => setY(i, { alias: e.target.value })} placeholder="(자동)" />
                </div>
                <button type="button" aria-label="시리즈 제거" onClick={() => removeY(i)} className="text-text-tertiary hover:text-danger">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <div className="flex items-center gap-3">
              <Button variant="secondary" size="sm" className="h-7" onClick={addY} disabled={!config.table}>
                + 시리즈 추가
              </Button>
              <span className="flex items-center gap-1.5 text-[13px] text-text-tertiary">
                시리즈 나누기
                <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-text-secondary">예정</span>
              </span>
            </div>
          </div>
        </Row>

        <Row label="조건">
          <div className="flex flex-col gap-2">
            {config.where.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-40">
                  <Select value={w.column} onChange={(e) => setW(i, { column: e.target.value })} options={colOptions} placeholder="컬럼" />
                </div>
                <div className="w-32">
                  <Select value={w.op} onChange={(e) => setW(i, { op: e.target.value as WhereCond['op'] })} options={OP_CHOICES} />
                </div>
                {!VALUELESS_OPS.includes(w.op) && (
                  <div className="w-36">
                    <Input size="sm" value={String(w.value ?? '')} onChange={(e) => setW(i, { value: e.target.value })} placeholder="값" />
                  </div>
                )}
                <button type="button" aria-label="조건 제거" onClick={() => removeW(i)} className="text-text-tertiary hover:text-danger">
                  <X className="size-3.5" />
                </button>
              </div>
            ))}
            <Button variant="secondary" size="sm" className="h-7" onClick={addW} disabled={!config.table}>
              + 조건 추가
            </Button>
          </div>
        </Row>

        <Row label="정렬">
          <div className="w-40">
            <Select
              value={config.orderBy?.target ?? ''}
              onChange={(e) => patch({ orderBy: e.target.value ? { target: e.target.value, direction: config.orderBy?.direction ?? 'desc' } : null })}
              options={orderTargets(config)}
              placeholder="없음"
            />
          </div>
          {config.orderBy && (
            <div className="w-28">
              <Select
                value={config.orderBy.direction}
                onChange={(e) => patch({ orderBy: { target: config.orderBy!.target, direction: e.target.value as 'asc' | 'desc' } })}
                options={[{ value: 'asc', label: '오름차순' }, { value: 'desc', label: '내림차순' }]}
              />
            </div>
          )}
        </Row>
      </div>

      {/* 생성된 SQL 보기 (기본 접힘) */}
      <div className="border-t border-border">
        <button type="button" onClick={onToggleSql} className="flex w-full items-center gap-2 px-4 py-2.5 text-left">
          {sqlOpen ? <ChevronDown className="size-3.5 text-text-secondary" /> : <ChevronRight className="size-3.5 text-text-secondary" />}
          <span className="text-[13px] text-text-primary">생성된 SQL 보기</span>
          <span className="text-xs text-text-tertiary">· 읽기 전용</span>
        </button>
        {sqlOpen && (
          <pre className="mx-4 mb-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-text-primary">
            {generatedSql || '실행하면 생성된 SQL이 표시됩니다.'}
          </pre>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 pt-1.5 text-[13px] text-text-secondary">{label}</span>
      <div className="flex flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
