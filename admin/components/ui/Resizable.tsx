'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

type ResizeDir = 'left' | 'right' | 'up';

// 패널 한 변을 드래그해 크기를 바꾸는 훅. dir = 패널이 놓인 위치 기준 핸들 방향.
//   left  = 패널이 왼쪽, 오른쪽 경계 핸들(오른쪽 드래그 → 커짐)
//   right = 패널이 오른쪽, 왼쪽 경계 핸들(왼쪽 드래그 → 커짐)
//   up    = 패널이 아래, 위쪽 경계 핸들(위로 드래그 → 커짐)
export function useResizable(initial: number, min: number, max: number, dir: ResizeDir, storageKey?: string) {
  const [size, setSize] = useState(initial);
  const [restored, setRestored] = useState(false);
  const dragging = useRef(false);

  useEffect(() => {
    if (storageKey) {
      const stored = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(stored) && stored > 0) setSize(Math.max(min, Math.min(max, stored)));
    }
    setRestored(true);
  }, [max, min, storageKey]);

  useEffect(() => {
    if (restored && storageKey) window.localStorage.setItem(storageKey, String(size));
  }, [restored, size, storageKey]);

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    dragging.current = true;
    const origin = dir === 'up' ? e.clientY : e.clientX;
    const start = size;
    const move = (ev: PointerEvent) => {
      if (!dragging.current) return;
      const cur = dir === 'up' ? ev.clientY : ev.clientX;
      const delta = dir === 'left' ? cur - origin : origin - cur; // left만 같은 방향, right·up은 반대
      setSize(Math.max(min, Math.min(max, start + delta)));
    };
    const up = () => {
      dragging.current = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return { size, setSize, onPointerDown, dir };
}

// 경계선처럼 보이되 ±3px 히트영역을 갖는 드래그 핸들. hover 시 primary 강조.
export function ResizeHandle({ onPointerDown, dir }: { onPointerDown: (e: React.PointerEvent) => void; dir: ResizeDir }) {
  const vertical = dir !== 'up'; // 좌우 패널 → 세로 핸들(가로 리사이즈)
  return (
    <div
      role="separator"
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      onPointerDown={onPointerDown}
      className={cn(
        'relative z-10 shrink-0 bg-border transition-colors hover:bg-primary',
        vertical ? 'w-px cursor-col-resize' : 'h-px cursor-row-resize',
      )}
    >
      <span className={cn('absolute', vertical ? 'inset-y-0 -left-1 -right-1' : 'inset-x-0 -top-1 -bottom-1')} />
    </div>
  );
}
