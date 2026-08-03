import { Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import {
  MAX_ANALYSIS_ANNOTATIONS_PER_KIND,
  analysisAnnotationsOf,
  type AnalysisAnnotations,
  type AnalysisReferenceLine,
  type AnalysisReferenceRange,
  type AnalysisTarget,
} from '@chartsdk/chart-options/analysisAnnotations';
import type { MajorType } from '@chartsdk/chart-options';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';

type AnnotationKind = keyof AnalysisAnnotations;

interface Props {
  value: unknown;
  chartType: MajorType;
  columns: { name: string; type: string }[];
  rows: unknown[][];
  seriesDisplayNames?: Record<string, string>;
  disabled: boolean;
  onChange: (value: AnalysisAnnotations) => void;
}

const DEFAULT_COLORS = {
  lines: '#E53935',
  ranges: '#FFB000',
  targets: '#D81B60',
} as const;

export function AnalysisAnnotationsControl({
  value,
  chartType,
  columns,
  rows,
  seriesDisplayNames = {},
  disabled,
  onChange,
}: Props) {
  const annotations = analysisAnnotationsOf(value);
  const series = columns.slice(1).map((column, index) => ({
    value: index,
    label: seriesDisplayNames[column.name] ?? column.name,
  }));
  const xValues = uniqueXValues(rows);
  const defaultX = xValues[0] ?? (chartType === 'scatter' ? 0 : '');

  const replace = <K extends AnnotationKind>(kind: K, index: number, patch: Partial<AnalysisAnnotations[K][number]>) => {
    const next = analysisAnnotationsOf(value);
    next[kind] = next[kind].map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    )) as AnalysisAnnotations[K];
    onChange(next);
  };
  const remove = (kind: AnnotationKind, index: number) => {
    const next = analysisAnnotationsOf(value);
    next[kind] = next[kind].filter((_item, itemIndex) => itemIndex !== index) as never;
    onChange(next);
  };
  const append = (kind: AnnotationKind) => {
    const next = analysisAnnotationsOf(value);
    if (next[kind].length >= MAX_ANALYSIS_ANNOTATIONS_PER_KIND) return;
    if (kind === 'lines') {
      next.lines.push({
        id: annotationId('line'),
        name: `기준선 ${next.lines.length + 1}`,
        seriesIndex: 0,
        color: DEFAULT_COLORS.lines,
        showLabel: true,
        value: 0,
        lineType: 'dashed',
        lineWidth: 2,
      });
    } else if (kind === 'ranges') {
      next.ranges.push({
        id: annotationId('range'),
        name: `기준 범위 ${next.ranges.length + 1}`,
        seriesIndex: 0,
        color: DEFAULT_COLORS.ranges,
        showLabel: true,
        min: 0,
        max: 100,
        opacity: 0.16,
      });
    } else {
      next.targets.push({
        id: annotationId('target'),
        name: `목표 ${next.targets.length + 1}`,
        seriesIndex: 0,
        color: DEFAULT_COLORS.targets,
        showLabel: true,
        xValue: defaultX,
        value: 0,
        symbol: 'pin',
        symbolSize: 42,
      });
    }
    onChange(next);
  };

  return (
    <div className="flex w-full flex-col gap-4" data-testid="analysis-annotations">
      <p className="text-[11px] leading-4 text-text-tertiary">
        값 축을 기준으로 표시합니다. 조합 차트나 이중 축에서는 적용 계열을 선택하세요.
      </p>

      <AnnotationGroup
        title="기준선"
        description="특정 값을 가로지르는 선"
        count={annotations.lines.length}
        disabled={disabled}
        onAdd={() => append('lines')}
      >
        {annotations.lines.map((item, index) => (
          <LineEditor
            key={item.id || `line-${index}`}
            item={item}
            index={index}
            series={series}
            disabled={disabled}
            onChange={(patch) => replace('lines', index, patch)}
            onRemove={() => remove('lines', index)}
          />
        ))}
      </AnnotationGroup>

      <AnnotationGroup
        title="기준 범위"
        description="최솟값과 최댓값 사이를 음영 처리"
        count={annotations.ranges.length}
        disabled={disabled}
        onAdd={() => append('ranges')}
      >
        {annotations.ranges.map((item, index) => (
          <RangeEditor
            key={item.id || `range-${index}`}
            item={item}
            index={index}
            series={series}
            disabled={disabled}
            onChange={(patch) => replace('ranges', index, patch)}
            onRemove={() => remove('ranges', index)}
          />
        ))}
      </AnnotationGroup>

      <AnnotationGroup
        title="목표값"
        description="선택한 X 위치에 목표점을 표시"
        count={annotations.targets.length}
        disabled={disabled}
        onAdd={() => append('targets')}
      >
        {annotations.targets.map((item, index) => (
          <TargetEditor
            key={item.id || `target-${index}`}
            item={item}
            index={index}
            chartType={chartType}
            series={series}
            xValues={xValues}
            disabled={disabled}
            onChange={(patch) => replace('targets', index, patch)}
            onRemove={() => remove('targets', index)}
          />
        ))}
      </AnnotationGroup>
    </div>
  );
}

