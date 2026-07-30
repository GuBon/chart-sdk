import type { ChartMainTable } from '@/lib/api';

/**
 * 저장된 차트의 정식 편집 주소.
 * datasource/schema/relation을 URL에 포함해 범위별 차트 목록과 편집기를 연결한다.
 */
export function chartEditPath(chartId: number, mainTable: ChartMainTable): string {
  return `${chartRelationPath(mainTable)}/${encodeURIComponent(String(chartId))}`;
}

export function chartDatasourcePath(datasourceName: string): string {
  return `/charts/${encodeURIComponent(datasourceName)}`;
}

export function chartSchemaPath(datasourceName: string, schema: string): string {
  return `${chartDatasourcePath(datasourceName)}/${encodeURIComponent(schema || 'public')}`;
}

export function chartRelationPath(relation: Pick<ChartMainTable, 'datasourceName' | 'schema' | 'name'>): string {
  return `${chartSchemaPath(relation.datasourceName, relation.schema)}/${encodeURIComponent(relation.name)}`;
}
