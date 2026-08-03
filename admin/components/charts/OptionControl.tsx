import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { Check, ChevronDown } from 'lucide-react';
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
  bubbleSizeColumns,
  colorSelectionFromItemTarget,
} from '@/lib/chartColorSelection';
import {
  DEFAULT_PALETTE,
  cartoPalette,
  paletteChoicesForChartType,
  paletteFamilyForChartType,
} from '@chartsdk/chart-options/palettes';
import {
  findItemColorOverride,
  itemColorTargetKey,
  normalizeItemColorOverrides,
  type ColorSelection,
} from '@chartsdk/chart-options/colorOverrides';
import {
  tooltipFieldVisible,
  tooltipFieldsFor,
  updateTooltipFieldVisibility,
} from '@chartsdk/chart-options/tooltip';
import { seriesDisplayNames } from '@chartsdk/chart-options/fieldDisplayNames';
import { AnalysisAnnotationsControl } from './AnalysisAnnotationsControl';
import {
  BoxplotOutliersControl,
  MovingAverageControl,
} from './StatisticalOverlaysControl';


/** 요소별 글자 크기 슬라이더가 자동일 때 실제 적용 중인 px 를 보여 주기 위한 대응표. */
const TYPOGRAPHY_AUTO_FIELDS: Record<string, 'title' | 'legend' | 'axis' | 'dataLabel' | 'tooltip'> = {
  'typography.titleFontSize': 'title',
  'typography.legendFontSize': 'legend',
  'typography.axisFontSize': 'axis',
  'typography.dataLabelFontSize': 'dataLabel',
  'typography.tooltipFontSize': 'tooltip',
};

export function autoTypographySizeOf(key: string, typography: ChartTypography): number | null {
  const field = TYPOGRAPHY_AUTO_FIELDS[key];
  return field ? typography[field] : null;
}

export function TypographyPolicy({ typography }: { typography: ChartTypography }) {
  return (
    <div data-testid="typography-policy" aria-live="polite" className="rounded-md bg-muted px-2.5 py-2 text-[11px] leading-4 text-text-tertiary">
      <p>요소별 글꼴과 글자 크기는 제목·범례·축 글자·라벨·툴팁 모양 섹션에서 각각 지정합니다. 전체 글자 크기는 자동 상태인 요소에만 적용됩니다.</p>
      <p>현재 제목 {typography.title}px · 범례 {typography.legend}px · 축 {typography.axis}px · 라벨 {typography.dataLabel}px · 툴팁 {typography.tooltip}px</p>
      <p>임베드 영역만 CSS로 리사이즈하면 위 px 값은 유지됩니다.</p>
    </div>
  );
}

