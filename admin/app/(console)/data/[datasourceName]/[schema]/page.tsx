import { DataCatalogPage } from '@/components/data/DataCatalogPage';

export default async function SchemaCatalogPage({ params }: { params: Promise<{ datasourceName: string; schema: string }> }) {
  const { datasourceName, schema } = await params;
  return <DataCatalogPage datasourceName={datasourceName} schema={schema} />;
}