function AnnotationGroup({
  title,
  description,
  count,
  disabled,
  onAdd,
  children,
}: {
  title: string;
  description: string;
  count: number;
  disabled: boolean;
  onAdd: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-text-primary">{title}</p>
          <p className="text-[10px] leading-4 text-text-tertiary">{description}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          icon={<Plus className="size-3.5" />}
          className="h-7 px-2 text-[11px]"
          disabled={disabled || count >= MAX_ANALYSIS_ANNOTATIONS_PER_KIND}
          onClick={onAdd}
        >
          추가
        </Button>
      </div>
      {count === 0
        ? <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] text-text-tertiary">아직 추가되지 않았습니다.</p>
        : children}
    </div>
  );
}

function LineEditor({
  item,
  index,
  series,
  disabled,
  onChange,
  onRemove,
}: {
  item: AnalysisReferenceLine;
  index: number;
  series: { value: number; label: string }[];
  disabled: boolean;
  onChange: (patch: Partial<AnalysisReferenceLine>) => void;
  onRemove: () => void;
}) {
  return (
    <AnnotationCard
      kindLabel="기준선"
      index={index}
      name={item.name}
      seriesIndex={item.seriesIndex}
      series={series}
      color={item.color}
      showLabel={item.showLabel}
      disabled={disabled}
      onChangeName={(name) => onChange({ name })}
      onChangeSeries={(seriesIndex) => onChange({ seriesIndex })}
      onChangeColor={(color) => onChange({ color })}
      onChangeShowLabel={(showLabel) => onChange({ showLabel })}
      onRemove={onRemove}
    >
      <CompactField label="값">
        <NumberInput
          ariaLabel={`기준선 ${index + 1} 값`}
          value={item.value}
          disabled={disabled}
          onChange={(next) => onChange({ value: next })}
        />
      </CompactField>
      <CompactField label="선 모양">
        <Select
          aria-label={`기준선 ${index + 1} 선 모양`}
          value={item.lineType}
          disabled={disabled}
          options={[
            { value: 'solid', label: '실선' },
            { value: 'dashed', label: '파선' },
            { value: 'dotted', label: '점선' },
          ]}
          onChange={(event) => onChange({ lineType: event.target.value as AnalysisReferenceLine['lineType'] })}
        />
      </CompactField>
      <CompactField label="두께">
        <NumberInput
          ariaLabel={`기준선 ${index + 1} 두께`}
          value={item.lineWidth}
          min={1}
          max={8}
          step={1}
          disabled={disabled}
          onChange={(next) => onChange({ lineWidth: next ?? 2 })}
        />
      </CompactField>
    </AnnotationCard>
  );
}

