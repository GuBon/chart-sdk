// 조건부 className 병합 — falsy 제거 후 공백 결합.
// MVP 범위에선 클래스 충돌을 호출부에서 통제하므로 tailwind-merge 의존성은 두지 않는다.
export type ClassValue = string | false | null | undefined;

export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(' ');
}
