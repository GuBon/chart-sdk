'use client';

import { useState } from 'react';
import { BarChart3, ChevronDown, ChevronRight, LineChart, PieChart, ScatterChart, Search } from 'lucide-react';
import {
  defaultOf,
  getPath,
  getVariants,
  setPath,
  switchMajor,
  visibleDefs,
  type MajorType,
  type OptionDef,
  type Options,
} from '@chartsdk/chart-options';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Segmented } from '@/components/ui/Segmented';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';

// S2 우측 시각화 옵션 패널(258:271) — optionRegistry SSOT 를 그대로 렌더.
// 옵션 변경 → 상위가 preview 재조립. 대분류 전환 → switchMajor(존 기반 유지/초기화).
interface Props {
  chartType: MajorType;
  options: Options;
  columns: { name: string; type: string }[];
  hasResult: boolean;
  onChangeChartType: (next: MajorType, nextOptions: Options) => void;
  onChangeOptions: (next: Options) => void;
}

const ZONE_LABEL: Record<string, string> = { common: '공통', axis: '좌표 · 축', type: '대분류 전용' };
const ZONE_ORDER = ['common', 'axis', 'type'];
const TYPE_ICONS: Record<string, typeof BarChart3> = { bar: BarChart3, line: LineChart, pie: PieChart, scatter: ScatterChart };
const TYPE_LABEL: Record<MajorType, string> = { bar: '막대', line: '선', pie: '원형', scatter: '분포' };
const DEFAULT_PALETTE = ['#5470C6', '#91CC75', '#FAC858', '#EE6666', '#73C0DE', '#3BA272', '#FC8452', '#9A60B4'];

