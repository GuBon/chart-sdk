'use client';

import { Minus, Plus } from 'lucide-react';
import type { PreviewFitMode } from '@chartsdk/chart-options/display';
import { cn } from '@/lib/cn';

interface Props {
  fitMode: PreviewFitMode;
  zoom: number;
  onFitMode: (mode: PreviewFitMode) => void;
  onZoom: (zoom: number) => void;
  compact?: boolean;
}

export function PreviewFitControls({ fitMode, zoom, onFitMode, onZoom, compact = false }: Props) {
  const chooseZoom = (next: number) => {
    onFitMode('actual');
    onZoom(Math.min(200, Math.max(25, next)));
  };
  return (
    <div role="group" className="flex items-center gap-1" aria-label="미리보기 맞춤 방식">
      <FitButton active={fitMode === 'contain'} onClick={() => onFitMode('contain')}>화면 맞춤</FitButton>
      {!compact && <FitButton active={fitMode === 'width'} onClick={() => onFitMode('width')}>너비 맞춤</FitButton>}
      <FitButton active={fitMode === 'actual'} onClick={() => { onFitMode('actual'); onZoom(100); }}>100%</FitButton>
      <button
        type="button"
        aria-label="축소"
        onClick={() => chooseZoom(zoom - 25)}
        className="flex size-7 items-center justify-center rounded text-text-secondary hover:bg-muted hover:text-text-primary"
      >
        <Minus className="size-3.5" />
      </button>
      <span className="w-10 text-center text-[11px] tabular-nums text-text-tertiary">{fitMode === 'actual' ? `${zoom}%` : '자동'}</span>
      <button
        type="button"
        aria-label="확대"
        onClick={() => chooseZoom(zoom + 25)}
        className="flex size-7 items-center justify-center rounded text-text-secondary hover:bg-muted hover:text-text-primary"
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}

function FitButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'h-7 rounded px-2 text-[11px] font-medium transition-colors',
        active ? 'bg-primary text-primary-foreground' : 'text-text-secondary hover:bg-muted hover:text-text-primary',
      )}
    >
      {children}
    </button>
  );
}
