'use client';

import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Play, X } from 'lucide-react';
import type { BuilderConfig, ChartType, Datasource, JoinSpec, SchemaTable, TableRef, WhereCond, YAxisField } from '@/lib/api';
import {
  BUCKET_CHOICES,
  JOIN_TYPE_CHOICES,
  MAX_JOINS,
  OP_CHOICES,
  VALUELESS_OPS,
  activeTables,
  aggChoicesForChart,
  builderValidationIssue,
  builderWarning,
  columnsForBuilder,
  createSampleConfig,
  createSampleSeed,
  emptyJoin,
  isDateType,
  orderTargets,
  tableHandle,
  tableRefKey,
  tableRefLabel,
  updateSampleMode,
  withUniqueHandle,
} from '@/lib/builder';
import { DEFAULT_SAMPLE_SEED, DEFAULT_SAMPLE_SIZE, MAX_SAMPLE_SIZE, MIN_SAMPLE_SIZE, isFullScanTable } from '@chartsdk/chart-options/sampling';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';

// 표본 크기 입력 옆 안내 — 전체 추정 행수(reltuples)는 정확치가 아니라 "약 N행"으로 표기. 작으면 전량 정확 계산.
function sampleTotalHint(estimatedRowCount?: number): string {
  if (!estimatedRowCount || estimatedRowCount <= 0) return '전체 크기 미상 · 실행 후 실제 표본 수와 가능한 통계 구간을 표시합니다';
  const total = `전체 약 ${estimatedRowCount.toLocaleString()}행`;
  return isFullScanTable(estimatedRowCount) ? `${total} — 작아서 전량 정확 계산됩니다` : `${total} 중 무작위 표본`;
}

// S2 중앙 노코드 구성 폼(259:191). builderConfig 를 편집하고 [실행]을 트리거한다.
interface Props {
  config: BuilderConfig;
  chartType: ChartType;
  tables: SchemaTable[]; // 모든 데이터소스의 테이블 풀(각 datasourceId 태깅) — 컬럼 해석·다중 소스 조인용
  browseDatasourceId: number | null; // 사이드바에서 선택한 탐색 소스 — 테이블/조인 드롭다운을 이 소스로 필터
  datasources: Datasource[];
  onChange: (next: BuilderConfig) => void;
  onRun: () => void;
  running: boolean;
  generatedSql: string | null;
  sqlOpen: boolean;
  onToggleSql: () => void;
}

