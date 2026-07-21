import {
  BarChart3,
  CandlestickChart,
  Grid3x3,
  LineChart,
  MapIcon,
  MapPin,
  PieChart,
  ScatterChart,
  type LucideIcon,
} from 'lucide-react';
import { MAJOR_TYPE_CHOICES, type MajorType } from '@chartsdk/chart-options';

const ICONS: Record<MajorType, LucideIcon> = {
  bar: BarChart3,
  line: LineChart,
  pie: PieChart,
  scatter: ScatterChart,
  boxplot: CandlestickChart,
  heatmap: Grid3x3,
  map: MapIcon,
  geoscatter: MapPin,
};

export const CHART_TYPE_META = Object.fromEntries(
  MAJOR_TYPE_CHOICES.map((choice) => [choice.value, { label: choice.label, Icon: ICONS[choice.value] }]),
) as Record<MajorType, { label: string; Icon: LucideIcon }>;

export const CHART_TYPE_FILTER_OPTIONS = [
  { value: 'all', label: '모든 종류' },
  ...MAJOR_TYPE_CHOICES.map(({ value, label }) => ({ value, label })),
];

export function chartTypeLabel(type: MajorType): string {
  return CHART_TYPE_META[type].label;
}
