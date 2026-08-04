'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, ChevronsLeft, Filter, Search, Table2, X } from 'lucide-react';
import type { Datasource, SchemaTable } from '@/lib/api';
import { columnDisplayName, relationDisplayName, tableRefKey } from '@/lib/builder';
import { Field } from '@/components/ui/Field';
import { Select } from '@/components/ui/Select';
import { Input } from '@/components/ui/Input';
import { cn } from '@/lib/cn';
import { isRelationSelectable, relationBadgeLabel } from '@/lib/relations';
import { Pagination } from '@/components/ui/Pagination';

// S2 좌측 스키마 탐색기(258:178) — 표시 전용. 데이터/선택 상태는 ChartEditor 소유.
// 데이터소스→테이블→컬럼의 수직 선택 흐름(Redash 패턴).
// 대형 스키마(수백 테이블) 대비 — 데이터는 전부 로드(빌더 컬럼해석 유지)하고 표시만 페이지로 자른다.
const PAGE_SIZE = 50;
type SortMode = 'schema' | 'name_asc' | 'name_desc';
type NameMode = 'display' | 'physical';
const SORT_CHOICES: { value: SortMode; label: string }[] = [
  { value: 'schema', label: '스키마순' },
  { value: 'name_asc', label: '이름 오름차순' },
  { value: 'name_desc', label: '이름 내림차순' },
];
interface Props {
  datasources: Datasource[];
  tables: SchemaTable[];
  datasourceId: number | null;
  selectedTable: string | null;
  baseTableKey: string | null;
  selection: {
    label: string;
    cancelLabel: string;
    focusSearch?: boolean;
    expandTableKey?: string | null;
  } | null;
  disabledTableKeys: Set<string>;
  focusRequestKey: number;
  columnTargetLabel: string;
  onChangeDatasource: (id: number) => void;
  onSelectTable: (table: SchemaTable) => void;
  columnSelectionIssue: (table: SchemaTable, column: SchemaTable['columns'][number]) => string | null;
  onSelectColumn: (table: SchemaTable, column: SchemaTable['columns'][number]) => void;
  onCancelSelection: () => void;
  onCollapse: () => void;
}

/** 필터 팝오버 메뉴 항목 — 라벨 + 활성 체크 (정렬·스키마 공용) */
function MenuItem({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between px-3 py-1.5 text-left text-[13px] text-text-primary hover:bg-muted"
    >
      {label}
      {active && <Check className="size-3.5 text-text-primary" />}
    </button>
  );
}

