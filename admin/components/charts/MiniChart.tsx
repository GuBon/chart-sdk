'use client';

import type { ChartType } from '@/lib/api';
import { ChartPreview } from './ChartPreview';

// S1 카드 썸네일 — chartType 별 대표 미니 차트(샘플 데이터). 축·범례·툴팁 없이 모양만.
const COLOR = '#5470C6';
const CATS = ['1', '2', '3', '4', '5'];

function miniOption(type: ChartType): Record<string, unknown> {
  const base = { animation: false, grid: { left: 4, right: 4, top: 8, bottom: 4 } };
  switch (type) {
    case 'line':
      return {
        ...base,
        xAxis: { type: 'category', show: false, data: CATS, boundaryGap: false },
        yAxis: { type: 'value', show: false },
        series: [{ type: 'line', data: [3, 5, 4, 6, 7], smooth: true, symbol: 'none', lineStyle: { width: 2, color: COLOR }, areaStyle: { color: COLOR, opacity: 0.15 } }],
      };
    case 'pie':
      return {
        ...base,
        series: [{ type: 'pie', radius: ['42%', '72%'], center: ['50%', '50%'], label: { show: false }, data: [{ value: 5 }, { value: 3 }, { value: 2 }, { value: 2 }] }],
      };
    case 'scatter':
      return {
        ...base,
        xAxis: { type: 'value', show: false },
        yAxis: { type: 'value', show: false },
        series: [{ type: 'scatter', symbolSize: 7, itemStyle: { color: COLOR }, data: [[1, 2], [2, 4], [3, 3], [4, 6], [5, 5], [3.5, 4.5]] }],
      };
    default: // bar
      return {
        ...base,
        xAxis: { type: 'category', show: false, data: CATS },
        yAxis: { type: 'value', show: false },
        series: [{ type: 'bar', data: [6, 4, 3, 4, 2], barWidth: '55%', itemStyle: { color: COLOR, borderRadius: [2, 2, 0, 0] } }],
      };
  }
}

export function MiniChart({ chartType }: { chartType: ChartType }) {
  return <ChartPreview option={miniOption(chartType)} />;
}
