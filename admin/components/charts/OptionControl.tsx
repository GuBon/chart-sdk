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

const DEFAULT_PALETTE = ['#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4'];

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
  hasResult,
  disabled,
  paletteActiveIndex,
  onChange,
  onChangeType,
  onSelectPaletteIndex,
}: {
  def: OptionDef;
  value: unknown;
  chartType: MajorType;
  columns: { name: string; type: string }[];
  hasResult: boolean;
  disabled: boolean;
  paletteActiveIndex: number;
  onChange: (value: unknown) => void;
  onChangeType: (type: MajorType) => void;
  onSelectPaletteIndex: (index: number) => void;
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
          rows={2}
          className="w-full resize-none rounded-md border border-border bg-bg-panel px-3 py-2 text-[13px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50"
        />
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
    case 'select':
      control = <div className="w-36"><Select id={fieldId} name={fieldName} disabled={disabled} value={String(value ?? '')} options={(def.choices ?? []).map((choice) => ({ value: String(choice.value), label: choice.label }))} onChange={(event) => onChange(coerce(def, event.target.value))} /></div>;
      break;
    case 'text':
      control = <div className="w-36"><Input id={fieldId} name={fieldName} disabled={disabled} size="sm" value={String(value ?? '')} onChange={(event) => onChange(event.target.value)} /></div>;
      break;
    case 'number':
      control = <div className="w-24"><Input id={fieldId} name={fieldName} disabled={disabled} size="sm" type="number" value={value == null ? '' : String(value)} min={def.min} max={def.max} onChange={(event) => onChange(event.target.value === '' ? null : Number(event.target.value))} /></div>;
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
    case 'color':
      control = <input id={fieldId} name={fieldName} aria-label={def.label} type="color" value={String(value ?? '#5470C6')} onChange={(event) => onChange(event.target.value)} disabled={disabled} className="h-7 w-10 rounded border border-border disabled:opacity-50" />;
      break;
    case 'palette':
      control = <PaletteControl value={value} selectedIndex={paletteActiveIndex} disabled={disabled} label={def.label} onChange={onChange} onSelect={onSelectPaletteIndex} />;
      break;
    case 'columnRef':
      control = hasResult
        ? <div className="w-36"><Select id={fieldId} name={fieldName} disabled={disabled} value={String(value ?? '')} options={columns.map((column) => ({ value: column.name, label: column.name }))} onChange={(event) => onChange(event.target.value)} placeholder="컬럼" /></div>
        : <span className="text-xs text-text-tertiary">실행 후 지정 가능</span>;
      break;
    case 'colorMap':
      control = <span className="text-xs text-text-tertiary">{hasResult ? '행별 색 지정(후속)' : '실행 후 지정 가능'}</span>;
      break;
    case 'button':
      control = <Button variant="secondary" size="sm" className="h-7" disabled={disabled}>{def.label}</Button>;
      break;
  }

  if (def.control === 'button') return <div className="flex items-center justify-between gap-2">{control}</div>;
  return <Labeled label={def.label}>{control}</Labeled>;
}

function coerce(def: OptionDef, raw: string): unknown {
  return def.choices?.some((choice) => typeof choice.value === 'number') ? Number(raw) : raw;
}

export function coercePaletteIndex(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function PaletteControl({ value, selectedIndex, disabled, label, onChange, onSelect }: {
  value: unknown;
  selectedIndex: number;
  disabled: boolean;
  label: string;
  onChange: (value: unknown) => void;
  onSelect: (index: number) => void;
}) {
  const palette = normalizePalette(value);
  const safeSelected = Math.min(Math.max(0, selectedIndex), palette.length - 1);
  const color = normalizeHex(palette[safeSelected] ?? DEFAULT_PALETTE[0]);
  const rgb = hexToRgb(color);

  const update = (nextColor: string) => {
    const next = [...palette];
    next[safeSelected] = normalizeHex(nextColor);
    onChange(next);
  };
  const updateRgb = (channel: 'r' | 'g' | 'b', raw: string) => {
    const next = { ...rgb, [channel]: clampRgb(Number(raw)) };
    update(rgbToHex(next.r, next.g, next.b));
  };

  return (
    <div className={cn('flex w-full flex-col gap-2', disabled && 'pointer-events-none opacity-50')}>
      <div className="flex flex-wrap gap-1.5">
        {palette.map((item, index) => {
          const swatch = normalizeHex(item);
          const active = index === safeSelected;
          return (
            <button
              key={`${swatch}-${index}`}
              type="button"
              aria-label={`${label} ${index + 1}번 색상 선택`}
              data-testid={`palette-swatch-${index}`}
              disabled={disabled}
              onClick={() => onSelect(index)}
              className={cn('size-6 rounded border transition-transform disabled:cursor-not-allowed', active ? 'scale-105 border-text-primary ring-2 ring-primary/30' : 'border-border hover:scale-105')}
              style={{ backgroundColor: swatch }}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-[44px_1fr] items-center gap-x-2 gap-y-1.5">
        <span className="text-xs text-text-tertiary">색상</span>
        <input id="option-palette-color" name="paletteColor" aria-label="선택한 팔레트 색상" type="color" value={color} disabled={disabled} onChange={(event) => update(event.target.value)} className="h-8 w-full rounded border border-border bg-bg-panel disabled:opacity-50" />
        {(['r', 'g', 'b'] as const).map((channel) => (
          <label key={channel} className="contents">
            <span className="text-xs uppercase text-text-tertiary">{channel}</span>
            <Input id={`option-palette-${channel}`} name={`palette${channel.toUpperCase()}`} aria-label={`선택한 팔레트 ${channel.toUpperCase()} 값`} size="sm" type="number" min={0} max={255} value={String(rgb[channel])} disabled={disabled} onChange={(event) => updateRgb(channel, event.target.value)} />
          </label>
        ))}
      </div>
    </div>
  );
}

function normalizePalette(value: unknown): string[] {
  const source = Array.isArray(value) && value.length > 0 ? value : DEFAULT_PALETTE;
  return source.map((color) => normalizeHex(String(color))).slice(0, 8);
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

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const normalized = normalizeHex(hex).slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((value) => clampRgb(value).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function clampRgb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
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
