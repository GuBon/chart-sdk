import type { ReactNode } from 'react';
import { getVariants, type MajorType, type OptionDef } from '@chartsdk/chart-options';
import type { ChartTypography } from '@chartsdk/chart-options/display';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Segmented } from '@/components/ui/Segmented';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { CHART_TYPE_META } from '@/lib/chartTypes';
import {
  DEFAULT_PALETTE,
  paletteChoicesForChartType,
  paletteFamilyForChartType,
} from '@chartsdk/chart-options/palettes';
import {
  findItemColorOverride,
  itemColorTargetKey,
  type ColorSelection,
} from '@chartsdk/chart-options/colorOverrides';


export function TypographyPolicy({ typography }: { typography: ChartTypography }) {
  return (
    <div data-testid="typography-policy" aria-live="polite" className="rounded-md bg-muted px-2.5 py-2 text-[11px] leading-4 text-text-tertiary">
      <p>{typography.mode === 'auto' ? '자동: 논리 차트 크기를 바꾸면 다시 계산합니다.' : '직접 지정: 저장한 px 값을 그대로 사용합니다.'}</p>
      <p>현재 제목 {typography.title}px · 범례 {typography.legend}px · 축 {typography.axis}px · 라벨 {typography.dataLabel}px · 툴팁 {typography.tooltip}px</p>
      <p>임베드 영역만 CSS로 리사이즈하면 위 px 값은 유지됩니다.</p>
    </div>
  );
}

