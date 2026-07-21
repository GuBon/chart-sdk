import { DataCatalogPage } from '@/components/data/DataCatalogPage';

export default async function DatasourceCatalogPage({ params }: { params: Promise<{ datasourceId: string }> }) {
  const { datasourceId } = await params;
  return <DataCatalogPage datasourceId={Number(datasourceId)} />;
}