function RangeEditor({
  item,
  index,
  series,
  disabled,
  onChange,
  onRemove,
}: {
  item: AnalysisReferenceRange;
  index: number;
  series: { value: number; label: string }[];
  disabled: boolean;
  onChange: (patch: Partial<AnalysisReferenceRange>) => void;
  onRemove: () => void;
}) {
  return (
    <AnnotationCard
      kindLabel="기준 범위"
      index={index}
      name={item.name}
      seriesIndex={item.seriesIndex}
      series={series}
      color={item.color}
      showLabel={item.showLabel}
      disabled={disabled}
      onChangeName={(name) => onChange({ name })}
      onChangeSeries={(seriesIndex) => onChange({ seriesIndex })}
      onChangeColor={(color) => onChange({ color })}
      onChangeShowLabel={(showLabel) => onChange({ showLabel })}
      onRemove={onRemove}
    >
      <CompactField label="시작값">
        <NumberInput
          ariaLabel={`기준 범위 ${index + 1} 시작값`}
          value={item.min}
          disabled={disabled}
          onChange={(next) => onChange({ min: next })}
        />
      </CompactField>
      <CompactField label="종료값">
        <NumberInput
          ariaLabel={`기준 범위 ${index + 1} 종료값`}
          value={item.max}
          disabled={disabled}
          onChange={(next) => onChange({ max: next })}
        />
      </CompactField>
      <CompactField label={`불투명도 ${Math.round(Number(item.opacity ?? 0.16) * 100)}%`}>
        <input
          aria-label={`기준 범위 ${index + 1} 불투명도`}
          type="range"
          min={5}
          max={60}
          step={1}
          value={Math.round(Number(item.opacity ?? 0.16) * 100)}
          disabled={disabled}
          className="h-8 w-full accent-primary disabled:opacity-50"
          onChange={(event) => onChange({ opacity: Number(event.target.value) / 100 })}
        />
      </CompactField>
    </AnnotationCard>
  );
}

function TargetEditor({
  item,
  index,
  chartType,
  series,
  xValues,
  disabled,
  onChange,
  onRemove,
}: {
  item: AnalysisTarget;
  index: number;
  chartType: MajorType;
  series: { value: number; label: string }[];
  xValues: unknown[];
  disabled: boolean;
  onChange: (patch: Partial<AnalysisTarget>) => void;
  onRemove: () => void;
}) {
  const currentIndex = xValues.findIndex((value) => sameCategory(value, item.xValue));
  const categoricalChoices = xValues.map((value, valueIndex) => ({
    value: String(valueIndex),
    label: String(value ?? ''),
  }));
  if (currentIndex < 0 && item.xValue != null && String(item.xValue).trim()) {
    categoricalChoices.unshift({ value: 'current', label: `${String(item.xValue)} (기존)` });
  }
  const currentCategory = currentIndex >= 0 ? String(currentIndex) : 'current';

  return (
    <AnnotationCard
      kindLabel="목표값"
      index={index}
      name={item.name}
      seriesIndex={item.seriesIndex}
      series={series}
      color={item.color}
      showLabel={item.showLabel}
      disabled={disabled}
      onChangeName={(name) => onChange({ name })}
      onChangeSeries={(seriesIndex) => onChange({ seriesIndex })}
      onChangeColor={(color) => onChange({ color })}
      onChangeShowLabel={(showLabel) => onChange({ showLabel })}
      onRemove={onRemove}
    >
      <CompactField label="X 위치">
        {chartType === 'scatter' ? (
          <NumberInput
            ariaLabel={`목표값 ${index + 1} X 위치`}
            value={numericOrNull(item.xValue)}
            disabled={disabled}
            onChange={(next) => onChange({ xValue: next })}
          />
        ) : (
          <Select
            aria-label={`목표값 ${index + 1} X 위치`}
            value={currentCategory}
            disabled={disabled}
            options={categoricalChoices}
            placeholder={categoricalChoices.length === 0 ? '실행 결과 없음' : undefined}
            onChange={(event) => onChange({
              xValue: event.target.value === 'current'
                ? item.xValue
                : xValues[Number(event.target.value)],
            })}
          />
        )}
      </CompactField>
      <CompactField label="목표값">
        <NumberInput
          ariaLabel={`목표값 ${index + 1} 값`}
          value={item.value}
          disabled={disabled}
          onChange={(next) => onChange({ value: next })}
        />
      </CompactField>
      <CompactField label="기호">
        <Select
          aria-label={`목표값 ${index + 1} 기호`}
          value={item.symbol}
          disabled={disabled}
          options={[
            { value: 'pin', label: '핀' },
            { value: 'diamond', label: '마름모' },
            { value: 'circle', label: '원' },
          ]}
          onChange={(event) => onChange({ symbol: event.target.value as AnalysisTarget['symbol'] })}
        />
      </CompactField>
      <CompactField label="크기">
        <NumberInput
          ariaLabel={`목표값 ${index + 1} 크기`}
          value={item.symbolSize}
          min={12}
          max={80}
          step={1}
          disabled={disabled}
          onChange={(next) => onChange({ symbolSize: next ?? 42 })}
        />
      </CompactField>
    </AnnotationCard>
  );
}

