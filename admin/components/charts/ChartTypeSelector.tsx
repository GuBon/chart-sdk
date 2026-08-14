import { Fragment, type ReactNode } from 'react';
import {
  getVariants,
  MAJOR_TYPE_CHOICES,
  type MajorType,
} from '@chartsdk/chart-options';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/lib/cn';
import { CHART_TYPE_META, chartTypeLabel } from '@/lib/chartTypes';

interface Props {
  /** null이면 아직 아무 종류도 선택하지 않은 상태 — 어떤 버튼도 활성 표시하지 않는다. */
  chartType: MajorType | null;
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
  const variants = chartType ? getVariants(chartType) : [];
  const selectedVariant = variants.find((choice) => choice.value === variant) ?? variants[0];
  const effectiveVariant = selectedVariant?.value ?? '';

  return (
    <div className="flex flex-col gap-4 p-4">
      <SelectorRow label="대분류">
        <TypeGrid
          choices={MAJOR_TYPE_CHOICES}
          value={chartType}
          onChange={onChangeChartType}
        />
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
  value: MajorType | null;
  onChange: (value: MajorType) => void;
}) {
  // 지리 계열 포함 전체를 한 줄로 배치하고, 폭이 부족하면 자동 줄바꿈한다.
  // 그룹(GEO 등)이 바뀌는 지점에는 그룹명 없이 세로 구분선만 둔다.
  return (
    <div className="flex min-w-0 flex-1 flex-wrap gap-2" role="group" aria-label="차트 대분류">
      {choices.map((choice, index) => {
        const { Icon } = CHART_TYPE_META[choice.value];
        const active = choice.value === value;
        const startsNewGroup = index > 0 && choice.group !== choices[index - 1].group;
        return (
          <Fragment key={choice.value}>
            {startsNewGroup && <span aria-hidden="true" className="my-1 w-px self-stretch bg-border" />}
            <button
              type="button"
              aria-pressed={active}
              data-testid={`builder-chart-type-${choice.value}`}
              onClick={() => onChange(choice.value)}
              className={cn(
                'flex min-h-10 items-center gap-2 whitespace-nowrap rounded-md border px-3 py-2 text-xs transition-colors',
                active
                  ? 'border-primary bg-muted font-medium text-text-primary'
                  : 'border-border text-text-secondary hover:bg-muted hover:text-text-primary',
              )}
            >
              <Icon className="size-4 shrink-0" />
              {choice.label}
            </button>
          </Fragment>
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
