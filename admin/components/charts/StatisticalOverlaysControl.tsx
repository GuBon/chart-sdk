import {
  MAX_MOVING_AVERAGE_PERIOD,
  MIN_MOVING_AVERAGE_PERIOD,
  boxplotOutliersOf,
  isTemporalColumnType,
  movingAverageOf,
  type BoxplotOutlierOptions,
  type MovingAverageOptions,
} from '@chartsdk/chart-options/statisticalOverlays';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';

export function BoxplotOutliersControl({
  value,
  disabled,
  onChange,
}: {
  value: unknown;
  disabled: boolean;
  onChange: (value: BoxplotOutlierOptions) => void;
}) {
  const config = boxplotOutliersOf(value);
  return (
    <div className="flex flex-col gap-2.5" data-testid="boxplot-outliers">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] text-text-secondary">이상치 표시</p>
          <p className="text-[10px] leading-4 text-text-tertiary">Q1·Q3에서 1.5 × IQR을 벗어난 값을 점으로 표시합니다.</p>
        </div>
        <Switch
          aria-label="박스플롯 이상치 표시"
          checked={config.show}
          disabled={disabled}
          onChange={(show) => onChange({ ...config, show })}
        />
      </div>
      {config.show && (
        <div className="flex min-h-7 items-center justify-between gap-2">
          <span className="text-[13px] text-text-secondary">이상치 색상</span>
          <input
            aria-label="박스플롯 이상치 색상"
            type="color"
            value={config.color}
            disabled={disabled}
            className="h-7 w-10 rounded border border-border disabled:opacity-50"
            onChange={(event) => onChange({ ...config, color: event.target.value.toUpperCase() })}
          />
        </div>
      )}
    </div>
  );
}

export function MovingAverageControl({
  value,
  columns,
  rows,
  disabled,
  onChange,
}: {
  value: unknown;
  columns: { name: string; type: string }[];
  rows: unknown[][];
  disabled: boolean;
  onChange: (value: MovingAverageOptions) => void;
}) {
  const config = movingAverageOf(value);
  const temporal = isTemporalColumnType(columns[0]?.type);
  const series = columns.slice(1).map((column, index) => ({ value: index, label: column.name }));
  const selectedSeriesIndex = Math.min(config.seriesIndex, Math.max(0, series.length - 1));
  const cannotEnable = !temporal || series.length === 0;

  return (
    <div className="flex flex-col gap-2.5" data-testid="moving-average">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[13px] text-text-secondary">이동평균 표시</p>
          <p className="text-[10px] leading-4 text-text-tertiary">시간 오름차순으로 정렬한 최근 N개 관측치의 단순 평균입니다.</p>
        </div>
        <Switch
          aria-label="이동평균 표시"
          checked={config.enabled}
          disabled={disabled || (cannotEnable && !config.enabled)}
          onChange={(enabled) => {
            if (enabled && cannotEnable) return;
            onChange({ ...config, enabled, seriesIndex: selectedSeriesIndex });
          }}
        />
      </div>

      {!temporal && (
        <p className="rounded-md border border-dashed border-border px-2.5 py-2 text-[11px] leading-4 text-text-tertiary">
          날짜·시간 형식의 X축 열에서만 사용할 수 있습니다.
        </p>
      )}

      {config.enabled && temporal && (
        <div className="flex flex-col gap-2.5 rounded-md border border-border bg-bg-panel p-2.5">
          {series.length > 1 && (
            <label className="flex min-h-7 items-center justify-between gap-2">
              <span className="text-[12px] text-text-secondary">적용 계열</span>
              <Select
                aria-label="이동평균 적용 계열"
                value={String(selectedSeriesIndex)}
                disabled={disabled}
                options={series}
                onChange={(event) => onChange({ ...config, seriesIndex: Number(event.target.value) })}
                className="w-36"
              />
            </label>
          )}
          <label className="flex min-h-7 items-center justify-between gap-2">
            <span className="text-[12px] text-text-secondary">기간</span>
            <Input
              aria-label="이동평균 기간"
              type="number"
              min={MIN_MOVING_AVERAGE_PERIOD}
              max={MAX_MOVING_AVERAGE_PERIOD}
              step={1}
              size="sm"
              value={String(config.period)}
              disabled={disabled}
              className="w-24"
              onChange={(event) => onChange({
                ...config,
                period: clampPeriod(event.target.value),
              })}
            />
          </label>
          <label className="flex min-h-7 items-center justify-between gap-2">
            <span className="text-[12px] text-text-secondary">범례에 포함</span>
            <Switch
              aria-label="이동평균 범례 포함"
              checked={config.showInLegend}
              disabled={disabled}
              onChange={(showInLegend) => onChange({ ...config, showInLegend })}
            />
          </label>
          <p className="text-[10px] leading-4 text-text-tertiary">
            {rows.length < config.period
              ? `현재 ${rows.length}개 관측치보다 기간이 커서 평균선이 표시되지 않습니다.`
              : `처음 ${config.period - 1}개 구간은 평균값이 없어 비워 둡니다.`}
          </p>
        </div>
      )}
    </div>
  );
}

function clampPeriod(value: string): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return MIN_MOVING_AVERAGE_PERIOD;
  return Math.max(MIN_MOVING_AVERAGE_PERIOD, Math.min(MAX_MOVING_AVERAGE_PERIOD, Math.trunc(numeric)));
}
