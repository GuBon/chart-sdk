import { DataCatalogPage } from '@/components/data/DataCatalogPage';

export default async function SchemaCatalogPage({ params }: { params: Promise<{ datasourceId: string; schema: string }> }) {
  const { datasourceId, schema } = await params;
  return <DataCatalogPage datasourceId={Number(datasourceId)} schema={schema} />;
}
