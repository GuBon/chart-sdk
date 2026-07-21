import type { ChartMainTable } from '@/lib/api';

/**
 * 저장된 차트의 정식 편집 주소.
 * datasource/schema/relation을 URL에 포함해 데이터 탐색 계층과 차트 편집을 연결한다.
 * 기준 관계가 없는 SQL 차트만 독립 /charts 경로를 사용한다.
 */
export function chartEditPath(chartId: number, mainTable?: ChartMainTable | null): string {
  if (!mainTable) return `/charts/${chartId}`;
  return `${dataRelationPath(mainTable)}/${encodeURIComponent(String(chartId))}`;
}

export function dataSourcePath(datasourceName: string): string {
  return `/data/${encodeURIComponent(datasourceName)}`;
}

export function dataSchemaPath(datasourceName: string, schema: string): string {
  return `${dataSourcePath(datasourceName)}/${encodeURIComponent(schema || 'public')}`;
}

export function dataRelationPath(relation: Pick<ChartMainTable, 'datasourceName' | 'schema' | 'name'>): string {
  return `${dataSchemaPath(relation.datasourceName, relation.schema)}/${encodeURIComponent(relation.name)}`;
}
