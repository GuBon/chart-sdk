'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { datasourcesApi } from '@/lib/api';
import type { Datasource } from '@/lib/api';
import { ChartListView } from '@/components/charts/ChartListView';
import { chartDatasourcePath } from '@/lib/chartRoutes';

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ChartList />
    </Suspense>
  );
}

function ChartList() {
  const router = useRouter();
  const params = useSearchParams();
  const [datasources, setDatasources] = useState<Datasource[]>([]);
  const [datasourcesLoaded, setDatasourcesLoaded] = useState(false);
  const legacyDatasourceId = params.get('datasourceId');
  const legacyDatasourceName = params.get('datasource');
  const hasLegacyDatasource = legacyDatasourceId !== null || legacyDatasourceName !== null;

  useEffect(() => {
    let alive = true;
    void datasourcesApi.list()
      .then((items) => {
        if (!alive) return;
        setDatasources(items);
        setDatasourcesLoaded(true);
      })
      .catch(() => {
        if (alive) setDatasourcesLoaded(true);
      });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!datasourcesLoaded || !hasLegacyDatasource) return;
    const selected = legacyDatasourceId !== null
      ? datasources.find((item) => item.id === Number(legacyDatasourceId))
      : datasources.find((item) => item.name === legacyDatasourceName);
    const next = new URLSearchParams(params.toString());
    next.delete('datasourceId');
    next.delete('datasource');
    next.delete('page');
    const query = next.toString();
    const path = selected ? chartDatasourcePath(selected.name) : '/';
    router.replace(query ? `${path}?${query}` : path, { scroll: false });
  }, [datasources, datasourcesLoaded, hasLegacyDatasource, legacyDatasourceId, legacyDatasourceName, params, router]);

  if (hasLegacyDatasource) return null;
  return <ChartListView datasources={datasources} />;
}