export function OptionControl({
  def,
  value,
  chartType,
  chartOptions,
  columns,
  rows,
  builderConfig,
  colorTargets,
  hasResult,
  disabled: disabledProp,
  paletteColors,
  paletteReversed,
  continuousPalette,
  colorMap,
  autoColorMap,
  itemColorOverrides,
  colorSelection,
  colorPicking,
  action,
  lockNote,
  autoValue,
  onChange,
  onChangeType,
  onSelectColorTarget,
  onColorPickingChange,
  onApplySelectedColor,
  onClearSelectedColor,
  onPaletteReversedChange,
  onDeleteSelectedChartItem,
  onClearAllChartItems,
}: {
  def: OptionDef;
  value: unknown;
  chartType: MajorType;
  chartOptions: Record<string, any>;
  columns: { name: string; type: string }[];
  rows: unknown[][];
  builderConfig: Record<string, any> | null;
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
  action?: {
    pending: boolean;
    status: string | null;
    error: string | null;
    disabledReason: string | null;
    onClick: () => void;
  };
  /** 다른 옵션이 이 값을 무효로 만들 때의 안내. 값은 보존하고 입력만 잠근다. */
  lockNote?: string | null;
  /** 값이 비어 자동으로 해석될 때 실제 적용되는 값(슬라이더 표시·눈금 위치용). */
  autoValue?: number | null;
  onChange: (value: unknown) => void;
  onChangeType: (type: MajorType) => void;
  onSelectColorTarget: (target: ColorSelection) => void;
  onColorPickingChange: (picking: boolean) => void;
  onApplySelectedColor: (color: string) => void;
  onClearSelectedColor: () => void;
  onPaletteReversedChange: (reversed: boolean) => void;
  onDeleteSelectedChartItem: () => void;
  onClearAllChartItems: () => void;
}) {
  const fieldName = fieldNameFor(def.key);
  const fieldId = `option-${fieldName}`;
  const displayNames = seriesDisplayNames(builderConfig, columns);
  const displayNameOf = (column: { name: string; displayName?: string }) => (
    displayNames[column.name] ?? column.displayName ?? column.name
  );
  // 잠긴 옵션은 저장값을 유지한 채 입력만 막는다 — 잠금이 풀리면 이전 값이 그대로 다시 쓰인다.
  const disabled = disabledProp || lockNote != null;

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
      <Labeled label={def.label} htmlFor={fieldId} stack>
        <textarea
          id={fieldId}
          name={fieldName}
          value={String(value ?? '')}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          rows={2}
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
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">{displayNameOf(column)}</span>
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

  if (def.control === 'tooltipFields') {
    const fields = tooltipFieldsFor({
      chartType,
      columns,
      options: chartOptions,
      builderConfig,
    });
    return (
      <Labeled label={def.label} stack>
        {fields.length === 0 ? (
          <span className="text-xs text-text-tertiary">표시할 수 있는 차트 데이터가 없습니다.</span>
        ) : (
          <div className="flex flex-col gap-1.5" data-testid="tooltip-field-list">
            {fields.map((item) => (
              <div
                key={item.key}
                data-testid={`tooltip-field-${item.key}`}
                className="flex min-h-8 items-center gap-2 rounded-md border border-border/70 bg-bg-panel px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary" title={item.label}>
                  {item.label}
                </span>
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-text-tertiary">
                  {item.role}
                </span>
                <Switch
                  checked={tooltipFieldVisible(item, value)}
                  disabled={disabled}
                  aria-label={`${item.label} 툴팁 표시`}
                  onChange={(checked) => onChange(updateTooltipFieldVisibility(value, item, checked))}
                />
              </div>
            ))}
          </div>
        )}
        {def.help && <span className="text-[11px] leading-4 text-text-tertiary">{def.help}</span>}
      </Labeled>
    );
  }

  if (def.control === 'analysisAnnotations') {
    return (
      <AnalysisAnnotationsControl
        value={value}
        chartType={chartType}
        columns={columns}
        rows={rows}
        seriesDisplayNames={displayNames}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (def.control === 'boxplotOutliers') {
    return (
      <BoxplotOutliersControl
        value={value}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  if (def.control === 'movingAverage') {
    return (
      <MovingAverageControl
        value={value}
        columns={columns}
        rows={rows}
        seriesDisplayNames={displayNames}
        disabled={disabled}
        onChange={onChange}
      />
    );
  }

  let control: ReactNode = null;
  switch (def.control) {
    case 'segment': {
      const choices = def.key === 'variant' ? getVariants(chartType) : (def.choices ?? []);
      control = <div className={disabled ? 'pointer-events-none opacity-50' : undefined}><Segmented value={String(value)} options={choices.map((choice) => ({ value: String(choice.value), label: choice.label }))} onChange={(next) => onChange(coerce(def, next))} /></div>;
      break;
    }
    case 'select': {
      const baseChoices = def.key === 'palettePreset' ? paletteChoicesForChartType(chartType) : (def.choices ?? []);
      const currentValue = String(value ?? '');
      const choices = def.key === 'palettePreset' && currentValue && !baseChoices.some((choice) => String(choice.value) === currentValue)
        ? [{ value: currentValue, label: '기존 테마' }, ...baseChoices]
        : baseChoices;
      control = def.key === 'palettePreset'
        ? (
          <div className="w-60 shrink-0">
            <ThemeSelect
              id={fieldId}
              name={fieldName}
              label={def.label}
              disabled={disabled}
              value={currentValue}
              choices={choices.map((choice) => ({ value: String(choice.value), label: choice.label }))}
              onChange={(next) => onChange(coerce(def, next))}
            />
          </div>
        )
        : <div className="w-36"><Select id={fieldId} name={fieldName} disabled={disabled} value={currentValue} options={choices.map((choice) => ({ value: String(choice.value), label: choice.label }))} onChange={(event) => onChange(coerce(def, event.target.value))} /></div>;
      break;
    }
    case 'text':
      control = <div className="w-36"><Input id={fieldId} name={fieldName} disabled={disabled} size="sm" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} /></div>;
      break;
    case 'number':
      control = <div className="w-24"><Input id={fieldId} name={fieldName} disabled={disabled} size="sm" type="number" value={value == null ? '' : String(value)} min={def.min} max={def.max} step={def.step} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} /></div>;
      break;
    case 'slider': {
      // 기본값이 null 인 슬라이더는 '자동'이 정상 상태다 — 눈금은 실제 적용 중인 값에 두고, 되돌릴 버튼을 함께 낸다.
      const automatic = value == null;
      const resettable = def.default === null;
      control = (
        <div className="flex items-center gap-2" data-testid={`option-slider-${fieldName}`}>
          <input id={fieldId} name={fieldName} aria-label={def.label} type="range" min={def.min} max={def.max} step={def.step} value={Number(value ?? autoValue ?? def.min ?? 0)} onChange={(event) => onChange(Number(event.target.value))} disabled={disabled} className="w-28 accent-primary disabled:opacity-50" />
          <span className="w-16 text-right text-xs text-text-tertiary">
            {automatic
              ? (autoValue == null ? '자동' : `자동 ${autoValue}${def.unit ?? ''}`)
              : `${value}${def.unit ?? ''}`}
          </span>
          {resettable && (
            <button
              type="button"
              disabled={disabled || automatic}
              onClick={() => onChange(null)}
              className="text-[11px] text-text-tertiary hover:text-text-primary disabled:opacity-50"
            >
              자동
            </button>
          )}
        </div>
      );
      break;
    }
    case 'toggle':
      control = <div className={disabled ? 'pointer-events-none opacity-50' : undefined}><Switch checked={value === true} onChange={onChange} aria-label={def.label} /></div>;
      break;
    case 'color': {
      const resettableColor = def.default === null;
      const automaticColor = resettableColor && value == null;
      const automaticColorLabel = def.key === 'tooltip.borderColor' ? '데이터 색상' : '자동';
      const fallbackColor = def.key === 'map.boundary.areaColor'
        ? '#EAEDF5'
        : def.key === 'map.boundary.borderColor'
          ? '#B7B9BE'
          : '#FFFFFF';
      const colorInput = (
        <input
          id={fieldId}
          name={fieldName}
          aria-label={def.label}
          type="color"
          value={normalizeHex(String(value ?? fallbackColor))}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          disabled={disabled}
          className="h-7 w-10 rounded border border-border disabled:opacity-50"
        />
      );
      control = (
        <div className="flex items-center gap-2">
          {resettableColor ? (
            <>
              <div className={disabled ? 'pointer-events-none opacity-50' : undefined}>
                <Segmented
                  value={automaticColor ? 'auto' : 'custom'}
                  options={[
                    { value: 'auto', label: automaticColorLabel },
                    { value: 'custom', label: '직접 지정' },
                  ]}
                  onChange={(mode) => onChange(mode === 'auto' ? null : normalizeHex(fallbackColor).toUpperCase())}
                />
              </div>
              {!automaticColor && colorInput}
            </>
          ) : colorInput}
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
          selectedHasOverride={selectionHasColorOverride(colorSelection, colorMap, itemColorOverrides)}
          disabled={disabled}
          label={def.label}
          sequential={paletteFamilyForChartType(chartType) === 'sequential'}
          reversed={paletteReversed}
          continuous={continuousPalette}
          onApply={onApplySelectedColor}
          onClear={onClearSelectedColor}
          onReversedChange={onPaletteReversedChange}
        />
      );
      break;
    case 'columnRef': {
      if (!hasResult) {
        control = <span className="text-xs text-text-tertiary">실행 후 지정 가능</span>;
      } else {
        const eligibleColumns = def.key === 'scatter.bubbleField'
          ? bubbleSizeColumns(columns)
          : columns;
        control = eligibleColumns.length > 0
          ? <div className="w-36"><Select id={fieldId} name={fieldName} disabled={disabled} value={String(value ?? '')} options={eligibleColumns.map((column) => ({ value: column.name, label: displayNameOf(column) }))} onChange={(event) => onChange(event.target.value)} placeholder="컬럼" /></div>
          : <span className="text-xs text-text-tertiary">크기로 사용할 숫자 컬럼이 없습니다</span>;
      }
      break;
    }
    case 'colorMap': {
      const colorMap = value && typeof value === 'object' ? value as Record<string, string> : {};
      control = !hasResult
        ? <span className="text-xs text-text-tertiary">실행 후 지정 가능</span>
        : <ColorTargetControl
            label={def.label}
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
            onDeleteSelectedItem={onDeleteSelectedChartItem}
            onClearAllItems={onClearAllChartItems}
          />;
      break;
    }
    case 'button':
      control = (
        <div className="flex w-full flex-col items-start gap-1.5" data-testid={`option-action-${def.key}`}>
          <Button
            variant="secondary"
            size="sm"
            className="h-7"
            disabled={disabled || action?.pending}
            onClick={action?.onClick}
          >
            {action?.pending ? '갱신 중…' : def.label}
          </Button>
          {action?.error && <p role="alert" className="text-[11px] leading-4 text-danger">{action.error}</p>}
          {action?.disabledReason && <p className="text-[11px] leading-4 text-text-tertiary">{action.disabledReason}</p>}
          {action?.status && <p role="status" className="text-[11px] leading-4 text-text-tertiary">{action.status}</p>}
        </div>
      );
      break;
  }

  if (def.control === 'button') return <div className="flex items-center justify-between gap-2">{control}</div>;
  if (def.control === 'colorMap' && hasResult) return control;
  if (def.control === 'palette' || def.control === 'colorMap') {
    return <Labeled label={def.label} stack>{control}</Labeled>;
  }
  if (lockNote) {
    return (
      <div className="flex flex-col gap-1" data-testid={`option-locked-${def.key}`}>
        <Labeled label={def.label} htmlFor={fieldId}>{control}</Labeled>
        <p className="text-[11px] leading-4 text-text-tertiary">{lockNote}</p>
      </div>
    );
  }
  return <Labeled label={def.label} htmlFor={def.key === 'palettePreset' ? `${fieldId}-trigger` : fieldId}>{control}</Labeled>;
}

function coerce(def: OptionDef, raw: string): unknown {
  return def.choices?.some((choice) => typeof choice.value === 'number') ? Number(raw) : raw;
}

function ThemeSelect({
  id,
  name,
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
  choices: { value: string; label: string }[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({
    top: 0,
    left: 0,
    width: 288,
    maxHeight: 320,
  });
  const selectedIndex = Math.max(0, choices.findIndex((choice) => choice.value === value));
  const selectedChoice = choices[selectedIndex] ?? { value, label: '기존 테마' };

  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      setMenuPosition(calculateThemeMenuPosition(triggerRef.current, choices.length));
    };
    positionMenu();
    optionRefs.current[selectedIndex]?.focus();
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu, true);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      window.removeEventListener('resize', positionMenu);
      window.removeEventListener('scroll', positionMenu, true);
    };
  }, [choices.length, open, selectedIndex]);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const selectChoice = (next: string) => {
    onChange(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const focusOption = (index: number) => {
    const normalizedIndex = (index + choices.length) % choices.length;
    optionRefs.current[normalizedIndex]?.focus();
  };

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(choices.length - 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <select
        id={id}
        name={name}
        aria-hidden="true"
        tabIndex={-1}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="hidden"
      >
        {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
      </select>
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-controls={`${id}-menu`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setMenuPosition(calculateThemeMenuPosition(triggerRef.current, choices.length));
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setMenuPosition(calculateThemeMenuPosition(triggerRef.current, choices.length));
            setOpen(true);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md border border-border bg-bg-panel px-2 text-[13px] text-text-primary outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <PaletteStrip colors={cartoPalette(selectedChoice.value)} testId="theme-selected-preview" />
        <span className="shrink-0">{selectedChoice.label}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-text-secondary transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="listbox"
          aria-label={`${label} 목록`}
          style={menuPosition}
          className="fixed z-[100] overflow-y-auto rounded-md border border-border bg-bg-panel p-1 shadow-lg"
        >
          {choices.map((choice, index) => {
            const selected = choice.value === value;
            return (
              <button
                key={choice.value}
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => selectChoice(choice.value)}
                onKeyDown={(event) => handleOptionKeyDown(event, index)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded px-2 text-left text-[13px] text-text-primary outline-none',
                  'hover:bg-muted focus-visible:bg-muted',
                  selected && 'bg-muted',
                )}
              >
                <PaletteStrip colors={cartoPalette(choice.value)} testId={`theme-option-preview-${choice.value}`} />
                <span className="shrink-0">{choice.label}</span>
                <Check className={cn('ml-auto size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function calculateThemeMenuPosition(trigger: HTMLButtonElement | null, choiceCount: number) {
  const viewportPadding = 8;
  const menuGap = 4;
  const menuWidth = Math.min(288, window.innerWidth - viewportPadding * 2);
  const desiredHeight = Math.min(choiceCount * 32 + 8, 320);
  if (!trigger) {
    return {
      top: viewportPadding,
      left: viewportPadding,
      width: menuWidth,
      maxHeight: desiredHeight,
    };
  }

  const bounds = trigger.getBoundingClientRect();
  const spaceAbove = bounds.top - viewportPadding - menuGap;
  const spaceBelow = window.innerHeight - bounds.bottom - viewportPadding - menuGap;
  const openAbove = spaceAbove >= desiredHeight || spaceAbove > spaceBelow;
  const availableHeight = Math.max(72, openAbove ? spaceAbove : spaceBelow);
  const maxHeight = Math.min(desiredHeight, availableHeight);
  const top = openAbove
    ? Math.max(viewportPadding, bounds.top - menuGap - maxHeight)
    : bounds.bottom + menuGap;
  const left = Math.min(
    Math.max(viewportPadding, bounds.right - menuWidth),
    window.innerWidth - viewportPadding - menuWidth,
  );
  return { top, left, width: menuWidth, maxHeight };
}

function PaletteStrip({ colors, testId }: { colors: readonly string[]; testId: string }) {
  return (
    <span
      data-testid={testId}
      aria-hidden="true"
      className="flex h-4 min-w-0 flex-1 overflow-hidden rounded-[3px] border border-black/10"
    >
      {colors.map((color, index) => (
        <span
          key={`${color}-${index}`}
          className="h-full min-w-0 flex-1"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}

function PaletteControl({
  value,
  selectedColor,
  selectedTarget,
  selectedHasOverride,
  disabled,
  label,
  sequential,
  reversed,
  continuous,
  onApply,
  onClear,
  onReversedChange,
}: {
  value: unknown;
  selectedColor: string | null;
  selectedTarget: ColorSelection | null;
  selectedHasOverride: boolean;
  disabled: boolean;
  label: string;
  sequential: boolean;
  reversed: boolean;
  continuous: boolean;
  onApply: (color: string) => void;
  onClear: () => void;
  onReversedChange: (reversed: boolean) => void;
}) {
  const palette = normalizePalette(value);
  const displayPalette = sequential && reversed ? [...palette].reverse() : palette;
  const gradientPalette = sequential && !continuous
    ? ['#F7F7F7', displayPalette[0] ?? DEFAULT_PALETTE[0]]
    : displayPalette;
  const normalizedSelected = selectedColor ? normalizeHex(selectedColor) : null;
  const unavailable = disabled || !selectedTarget;
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
    <div className="flex flex-col gap-2">
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
      <div className={cn('flex flex-wrap gap-1.5', unavailable && 'opacity-50')}>
        {displayPalette.map((color, index) => {
          const swatch = normalizeHex(color);
          const active = normalizedSelected === swatch;
          return (
            <button
              key={`${swatch}-${index}`}
              type="button"
              aria-label={`${label} ${index + 1}번 색상을 ${selectedTarget?.label ?? '선택 대상'}에 적용`}
              data-testid={`palette-swatch-${index}`}
              title={selectedTarget ? `${selectedTarget.label}에 적용` : '먼저 시리즈 또는 차트 요소를 선택하세요'}
              disabled={unavailable}
              onClick={() => onApply(swatch)}
              className={cn('size-6 rounded border transition-transform disabled:cursor-not-allowed', active ? 'scale-105 border-text-primary ring-2 ring-primary/30' : 'border-border hover:scale-105')}
              style={{ backgroundColor: swatch }}
            />
          );
        })}
      </div>
      {sequential && (
        <div className={cn('flex min-h-7 items-center justify-between gap-2', disabled && 'opacity-50')}>
          <span className="text-[13px] text-text-secondary">색상 방향 반전</span>
          <div className={disabled ? 'pointer-events-none' : undefined}>
            <Switch
              checked={reversed}
              onChange={onReversedChange}
              aria-label="색상 방향 반전"
            />
          </div>
        </div>
      )}
      <div className={cn('flex min-h-7 flex-wrap items-center gap-1.5', unavailable && 'opacity-50')}>
        <span data-testid="selected-color-target" className="mr-auto min-w-0 truncate text-xs font-medium text-text-primary">
          {selectedTarget ? `선택: ${selectedTarget.label}` : '시리즈 또는 차트 요소를 선택하세요'}
        </span>
        <div className="relative shrink-0">
          <Button
            variant="secondary"
            size="sm"
            className="h-7 px-2 text-[11px]"
            data-testid="series-color-edit"
            disabled={unavailable}
            onClick={openEditor}
          >
            직접 지정
          </Button>
          <input
            id="option-series-color-picker"
            name="seriesColor"
            aria-label={`${selectedTarget?.label ?? '선택한 대상'} 색상 직접 지정`}
            type="color"
            value={normalizedSelected ?? normalizeHex(palette[0] ?? DEFAULT_PALETTE[0])}
            disabled={unavailable}
            tabIndex={-1}
            onChange={(event) => onApply(event.target.value.toUpperCase())}
            className="pointer-events-none absolute inset-0 h-full w-full opacity-0"
          />
        </div>
        <button
          type="button"
          disabled={unavailable || !selectedHasOverride}
          onClick={onClear}
          className="h-7 shrink-0 rounded px-1.5 text-[11px] text-text-secondary hover:bg-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          지정 해제
        </button>
      </div>
      <p className="text-right text-[10px] leading-4 text-text-tertiary">직접 지정한 색은 테마를 바꿔도 유지됩니다.</p>
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
  onDeleteSelectedItem,
  onClearAllItems,
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
  onDeleteSelectedItem: () => void;
  onClearAllItems: () => void;
}) {
  const seriesTargets = targets.filter(
    (target): target is Extract<ColorSelection, { scope: 'series' }> => target.scope === 'series',
  );
  const itemTargetsByKey = new Map(
    normalizeItemColorOverrides(itemColorOverrides).map((override) => {
      const target = colorSelectionFromItemTarget(override);
      return [itemColorTargetKey(target), target] as const;
    }),
  );
  if (selection?.scope === 'item') {
    itemTargetsByKey.set(itemColorTargetKey(selection), selection);
  }
  const itemTargets = [...itemTargetsByKey.values()];
  const allTargets: ColorSelection[] = [...seriesTargets, ...itemTargets];
  const selectedItem = selection?.scope === 'item' ? selection : null;

  return (
    <div className="flex w-full flex-col gap-2">
      {seriesTargets.length > 0 && (
        <>
          <span className="text-[13px] text-text-secondary">{label}</span>
          <div data-testid="series-color-grid" className="grid grid-cols-5 gap-1.5">
            {seriesTargets.map((target) => {
              const color = resolvedSelectionColor(target, allTargets, colorMap, autoColorMap, itemColorOverrides, palette);
              const active = sameColorSelection(target, selection);
              return (
                <button
                  key={colorSelectionId(target)}
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
        </>
      )}

      <div className={cn('flex flex-col gap-2', seriesTargets.length > 0 && 'mt-1 border-t border-border pt-2')}>
        <div className="flex min-h-7 flex-wrap items-center gap-1.5">
          <span className="mr-auto text-[13px] text-text-secondary">차트 요소 색상</span>
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
          <button
            type="button"
            data-testid="delete-selected-chart-color"
            disabled={disabled || !selectedItem}
            onClick={onDeleteSelectedItem}
            className="h-7 shrink-0 rounded px-1.5 text-[11px] text-text-secondary hover:bg-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            선택 삭제
          </button>
          <button
            type="button"
            data-testid="clear-all-chart-colors"
            disabled={disabled || itemTargets.length === 0}
            onClick={onClearAllItems}
            className="h-7 shrink-0 rounded px-1.5 text-[11px] text-text-secondary hover:bg-muted hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            모두 삭제
          </button>
        </div>
        <div data-testid="chart-color-item-grid" className="grid grid-cols-5 gap-1.5" aria-live="polite">
          {itemTargets.map((target) => {
            const color = resolvedSelectionColor(target, allTargets, colorMap, autoColorMap, itemColorOverrides, palette);
            const active = sameColorSelection(target, selection);
            return (
              <button
                key={colorSelectionId(target)}
                type="button"
                data-testid={active ? 'selected-chart-color-item' : `chart-color-item-chip-${itemColorTargetKey(target)}`}
                aria-label={`${target.label} 차트 요소 색상 선택`}
                title={target.label}
                disabled={disabled}
                onClick={() => onSelect(target)}
                className={cn(
                  'flex h-7 min-w-0 items-center justify-between gap-1.5 rounded border px-2 text-[11px] text-text-secondary transition-colors disabled:cursor-not-allowed',
                  active ? 'border-text-primary bg-muted ring-2 ring-primary/20' : 'border-border hover:bg-muted',
                )}
              >
                <span className="min-w-0 flex-1 truncate text-left">{target.label}</span>
                <span className="size-3.5 shrink-0 rounded-sm border border-black/10" style={{ backgroundColor: color }} />
              </button>
            );
          })}
        </div>
        {itemTargets.length === 0 && (
          <p className="text-[11px] leading-4 text-text-tertiary">차트에서 선택한 요소가 여기에 추가됩니다.</p>
        )}
      </div>
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

function selectionHasColorOverride(
  selection: ColorSelection | null,
  colorMap: Record<string, string>,
  itemColorOverrides: unknown,
): boolean {
  if (!selection) return false;
  if (selection.scope === 'series') return colorMap[selection.seriesName] != null;
  return !!findItemColorOverride(itemColorOverrides, selection)
    || (selection.kind === 'pie' && colorMap[String(selection.dimensions[0])] != null);
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

function Labeled({
  label,
  children,
  stack,
  htmlFor,
}: {
  label: string;
  children: ReactNode;
  stack?: boolean;
  htmlFor?: string;
}) {
  const labelElement = <label htmlFor={htmlFor} className="text-[13px] text-text-secondary">{label}</label>;
  if (stack) {
    return <div className="flex flex-col gap-1.5">{labelElement}{children}</div>;
  }
  return <div className="flex min-h-7 items-center justify-between gap-2">{labelElement}{children}</div>;
}