export function OptionPanel({ chartType, options, columns, hasResult, onChangeChartType, onChangeOptions }: Props) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [resetNotice, setResetNotice] = useState<{
    message: string;
    prevType: MajorType;
    prevOptions: Options;
  } | null>(null);

  const disabled = !hasResult;
  const q = query.toLowerCase().trim();
  const defs = visibleDefs(chartType, options).filter((d) => !q || d.label.toLowerCase().includes(q) || d.section.toLowerCase().includes(q));

  const getValue = (def: OptionDef) => {
    if (def.key === 'chartType') return chartType;
    const v = getPath(options, def.key);
    return v === undefined ? defaultOf(def, chartType) : v;
  };
  const setValue = (def: OptionDef, value: unknown) => {
    const next = structuredClone(options);
    setPath(next, def.key, value);
    onChangeOptions(next);
  };
  const setPaletteActiveIndex = (index: number) => {
    const next = structuredClone(options);
    setPath(next, 'paletteActiveIndex', index);
    onChangeOptions(next);
  };
  const changeType = (to: MajorType) => {
    if (to === chartType) return;
    const prevType = chartType;
    const prevOptions = structuredClone(options);
    const { next, removedKeys } = switchMajor(options, chartType, to);
    onChangeChartType(to, next);
    setResetNotice(
      removedKeys.length > 0
        ? {
            message: `${TYPE_LABEL[prevType]} 전용 설정이 초기화되었습니다.`,
            prevType,
            prevOptions,
          }
        : null,
    );
  };

  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between p-4 pb-2">
        <h2 className="text-sm font-semibold text-text-primary">시각화 옵션</h2>
      </div>
      <div className="px-4 pb-2">
        <Input id="option-search" name="optionSearch" icon={<Search className="size-3.5" />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="옵션 검색" size="sm" disabled={disabled} />
        {disabled && <p className="mt-2 text-xs text-text-tertiary">실행하면 옵션을 변경할 수 있습니다.</p>}
        {resetNotice && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-md bg-muted px-2.5 py-2 text-xs text-text-secondary">
            <span>{resetNotice.message}</span>
            <button
              type="button"
              className="shrink-0 font-medium text-text-primary hover:underline"
              onClick={() => {
                onChangeChartType(resetNotice.prevType, resetNotice.prevOptions);
                setResetNotice(null);
              }}
            >
              실행 취소
            </button>
          </div>
        )}
      </div>

      {ZONE_ORDER.map((zone) => {
        const zoneDefs = defs.filter((d) => d.zone === zone);
        if (zoneDefs.length === 0) return null;
        const sections = [...new Set(zoneDefs.map((d) => d.section))];
        return (
          <div key={zone}>
            <div className="flex items-center gap-2 px-4 pb-1 pt-3">
              <span className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary">{ZONE_LABEL[zone]}</span>
              <span className="h-px flex-1 bg-border" />
            </div>
            {sections.map((section) => {
              const sectionKey = `${zone}/${section}`;
              const open = !collapsed.has(sectionKey);
              const sectionDefs = zoneDefs.filter((d) => d.section === section);
              return (
                <section key={sectionKey} className="border-b border-border px-4 py-2.5">
                  <button type="button" onClick={() => toggleSection(sectionKey)} className="flex w-full items-center gap-1.5 text-left">
                    {open ? <ChevronDown className="size-3.5 text-text-secondary" /> : <ChevronRight className="size-3.5 text-text-secondary" />}
                    <span className="text-[13px] font-semibold text-text-primary">{section}</span>
                  </button>
                  {open && (
                    <div className="mt-2.5 flex flex-col gap-2.5">
                      {sectionDefs.map((def) => (
                        <Control
                          key={def.key}
                          def={def}
                          value={getValue(def)}
                          chartType={chartType}
                          columns={columns}
                          hasResult={hasResult}
                          disabled={disabled}
                          paletteActiveIndex={coercePaletteIndex(options.paletteActiveIndex)}
                          onChange={(v) => setValue(def, v)}
                          onChangeType={changeType}
                          onSelectPaletteIndex={setPaletteActiveIndex}
                        />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

function Control({
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
  onChange: (v: unknown) => void;
  onChangeType: (to: MajorType) => void;
  onSelectPaletteIndex: (index: number) => void;
}) {
  const fieldName = fieldNameFor(def.key);
  const fieldId = `option-${fieldName}`;

  // 전체폭 컨트롤
  if (def.control === 'iconGrid') {
    return (
      <div className="grid grid-cols-4 gap-2">
        {(def.choices ?? []).map((c) => {
          const Icon = TYPE_ICONS[String(c.value)] ?? BarChart3;
          const active = c.value === value;
          return (
            <button
              key={c.value}
              type="button"
              aria-label={c.label}
              disabled={false}
              onClick={() => onChangeType(c.value as MajorType)}
              className={cn(
                'flex flex-col items-center gap-1.5 rounded-md border py-2.5 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                active ? 'border-primary bg-muted text-text-primary' : 'border-border text-text-secondary hover:bg-muted',
              )}
            >
              <Icon className="size-4" />
              {c.label}
            </button>
          );
        })}
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
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          rows={2}
          className="w-full resize-none rounded-md border border-border bg-bg-panel px-3 py-2 text-[13px] text-text-primary outline-none focus-visible:ring-2 focus-visible:ring-primary/20 disabled:opacity-50"
        />
      </Labeled>
    );
  }

  // 혼합(combo) — 결과 시리즈별 막대/선 지정. 실행 후 결과 컬럼[1..] 이 있을 때만 활성.
  if (def.control === 'seriesTypes') {
    const seriesCols = columns.slice(1);
    if (!hasResult || seriesCols.length === 0) {
      return (
        <Labeled label={def.label} stack>
          <span className="text-xs text-text-tertiary">실행 후 지정 가능</span>
        </Labeled>
      );
    }
    const map = value && typeof value === 'object' ? (value as Record<string, string>) : {};
    return (
      <Labeled label={def.label} stack>
        <div className="flex flex-col gap-2">
          {seriesCols.map((col) => (
            <div key={col.name} data-testid={`series-type-${col.name}`} className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-[13px] text-text-secondary">{col.name}</span>
              <Segmented
                value={String(map[col.name] ?? chartType)}
                options={[{ value: 'bar', label: '막대' }, { value: 'line', label: '선' }]}
                onChange={(v) => onChange({ ...map, [col.name]: v })}
              />
            </div>
          ))}
        </div>
      </Labeled>
    );
  }

  // 라벨 + 우측 컨트롤
  let control: React.ReactNode = null;
  switch (def.control) {
    case 'segment': {
      const choices = def.key === 'variant' ? getVariants(chartType).map((v) => ({ value: v.value, label: v.label })) : (def.choices ?? []);
      control = <div className={disabled ? 'pointer-events-none opacity-50' : undefined}><Segmented value={String(value)} options={choices.map((c) => ({ value: String(c.value), label: c.label }))} onChange={(v) => onChange(v)} /></div>;
      break;
    }
    case 'select':
      control = <div className="w-36"><Select id={fieldId} name={fieldName} disabled={disabled} value={String(value ?? '')} options={(def.choices ?? []).map((c) => ({ value: String(c.value), label: c.label }))} onChange={(e) => onChange(coerce(def, e.target.value))} /></div>;
      break;
    case 'text':
      control = <div className="w-36"><Input id={fieldId} name={fieldName} disabled={disabled} size="sm" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} /></div>;
      break;
    case 'number':
      control = <div className="w-24"><Input id={fieldId} name={fieldName} disabled={disabled} size="sm" type="number" value={value == null ? '' : String(value)} min={def.min} max={def.max} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} /></div>;
      break;
    case 'slider':
      control = (
        <div className="flex items-center gap-2">
          <input id={fieldId} name={fieldName} aria-label={def.label} type="range" min={def.min} max={def.max} step={def.step} value={Number(value ?? def.min ?? 0)} onChange={(e) => onChange(Number(e.target.value))} disabled={disabled} className="w-28 accent-primary disabled:opacity-50" />
          <span className="w-10 text-right text-xs text-text-tertiary">{value == null ? '자동' : `${value}${def.unit ?? ''}`}</span>
        </div>
      );
      break;
    case 'toggle':
      control = <div className={disabled ? 'pointer-events-none opacity-50' : undefined}><Switch checked={value === true} onChange={onChange} aria-label={def.label} /></div>;
      break;
    case 'color':
      control = <input id={fieldId} name={fieldName} aria-label={def.label} type="color" value={String(value ?? '#5470C6')} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="h-7 w-10 rounded border border-border disabled:opacity-50" />;
      break;
    case 'palette':
      control = <PaletteControl value={value} selectedIndex={paletteActiveIndex} disabled={disabled} label={def.label} onChange={onChange} onSelect={onSelectPaletteIndex} />;
      break;
    case 'columnRef':
      control = hasResult ? (
        <div className="w-36"><Select id={fieldId} name={fieldName} disabled={disabled} value={String(value ?? '')} options={columns.map((c) => ({ value: c.name, label: c.name }))} onChange={(e) => onChange(e.target.value)} placeholder="컬럼" /></div>
      ) : (
        <span className="text-xs text-text-tertiary">실행 후 지정 가능</span>
      );
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
  if (def.choices?.some((c) => typeof c.value === 'number')) return Number(raw);
  return raw;
}

function coercePaletteIndex(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function PaletteControl({
  value,
  selectedIndex,
  disabled,
  label,
  onChange,
  onSelect,
}: {
  value: unknown;
  selectedIndex: number;
  disabled: boolean;
  label: string;
  onChange: (v: unknown) => void;
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
    const nextRgb = { ...rgb, [channel]: clampRgb(Number(raw)) };
    update(rgbToHex(nextRgb.r, nextRgb.g, nextRgb.b));
  };

  return (
    <div className={cn('flex w-full flex-col gap-2', disabled && 'pointer-events-none opacity-50')}>
      <div className="flex flex-wrap gap-1.5">
        {palette.map((c, i) => {
          const swatch = normalizeHex(c);
          const active = i === safeSelected;
          return (
            <button
              key={`${swatch}-${i}`}
              type="button"
              aria-label={`${label} ${i + 1}번 색상 선택`}
              data-testid={`palette-swatch-${i}`}
              disabled={disabled}
              onClick={() => onSelect(i)}
              className={cn(
                'size-6 rounded border transition-transform disabled:cursor-not-allowed',
                active ? 'scale-105 border-text-primary ring-2 ring-primary/30' : 'border-border hover:scale-105',
              )}
              style={{ backgroundColor: swatch }}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-[44px_1fr] items-center gap-x-2 gap-y-1.5">
        <span className="text-xs text-text-tertiary">색상</span>
        <input
          id="option-palette-color"
          name="paletteColor"
          aria-label="선택한 팔레트 색상"
          type="color"
          value={color}
          disabled={disabled}
          onChange={(e) => update(e.target.value)}
          className="h-8 w-full rounded border border-border bg-bg-panel disabled:opacity-50"
        />
        {(['r', 'g', 'b'] as const).map((channel) => (
          <label key={channel} className="contents">
            <span className="text-xs uppercase text-text-tertiary">{channel}</span>
            <Input
              id={`option-palette-${channel}`}
              name={`palette${channel.toUpperCase()}`}
              aria-label={`선택한 팔레트 ${channel.toUpperCase()} 값`}
              size="sm"
              type="number"
              min={0}
              max={255}
              value={String(rgb[channel])}
              disabled={disabled}
              onChange={(e) => updateRgb(channel, e.target.value)}
            />
          </label>
        ))}
      </div>
    </div>
  );
}

function normalizePalette(value: unknown): string[] {
  const source = Array.isArray(value) && value.length > 0 ? value : DEFAULT_PALETTE;
  return source.map((c) => normalizeHex(String(c))).slice(0, 8);
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
  return `#${[r, g, b].map((n) => clampRgb(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function clampRgb(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(255, Math.max(0, Math.round(value)));
}

function fieldNameFor(key: string): string {
  return key.replace(/[^a-zA-Z0-9]+/g, '_');
}

function Labeled({ label, children, stack }: { label: string; children: React.ReactNode; stack?: boolean }) {
  if (stack) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-text-secondary">{label}</span>
        {children}
      </div>
    );
  }
  return (
    <div className="flex min-h-7 items-center justify-between gap-2">
      <span className="text-[13px] text-text-secondary">{label}</span>
      {children}
    </div>
  );
}
