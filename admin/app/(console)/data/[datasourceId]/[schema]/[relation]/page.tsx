import { DataCatalogPage } from '@/components/data/DataCatalogPage';

export default async function RelationCatalogPage({ params }: { params: Promise<{ datasourceId: string; schema: string; relation: string }> }) {
  const { datasourceId, schema, relation } = await params;
  return (
    <DataCatalogPage
      datasourceId={Number(datasourceId)}
      schema={schema}
      relation={relation}
    />
  );
}
