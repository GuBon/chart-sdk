import { DataCatalogPage } from '@/components/data/DataCatalogPage';

export default async function SchemaCatalogPage({ params, searchParams }: {
  params: Promise<{ datasourceName: string; schema: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const [{ datasourceName, schema }, { view }] = await Promise.all([params, searchParams]);
  return <DataCatalogPage datasourceName={datasourceName} schema={schema} view={view === 'relations' ? 'relations' : 'charts'} />;
}
