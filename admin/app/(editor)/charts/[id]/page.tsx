import { ChartEditor } from '@/components/charts/ChartEditor';

// S2 기존 차트 편집 — chartId 로 진입 시 1회 자동 실행(화면설계 4.1).
export default async function EditChartPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ChartEditor chartId={Number(id)} />;
}
