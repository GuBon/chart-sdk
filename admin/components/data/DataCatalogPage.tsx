'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ChevronRight, Database, Layers3, Pencil, Search, Table2, X } from 'lucide-react';
import { datasourcesApi, schemaApi } from '@/lib/api';
import type { Datasource, RelationType, SchemaTable } from '@/lib/api';
import { chartDatasourcePath, chartRelationPath, chartSchemaPath } from '@/lib/chartRoutes';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { ChartListView } from '@/components/charts/ChartListView';
import { isRelationSelectable, relationBadgeLabel, relationTypeLabel } from '@/lib/relations';

interface Props {
  datasourceName: string;
  schema?: string;
  relation?: string;
  view?: 'charts' | 'schema' | 'relations' | 'columns';
}

export function DataCatalogPage({ datasourceName, schema, relation, view = 'charts' }: Props) {
  const [datasources, setDatasources] = useState<Datasource[] | null>(null);
  const [relations, setRelations] = useState<SchemaTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relationQuery, setRelationQuery] = useState('');
  const needsCatalog = view !== 'charts';

  useEffect(() => {
    let alive = true;
    setDatasources(null);
    setRelations(null);
    setError(null);
    void datasourcesApi.list()
      .then(async (items) => {
        if (!alive) return;
        setDatasources(items);
        const selected = items.find((item) => item.name === datasourceName);
        if (!selected) {
          setRelations([]);
          return;
        }
        if (!needsCatalog) {
          setRelations([]);
          return;
        }
        try {
          const tables = await schemaApi.tables(selected.id);
          if (alive) setRelations(tables);
        } catch {
          if (!alive) return;
          setRelations([]);
          setError('데이터 정보를 불러오지 못했습니다.');
        }
      })
      .catch(() => {
        if (!alive) return;
        setDatasources([]);
        setRelations([]);
        setError('데이터 정보를 불러오지 못했습니다.');
      });
    return () => { alive = false; };
  }, [datasourceName, needsCatalog]);

  const datasource = datasources?.find((item) => item.name === datasourceName) ?? null;

  const schemas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of relations ?? []) counts.set(item.schema, (counts.get(item.schema) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'ko'));
  }, [relations]);
  const schemaRelations = useMemo(
    () => (relations ?? [])
      .filter((item) => item.schema === schema)
      .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name, 'ko')),
    [relations, schema],
  );
  const selectedRelation = relation == null
    ? null
    : schemaRelations.find((item) => item.name === relation) ?? null;
  const visibleSchemaRelations = useMemo(() => {
    const query = relationQuery.trim().toLocaleLowerCase('ko');
    if (!query) return schemaRelations;
    return schemaRelations.filter((item) =>
      item.name.toLocaleLowerCase('ko').includes(query)
      || item.displayName?.toLocaleLowerCase('ko').includes(query)
      || item.columns.some((column) =>
        column.name.toLocaleLowerCase('ko').includes(query)
        || column.displayName?.toLocaleLowerCase('ko').includes(query)));
  }, [relationQuery, schemaRelations]);

  const updateDisplayName = async (
    relationName: string,
    columnName: string | undefined,
    displayName: string,
  ) => {
    await schemaApi.updateDisplayName({
      datasourceId: datasource!.id,
      schema: schema ?? 'public',
      relation: relationName,
      column: columnName,
      displayName: displayName.trim() || null,
    });
    setRelations(await schemaApi.tables(datasource!.id));
  };

  if (datasources === null || (needsCatalog && relations === null)) {
    return <div className="py-24 text-center text-sm text-text-tertiary">데이터 탐색 정보를 불러오는 중…</div>;
  }
  if (datasource === null) {
    return (
      <EmptyState
        className="py-24"
        icon={<Database className="size-8 text-text-tertiary" />}
        title="데이터소스를 찾을 수 없습니다"
        description={error ?? `데이터소스 '${datasourceName}'이(가) 존재하지 않습니다.`}
        action={<Link href="/datasources" className="text-[13px] text-primary hover:underline">데이터소스 목록으로</Link>}
      />
    );
  }

  if (view === 'charts') {
    const scopePath = relation == null
      ? schema == null
        ? chartDatasourcePath(datasource.name)
        : chartSchemaPath(datasource.name, schema)
      : chartRelationPath({ datasourceName: datasource.name, schema: schema ?? 'public', name: relation });
    const catalogView = relation == null ? (schema == null ? 'schema' : 'relations') : 'columns';
    return (
      <Suspense fallback={null}>
        <ChartListView
          datasources={datasources}
          selectedDatasource={datasource}
          schema={schema}
          relation={relation}
          catalogHref={`${scopePath}?view=${catalogView}`}
        />
      </Suspense>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <DataBreadcrumb datasource={datasource} schema={schema} relation={relation} />
      {error && <p className="mb-4 text-[13px] text-danger">{error}</p>}

      {schema == null ? (
        <>
          <PageHeader
            icon={<Database className="size-5" />}
            title={datasource.name}
            description={`${datasource.databaseName} · ${datasource.host}:${datasource.port}`}
          />
          <ScopeViewTabs
            basePath={chartDatasourcePath(datasource.name)}
            activeDetail={view === 'schema'}
            detailView="schema"
            detailLabel="스키마 탐색"
            ariaLabel="데이터소스 보기"
          />
          {view === 'schema' ? (
            <section>
              <SectionHeader title="스키마" count={schemas.length} />
              {schemas.length === 0 ? (
                <EmptyPanel text="조회 가능한 스키마가 없습니다." />
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                  {schemas.map(([name, count]) => (
                    <Link key={name} href={`${chartSchemaPath(datasource.name, name)}?view=relations`} className="flex items-center gap-3 rounded-[10px] border border-border bg-bg-panel p-4 transition-colors hover:border-text-tertiary">
                      <Layers3 className="size-5 text-text-tertiary" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-text-primary">{name}</p>
                        <p className="mt-0.5 text-xs text-text-tertiary">관계 {count}개</p>
                      </div>
                      <ChevronRight className="size-4 text-text-tertiary" />
                    </Link>
                  ))}
                </div>
              )}
            </section>
          ) : (
            <Suspense fallback={null}>
              <ChartListView datasources={datasources} selectedDatasource={datasource} />
            </Suspense>
          )}
        </>
      ) : relation == null ? (
        <>
          <PageHeader
            icon={<Layers3 className="size-5" />}
            title={schema}
            description={`${datasource.name} 데이터소스의 TABLE·View·Materialized View`}
          />
          <ScopeViewTabs
            basePath={chartSchemaPath(datasource.name, schema)}
            activeDetail={view === 'relations'}
            detailView="relations"
            detailLabel="관계 탐색"
            ariaLabel="스키마 보기"
          />
          {view === 'relations' ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <SectionHeader title="관계 목록" count={schemaRelations.length} className="mb-0" />
                <div className="flex-1" />
                <div className="relative w-full sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary" aria-hidden />
                  <Input
                    aria-label="관계 검색"
                    value={relationQuery}
                    onChange={(event) => setRelationQuery(event.target.value)}
                    placeholder="표시 이름·실제 이름 검색"
                    className="h-9 pl-9"
                  />
                </div>
              </div>
              {schemaRelations.length === 0 ? (
                <EmptyPanel text="이 스키마에서 조회 가능한 관계를 찾지 못했습니다." />
              ) : visibleSchemaRelations.length === 0 ? (
                <EmptyPanel text={`‘${relationQuery}’와 일치하는 관계가 없습니다.`} />
              ) : (
                <div className="overflow-hidden rounded-[10px] border border-border bg-bg-panel">
                  <table className="w-full table-fixed border-collapse">
                    <thead>
                      <tr className="h-10 bg-muted/60 text-left text-xs font-medium text-text-secondary">
                        <th className="w-[28%] pl-5">표시 이름</th>
                        <th className="w-[25%]">실제 이름</th>
                        <th className="w-[18%]">종류</th>
                        <th className="w-[12%]">컬럼</th>
                        <th className="pr-5">예상 행 수</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleSchemaRelations.map((item) => (
                        <tr key={item.name} className="h-[52px] border-t border-border text-[13px]">
                          <td className="pl-5">
                            <InlineDisplayName
                              value={item.displayName}
                              physicalName={item.name}
                              ariaLabel={`${item.name} 표시 이름`}
                              onSave={(value) => updateDisplayName(item.name, undefined, value)}
                            />
                          </td>
                          <td className="font-mono text-xs text-text-secondary">
                            <Link href={`${chartRelationPath({ datasourceName: datasource.name, schema: item.schema, name: item.name })}?view=columns`} className="hover:text-primary hover:underline">{item.name}</Link>
                          </td>
                          <td><RelationBadge type={item.relationType} populated={item.populated} /></td>
                          <td className="text-text-secondary">{item.columns.length}개</td>
                          <td className="pr-5 text-text-secondary">{item.estimatedRowCount == null ? '—' : `약 ${item.estimatedRowCount.toLocaleString()}행`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <Suspense fallback={null}>
              <ChartListView datasources={datasources} selectedDatasource={datasource} schema={schema} />
            </Suspense>
          )}
        </>
      ) : selectedRelation == null ? (
        <EmptyState
          className="py-24"
          icon={<Database className="size-8 text-text-tertiary" />}
          title="관계를 찾을 수 없습니다"
          description={`${schema}.${relation}이 현재 카탈로그에 없습니다.`}
          action={<Link href={`${chartSchemaPath(datasource.name, schema)}?view=relations`} className="text-[13px] text-primary hover:underline">관계 목록으로</Link>}
        />
      ) : (
        <>
          <PageHeader
            icon={<Table2 className="size-5" />}
            title={selectedRelation.displayName || selectedRelation.name}
            description={`${selectedRelation.schema}.${selectedRelation.name} · ${relationTypeLabel(selectedRelation.relationType)}${selectedRelation.estimatedRowCount == null ? '' : ` · 약 ${selectedRelation.estimatedRowCount.toLocaleString()}행`}`}
          />
          <ScopeViewTabs
            basePath={chartRelationPath({ datasourceName: datasource.name, schema, name: relation })}
            activeDetail={view === 'columns'}
            detailView="columns"
            detailLabel="컬럼 정보"
            ariaLabel="테이블 보기"
          />
          {view === 'columns' ? (
            <section className="mb-8">
              <div className="mb-5 flex items-center gap-4 rounded-[10px] border border-border bg-bg-panel px-5 py-4">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-text-secondary">관계 표시 이름</p>
                  <p className="mt-1 font-mono text-xs text-text-tertiary">{selectedRelation.schema}.{selectedRelation.name}</p>
                </div>
                <div className="w-full max-w-sm">
                  <InlineDisplayName
                    value={selectedRelation.displayName}
                    physicalName={selectedRelation.name}
                    ariaLabel={`${selectedRelation.name} 표시 이름`}
                    onSave={(value) => updateDisplayName(selectedRelation.name, undefined, value)}
                  />
                </div>
              </div>
              <SectionHeader title="컬럼" count={selectedRelation.columns.length} />
              <div className="overflow-hidden rounded-[10px] border border-border bg-bg-panel">
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr className="h-10 bg-muted/60 text-left text-xs font-medium text-text-secondary">
                      <th className="w-[38%] pl-5">표시 이름</th>
                      <th className="w-[34%]">실제 이름</th>
                      <th className="pr-5">데이터 타입</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedRelation.columns.map((column) => (
                      <tr key={column.name} className="h-11 border-t border-border text-[13px]">
                        <td className="pl-5">
                          <InlineDisplayName
                            value={column.displayName}
                            physicalName={column.name}
                            ariaLabel={`${column.name} 표시 이름`}
                            onSave={(value) => updateDisplayName(selectedRelation.name, column.name, value)}
                          />
                        </td>
                        <td className="font-mono text-xs text-text-secondary">{column.name}</td>
                        <td className="pr-5 text-text-secondary">{column.type}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <Suspense fallback={null}>
              <ChartListView datasources={datasources} selectedDatasource={datasource} schema={schema} relation={relation} />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}

function ScopeViewTabs({ basePath, activeDetail, detailView, detailLabel, ariaLabel }: {
  basePath: string;
  activeDetail: boolean;
  detailView: 'schema' | 'relations' | 'columns';
  detailLabel: string;
  ariaLabel: string;
}) {
  const tabClass = (active: boolean) => `border-b-2 px-1 pb-2 text-[13px] font-medium transition-colors ${active ? 'border-primary text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`;
  return (
    <nav aria-label={ariaLabel} className="mb-5 flex gap-5 border-b border-border">
      <Link href={basePath} aria-current={!activeDetail ? 'page' : undefined} className={tabClass(!activeDetail)}>차트</Link>
      <Link href={`${basePath}?view=${detailView}`} aria-current={activeDetail ? 'page' : undefined} className={tabClass(activeDetail)}>{detailLabel}</Link>
    </nav>
  );
}

function DataBreadcrumb({ datasource, schema, relation }: { datasource: Datasource; schema?: string; relation?: string }) {
  return (
    <nav aria-label="데이터 경로" className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
      <Link href="/datasources" className="hover:text-text-primary">데이터소스</Link>
      <ChevronRight className="size-3" />
      {schema == null ? <span className="text-text-secondary">{datasource.name}</span> : <Link href={`${chartDatasourcePath(datasource.name)}?view=schema`} className="hover:text-text-primary">{datasource.name}</Link>}
      {schema != null && <><ChevronRight className="size-3" />{relation == null ? <span className="text-text-secondary">{schema}</span> : <Link href={`${chartSchemaPath(datasource.name, schema)}?view=relations`} className="hover:text-text-primary">{schema}</Link>}</>}
      {relation != null && <><ChevronRight className="size-3" /><span className="text-text-secondary">{relation}</span></>}
    </nav>
  );
}

function PageHeader({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <header className="mb-6 flex items-center gap-3">
      <div className="flex size-10 items-center justify-center rounded-lg bg-muted text-text-secondary">{icon}</div>
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-text-primary">{title}</h1>
        <p className="mt-0.5 truncate text-[13px] text-text-secondary">{description}</p>
      </div>
    </header>
  );
}

function SectionHeader({ title, count, className = 'mb-3' }: { title: string; count: number; className?: string }) {
  return <div className={`${className} flex items-center gap-2`}><h2 className="text-base font-semibold text-text-primary">{title}</h2><span className="text-xs text-text-tertiary">{count}개</span></div>;
}

function RelationBadge({ type, populated }: { type: RelationType; populated?: boolean }) {
  const relation = { relationType: type, populated };
  const warning = !isRelationSelectable(relation);
  return <span className={`rounded px-2 py-1 text-[11px] ${warning ? 'bg-amber-50 text-amber-700' : 'bg-muted text-text-secondary'}`}>{relationBadgeLabel(relation)}</span>;
}

function EmptyPanel({ text, icon }: { text: string; icon?: ReactNode }) {
  return <div className="flex min-h-32 flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-border bg-bg-panel px-4 text-center text-[13px] text-text-tertiary">{icon}{text}</div>;
}

function InlineDisplayName({
  value,
  physicalName,
  ariaLabel,
  onSave,
}: {
  value?: string;
  physicalName: string;
  ariaLabel: string;
  onSave: (value: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setDraft(value ?? '');
  }, [editing, value]);

  const cancel = () => {
    if (saving) return;
    setDraft(value ?? '');
    setError(null);
    setEditing(false);
  };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      setError('표시 이름을 저장하지 못했습니다.');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="group flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-text-primary" title={value || physicalName}>
          {value || physicalName}
        </span>
        {!value && <span className="shrink-0 text-[10px] text-text-tertiary">기본</span>}
        <button
          type="button"
          aria-label={`${ariaLabel} 편집`}
          title="표시 이름 편집"
          onClick={() => setEditing(true)}
          className="shrink-0 rounded p-1 text-text-tertiary opacity-70 transition-colors hover:bg-muted hover:text-text-primary group-hover:opacity-100"
        >
          <Pencil className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-1.5">
        <Input
          autoFocus
          size="sm"
          aria-label={ariaLabel}
          value={draft}
          maxLength={200}
          placeholder={physicalName}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void save();
            }
            if (event.key === 'Escape') {
              event.preventDefault();
              cancel();
            }
          }}
        />
        <button
          type="button"
          aria-label="표시 이름 저장"
          title="저장"
          disabled={saving}
          onClick={() => void save()}
          className="rounded p-1 text-primary hover:bg-blue-50 disabled:opacity-50"
        >
          <Check className="size-4" />
        </button>
        <button
          type="button"
          aria-label="표시 이름 편집 취소"
          title="취소"
          disabled={saving}
          onClick={cancel}
          className="rounded p-1 text-text-tertiary hover:bg-muted hover:text-text-primary disabled:opacity-50"
        >
          <X className="size-4" />
        </button>
      </div>
      <p className={`mt-1 text-[10px] ${error ? 'text-danger' : 'text-text-tertiary'}`}>
        {error ?? '비우고 저장하면 데이터소스의 기본 표시 이름으로 되돌립니다.'}
      </p>
    </div>
  );
}
