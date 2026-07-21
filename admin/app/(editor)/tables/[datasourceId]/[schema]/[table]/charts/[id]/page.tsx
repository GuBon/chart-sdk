import { ChartEditor } from '@/components/charts/ChartEditor';

// 저장된 차트의 정식 편집 경로. URL의 테이블 문맥은 탐색·공유용이며 실제 정의는 서버 builderConfig로 복원한다.
export default async function TableChartEditPage({ params }: {
  params: Promise<{ datasourceId: string; schema: string; table: string; id: string }>;
}) {
  const { id } = await params;
  return <ChartEditor chartId={Number(id)} />;
}

