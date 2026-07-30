import { DataCatalogPage } from '@/components/data/DataCatalogPage';

export default async function RelationChartPage({ params, searchParams }: {
  params: Promise<{ datasourceName: string; schema: string; relation: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ datasourceName, schema, relation }, { view }] = await Promise.all([params, searchParams]);
  return <DataCatalogPage datasourceName={datasourceName} schema={schema} relation={relation} view={view === 'columns' ? 'columns' : 'charts'} />;
}
