import { DataCatalogPage } from '@/components/data/DataCatalogPage';

export default async function RelationCatalogPage({ params }: { params: Promise<{ datasourceName: string; schema: string; relation: string }> }) {
  const { datasourceName, schema, relation } = await params;
  return <DataCatalogPage datasourceName={datasourceName} schema={schema} relation={relation} />;
}
