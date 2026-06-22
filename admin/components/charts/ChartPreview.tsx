'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';

// S2 우측 상단 차트 미리보기. 서버(목 변환기)가 조립한 ECharts option 을 setOption 만 한다.
// (방식 A — 클라이언트는 모양을 결정하지 않는다. SDK 와 동일 규약.)
export function ChartPreview({ option }: { option: Record<string, unknown> | null }) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!elRef.current) return;
    const chart = echarts.init(elRef.current);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => chart.resize());
    ro.observe(elRef.current);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    if (option) chart.setOption(option, true);
    else chart.clear();
  }, [option]);

  return <div ref={elRef} data-testid="chart-preview" className="h-full w-full" />;
}
