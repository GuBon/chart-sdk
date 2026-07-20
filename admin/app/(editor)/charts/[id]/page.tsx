import { ChartEditor } from '@/components/charts/ChartEditor';

// S2 기존 차트 편집 — chartId 로 정의 + 마지막 저장 캐시를 복원(고객 DB 자동 재실행 없음).
export default async function EditChartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChartEditor chartId={Number(id)} />;
}
