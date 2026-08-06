import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MutableRefObject,
} from 'react';
import { Check, ChevronDown } from 'lucide-react';
import {
  d3Palette,
  paletteFamilyOfPreset,
  type PaletteFamily,
} from '@chartsdk/chart-options/palettes';
import { cn } from '@/lib/cn';

export type ThemeSelectChoice = {
  value: string;
  label: string;
  family?: PaletteFamily;
};

type IndexedThemeChoice = {
  choice: ThemeSelectChoice;
  index: number;
};

type ThemeChoiceGroup = {
  family: PaletteFamily | null;
  items: IndexedThemeChoice[];
};

const PALETTE_FAMILY_LABELS: Record<PaletteFamily, string> = {
  categorical: 'Categorical',
  sequential: 'Sequential',
  diverging: 'Diverging',
  cyclical: 'Cyclical',
};

function groupThemeChoices(choices: ThemeSelectChoice[]): ThemeChoiceGroup[] {
  const groups: ThemeChoiceGroup[] = [];
  choices.forEach((choice, index) => {
    const family = choice.family ?? null;
    const current = groups.at(-1);
    if (!current || current.family !== family) groups.push({ family, items: [] });
    groups.at(-1)!.items.push({ choice, index });
  });
  return groups;
}

export function ThemeSelect({
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
  choices: ThemeSelectChoice[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [expandedFamilies, setExpandedFamilies] = useState<Set<PaletteFamily>>(new Set());
  const [menuPosition, setMenuPosition] = useState({
    top: 0,
    left: 0,
    width: 288,
    maxHeight: 320,
  });
  const selectedIndex = Math.max(0, choices.findIndex((choice) => choice.value === value));
  const selectedChoice = choices[selectedIndex] ?? { value, label: '기존 테마', family: undefined };
  const choiceGroups = useMemo(() => groupThemeChoices(choices), [choices]);
  const visibleChoiceIndexes = useMemo(() => choiceGroups.flatMap((group) => (
    group.family == null || expandedFamilies.has(group.family)
      ? group.items.map((item) => item.index)
      : []
  )), [choiceGroups, expandedFamilies]);

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

  const openThemeMenu = () => {
    const initialFamily = selectedChoice.family ?? choiceGroups.find((group) => group.family)?.family;
    setExpandedFamilies(new Set(initialFamily ? [initialFamily] : []));
    setMenuPosition(calculateThemeMenuPosition(triggerRef.current, choices.length));
    setOpen(true);
  };

  const toggleFamily = (family: PaletteFamily) => {
    setExpandedFamilies((previous) => {
      const next = new Set(previous);
      if (next.has(family)) next.delete(family);
      else next.add(family);
      return next;
    });
  };

  const focusOption = (currentIndex: number, offset: number) => {
    if (visibleChoiceIndexes.length === 0) return;
    const currentPosition = visibleChoiceIndexes.indexOf(currentIndex);
    const basePosition = currentPosition >= 0 ? currentPosition : 0;
    const nextPosition = (basePosition + offset + visibleChoiceIndexes.length) % visibleChoiceIndexes.length;
    optionRefs.current[visibleChoiceIndexes[nextPosition]]?.focus();
  };

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index, -1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      optionRefs.current[visibleChoiceIndexes[0]]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      optionRefs.current[visibleChoiceIndexes.at(-1) ?? 0]?.focus();
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
        aria-haspopup="tree"
        aria-controls={`${id}-menu`}
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          if (open) setOpen(false);
          else openThemeMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openThemeMenu();
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={cn(
          'flex h-8 w-full items-center gap-2 rounded-md border border-border bg-bg-panel px-2 text-[13px] text-text-primary outline-none',
          'focus-visible:ring-2 focus-visible:ring-primary/20 disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <PaletteStrip preset={selectedChoice.value} testId="theme-selected-preview" />
        <span className="shrink-0">{selectedChoice.label}</span>
        <ChevronDown className={cn('size-3.5 shrink-0 text-text-secondary transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          id={`${id}-menu`}
          role="tree"
          aria-label={`${label} 목록`}
          style={menuPosition}
          className="fixed z-[100] overflow-y-auto rounded-md border border-border bg-bg-panel p-1 shadow-lg"
        >
          {choiceGroups.map((group) => {
            if (group.family == null) {
              return group.items.map(({ choice, index }) => (
                <ThemeChoiceButton
                  key={choice.value}
                  choice={choice}
                  index={index}
                  selected={choice.value === value}
                  optionRefs={optionRefs}
                  onSelect={selectChoice}
                  onKeyDown={handleOptionKeyDown}
                />
              ));
            }
            const expanded = expandedFamilies.has(group.family);
            const selectedFamily = selectedChoice.family === group.family;
            const previewPreset = selectedFamily ? selectedChoice.value : group.items[0]?.choice.value;
            return (
              <div key={group.family} role="none" className="border-b border-border/70 last:border-b-0">
                <button
                  type="button"
                  role="treeitem"
                  aria-expanded={expanded}
                  aria-label={`${PALETTE_FAMILY_LABELS[group.family]} 테마 ${group.items.length}개`}
                  data-testid={`theme-group-${group.family}`}
                  onClick={() => toggleFamily(group.family!)}
                  className="flex h-9 w-full items-center gap-2 rounded px-2 text-left text-[12px] font-semibold text-text-secondary outline-none hover:bg-muted focus-visible:bg-muted"
                >
                  <ChevronDown className={cn('size-3.5 shrink-0 transition-transform', !expanded && '-rotate-90')} />
                  <span className="w-[76px] shrink-0">{PALETTE_FAMILY_LABELS[group.family]}</span>
                  <span className="min-w-0 flex-1"><PaletteStrip preset={previewPreset} testId={`theme-group-preview-${group.family}`} /></span>
                  <span className="shrink-0 text-[10px] font-normal text-text-tertiary">{group.items.length}</span>
                  <Check className={cn('size-3.5 shrink-0', selectedFamily ? 'opacity-100' : 'opacity-0')} />
                </button>
                {expanded && (
                  <div role="group" aria-label={`${PALETTE_FAMILY_LABELS[group.family]} 테마`}>
                    {group.items.map(({ choice, index }) => (
                      <ThemeChoiceButton
                        key={choice.value}
                        choice={choice}
                        index={index}
                        selected={choice.value === value}
                        optionRefs={optionRefs}
                        onSelect={selectChoice}
                        onKeyDown={handleOptionKeyDown}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ThemeChoiceButton({
  choice,
  index,
  selected,
  optionRefs,
  onSelect,
  onKeyDown,
}: {
  choice: ThemeSelectChoice;
  index: number;
  selected: boolean;
  optionRefs: MutableRefObject<Array<HTMLButtonElement | null>>;
  onSelect: (value: string) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => void;
}) {
  return (
    <button
      ref={(element) => { optionRefs.current[index] = element; }}
      type="button"
      role="treeitem"
      aria-selected={selected}
      onClick={() => onSelect(choice.value)}
      onKeyDown={(event) => onKeyDown(event, index)}
      className={cn(
        'flex h-8 w-full items-center gap-2 rounded px-2 pl-7 text-left text-[13px] text-text-primary outline-none',
        'hover:bg-muted focus-visible:bg-muted',
        selected && 'bg-muted',
      )}
    >
      <PaletteStrip preset={choice.value} testId={`theme-option-preview-${choice.value}`} />
      <span className="shrink-0">{choice.label}</span>
      <Check className={cn('ml-auto size-3.5 shrink-0', selected ? 'opacity-100' : 'opacity-0')} />
    </button>
  );
}

function PaletteStrip({ preset, testId }: { preset: unknown; testId: string }) {
  const colors = d3Palette(preset);
  const family = paletteFamilyOfPreset(preset);
  if (family && family !== 'categorical') {
    return (
      <span
        data-testid={testId}
        aria-hidden="true"
        className="h-4 min-w-0 flex-1 overflow-hidden rounded-[3px] border border-black/10"
        style={{ background: `linear-gradient(to right, ${colors.join(', ')})` }}
      />
    );
  }
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
