'use client';

import { useEffect, useRef, useState } from 'react';
import { Maximize, X } from 'lucide-react';
import type { ChartDesignSize, PreviewFitMode } from '@chartsdk/chart-options/display';
import { ChartDesignViewport } from './ChartDesignViewport';
import { PreviewFitControls } from './PreviewFitControls';

interface Props {
  option: Record<string, unknown>;
  designSize: ChartDesignSize;
  onClose: () => void;
}

export function ChartFocusDialog({ option, designSize, onClose }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [fitMode, setFitMode] = useState<PreviewFitMode>('contain');
  const [zoom, setZoom] = useState(100);
  const [browserFullscreen, setBrowserFullscreen] = useState(false);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusFrame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !document.fullscreenElement) onClose();
      if (event.key !== 'Tab') return;
      const root = rootRef.current;
      if (!root) return;
      const focusable = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const onFullscreen = () => setBrowserFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFullscreen);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFullscreen);
      previouslyFocused?.focus();
    };
  }, [onClose]);

  const toggleBrowserFullscreen = async () => {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await rootRef.current?.requestFullscreen?.();
  };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="차트 전체 화면 미리보기"
      data-testid="chart-focus-dialog"
      className="fixed inset-0 z-50 flex flex-col bg-bg-panel"
    >
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">집중 미리보기</h2>
          <p className="text-[11px] text-text-tertiary">{designSize.label}</p>
        </div>
        <div className="flex-1" />
        <PreviewFitControls fitMode={fitMode} zoom={zoom} onFitMode={setFitMode} onZoom={setZoom} />
        <button
          type="button"
          onClick={() => void toggleBrowserFullscreen()}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-text-secondary hover:bg-muted hover:text-text-primary"
        >
          <Maximize className="size-3.5" />
          {browserFullscreen ? '전체 화면 종료' : '브라우저 전체 화면'}
        </button>
        <button ref={closeButtonRef} type="button" aria-label="집중 미리보기 닫기" onClick={onClose} className="flex size-8 items-center justify-center rounded-md text-text-secondary hover:bg-muted hover:text-text-primary">
          <X className="size-4" />
        </button>
      </header>
      <main className="min-h-0 flex-1">
        <ChartDesignViewport option={option} designSize={designSize} fitMode={fitMode} zoom={zoom} testId="chart-focus-viewport" />
      </main>
    </div>
  );
}
