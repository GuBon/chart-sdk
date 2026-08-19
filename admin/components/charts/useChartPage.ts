'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { chartsApi } from '@/lib/api';
import type { ChartListParams, ChartOptions, ChartSummary } from '@/lib/api';

export function useChartPage(params: ChartListParams, onPageResolved?: (page: number) => void) {
  const { q, type, datasourceId, schema, relation, sort, page = 1, pageSize } = params;
  const [charts, setCharts] = useState<ChartSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [previewOptions, setPreviewOptions] = useState<Record<number, ChartOptions | null>>({});
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [reloadToken, setReloadToken] = useState(0);
  const onPageResolvedRef = useRef(onPageResolved);
  onPageResolvedRef.current = onPageResolved;

  const reload = useCallback(() => setReloadToken((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    setCharts(null);
    setError(false);
    setPreviewOptions({});
    void chartsApi.list({ q, type, datasourceId, schema, relation, sort, page, pageSize })
      .then((response) => {
        if (!alive) return;
        setCharts(response.charts);
        setTotal(response.total);
        setTotalPages(response.totalPages);
        if (response.page !== page) onPageResolvedRef.current?.(response.page);
      })
      .catch(() => {
        if (!alive) return;
        // 목록 조회 실패를 빈 목록("차트 없음")으로 위장하지 않는다 — 오류 상태를 분리해
        // 화면이 "불러오지 못함 + 재시도"를 안내하게 한다(운영자가 전체 삭제로 오인하는 것 방지).
        setError(true);
        setCharts([]);
        setTotal(0);
        setTotalPages(1);
      });
    return () => { alive = false; };
  }, [datasourceId, page, pageSize, q, relation, reloadToken, schema, sort, type]);

  useEffect(() => {
    if (!charts?.length) {
      setPreviewOptions({});
      return;
    }
    let alive = true;
    const ids = charts.map((chart) => chart.id);
    void chartsApi.previews(ids)
      .then((response) => {
        if (!alive) return;
        setPreviewOptions(Object.fromEntries(ids.map((id) => [id, response.previews[String(id)]?.option ?? null])));
      })
      .catch(() => {
        if (alive) setPreviewOptions(Object.fromEntries(ids.map((id) => [id, null])));
      });
    return () => { alive = false; };
  }, [charts]);

  return { charts, previewOptions, total, totalPages, error, reload };
}
