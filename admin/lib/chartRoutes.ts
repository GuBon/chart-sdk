import type { TableRef } from '@/lib/api';

/**
 * 저장된 차트의 정식 편집 주소.
 * datasource/schema/relation을 URL에 포함해 데이터 탐색 계층과 차트 편집을 연결한다.
 */
export function chartEditPath(chartId: number, mainTable?: TableRef | null): string {
  if (!mainTable) return `/charts/${chartId}`;
  return `${dataRelationPath(mainTable)}/charts/${encodeURIComponent(String(chartId))}`;
}

export function dataSourcePath(datasourceId: number): string {
  return `/data/${encodeURIComponent(String(datasourceId))}`;
}

export function dataSchemaPath(datasourceId: number, schema: string): string {
  return `${dataSourcePath(datasourceId)}/${encodeURIComponent(schema || 'public')}`;
}

export function dataRelationPath(relation: Pick<TableRef, 'datasourceId' | 'schema' | 'name'>): string {
  return `${dataSchemaPath(relation.datasourceId, relation.schema)}/${encodeURIComponent(relation.name)}`;
}
