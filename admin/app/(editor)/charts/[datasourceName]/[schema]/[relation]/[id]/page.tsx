import { notFound } from 'next/navigation';
import { ChartEditor } from '@/components/charts/ChartEditor';

export default async function RelationChartEditorPage({ params }: {
  params: Promise<{ datasourceName: string; schema: string; relation: string; id: string }>;
}) {
  const { id } = await params;
  const chartId = Number(id);
  if (!Number.isSafeInteger(chartId) || chartId < 1) notFound();
  return <ChartEditor chartId={chartId} />;
}
