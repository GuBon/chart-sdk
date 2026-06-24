'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Play, X } from 'lucide-react';
import type { BuilderConfig, ChartType, JoinSpec, SchemaTable, WhereCond, YAxisField } from '@/lib/api';
import {
  BUCKET_CHOICES,
  DEFAULT_SAMPLE_RATE,
  JOIN_TYPE_CHOICES,
  MAX_JOINS,
  OP_CHOICES,
  VALUELESS_OPS,
  activeTables,
  aggChoicesForChart,
  builderValidationIssue,
  builderWarning,
  columnsForBuilder,
  emptyJoin,
  isDateType,
  orderTargets,
} from '@/lib/builder';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';

// S2 중앙 노코드 구성 폼(259:191). builderConfig 를 편집하고 [실행]을 트리거한다.
interface Props {
  config: BuilderConfig;
  chartType: ChartType;
  tables: SchemaTable[];
  onChange: (next: BuilderConfig) => void;
  onRun: () => void;
  running: boolean;
  generatedSql: string | null;
  sqlOpen: boolean;
  onToggleSql: () => void;
}

export function NocodeBuilder({ config, chartType, tables, onChange, onRun, running, generatedSql, sqlOpen, onToggleSql }: Props) {
  // 조인 시 활성 테이블 전부 qualified, 미조인 시 base unqualified (생성규칙 11.2)
  const colOptions = columnsForBuilder(config, tables);
  const xType = colOptions.find((c) => c.value === config.xAxis)?.type;
  const isScatter = chartType === 'scatter';
  const isPie = chartType === 'pie';
  const yAggChoices = aggChoicesForChart(chartType);
  const validationIssue = builderValidationIssue(config, chartType, tables);
  const warning = builderWarning(config);
  const canRun = !validationIssue;
  const firstCol = colOptions[0]?.value ?? '';

  const patch = (p: Partial<BuilderConfig>) => onChange({ ...config, ...p });

  // 테이블 변경 시 컬럼·조인 참조가 모두 무효 → 구성 초기화
  const changeTable = (table: string) =>
    onChange({ table, joins: [], xAxis: null, xAxisBucket: null, yAxis: [], where: [], orderBy: null, sample: config.sample ?? null });

  const changeXAxis = (xAxis: string) => {
    const isDate = isDateType(colOptions.find((c) => c.value === xAxis)?.type);
    patch({ xAxis, xAxisBucket: isDate && !isScatter ? 'month' : null });
  };

  const setY = (i: number, p: Partial<YAxisField>) =>
    patch({ yAxis: config.yAxis.map((y, idx) => (idx === i ? { ...y, ...p } : y)) });
  const addY = () => patch({ yAxis: [...config.yAxis, { column: firstCol, agg: isScatter ? 'none' : 'sum' }] });
  const removeY = (i: number) => patch({ yAxis: config.yAxis.filter((_, idx) => idx !== i) });

  const setW = (i: number, p: Partial<WhereCond>) =>
    patch({ where: config.where.map((w, idx) => (idx === i ? { ...w, ...p } : w)) });
  const addW = () => patch({ where: [...config.where, { column: firstCol, op: 'eq', value: '' }] });
  const removeW = (i: number) => patch({ where: config.where.filter((_, idx) => idx !== i) });
  const changeWhereOp = (i: number, op: WhereCond['op']) => {
    const current = config.where[i]?.value;
    setW(i, { op, value: defaultValueForOp(op, current) });
  };

  // ── 조인 (생성규칙 11장) ──
  const joins = config.joins ?? [];
  const sampleDisabledByJoin = joins.length > 0;
  const colsOf = (t: string) => tables.find((x) => x.name === t)?.columns ?? [];
  const qualOpts = (tableNames: string[]) =>
    tableNames.flatMap((t) => colsOf(t).map((c) => ({ value: `${t}.${c.name}`, label: `${t}.${c.name}` })));
  const setJoin = (i: number, p: Partial<JoinSpec>) => patch({ joins: joins.map((j, idx) => (idx === i ? { ...j, ...p } : j)) });
  const setJoinOn = (i: number, side: 'leftColumn' | 'rightColumn', col: string) => setJoin(i, { on: { ...joins[i].on, [side]: col } });
  const changeJoinTable = (i: number, table: string) => setJoin(i, { table, on: { leftColumn: '', rightColumn: '' } });
  const removeJoin = (i: number) => patch({ joins: joins.filter((_, idx) => idx !== i) });
  const addJoin = () => {
    const used = activeTables(config);
    const next = tables.find((t) => !used.includes(t.name));
    if (next) patch({ joins: [...joins, emptyJoin(next.name)], sample: null });
  };
  const unusedTable = !!config.table && tables.some((t) => !activeTables(config).includes(t.name));

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
        {validationIssue ? (
          <span className="text-xs text-danger">{validationIssue}</span>
        ) : warning ? (
          <span className="text-xs text-amber-600">{warning}</span>
        ) : null}
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

        {/* 테이블 조인 (생성규칙 11장) — base 다음, 컬럼 참조는 qualified */}
        {config.table && (
          <Row label="조인">
            <div className="flex flex-col gap-2">
              {joins.map((j, i) => {
                const priorTables = [config.table!, ...joins.slice(0, i).map((x) => x.table)].filter(Boolean);
                const usedExceptSelf = activeTables(config).filter((t) => t !== j.table);
                const tableOpts = tables.filter((t) => !usedExceptSelf.includes(t.name)).map((t) => ({ value: t.name, label: t.name }));
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-36">
                      <Select aria-label="조인 테이블" value={j.table} onChange={(e) => changeJoinTable(i, e.target.value)} options={tableOpts} />
                    </div>
                    <div className="w-24">
                      <Select aria-label="조인 종류" value={j.type} onChange={(e) => setJoin(i, { type: e.target.value as JoinSpec['type'] })} options={JOIN_TYPE_CHOICES} />
                    </div>
                    <span className="text-[13px] text-text-secondary">ON</span>
                    <div className="w-40">
                      <Select aria-label="조인 기준 컬럼" value={j.on.leftColumn} onChange={(e) => setJoinOn(i, 'leftColumn', e.target.value)} options={qualOpts(priorTables)} placeholder="컬럼" />
                    </div>
                    <span className="text-[13px] text-text-secondary">=</span>
                    <div className="w-44">
                      <Select aria-label="조인 대상 컬럼" value={j.on.rightColumn} onChange={(e) => setJoinOn(i, 'rightColumn', e.target.value)} options={qualOpts([j.table])} placeholder="컬럼" />
                    </div>
                    <button type="button" aria-label="조인 제거" onClick={() => removeJoin(i)} className="text-text-tertiary hover:text-danger">
                      <X className="size-3.5" />
                    </button>
                  </div>
                );
              })}
              <div>
                <Button variant="secondary" size="sm" className="h-7" onClick={addJoin} disabled={!unusedTable}>
                  + 조인 추가
                </Button>
              </div>
            </div>
          </Row>
        )}

        <Row label="X축">
          <div className="w-60">
            <Select aria-label="X축" value={config.xAxis ?? ''} onChange={(e) => changeXAxis(e.target.value)} options={colOptions} placeholder="컬럼 선택" />
          </div>
          {isDateType(xType) && !isScatter && (
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
                  <Select value={y.agg} onChange={(e) => setY(i, { agg: e.target.value as YAxisField['agg'] })} options={yAggChoices} />
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
              <Button variant="secondary" size="sm" className="h-7" onClick={addY} disabled={!config.table || (isPie && config.yAxis.length >= 1)}>
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
                  <Select value={w.op} onChange={(e) => changeWhereOp(i, e.target.value as WhereCond['op'])} options={OP_CHOICES} />
                </div>
                <WhereValueControl cond={w} onChange={(value) => setW(i, { value })} />
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

        {!isScatter && (
        <Row label="표본 추출">
          <Switch
            aria-label="표본 추출"
            checked={!!config.sample && !sampleDisabledByJoin}
            disabled={sampleDisabledByJoin}
            onChange={(on) => {
              if (!sampleDisabledByJoin) patch({ sample: on ? { rate: config.sample?.rate ?? DEFAULT_SAMPLE_RATE } : null });
            }}
          />
          {sampleDisabledByJoin ? (
            <span className="text-[13px] text-text-tertiary">조인 사용 중에는 표본 추출을 사용할 수 없습니다.</span>
          ) : config.sample ? (
            <>
              <div className="flex w-20 items-center gap-1">
                <Input
                  size="sm"
                  type="number"
                  min={1}
                  max={100}
                  aria-label="표본 비율"
                  placeholder={String(DEFAULT_SAMPLE_RATE)}
                  // 입력 중엔 빈칸·1자리 중간 상태를 허용한다(0=빈칸). 하한 1 보정은 실행 시 clampRate 가 담당 → "1이 안 지워지는" 문제 해소.
                  value={config.sample.rate ? String(config.sample.rate) : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    patch({ sample: { rate: v === '' ? 0 : Math.min(100, Math.max(0, Math.floor(Number(v) || 0))) } });
                  }}
                />
                <span className="text-[13px] text-text-secondary">%</span>
              </div>
              <span className="text-[13px] text-text-tertiary">일부만 빠르게 스캔 — 근사값(합계·개수 보정)</span>
            </>
          ) : (
            <span className="text-[13px] text-text-tertiary">대용량 테이블 일부만 스캔해 근사 집계</span>
          )}
        </Row>
        )}
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

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}

