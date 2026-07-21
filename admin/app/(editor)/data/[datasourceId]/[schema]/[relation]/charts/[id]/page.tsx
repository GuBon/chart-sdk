import { ChartEditor } from '@/components/charts/ChartEditor';

export default async function RelationChartEditorPage({ params }: {
  params: Promise<{ datasourceId: string; schema: string; relation: string; id: string }>;
}) {
  const { id } = await params;
  return <ChartEditor chartId={Number(id)} />;
}