export function SchemaExplorer({
  datasources,
  tables,
  datasourceId,
  selectedTable,
  baseTableKey,
  selection,
  disabledTableKeys,
  focusRequestKey,
  columnTargetLabel,
  onChangeDatasource,
  onSelectTable,
  columnSelectionIssue,
  onSelectColumn,
  onCancelSelection,
  onCollapse,
}: Props) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<SortMode>('schema');
  const [nameMode, setNameMode] = useState<NameMode>('physical');
  const [sortOpen, setSortOpen] = useState(false);
  const [schemaFilter, setSchemaFilter] = useState<string | null>(null); // null = 전체
  const [page, setPage] = useState(1);
  const searchRef = useRef<HTMLInputElement>(null);

  // 현재 소스의 스키마 목록(데이터에서 유도). 1개뿐이면 필터 섹션을 숨긴다.
  const schemas = [...new Set(tables.map((t) => t.schema))];
  const pinnedBaseTable = baseTableKey
    ? tables.find((table) => tableRefKey(table) === baseTableKey)
    : undefined;
  const unpinnedTables = pinnedBaseTable
    ? tables.filter((table) => tableRefKey(table) !== baseTableKey)
    : tables;

  const q = query.toLowerCase().trim();
  // 원본 테이블은 검색·정렬·페이지와 분리해 항상 첫 행에 고정하고, 나머지 목록만 검색한다.
  const searched = q
    ? unpinnedTables.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.displayName?.toLowerCase().includes(q) ||
          t.schema.toLowerCase().includes(q) ||
          t.columns.some((c) =>
            c.name.toLowerCase().includes(q) || c.displayName?.toLowerCase().includes(q)),
      )
    : unpinnedTables;
  // 스키마 필터(팝오버) — 검색과 독립 적용.
  const filtered = schemaFilter ? searched.filter((t) => t.schema === schemaFilter) : searched;

  // 정렬: schema=백엔드 원본 순서(table_schema, table_name) 유지 / 이름 오름·내림.
  const sorted =
    sort === 'schema'
      ? filtered
      : [...filtered].sort((a, b) => {
          const left = nameMode === 'display' ? relationDisplayName(a) : a.name;
          const right = nameMode === 'display' ? relationDisplayName(b) : b.name;
          const c = left.localeCompare(right, 'ko');
          return sort === 'name_asc' ? c : -c;
        });
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const pageClamped = Math.min(Math.max(1, page), totalPages);
  const pageItems = [
    ...(pinnedBaseTable ? [pinnedBaseTable] : []),
    ...sorted.slice((pageClamped - 1) * PAGE_SIZE, pageClamped * PAGE_SIZE),
  ];

  // 검색·정렬·소스 변경 시 1페이지로 리셋.
  useEffect(() => setPage(1), [query, sort, schemaFilter, datasourceId, nameMode]);
  // 소스가 바뀌면 이전 소스의 스키마 필터는 무효 — 전체로 리셋.
  useEffect(() => setSchemaFilter(null), [datasourceId]);
  useEffect(() => {
    if (!selection?.focusSearch || focusRequestKey <= 0) return;
    searchRef.current?.focus();
    searchRef.current?.select();
  }, [focusRequestKey, selection]);
  useEffect(() => {
    const key = selection?.expandTableKey;
    if (!key) return;
    setExpanded((previous) => previous.has(key) ? previous : new Set(previous).add(key));
  }, [selection?.expandTableKey]);
  useEffect(() => {
    if (!baseTableKey) return;
    setExpanded((previous) => previous.has(baseTableKey) ? previous : new Set(previous).add(baseTableKey));
  }, [baseTableKey]);

  const toggle = (name: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  const selectTable = (t: SchemaTable) => {
    onSelectTable(t);
    setExpanded((prev) => new Set(prev).add(tableRefKey(t)));
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-4">
        <div className="mb-3 flex items-center gap-2">
          <span className="whitespace-nowrap text-sm font-medium text-text-primary">데이터 패널</span>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onCollapse}
            aria-label="데이터 패널 접기"
            aria-controls="schema-sidebar"
            className="inline-flex h-7 items-center gap-1 rounded px-2 text-[11px] font-medium text-text-secondary hover:bg-muted hover:text-text-primary"
          >
            <ChevronsLeft className="size-3.5" />
            접기
          </button>
        </div>
        <Field label="데이터소스">
          <Select
            id="schema-datasource"
            name="schemaDatasource"
            aria-label="데이터소스"
            value={datasourceId ?? ''}
            onChange={(e) => onChangeDatasource(Number(e.target.value))}
            options={datasources.map((d) => ({ value: d.id, label: d.name }))}
            placeholder="데이터소스 선택"
          />
        </Field>
      </div>

      <div className="px-4 pb-2 pt-4">
        <p className="truncate whitespace-nowrap text-sm font-medium text-text-primary">테이블·View·컬럼</p>
      </div>

      {selection && (
        <div className="mx-3 mb-2 flex h-8 items-center gap-2 rounded-md border border-primary/40 bg-blue-50 px-2.5" data-testid="table-selection-banner">
            <p className="min-w-0 flex-1 truncate whitespace-nowrap text-[13px] font-medium text-blue-900" role="status" aria-live="polite">
              {selection.label}
            </p>
            <button
              type="button"
              aria-label={selection.cancelLabel}
              onClick={onCancelSelection}
              className="rounded p-0.5 text-blue-700 hover:bg-blue-100 hover:text-blue-900"
            >
              <X className="size-3.5" />
            </button>
        </div>
      )}

      {/* 검색 + 정렬 — 정렬은 인풋 우측 안쪽 필터 아이콘의 팝오버 메뉴 (화면설계 S2 사이드바) */}
      <div className="px-3 pb-2">
        {/* relative 기준을 인풋과 정확히 일치시킨다(패딩 포함 시 top-1/2 가 어긋남) */}
        <div className="relative">
          <Input
            ref={searchRef}
            id="schema-search"
            name="schemaSearch"
            icon={<Search className="size-3.5" />}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="검색"
            disabled={datasourceId == null}
            className="pr-6"
          />
          <button
            type="button"
            aria-label="정렬"
            disabled={datasourceId == null}
            onClick={() => setSortOpen((v) => !v)}
            className={cn(
              'absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-40',
              sort !== 'schema' || schemaFilter !== null ? 'text-text-primary' : 'text-text-tertiary hover:text-text-primary',
            )}
          >
            <Filter className="size-3.5" />
          </button>
          {sortOpen && (
            <>
              {/* 바깥 클릭 시 닫힘 */}
              <button type="button" aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={() => setSortOpen(false)} />
              <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-md border border-border bg-bg-panel py-1 shadow-md">
                <p className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium tracking-wide text-text-tertiary">정렬</p>
                {SORT_CHOICES.map((c) => (
                  <MenuItem key={c.value} label={c.label} active={sort === c.value} onClick={() => { setSort(c.value); setSortOpen(false); }} />
                ))}
                {/* 스키마 필터 — 현재 소스에 스키마가 2개 이상일 때만 노출 (화면설계 S2-보조 팝오버) */}
                {schemas.length >= 2 && (
                  <>
                    <div className="my-1 h-px bg-border" />
                    <p className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium tracking-wide text-text-tertiary">스키마</p>
                    <MenuItem label="전체" active={schemaFilter === null} onClick={() => { setSchemaFilter(null); setSortOpen(false); }} />
                    {schemas.map((s) => (
                      <MenuItem key={s} label={s} active={schemaFilter === s} onClick={() => { setSchemaFilter(s); setSortOpen(false); }} />
                    ))}
                  </>
                )}
                <div className="my-1 h-px bg-border" />
                <p className="px-3 pb-0.5 pt-1.5 text-[11px] font-medium tracking-wide text-text-tertiary">필드 이름</p>
                <MenuItem label="표시 이름" active={nameMode === 'display'} onClick={() => { setNameMode('display'); setSortOpen(false); }} />
                <MenuItem label="실제 이름" active={nameMode === 'physical'} onClick={() => { setNameMode('physical'); setSortOpen(false); }} />
              </div>
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {datasourceId == null ? (
          <p className="px-2 py-3 text-xs text-text-tertiary">데이터소스를 먼저 선택하세요.</p>
        ) : (
          pageItems.map((t) => {
            const key = tableRefKey(t);
            const open = expanded.has(key);
            const active = selectedTable === key;
            const baseTable = baseTableKey === key;
            const unavailable = !isRelationSelectable(t);
            const alreadyUsed = disabledTableKeys.has(key);
            const disabled = unavailable || alreadyUsed;
            const relationLabel = t.relationType === 'TABLE' ? null : relationBadgeLabel(t);
            const relationPrimary = nameMode === 'display' ? relationDisplayName(t) : t.name;
            const relationSecondary = t.displayName
              ? nameMode === 'display' ? t.name : t.displayName
              : null;
            return (
              <div key={key}>
                <button
                  type="button"
                  data-testid={`schema-table-${key}`}
                  data-base-table={baseTable || undefined}
                  onClick={() => selectTable(t)}
                  disabled={disabled}
                  title={
                    unavailable
                      ? 'REFRESH가 필요한 Materialized View입니다.'
                      : alreadyUsed
                        ? '현재 구성에서 이미 사용 중인 항목입니다.'
                        : selection
                          ? `${selection.label}: ${t.schema}.${t.name}`
                          : '원본 테이블로 선택'
                  }
                  className={cn(
                    'flex w-full items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md px-1.5 py-1 text-left text-[13px] hover:bg-muted disabled:cursor-not-allowed',
                    baseTable
                      ? 'bg-blue-100 text-blue-950 ring-1 ring-inset ring-primary/40'
                      : active
                        ? 'bg-blue-50 text-blue-900 ring-1 ring-inset ring-primary/30'
                        : 'text-text-primary',
                    disabled && !baseTable && 'opacity-50',
                    baseTable ? 'font-bold' : active ? 'font-medium' : 'font-normal',
                  )}
                >
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(key);
                    }}
                    className="text-text-secondary"
                  >
                    {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                  </span>
                  <Table2 className="size-3.5 shrink-0 text-text-secondary" />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate', baseTable && 'font-bold')} title={relationPrimary}>{relationPrimary}</span>
                    {relationSecondary && (
                      <span className="block truncate text-[10px] font-normal text-text-tertiary" title={relationSecondary}>
                        {relationSecondary}
                      </span>
                    )}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center gap-1">
                    {relationLabel && (
                      <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] text-blue-700">
                        {relationLabel}
                      </span>
                    )}
                    {t.schema && (
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-text-tertiary">{t.schema}</span>
                    )}
                  </span>
                </button>
                {open &&
                  t.columns.map((c) => {
                    const primary = nameMode === 'display' ? columnDisplayName(c) : c.name;
                    const secondary = c.displayName
                      ? nameMode === 'display' ? c.name : c.displayName
                      : null;
                    const selectionIssue = columnSelectionIssue(t, c);
                    const selectable = selectionIssue == null;
                    const content = (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-text-primary" title={primary}>{primary}</span>
                          {secondary && <span className="block truncate text-[10px] text-text-tertiary">{secondary}</span>}
                        </span>
                        <span className="shrink-0 text-xs text-text-tertiary">{c.type}</span>
                      </>
                    );
                    return (
                      <button
                        key={c.name}
                        type="button"
                        data-testid={`schema-column-${key}-${c.name}`}
                        aria-label={selectable
                          ? `${primary} 컬럼을 ${columnTargetLabel}에 사용`
                          : `${primary} 컬럼 사용 불가: ${selectionIssue}`}
                        title={selectable ? `${columnTargetLabel}에 사용` : selectionIssue}
                        disabled={!selectable}
                        onClick={() => onSelectColumn(t, c)}
                        className={cn(
                          'group flex w-full items-center gap-1.5 rounded border border-transparent py-0.5 pl-7 pr-1.5 text-left text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                          selectable
                            ? 'cursor-pointer hover:border-primary/20 hover:bg-blue-50'
                            : 'cursor-not-allowed opacity-55',
                        )}
                      >
                        {content}
                      </button>
                    );
                  })}
              </div>
            );
          })
        )}
      </div>

      {datasourceId != null && (
        <Pagination
          page={pageClamped}
          totalPages={totalPages}
          onChange={setPage}
          compact
          className="shrink-0 gap-2 border-t border-border px-2 py-2"
        />
      )}
    </div>
  );
}