function defaultValueForOp(op: WhereCond['op'], current: WhereCond['value']): WhereCond['value'] {
  if (VALUELESS_OPS.includes(op)) return undefined;
  if (op === 'in') return Array.isArray(current) ? current : splitList(String(current ?? ''));
  if (op === 'between') {
    if (Array.isArray(current)) return [current[0] ?? '', current[1] ?? ''];
    return [current ?? '', ''];
  }
  return Array.isArray(current) ? current[0] ?? '' : current ?? '';
}

function WhereValueControl({ cond, onChange }: { cond: WhereCond; onChange: (value: WhereCond['value']) => void }) {
  if (VALUELESS_OPS.includes(cond.op)) return null;

  if (cond.op === 'between') {
    const values = Array.isArray(cond.value) ? cond.value : [cond.value ?? '', ''];
    return (
      <>
        <div className="w-28">
          <Input size="sm" value={String(values[0] ?? '')} onChange={(e) => onChange([e.target.value, values[1] ?? ''])} placeholder="시작" />
        </div>
        <div className="w-28">
          <Input size="sm" value={String(values[1] ?? '')} onChange={(e) => onChange([values[0] ?? '', e.target.value])} placeholder="끝" />
        </div>
      </>
    );
  }

  if (cond.op === 'in') {
    const value = Array.isArray(cond.value) ? cond.value.join(', ') : String(cond.value ?? '');
    return (
      <div className="w-48">
        <Input size="sm" value={value} onChange={(e) => onChange(splitList(e.target.value))} placeholder="값1, 값2, 값3" />
      </div>
    );
  }

  return (
    <div className="w-36">
      <Input size="sm" value={String(cond.value ?? '')} onChange={(e) => onChange(e.target.value)} placeholder="값" />
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
