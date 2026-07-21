import type { TableRef } from '@/lib/api';

/**
 * 저장된 차트의 정식 편집 주소.
 * datasource/schema/table을 URL에 포함해 이후 테이블 상세 화면에서 소속 차트를 자연스럽게 연결한다.
 */
export function chartEditPath(chartId: number, mainTable?: TableRef | null): string {
  if (!mainTable) return `/charts/${chartId}`;
  return [
    '/tables',
    encodeURIComponent(String(mainTable.datasourceId)),
    encodeURIComponent(mainTable.schema || 'public'),
    encodeURIComponent(mainTable.name),
    'charts',
    encodeURIComponent(String(chartId)),
  ].join('/');
}

