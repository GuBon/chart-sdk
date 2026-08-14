'use client';

// 미저장 변경 이탈 가드.
// - 문서 전체 이탈(새로고침·탭 닫기·외부 URL): beforeunload의 브라우저 기본 확인
// - 에디터가 제어하는 내부 이동: requestLeave의 커스텀 확인 모달
// - Navigation API의 취소 가능한 push: 누락된 내부 Link를 보조적으로 가로챔
// Back/Forward traverse는 취소 가능하다고 보장하지 않는다. 이 경우의 데이터 보호는 ChartEditor의
// sessionStorage 초안 복구가 담당한다.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

// Navigation API 최소 타입 — TS lib.dom 포함 여부와 무관하게 참조하도록 로컬로 선언한다.
type NavigateEventLike = {
  readonly cancelable: boolean;
  readonly hashChange: boolean;
  readonly downloadRequest: string | null;
  readonly navigationType: 'push' | 'replace' | 'reload' | 'traverse';
  readonly destination: { readonly url: string; readonly key: string };
  preventDefault(): void;
};
type NavigationLike = {
  addEventListener(type: 'navigate', listener: (event: NavigateEventLike) => void): void;
  removeEventListener(type: 'navigate', listener: (event: NavigateEventLike) => void): void;
};

function browserNavigation(): NavigationLike | null {
  if (typeof window === 'undefined') return null;
  return (window as unknown as { navigation?: NavigationLike }).navigation ?? null;
}

/** URL 의 앱 내부 경로 표현 — 가드 통과 판정과 재개(push) 양쪽에서 동일하게 쓴다. */
function appPath(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export type LeaveTarget = { path: string };

export function useLeaveGuard(hasUnsavedChanges: boolean) {
  const router = useRouter();
  const [leaveTarget, setLeaveTarget] = useState<LeaveTarget | null>(null);
  // 확인된 이탈 경로 — navigate 가드가 자신이 재개한 이동을 다시 가로채지 않도록 목적지 경로로
  // 대조해 한 번 통과시킨다(boolean 표식과 달리 무관한 이동에 소모되지 않는다).
  const confirmedPathRef = useRef<string | null>(null);

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = ''; // 크롬/사파리: 표준 확인 다이얼로그 표시에 필요
    };
    window.addEventListener('beforeunload', beforeUnload);

    const navigation = browserNavigation();
    const onNavigate = (event: NavigateEventLike) => {
      // reload 는 beforeunload 가 담당한다(취소 후 push 재개는 새로고침 의미가 아니다).
      // replace 는 프레임워크 내부 이동일 수 있어 가로채지 않는다.
      if (event.navigationType !== 'push') return;
      // 취소 불가·해시 이동·다운로드는 가로채지 않는다.
      if (!event.cancelable || event.hashChange || event.downloadRequest !== null) return;
      const destination = new URL(event.destination.url);
      if (destination.origin !== window.location.origin) return; // 외부 이탈은 beforeunload 담당
      const path = appPath(destination);
      if (confirmedPathRef.current === path) {
        confirmedPathRef.current = null;
        return;
      }
      event.preventDefault();
      setLeaveTarget({ path });
    };
    navigation?.addEventListener('navigate', onNavigate);

    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      navigation?.removeEventListener('navigate', onNavigate);
    };
  }, [hasUnsavedChanges]);

  /** 가드 대상 내부 이동 진입점 — 미저장이면 이탈확인 모달, 아니면 즉시 이동. */
  const requestLeave = (path: string) => {
    if (hasUnsavedChanges) setLeaveTarget({ path });
    else router.push(path);
  };

  /** 이탈확인 모달의 "나가기" 확정 — 가로챘던 이동을 재개한다. */
  const confirmLeave = () => {
    if (!leaveTarget) return;
    setLeaveTarget(null);
    confirmedPathRef.current = leaveTarget.path;
    router.push(leaveTarget.path);
  };

  const cancelLeave = () => setLeaveTarget(null);

  return { leaveTarget, requestLeave, confirmLeave, cancelLeave };
}