export function OptionControl({
  def,
  value,
  chartType,
  columns,
  colorTargets,
  hasResult,
  disabled,
  paletteColors,
  paletteReversed,
  continuousPalette,
  colorMap,
  autoColorMap,
  itemColorOverrides,
  colorSelection,
  colorPicking,
  onChange,
  onChangeType,
  onSelectColorTarget,
  onColorPickingChange,
  onApplySelectedColor,
  onClearSelectedColor,
}: {
  def: OptionDef;
  value: unknown;
  chartType: MajorType;
  columns: { name: string; type: string }[];
  colorTargets: ColorSelection[];
  hasResult: boolean;
  disabled: boolean;
  paletteColors: string[];
  paletteReversed: boolean;
  continuousPalette: boolean;
  colorMap: Record<string, string>;
  autoColorMap: Record<string, string>;
  itemColorOverrides: unknown;
  colorSelection: ColorSelection | null;
  colorPicking: boolean;
  onChange: (value: unknown) => void;
  onChangeType: (type: MajorType) => void;
  onSelectColorTarget: (target: ColorSelection) => void;
  onColorPickingChange: (picking: boolean) => void;
  onApplySelectedColor: (color: string) => void;
  onClearSelectedColor: () => void;
}) {
  const fieldName = fieldNameFor(def.key);
  const fieldId = `option-${fieldName}`;

  if (def.control === 'iconGrid') {
    const choices = def.choices ?? [];
    const groups = [...new Set(choices.filter((choice) => choice.group).map((choice) => choice.group!))];
    const typeButton = (choice: NonNullable<OptionDef['choices']>[number]) => {
      const Icon = CHART_TYPE_META[choice.value as MajorType]?.Icon ?? CHART_TYPE_META.bar.Icon;
      const active = choice.value === value;
      return (
        <button
          key={choice.value}
          type="button"
          aria-label={choice.label}
          onClick={() => onChangeType(choice.value as MajorType)}
          className={cn(
            'flex flex-col items-center gap-1.5 rounded-md border py-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
            active ? 'border-primary bg-muted text-text-primary' : 'border-border text-text-secondary hover:bg-muted',
          )}
        >
          <Icon className="size-4" />
          {choice.label}
        </button>
      );
    };
    return (
      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-4 gap-2">{choices.filter((choice) => !choice.group).map(typeButton)}</div>
        {groups.map((group) => (
          <div key={group} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 pt-1">
              <span className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{group}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-4 gap-2">{choices.filter((choice) => choice.group === group).map(typeButton)}</div>
          </div>
        ))}
      </div>
    );
  }

  if (def.control === 'textarea') {
    return (
      <Labeled label={def.label} stack>
        <textarea
          id={fieldId}
          name={fieldName}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={def.key === 'tooltip.template' ? 5 : 2}
          className="w-full resize-none rounded-md border border-border bg-bg-panel px-3 py-2 text-[13px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50"
        />
        {def.help && <span className="text-[11px] leading-4 text-text-tertiary">{def.help}</span>}
      </Labeled>
    );
  }

  if (def.control === 'seriesTypes') {
    const seriesColumns = columns.slice(1);
    if (!hasResult || seriesColumns.length === 0) {
      return <Labeled label={def.label} stack><span className="text-xs text-text-tertiary">실행 후 지정 가능</span></Labeled>;
    }
    const map = value && typeof value === 'object' ? (value as Record<string, string>) : {};
    return (
      <Labeled label={def.label} stack>
        <div className="flex flex-col gap-2">
          {seriesColumns.map((column) => (
            <div key={column.name} data-testid={`series-type-${column.name}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">{column.name}</span>
              <Segmented
                value={String(map[column.name] ?? chartType)}
                options={[{ value: 'bar', label: '막대' }, { value: 'line', label: '선' }]}
                onChange={(next) => onChange({ ...map, [column.name]: next })}
              />
            </div>
          ))}
        </div>
      </Labeled>
    );
  }

  let control: ReactNode = null;
  switch (def.control) {
    case 'segment': {
      const choices = def.key === 'variant' ? getVariants(chartType) : (def.choices ?? []);
      control = <div className={disabled ? 'pointer-events-none opacity-50' : undefined}><Segmented value={String(value)} options={choices.map((choice) => ({ value: String(choice.value), label: choice.label }))} onChange={onChange} /></div>;
      break;
    }
    case 'select': {
      const baseChoices = def.key === 'palettePreset' ? paletteChoicesForChartType(chartType) : (def.choices ?? []);
      const currentValue = String(value ?? '');
      const choices = def.key === 'palettePreset' && currentValue && !baseChoices.some((choice) => String(choice.value) === currentValue)
        ? [{ value: currentValue, label: '기존 테마' }, ...baseChoices]
        : baseChoices;
      control = <div className="w-36"><Select id={fieldId} name={fieldName} disabled={disabled} value={currentValue} options={choices.map((choice) => ({ value: String(choice.value), label: choice.label }))} onChange={(event) => onChange(coerce(def, event.target.value))} /></div>;
      break;
    }
    case 'text':
      control = <div className="w-36"><Input id={fieldId} name={fieldName} disabled={disabled} size="sm" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} /></div>;
      break;
    case 'number':
      control = <div className="w-24"><Input id={fieldId} name={fieldName} disabled={disabled} size="sm" type="number" value={value == null ? '' : String(value)} min={def.min} max={def.max} step={def.step} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} /></div>;
      break;
    case 'slider':
      control = (
        <div className="flex items-center gap-2">
          <input id={fieldId} name={fieldName} aria-label={def.label} type="range" min={def.min} max={def.max} step={def.step} value={Number(value ?? def.min ?? 0)} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} className="w-28 accent-primary disabled:opacity-50" />
          <span className="w-10 text-right text-xs text-text-tertiary">{value == null ? '자동' : `${value}${def.unit ?? ''}`}</span>
        </div>
      );
      break;
    case 'toggle':
      control = <div className={disabled ? 'pointer-events-none opacity-50' : undefined}><Switch checked={value === true} onChange={onChange} aria-label={def.label} /></div>;
      break;
    case 'color': {
      const automaticBorderColor = def.key === 'tooltip.borderColor' && value == null;
      control = (
        <div className="flex items-center gap-2">
          <input
            id={fieldId}
            name={fieldName}
            aria-label={def.label}
            type="color"
            value={normalizeHex(String(value ?? '#FFFFFF'))}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            disabled={disabled}
            className="h-7 w-10 rounded border border-border disabled:opacity-50"
          />
          {def.key === 'tooltip.borderColor' && (
            <button
              type="button"
              disabled={disabled || automaticBorderColor}
              onClick={() => onChange(null)}
              className="text-[11px] text-text-tertiary hover:text-text-primary disabled:opacity-50"
            >
              {automaticBorderColor ? '데이터 색상' : '자동'}
            </button>
          )}
        </div>
      );
      break;
    }
    case 'palette':
      control = (
        <PaletteControl
          value={value}
          selectedColor={colorSelection
            ? resolvedSelectionColor(colorSelection, colorTargets, colorMap, autoColorMap, itemColorOverrides, paletteColors)
            : null}
          selectedTarget={colorSelection}
          disabled={disabled}
          label={def.label}
          sequential={paletteFamilyForChartType(chartType) === 'sequential'}
          reversed={paletteReversed}
          continuous={continuousPalette}
          onApply={onApplySelectedColor}
        />
      );
      break;
    case 'columnRef':
      control = hasResult
        ? <div className="w-36"><Select id={fieldId} name={fieldName} disabled={disabled} value={String(value ?? '')} options={columns.map((column) => ({ value: column.name, label: column.name }))} onChange={(event) => onChange(event.target.value)} placeholder="컬럼" /></div>
        : <span className="text-xs text-text-tertiary">실행 후 지정 가능</span>;
      break;
    case 'colorMap': {
      const colorMap = value && typeof value === 'object' ? value as Record<string, string> : {};
      control = !hasResult
        ? <span className="text-xs text-text-tertiary">실행 후 지정 가능</span>
        : <ColorTargetControl
            label={chartType === 'map' || chartType === 'heatmap' ? '요소 색상' : def.label}
            targets={colorTargets}
            selection={colorSelection}
            colorMap={colorMap}
            autoColorMap={autoColorMap}
            itemColorOverrides={itemColorOverrides}
            palette={paletteColors}
            picking={colorPicking}
            disabled={disabled}
            onSelect={onSelectColorTarget}
            onPickingChange={onColorPickingChange}
            onApplyColor={onApplySelectedColor}
            onClearColor={onClearSelectedColor}
          />;
      break;
    }
    case 'button':
      control = <Button variant="secondary" size="sm" className="h-7" disabled={disabled}>{def.label}</Button>;
      break;
  }

  if (def.control === 'button') return <div className="flex items-center justify-between gap-2">{control}</div>;
  if (def.control === 'colorMap' && hasResult) return control;
  if (def.control === 'palette' || def.control === 'colorMap') {
    return <Labeled label={def.label} stack>{control}</Labeled>;
  }
  return <Labeled label={def.label}>{control}</Labeled>;
}

function coerce(def: OptionDef, raw: string): unknown {
  return def.choices?.some((choice) => typeof choice.value === 'number') ? Number(raw) : raw;
}

function PaletteControl({ value, selectedColor, selectedTarget, disabled, label, sequential, reversed, continuous, onApply }: {
  value: unknown;
  selectedColor: string | null;
  selectedTarget: ColorSelection | null;
  disabled: boolean;
  label: string;
  sequential: boolean;
  reversed: boolean;
  continuous: boolean;
  onApply: (color: string) => void;
}) {
  const palette = normalizePalette(value);
  const displayPalette = sequential && reversed ? [...palette].reverse() : palette;
  const gradientPalette = sequential && !continuous
    ? ['#F7F7F7', displayPalette[0] ?? DEFAULT_PALETTE[0]]
    : displayPalette;
  const normalizedSelected = selectedColor ? normalizeHex(selectedColor) : null;
  const unavailable = disabled || !selectedTarget;

  return (
    <div className={cn('flex flex-col gap-2', unavailable && 'opacity-50')}>
      {sequential && (
        <div className="flex items-center gap-2 text-[10px] text-text-tertiary">
          <span className="shrink-0">낮은 값</span>
          <div
            data-testid="palette-gradient"
            role="img"
            aria-label={`낮은 값에서 높은 값 색상${reversed ? ' · 반전됨' : ''}`}
            className="h-3 flex-1 rounded-sm border border-black/10"
            style={{ background: `linear-gradient(to right, ${gradientPalette.join(', ')})` }}
          />
          <span className="shrink-0">높은 값</span>
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {displayPalette.map((item, index) => {
          const swatch = normalizeHex(item);
          const active = normalizedSelected === swatch;
          return (
            <button
              key={`${swatch}-${index}`}
              type="button"
              aria-label={`${label} ${index + 1}번 색상을 ${selectedTarget?.label ?? '선택한 대상'}에 적용`}
              data-testid={`palette-swatch-${index}`}
              title={selectedTarget ? `${selectedTarget.label}에 적용` : '먼저 시리즈 칩을 선택하거나 차트에서 요소를 선택하세요'}
              disabled={unavailable}
              onClick={() => onApply(swatch)}
              className={cn('size-6 rounded border transition-transform disabled:cursor-not-allowed', active ? 'scale-105 border-text-primary ring-2 ring-primary/30' : 'border-border hover:scale-105')}
              style={{ backgroundColor: swatch }}
            />
          );
        })}
      </div>
    </div>
  );
}

function ColorTargetControl({
  label,
  targets,
  selection,
  colorMap,
  autoColorMap,
  itemColorOverrides,
  palette,
  picking,
  disabled,
  onSelect,
  onPickingChange,
  onApplyColor,
  onClearColor,
}: {
  label: string;
  targets: ColorSelection[];
  selection: ColorSelection | null;
  colorMap: Record<string, string>;
  autoColorMap: Record<string, string>;
  itemColorOverrides: unknown;
  palette: string[];
  picking: boolean;
  disabled: boolean;
  onSelect: (target: ColorSelection) => void;
  onPickingChange: (picking: boolean) => void;
  onApplyColor: (color: string) => void;
  onClearColor: () => void;
}) {
  const activeColor = selection
    ? resolvedSelectionColor(selection, targets, colorMap, autoColorMap, itemColorOverrides, palette)
    : normalizeHex(palette[0] ?? DEFAULT_PALETTE[0]);
  const selectionHasOverride = selection?.scope === 'series'
    ? colorMap[selection.seriesName] != null
    : selection?.scope === 'item' && (
      !!findItemColorOverride(itemColorOverrides, selection)
      || (selection.kind === 'pie' && colorMap[String(selection.dimensions[0])] != null)
    );
  const openEditor = () => {
    const picker = document.getElementById('option-series-color-picker') as HTMLInputElement | null;
    if (!picker) return;
    try {
      if (typeof picker.showPicker === 'function') picker.showPicker();
      else picker.click();
    } catch {
      picker.click();
    }
  };

  return (
    <div className="flex w-full flex-col gap-2">
      <div className="flex min-h-7 flex-wrap items-center gap-1.5">
        <span className="mr-auto text-[13px] text-text-secondary">{label}</span>
        <Button
          variant={picking ? 'primary' : 'secondary'}
          size="sm"
          className="h-7 px-2 text-[11px]"
          data-testid="chart-color-pick"
          aria-pressed={picking}
          disabled={disabled}
          onClick={() => onPickingChange(!picking)}
        >
          {picking ? '선택 중' : '차트에서 선택'}
        </Button>
        <div className="relative shrink-0">
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-[11px]"
            data-testid="series-color-edit"
            disabled={disabled || !selection}
            onClick={openEditor}
          >
            직접 지정
          </Button>
          <input
            id="option-series-color-picker"
            name="seriesColor"
            aria-label={`${selection?.label ?? '선택한 대상'} 색상 직접 지정`}
            type="color"
            value={activeColor}
            disabled={disabled || !selection}
            tabIndex={-1}
            onChange={(event) => onApplyColor(event.target.value.toUpperCase())}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          />
        </div>
        <button
          type="button"
          disabled={disabled || !selectionHasOverride}
          onClick={onClearColor}
          className="h-7 shrink-0 rounded px-1.5 text-[11px] text-text-secondary hover:bg-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          지정 해제
        </button>
      </div>
      {selection?.scope === 'item' && (
        <div className="flex min-h-8 items-center gap-1.5" aria-live="polite">
          <div
            data-testid="selected-chart-color-item"
            className="flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md border border-text-primary bg-muted px-2.5 py-1.5 text-[11px] text-text-primary ring-2 ring-primary/20"
            title={selection.label}
          >
            <span className="min-w-0 truncate">{selection.label}</span>
            <span className="size-3.5 shrink-0 rounded-sm border border-black/10" style={{ backgroundColor: activeColor }} />
          </div>
        </div>
      )}
      <div data-testid="series-color-grid" className="grid grid-cols-5 gap-1.5">
        {targets.map((target) => {
          const color = resolvedSelectionColor(target, targets, colorMap, autoColorMap, itemColorOverrides, palette);
          const active = sameColorSelection(target, selection);
          const targetId = colorSelectionId(target);
          return (
            <button
              key={targetId}
              type="button"
              data-testid={`series-color-chip-${target.label}`}
              aria-label={`${target.label} 색상 선택`}
              title={target.label}
              disabled={disabled}
              onClick={() => onSelect(target)}
              className={cn(
                'flex h-7 min-w-0 items-center justify-between gap-1.5 rounded border px-2 text-[11px] text-text-secondary transition-colors disabled:cursor-not-allowed',
                active ? 'border-text-primary bg-muted ring-2 ring-primary/20' : 'border-border hover:bg-muted',
              )}
            >
              <span className="min-w-0 flex-1 truncate text-left">{target.label}</span>
              <span
                data-testid={`series-color-swatch-${target.label}`}
                className="size-3.5 shrink-0 rounded-sm border border-black/10"
                style={{ backgroundColor: color }}
              />
            </button>
          );
        })}
      </div>
      {targets.length === 0 && !selection && (
        <p className="text-[11px] leading-4 text-text-tertiary">차트에서 요소를 선택한 뒤 색상을 지정할 수 있습니다.</p>
      )}
    </div>
  );
}

function resolvedSelectionColor(
  selection: ColorSelection,
  targets: ColorSelection[],
  colorMap: Record<string, string>,
  autoColorMap: Record<string, string>,
  itemColorOverrides: unknown,
  palette: string[],
): string {
  const paletteSize = Math.max(1, palette.length);
  if (selection.scope === 'series') {
    const seriesTargets = targets.filter((target) => target.scope === 'series');
    const index = Math.max(0, seriesTargets.findIndex((target) => target.seriesName === selection.seriesName));
    return normalizeHex(
      colorMap[selection.seriesName]
      ?? autoColorMap[selection.seriesName]
      ?? palette[index % paletteSize]
      ?? DEFAULT_PALETTE[index % DEFAULT_PALETTE.length],
    );
  }

  const override = findItemColorOverride(itemColorOverrides, selection);
  if (override) return override.color;
  if (selection.kind === 'pie') {
    const itemName = String(selection.dimensions[0] ?? '');
    const pieTargets = targets.filter((target) => target.scope === 'item' && target.kind === 'pie');
    const index = Math.max(0, pieTargets.findIndex((target) => sameColorSelection(target, selection)));
    return normalizeHex(
      colorMap[itemName]
      ?? autoColorMap[itemName]
      ?? selection.renderedColor
      ?? palette[index % paletteSize]
      ?? DEFAULT_PALETTE[index % DEFAULT_PALETTE.length],
    );
  }
  if (selection.kind === 'cartesian' || selection.kind === 'scatter') {
    const seriesTargets = targets.filter((target) => target.scope === 'series');
    const index = Math.max(0, seriesTargets.findIndex((target) => target.seriesName === selection.seriesName));
    return normalizeHex(
      colorMap[selection.seriesName]
      ?? autoColorMap[selection.seriesName]
      ?? selection.renderedColor
      ?? palette[index % paletteSize]
      ?? DEFAULT_PALETTE[index % DEFAULT_PALETTE.length],
    );
  }
  return normalizeHex(selection.renderedColor ?? palette[0] ?? DEFAULT_PALETTE[0]);
}

function sameColorSelection(left: ColorSelection, right: ColorSelection | null): boolean {
  if (!right || left.scope !== right.scope) return false;
  if (left.scope === 'series' && right.scope === 'series') return left.seriesName === right.seriesName;
  return left.scope === 'item'
    && right.scope === 'item'
    && itemColorTargetKey(left) === itemColorTargetKey(right);
}

function colorSelectionId(selection: ColorSelection): string {
  return selection.scope === 'series'
    ? `series:${selection.seriesName}`
    : `item:${itemColorTargetKey(selection)}`;
}

function normalizePalette(value: unknown): string[] {
  const source = Array.isArray(value) && value.length > 0 ? value : DEFAULT_PALETTE;
  return source.map((color) => normalizeHex(String(color))).slice(0, 12);
}

function normalizeHex(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    const [, r, g, b] = trimmed;
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return DEFAULT_PALETTE[0];
}

function fieldNameFor(key: string): string {
  return key.replace(/[^a-zA-Z0-9]+/g, '_');
}

function Labeled({ label, children, stack }: { label: string; children: ReactNode; stack?: boolean }) {
  if (stack) {
    return <div className="flex flex-col gap-1.5"><span className="text-[13px] text-text-secondary">{label}</span>{children}</div>;
  }
  return <div className="flex min-h-7 items-center justify-between gap-2"><span className="text-[13px] text-text-secondary">{label}</span>{children}</div>;
}
