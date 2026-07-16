'use client';

import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import krSido from '@chartsdk/chart-options/maps/kr-sido.json';
import krSigungu from '@chartsdk/chart-options/maps/kr-sigungu.json';
import { hasChartTitle, responsiveTitlePatch, withResponsiveTitle } from '@chartsdk/chart-options/renderLayout';

// 지도(map·geoscatter) 차트용 GeoJSON 등록 — 모듈 로드 시 1회. registerMap 은 DOM 불요라 SSR 안전.
// 미리보기(에디터)와 S1 썸네일(MiniChart)이 이 컴포넌트를 공유하므로 여기서 등록하면 양쪽 모두 커버.
echarts.registerMap('kr-sido', krSido as never);
echarts.registerMap('kr-sigungu', krSigungu as never);

// S2 우측 상단 차트 미리보기. 서버(목 변환기)가 조립한 ECharts option 을 setOption 만 한다.
// (방식 A — 클라이언트는 모양을 결정하지 않는다. SDK 와 동일 규약.)
export function ChartPreview({ option }: { option: Record<string, unknown> | null }) {
  const elRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const hasTitleRef = useRef(false);

  useEffect(() => {
    if (!elRef.current) return;
    const el = elRef.current;
    const chart = echarts.init(el);
    chartRef.current = chart;
    const ro = new ResizeObserver(() => {
      chart.resize();
      if (hasTitleRef.current) chart.setOption(responsiveTitlePatch(el.clientWidth));
    });
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const el = elRef.current;
    if (!chart || !el) return;
    if (option) {
      hasTitleRef.current = hasChartTitle(option);
      chart.setOption(withResponsiveTitle(option, el.clientWidth), true);
    } else {
      hasTitleRef.current = false;
      chart.clear();
    }
  }, [option]);

  return <div ref={elRef} data-testid="chart-preview" className="h-full w-full" />;
}
