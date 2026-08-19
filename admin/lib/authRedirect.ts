/** 로그인 후 이동은 현재 origin 내부의 경로만 허용한다. */
export function safeLoginNext(candidate: string | null, origin: string): string {
  if (!candidate) return '/';
  try {
    const target = new URL(candidate, origin);
    if (target.origin !== origin) return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}
