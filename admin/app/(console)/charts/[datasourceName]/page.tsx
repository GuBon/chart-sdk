import { DataCatalogPage } from '@/components/data/DataCatalogPage';

export default async function DatasourceChartPage({
  params,
  searchParams,
}: {
  params: Promise<{ datasourceName: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ datasourceName }, { view }] = await Promise.all([params, searchParams]);
  return <DataCatalogPage datasourceName={datasourceName} view={view === 'schema' ? 'schema' : 'charts'} />;
}
