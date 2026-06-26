'use client';

import type { ChartOptions } from '@/lib/api';
import { ChartPreview } from './ChartPreview';

export function MiniChart({ option }: { option?: ChartOptions | null }) {
  if (option === null) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-md bg-bg-panel/60 text-xs text-text-tertiary">
        preview unavailable
      </div>
    );
  }

  if (option === undefined) {
    return <div className="h-full w-full animate-pulse rounded-md bg-bg-panel/70" />;
  }

  return <ChartPreview option={option} />;
}