function AnnotationCard({
  kindLabel,
  index,
  name,
  seriesIndex,
  series,
  color,
  showLabel,
  disabled,
  onChangeName,
  onChangeSeries,
  onChangeColor,
  onChangeShowLabel,
  onRemove,
  children,
}: {
  kindLabel: string;
  index: number;
  name: string;
  seriesIndex: number;
  series: { value: number; label: string }[];
  color: string;
  showLabel: boolean;
  disabled: boolean;
  onChangeName: (value: string) => void;
  onChangeSeries: (value: number) => void;
  onChangeColor: (value: string) => void;
  onChangeShowLabel: (value: boolean) => void;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border bg-bg-panel p-2.5">
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={`${kindLabel} ${index + 1} 이름`}
          value={name ?? ''}
          maxLength={80}
          size="sm"
          disabled={disabled}
          placeholder={kindLabel}
          onChange={(event) => onChangeName(event.target.value)}
        />
        <button
          type="button"
          aria-label={`${kindLabel} ${index + 1} 삭제`}
          disabled={disabled}
          onClick={onRemove}
          className="flex size-8 shrink-0 items-center justify-center rounded-md text-text-tertiary hover:bg-muted hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {series.length > 1 && (
        <CompactField label="적용 계열">
          <Select
            aria-label={`${kindLabel} ${index + 1} 적용 계열`}
            value={String(clampSeriesIndex(seriesIndex, series.length))}
            disabled={disabled}
            options={series}
            onChange={(event) => onChangeSeries(Number(event.target.value))}
          />
        </CompactField>
      )}
      <div className="grid grid-cols-2 gap-2">{children}</div>
      <div className="flex items-center justify-between gap-2 border-t border-border pt-2">
        <label className="flex items-center gap-2 text-[11px] text-text-secondary">
          <input
            aria-label={`${kindLabel} ${index + 1} 색상`}
            type="color"
            value={colorForInput(color)}
            disabled={disabled}
            className="h-7 w-9 rounded border border-border disabled:opacity-50"
            onChange={(event) => onChangeColor(event.target.value.toUpperCase())}
          />
          색상
        </label>
        <label className="flex items-center gap-2 text-[11px] text-text-secondary">
          라벨
          <Switch
            aria-label={`${kindLabel} ${index + 1} 라벨 표시`}
            checked={showLabel !== false}
            disabled={disabled}
            onChange={onChangeShowLabel}
          />
        </label>
      </div>
    </div>
  );
}

function CompactField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[10px] text-text-tertiary">
      <span>{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  ariaLabel,
  value,
  min,
  max,
  step = 'any',
  disabled,
  onChange,
}: {
  ariaLabel: string;
  value: number | null | undefined;
  min?: number;
  max?: number;
  step?: number | 'any';
  disabled: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <Input
      aria-label={ariaLabel}
      type="number"
      value={value == null ? '' : String(value)}
      min={min}
      max={max}
      step={step}
      size="sm"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))}
    />
  );
}

function annotationId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid ? `${prefix}-${uuid}` : `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueXValues(rows: unknown[][]): unknown[] {
  const seen = new Set<string>();
  const values: unknown[] = [];
  for (const row of rows) {
    const value = row[0];
    const key = `${typeof value}:${String(value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
    if (values.length >= 200) break;
  }
  return values;
}

function sameCategory(left: unknown, right: unknown): boolean {
  return typeof left === typeof right && Object.is(left, right);
}

function numericOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function clampSeriesIndex(value: unknown, length: number): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(Math.max(0, length - 1), numeric));
}

function colorForInput(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return /^#[0-9A-Fa-f]{6}$/.test(normalized) ? normalized : '#E53935';
}
