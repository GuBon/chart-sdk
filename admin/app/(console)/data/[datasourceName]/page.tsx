import { DataCatalogPage } from '@/components/data/DataCatalogPage';

export default async function DatasourceCatalogPage({ params }: { params: Promise<{ datasourceName: string }> }) {
  const { datasourceName } = await params;
  return <DataCatalogPage datasourceName={datasourceName} />;
}
