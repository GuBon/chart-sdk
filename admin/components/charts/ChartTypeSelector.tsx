'use client';

import type { ReactNode } from 'react';
import {
  getVariants,
  MAJOR_TYPE_CHOICES,
  type MajorType,
} from '@chartsdk/chart-options';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { CHART_TYPE_META, chartTypeLabel } from '@/lib/chartTypes';

interface Props {
  chartType: MajorType;
  variant: string;
  onChangeChartType: (chartType: MajorType) => void;
  onChangeVariant: (variant: string) => void;
}

/** 저장 레지스트리를 그대로 사용하는 차트 대분류·중분류 선택 UI. */
export function ChartTypeSelector({
  chartType,
  variant,
  onChangeChartType,
  onChangeVariant,
}: Props) {
  const variants = getVariants(chartType);
  const selectedVariant = variants.find((choice) => choice.value === variant) ?? variants[0];
  const effectiveVariant = selectedVariant?.value ?? '';
  const ungrouped = MAJOR_TYPE_CHOICES.filter((choice) => !choice.group);
  const groups = [...new Set(MAJOR_TYPE_CHOICES.flatMap((choice) => choice.group ? [choice.group] : []))];

  return (
    <div className="flex flex-col gap-4 p-4">
      <SelectorRow label="대분류">
        <div className="flex min-w-0 flex-1 flex-col gap-3" role="group" aria-label="차트 대분류">
          <TypeGrid
            choices={ungrouped}
            value={chartType}
            onChange={onChangeChartType}
          />
          {groups.map((group) => (
            <div key={group} className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{group}</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <TypeGrid
                choices={MAJOR_TYPE_CHOICES.filter((choice) => choice.group === group)}
                value={chartType}
                onChange={onChangeChartType}
              />
            </div>
          ))}
        </div>
      </SelectorRow>

      {variants.length > 1 && (
        <SelectorRow label="중분류">
          <Segmented
            ariaLabel="차트 중분류"
            value={effectiveVariant}
            options={variants.map((choice) => ({ value: choice.value, label: choice.label }))}
            onChange={onChangeVariant}
          />
          {selectedVariant?.help && (
            <span className="text-xs text-text-tertiary">
              {selectedVariant.help}
            </span>
          )}
        </SelectorRow>
      )}
    </div>
  );
}

export function chartTypeSelectionLabel(chartType: MajorType, variant: string): string {
  const variants = getVariants(chartType);
  if (variants.length <= 1) return chartTypeLabel(chartType);
  const selected = variants.find((choice) => choice.value === variant) ?? variants[0];
  return selected ? `${chartTypeLabel(chartType)} · ${selected.label}` : chartTypeLabel(chartType);
}

function TypeGrid({
  choices,
  value,
  onChange,
}: {
  choices: typeof MAJOR_TYPE_CHOICES;
  value: MajorType;
  onChange: (value: MajorType) => void;
}) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(88px,1fr))] gap-2">
      {choices.map((choice) => {
        const { Icon } = CHART_TYPE_META[choice.value];
        const active = choice.value === value;
        return (
          <button
            key={choice.value}
            type="button"
            aria-pressed={active}
            data-testid={`builder-chart-type-${choice.value}`}
            onClick={() => onChange(choice.value)}
            className={cn(
              'flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-md border px-2 py-2 text-xs transition-colors',
              active
                ? 'border-primary bg-muted font-medium text-text-primary'
                : 'border-border text-text-secondary hover:bg-muted hover:text-text-primary',
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{choice.label}</span>
          </button>
        );
      })}
    </div>
  );
}

function SelectorRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-16 shrink-0 pt-2 text-[13px] text-text-secondary">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}