export function NocodeBuilder({ config, chartType, tables, browseDatasourceId, datasources, onChange, onRun, running, generatedSql, sqlOpen, onToggleSql }: Props) {
  // 조인 시 활성 테이블 전부 qualified, 미조인 시 base unqualified (생성규칙 11.2)
  const colOptions = columnsForBuilder(config, tables);
  const xType = colOptions.find((c) => c.value === config.xAxis)?.type;
  const isScatter = chartType === 'scatter';
  const isPie = chartType === 'pie';
  const isBoxplot = chartType === 'boxplot';
  const isMap = chartType === 'map';
  const isGeoScatter = chartType === 'geoscatter';
  // 시리즈 수 상한(원형·지도·상자수염=1, 지도 포인트=2[위도+크기]). 버킷·표본은 원본값 모드에서 숨김.
  const maxSeries = isPie || isMap || isBoxplot ? 1 : isGeoScatter ? 2 : Infinity;
  const hideBucket = isScatter || isBoxplot || isGeoScatter;
  const hideSampleRow = isScatter || isBoxplot || isGeoScatter;
  const rawY = isScatter || isBoxplot || isGeoScatter; // Y 기본 집계 없음
  const xLabel = isMap ? '지역' : isBoxplot ? '카테고리' : isGeoScatter ? '경도' : 'X축';
  const yLabel = isMap ? '값' : isBoxplot || isPie ? '값' : isGeoScatter ? '위도 · 크기' : 'Y축 · 집계';
  const yAggChoices = aggChoicesForChart(chartType);
  const validationIssue = builderValidationIssue(config, chartType, tables);
  const warning = builderWarning(config);
  const canRun = !validationIssue;
  const firstCol = colOptions[0]?.value ?? '';

  const patch = (p: Partial<BuilderConfig>) => onChange({ ...config, ...p });

  // ── 다중 소스 테이블 참조 헬퍼 ──
  const refOf = (t: SchemaTable): TableRef => ({ datasourceId: t.datasourceId, schema: t.schema, name: t.name });
  const findByKey = (key: string) => tables.find((t) => tableRefKey(t) === key);
  const dsName = (id: number) => datasources.find((d) => d.id === id)?.name ?? `ds${id}`;
  const sourceLabel = (t: SchemaTable) => `${dsName(t.datasourceId)} · ${tableRefLabel(t)}`;
  // 탐색 소스의 테이블만 드롭다운 옵션으로. 사이드바가 소스를 정하고, 드롭다운은 그 소스의 테이블만 노출.
  const browseTables = tables.filter((t) => t.datasourceId === browseDatasourceId);
  const selectableBrowseTables = browseTables.filter((t) => t.relationType !== 'MATERIALIZED_VIEW' || t.populated !== false);
  // browse 소스 테이블 − exclude. 현재 선택값이 목록 밖(타 소스 base/조인)이면 선택 유지용으로 앞에 추가(출처 표기).
  const tableOptionsFor = (currentKey: string | null, exclude: Set<string>) => {
    const opts = selectableBrowseTables
      .filter((t) => !exclude.has(tableRefKey(t)))
      .map((t) => ({ value: tableRefKey(t), label: tableRefLabel(t) }));
    if (currentKey && !opts.some((o) => o.value === currentKey)) {
      const cur = findByKey(currentKey);
      if (cur) opts.unshift({ value: currentKey, label: sourceLabel(cur) });
    }
    return opts;
  };
  const tableOptions = tableOptionsFor(config.table ? tableRefKey(config.table) : null, new Set());
  const baseSchemaTable = config.table ? findByKey(tableRefKey(config.table)) : undefined;

  // 테이블 변경 시 컬럼·조인 참조가 모두 무효 → 구성 초기화 (드롭다운 직접 선택은 의도적 변경이라 모달 없음)
  const changeTable = (key: string) => {
    const t = findByKey(key);
    if (!t) return;
    // 표본 설정은 방식(자동/갯수)·seed 로 테이블 독립이므로 그대로 유지(정확도는 절대 갯수가 결정).
    onChange({ table: refOf(t), joins: [], xAxis: null, xAxisBucket: null, yAxis: [], where: [], orderBy: null, sample: config.sample ?? null });
  };

  const changeXAxis = (xAxis: string) => {
    const isDate = isDateType(colOptions.find((c) => c.value === xAxis)?.type);
    patch({ xAxis, xAxisBucket: isDate && !hideBucket ? 'month' : null });
  };

  const setY = (i: number, p: Partial<YAxisField>) =>
    patch({ yAxis: config.yAxis.map((y, idx) => (idx === i ? { ...y, ...p } : y)) });
  const addY = () => patch({ yAxis: [...config.yAxis, { column: firstCol, agg: rawY ? 'none' : 'sum' }] });
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
  const rawValueMode = config.yAxis.some((y) => y.agg === 'none');
  const sampleDisabled = rawValueMode;
  const colsOf = (ref: TableRef) => tables.find((t) => tableRefKey(t) === tableRefKey(ref))?.columns ?? [];
  // 조인 컬럼 참조는 테이블 핸들로 qualified — 백엔드가 핸들을 소스로 해석(§11.2). 동명 테이블은 핸들이 달라 구분됨.
  const qualOpts = (refs: TableRef[]) =>
    refs.flatMap((ref) => colsOf(ref).map((c) => ({ value: `${tableHandle(ref)}.${c.name}`, label: `${tableHandle(ref)}.${c.name}` })));
  const usedKeys = () => new Set(activeTables(config).map(tableRefKey));
  // 이 조인이 참조할 수 있는 앞선 테이블들(핸들 부여 시 겹침 검사 대상) — 자기 자신 제외.
  const othersExcept = (i: number): TableRef[] =>
    [config.table, ...joins.filter((_, idx) => idx !== i).map((x) => x.table)].filter(Boolean) as TableRef[];
  const setJoin = (i: number, p: Partial<JoinSpec>) => patch({ joins: joins.map((j, idx) => (idx === i ? { ...j, ...p } : j)) });
  const setJoinOn = (i: number, side: 'leftColumn' | 'rightColumn', col: string) => setJoin(i, { on: { ...joins[i].on, [side]: col } });
  const changeJoinTable = (i: number, key: string) => {
    const t = findByKey(key);
    // 동명 테이블이 겹치면 유일 핸들 부여(users_2) → 컬럼 참조가 어느 테이블인지 구분. 컬럼 참조는 초기화(새 테이블).
    if (t) setJoin(i, { table: withUniqueHandle(refOf(t), othersExcept(i)), on: { leftColumn: '', rightColumn: '' } });
  };
  const removeJoin = (i: number) => patch({ joins: joins.filter((_, idx) => idx !== i) });
  const addJoin = () => {
    const used = usedKeys();
    const next = selectableBrowseTables.find((t) => !used.has(tableRefKey(t)));
    if (next) patch({ joins: [...joins, emptyJoin(withUniqueHandle(refOf(next), activeTables(config)))] });
  };
  const unusedTable = !!config.table && selectableBrowseTables.some((t) => !usedKeys().has(tableRefKey(t)));
  const sampleSourceHint = joins.length > 0
    ? '조인 결과에서 무작위 행 표본'
    : baseSchemaTable?.relationType === 'VIEW'
      ? 'View 조회 결과에서 무작위 행 표본'
      : sampleTotalHint(baseSchemaTable?.estimatedRowCount);

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
        <Button id="builder-run" size="sm" icon={<Play className="size-3.5" />} disabled={!canRun || running} onClick={onRun}>
          {running ? '실행 중…' : '실행'}
        </Button>
      </div>

      {/* 구성 폼 */}
      <div className="flex flex-col gap-4 p-4">
        <Row label="원본">
          <div className="w-72">
            <Select
              id="builder-table"
              aria-label="테이블"
              value={config.table ? tableRefKey(config.table) : ''}
              onChange={(e) => changeTable(e.target.value)}
              options={tableOptions}
              placeholder="테이블·View 선택"
            />
          </div>
        </Row>

        {/* 테이블 조인 (생성규칙 11장) — base 다음, 컬럼 참조는 qualified */}
        {config.table && (
          <Row label="조인">
            <div className="flex flex-col gap-2">
              {joins.map((j, i) => {
                const priorTables: TableRef[] = [config.table!, ...joins.slice(0, i).map((x) => x.table)];
                const usedExceptSelf = new Set(
                  activeTables(config).filter((t) => tableRefKey(t) !== tableRefKey(j.table)).map(tableRefKey),
                );
                const tableOpts = tableOptionsFor(tableRefKey(j.table), usedExceptSelf);
                return (
                  <div key={i} className="flex items-center gap-2">
                    <div className="w-48">
                      <Select aria-label="조인 테이블" value={tableRefKey(j.table)} onChange={(e) => changeJoinTable(i, e.target.value)} options={tableOpts} />
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

        <Row label={xLabel}>
          <div className="w-60">
            <Select id="builder-x-axis" aria-label="X축" value={config.xAxis ?? ''} onChange={(e) => changeXAxis(e.target.value)} options={colOptions} placeholder={isMap ? '지역명 컬럼' : '컬럼 선택'} />
          </div>
          {isMap && <span className="text-[13px] text-text-tertiary">지역 정식 명칭 컬럼(예: 서울특별시 / 시군구 지도는 부산광역시 중구)</span>}
          {isGeoScatter && <span className="text-[13px] text-text-tertiary">경도(숫자) 컬럼 — 위도는 아래 첫 번째, 점 크기값은 두 번째(선택)</span>}
          {isDateType(xType) && !hideBucket && (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-text-secondary">묶기</span>
              <div className="w-28">
                <Select
                  aria-label="X축 묶기"
                  value={config.xAxisBucket ?? 'month'}
                  onChange={(e) => patch({ xAxisBucket: e.target.value as BuilderConfig['xAxisBucket'] })}
                  options={BUCKET_CHOICES}
                />
              </div>
            </div>
          )}
        </Row>

        <Row label={yLabel}>
          <div className="flex flex-col gap-2">
            {config.yAxis.map((y, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-44">
                  <Select id={`builder-y-column-${i}`} name={`builderYColumn${i}`} value={y.column} onChange={(e) => setY(i, { column: e.target.value })} options={colOptions} placeholder="컬럼" />
                </div>
                <div className="w-36">
                  <Select id={`builder-y-agg-${i}`} name={`builderYAgg${i}`} value={y.agg} onChange={(e) => setY(i, { agg: e.target.value as YAxisField['agg'] })} options={yAggChoices} />
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
              <Button id="builder-add-series" variant="secondary" size="sm" className="h-7" onClick={addY} disabled={!config.table || config.yAxis.length >= maxSeries}>
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
                  <Select aria-label="조건 컬럼" value={w.column} onChange={(e) => setW(i, { column: e.target.value })} options={colOptions} placeholder="컬럼" />
                </div>
                <div className="w-32">
                  <Select aria-label="조건 연산자" value={w.op} onChange={(e) => changeWhereOp(i, e.target.value as WhereCond['op'])} options={OP_CHOICES} />
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
              aria-label="정렬 기준"
              value={config.orderBy?.target ?? ''}
              onChange={(e) => patch({ orderBy: e.target.value ? { target: e.target.value, direction: config.orderBy?.direction ?? 'desc' } : null })}
              options={orderTargets(config)}
              placeholder="없음"
            />
          </div>
          {config.orderBy && (
            <div className="w-28">
              <Select
                aria-label="정렬 방향"
                value={config.orderBy.direction}
                onChange={(e) => patch({ orderBy: { target: config.orderBy!.target, direction: e.target.value as 'asc' | 'desc' } })}
                options={[{ value: 'asc', label: '오름차순' }, { value: 'desc', label: '내림차순' }]}
              />
            </div>
          )}
        </Row>

        {!hideSampleRow && (
        <Row label="표본 추출">
          <Switch
            aria-label="표본 추출"
            checked={!!config.sample && !sampleDisabled}
            disabled={sampleDisabled}
            onChange={(on) => {
              if (!sampleDisabled) patch({ sample: on ? createSampleConfig() : null });
            }}
          />
          {rawValueMode ? (
            <span className="text-[13px] text-text-tertiary">원본값 모드에서는 표본 추출을 사용할 수 없습니다.</span>
          ) : config.sample ? (
            <>
              <div className="w-32">
                <Select
                  aria-label="표본 방식"
                  value={config.sample.mode === 'manual' ? 'manual' : 'auto'}
                  onChange={(e) => patch({ sample: updateSampleMode(config.sample, e.target.value === 'manual' ? 'manual' : 'auto') })}
                  options={[
                    { value: 'auto', label: '자동 (서버 결정)' },
                    { value: 'manual', label: '직접 지정' },
                  ]}
                />
              </div>
              {config.sample.mode === 'manual' && (
                <div className="flex items-center gap-1">
                  <div className="w-24">
                    <Input
                      size="sm"
                      type="number"
                      min={MIN_SAMPLE_SIZE}
                      max={MAX_SAMPLE_SIZE}
                      aria-label="표본 크기"
                      placeholder={String(DEFAULT_SAMPLE_SIZE)}
                      value={config.sample.size ? String(config.sample.size) : ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        patch({ sample: { ...config.sample!, size: v === '' ? undefined : Math.max(0, Math.floor(Number(v) || 0)) } });
                      }}
                    />
                  </div>
                  <span className="text-[13px] text-text-secondary">행</span>
                </div>
              )}
              <span className="text-[13px] text-text-tertiary" data-testid="sample-total-hint">
                {sampleSourceHint}
              </span>
              <button
                type="button"
                className="text-xs text-text-secondary underline-offset-2 hover:underline"
                aria-label="표본 다시 뽑기"
                title={`현재 seed ${config.sample.seed ?? DEFAULT_SAMPLE_SEED}`}
                onClick={() => patch({ sample: { ...config.sample!, seed: createSampleSeed() } })}
              >
                다시 뽑기
              </button>
            </>
          ) : (
            <span className="text-[13px] text-text-tertiary">무작위 표본으로 빠르게 확인 — SUM·COUNT는 표본값, AVG·표준편차·분산은 가능한 경우 95% 추정 구간을 표시합니다.</span>
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
