'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { BarChart3, ChevronRight, Database, Layers3, Plus, Search, Table2 } from 'lucide-react';
import { datasourcesApi, schemaApi } from '@/lib/api';
import type { ChartSummary, Datasource, RelationType, SchemaTable } from '@/lib/api';
import { dataRelationPath, dataSchemaPath, dataSourcePath } from '@/lib/chartRoutes';
import { ChartCard } from '@/components/charts/ChartCard';
import { DeleteChartModal } from '@/components/charts/DeleteChartModal';
import { EmbedModal } from '@/components/charts/EmbedModal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pagination } from '@/components/ui/Pagination';
import { useChartPage } from '@/components/charts/useChartPage';
import { isRelationSelectable, relationBadgeLabel, relationTypeLabel } from '@/lib/relations';

const PAGE_SIZE = 12;
interface Props {
  datasourceId: number;
  schema?: string;
  relation?: string;
}

export function DataCatalogPage({ datasourceId, schema, relation }: Props) {
  const [datasource, setDatasource] = useState<Datasource | null | undefined>(undefined);
  const [relations, setRelations] = useState<SchemaTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [relationQuery, setRelationQuery] = useState('');

  useEffect(() => {
    let alive = true;
    setDatasource(undefined);
    setRelations(null);
    setError(null);
    void Promise.all([datasourcesApi.list(), schemaApi.tables(datasourceId)])
      .then(([datasources, tables]) => {
        if (!alive) return;
        setDatasource(datasources.find((item) => item.id === datasourceId) ?? null);
        setRelations(tables);
      })
      .catch(() => {
        if (!alive) return;
        setDatasource(null);
        setRelations([]);
        setError('데이터 정보를 불러오지 못했습니다.');
      });
    return () => { alive = false; };
  }, [datasourceId]);

  const schemas = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of relations ?? []) counts.set(item.schema, (counts.get(item.schema) ?? 0) + 1);
    return [...counts].sort(([a], [b]) => a.localeCompare(b, 'ko'));
  }, [relations]);
  const schemaRelations = useMemo(
    () => (relations ?? []).filter((item) => item.schema === schema).sort((a, b) => a.name.localeCompare(b.name, 'ko')),
    [relations, schema],
  );
  const selectedRelation = relation == null
    ? null
    : schemaRelations.find((item) => item.name === relation) ?? null;
  const visibleSchemaRelations = useMemo(() => {
    const query = relationQuery.trim().toLocaleLowerCase('ko');
    if (!query) return schemaRelations;
    return schemaRelations.filter((item) => item.name.toLocaleLowerCase('ko').includes(query));
  }, [relationQuery, schemaRelations]);

  if (datasource === undefined || relations === null) {
    return <div className="py-24 text-center text-sm text-text-tertiary">데이터 탐색 정보를 불러오는 중…</div>;
  }
  if (datasource === null) {
    return (
      <EmptyState
        className="py-24"
        icon={<Database className="size-8 text-text-tertiary" />}
        title="데이터소스를 찾을 수 없습니다"
        description={error ?? `데이터소스 #${datasourceId}가 존재하지 않습니다.`}
        action={<Link href="/datasources" className="text-[13px] text-primary hover:underline">데이터소스 목록으로</Link>}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1240px]">
      <DataBreadcrumb datasource={datasource} schema={schema} relation={relation} />

      {schema == null ? (
        <>
          <PageHeader
            icon={<Database className="size-5" />}
            title={datasource.name}
            description={`${datasource.databaseName} · ${datasource.host}:${datasource.port}`}
          />
          <section className="mb-8">
            <SectionHeader title="스키마" count={schemas.length} />
            {schemas.length === 0 ? (
              <EmptyPanel text="조회 가능한 스키마가 없습니다." />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {schemas.map(([name, count]) => (
                  <Link key={name} href={dataSchemaPath(datasourceId, name)} className="flex items-center gap-3 rounded-[10px] border border-border bg-bg-panel p-4 transition-colors hover:border-text-tertiary">
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
          <ScopedChartGrid datasourceId={datasourceId} title="이 데이터소스를 사용하는 차트" />
        </>
      ) : relation == null ? (
        <>
          <PageHeader
            icon={<Layers3 className="size-5" />}
            title={schema}
            description={`${datasource.name} 데이터소스의 TABLE·View·Materialized View`}
          />
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <SectionHeader title="관계 목록" count={schemaRelations.length} className="mb-0" />
            <div className="flex-1" />
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-text-tertiary" aria-hidden />
              <Input
                aria-label="관계 검색"
                value={relationQuery}
                onChange={(event) => setRelationQuery(event.target.value)}
                placeholder="TABLE·View 이름 검색"
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
                    <th className="w-[36%] pl-5">이름</th>
                    <th className="w-[22%]">종류</th>
                    <th className="w-[18%]">컬럼</th>
                    <th className="pr-5">예상 행 수</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleSchemaRelations.map((item) => (
                    <tr key={item.name} className="h-[52px] border-t border-border text-[13px]">
                      <td className="pl-5 font-medium">
                        <Link href={dataRelationPath(item)} className="text-text-primary hover:text-primary hover:underline">{item.name}</Link>
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
      ) : selectedRelation == null ? (
        <EmptyState
          className="py-24"
          icon={<Database className="size-8 text-text-tertiary" />}
          title="관계를 찾을 수 없습니다"
          description={`${schema}.${relation}이 현재 카탈로그에 없습니다.`}
          action={<Link href={dataSchemaPath(datasourceId, schema)} className="text-[13px] text-primary hover:underline">관계 목록으로</Link>}
        />
      ) : (
        <>
          <PageHeader
            icon={<Table2 className="size-5" />}
            title={selectedRelation.name}
            description={`${selectedRelation.schema} · ${relationTypeLabel(selectedRelation.relationType)}${selectedRelation.estimatedRowCount == null ? '' : ` · 약 ${selectedRelation.estimatedRowCount.toLocaleString()}행`}`}
          />
          <section className="mb-8">
            <SectionHeader title="컬럼" count={selectedRelation.columns.length} />
            <div className="overflow-hidden rounded-[10px] border border-border bg-bg-panel">
              <table className="w-full table-fixed border-collapse">
                <thead>
                  <tr className="h-10 bg-muted/60 text-left text-xs font-medium text-text-secondary">
                    <th className="w-1/2 pl-5">컬럼명</th>
                    <th className="pr-5">데이터 타입</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedRelation.columns.map((column) => (
                    <tr key={column.name} className="h-11 border-t border-border text-[13px]">
                      <td className="pl-5 font-medium text-text-primary">{column.name}</td>
                      <td className="pr-5 text-text-secondary">{column.type}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <ScopedChartGrid datasourceId={datasourceId} schema={schema} relation={relation} title="이 관계를 기준으로 만든 차트" />
        </>
      )}
    </div>
  );
}

function ScopedChartGrid({ datasourceId, schema, relation, title }: { datasourceId: number; schema?: string; relation?: string; title: string }) {
  const [page, setPage] = useState(1);
  const [toDelete, setToDelete] = useState<ChartSummary | null>(null);
  const [toEmbed, setToEmbed] = useState<ChartSummary | null>(null);
  const { charts, previewOptions, total, totalPages, reload } = useChartPage(
    { datasourceId, schema, relation, page, pageSize: PAGE_SIZE },
    setPage,
  );

  useEffect(() => { setPage(1); }, [datasourceId, schema, relation]);

  return (
    <section>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        {charts && <span className="text-xs text-text-tertiary">{total}개</span>}
        <div className="flex-1" />
        <Link href="/charts/new"><Button size="sm" className="h-8" icon={<Plus className="size-3.5" />}>새 차트</Button></Link>
      </div>
      {charts === null ? (
        <EmptyPanel text="차트 목록을 불러오는 중…" />
      ) : charts.length === 0 ? (
        <EmptyPanel text="이 범위에서 만든 차트가 없습니다." icon={<BarChart3 className="size-7" />} />
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
          {charts.map((chart) => (
            <ChartCard key={chart.id} chart={chart} previewOption={previewOptions[chart.id]} onEmbed={setToEmbed} onDelete={setToDelete} />
          ))}
        </div>
      )}
      {charts && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
      {toDelete && <DeleteChartModal chart={toDelete} onClose={() => setToDelete(null)} onDeleted={() => { setToDelete(null); reload(); }} />}
      {toEmbed && <EmbedModal chart={toEmbed} onClose={() => setToEmbed(null)} />}
    </section>
  );
}

function DataBreadcrumb({ datasource, schema, relation }: { datasource: Datasource; schema?: string; relation?: string }) {
  return (
    <nav aria-label="데이터 경로" className="mb-4 flex flex-wrap items-center gap-1.5 text-xs text-text-tertiary">
      <Link href="/datasources" className="hover:text-text-primary">데이터소스</Link>
      <ChevronRight className="size-3" />
      {schema == null ? <span className="text-text-secondary">{datasource.name}</span> : <Link href={dataSourcePath(datasource.id)} className="hover:text-text-primary">{datasource.name}</Link>}
      {schema != null && <><ChevronRight className="size-3" />{relation == null ? <span className="text-text-secondary">{schema}</span> : <Link href={dataSchemaPath(datasource.id, schema)} className="hover:text-text-primary">{schema}</Link>}</>}
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
