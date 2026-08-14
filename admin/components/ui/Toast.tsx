'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/** 토스트 1건. 문자열이 같아도 id 로 구분해 "같은 문구 연속 표시"를 새 알림으로 취급한다. */
export interface ToastNotice {
  id: number;
  message: string;
}

/**
 * 화면 하단 중앙에 잠깐 떴다 사라지는 알림(토스트)의 상태·자동 해제 타이머를 한 곳에서 관리한다.
 * 세 화면(에디터·차트목록·토큰)이 각자 복제하던 useState + setTimeout 패턴을 대체한다.
 *
 * 메시지 문자열이 아니라 증가하는 id 를 상태 식별자로 사용한다. 같은 문구를 다시 show() 해도
 * id 가 바뀌어 새 상태가 되므로, 타이머 effect 가 재실행되어 유지 시간이 처음부터 다시 시작된다
 * (문자열만 상태로 쓰면 React 가 동일값 setState 를 건너뛰어 이전 타이머가 새 토스트를 지운다).
 *
 * @param durationMs 표시 유지 시간(ms). 기본 2500.
 */
export function useToast(durationMs = 2500) {
  const [notice, setNotice] = useState<ToastNotice | null>(null);
  const sequence = useRef(0);
  const clear = useCallback(() => setNotice(null), []);
  const show = useCallback((message: string) => {
    sequence.current += 1;
    setNotice({ id: sequence.current, message });
  }, []);
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(clear, durationMs);
    return () => clearTimeout(timer);
  }, [notice, durationMs, clear]);
  return { notice, show, clear };
}

/**
 * useToast 의 notice 를 하단 중앙 토스트로 렌더한다. role="status" + aria-live="polite" + aria-atomic
 * 로 스크린리더 고지를 표준화하고, key={notice.id} 로 같은 문구를 다시 띄워도 새 알림으로 재생성한다.
 *
 * z-index 는 화면마다 다르므로(에디터는 자체 모달 위, z-[60]) className 으로 주입받는다.
 * cn 이 tailwind-merge 가 아니므로 base 에는 z 클래스를 넣지 않아 충돌을 피한다.
 */
export function Toast({ notice, className = 'z-50' }: { notice: ToastNotice | null; className?: string }) {
  if (!notice) return null;
  return (
    <div
      key={notice.id}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn(
        'fixed bottom-6 left-1/2 -translate-x-1/2 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow-lg',
        className,
      )}
    >
      {notice.message}
    </div>
  );
}
