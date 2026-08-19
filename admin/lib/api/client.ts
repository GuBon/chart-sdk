// 공통 fetch 래퍼. 모든 엔드포인트가 이 한 곳을 거친다(에러 형식·기본 헤더 단일화).
// 개발 환경에서는 MSW 가 동일 경로를 가로챈다.

const BASE = `${process.env.NEXT_PUBLIC_E2E_MSW === 'true' ? '' : (process.env.NEXT_PUBLIC_API_BASE ?? '')}/api/v1`;
export const AUTH_INVALID_EVENT = 'chartsdk:auth-invalid';

/** 서버 공통 에러 형식 {error:{code,message,fields?,requestId?}} 을 표현 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    /** 필드 검증 오류일 때만: {필드명: 메시지} — 폼이 해당 칸을 콕 집어 표시한다 */
    readonly fields?: Record<string, string>,
    /** 서버 요청 ID — 5xx일 때 사용자에게 노출해 지원팀이 로그를 상관 지을 수 있게 한다 */
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** API 오류 메시지에 운영 로그를 찾을 수 있는 5xx 요청 ID를 보존한다. */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback;
  if (error.status >= 500 && error.requestId) return `${error.message} (요청 ID: ${error.requestId})`;
  return error.message;
}

/** Bean Validation의 필드별 메시지를 폼 컨트롤 가까이에 표시하기 위한 단일 접근점. */
export function apiFieldError(error: unknown, field: string): string | undefined {
  return error instanceof ApiError ? error.fields?.[field] : undefined;
}

interface RequestInitJson extends Omit<RequestInit, 'body'> {
  body?: unknown; // 객체를 받으면 JSON 직렬화
}

// React Strict Mode 등에서 같은 GET이 동시에 시작되면 하나의 네트워크 요청을 공유한다.
// 완료 후 즉시 제거하므로 응답 캐시가 아니며, 이후의 명시적 새로고침은 그대로 서버를 조회한다.
const inFlightGets = new Map<string, Promise<unknown>>();
let csrfPromise: Promise<{ headerName: string; token: string }> | null = null;

// 세션 세대 — 로그인·로그아웃이 성공할 때마다 1 증가한다. 그 전에 시작된 요청은 이전 세션의 결과이므로
// (1) 그 401 은 현재 세션을 무효화하지 않고 (2) 진행 중 GET 공유도 세대가 다르면 재사용하지 않는다.
// 초기 /auth/me 가 느리게 401 로 끝나는 사이 로그인이 완료되면 방금 로그인한 상태를 뒤집던 경쟁을 막는다.
let authGeneration = 0;

/** 현재 세션 세대. 호출 측은 비동기 대기 전후 값을 비교해 이전 세션의 결과를 버린다. */
export function currentAuthGeneration(): number {
  return authGeneration;
}

export function clearCsrfToken() {
  csrfPromise = null;
}

export function request<T>(path: string, init: RequestInitJson = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  if (method !== 'GET' || init.body !== undefined) return execute<T>(path, init);

  const key = `${authGeneration}:${BASE}${path}`;
  const existing = inFlightGets.get(key);
  if (existing) return existing as Promise<T>;

  const pending = execute<T>(path, init);
  inFlightGets.set(key, pending);
  const clear = () => {
    if (inFlightGets.get(key) === pending) inFlightGets.delete(key);
  };
  void pending.then(clear, clear);
  return pending;
}

async function execute<T>(path: string, init: RequestInitJson, retryCsrf = true): Promise<T> {
  const startedGeneration = authGeneration;
  const { body, headers, ...rest } = init;
  const method = (rest.method ?? 'GET').toUpperCase();
  const requestHeaders = new Headers(headers);
  if (body !== undefined && !requestHeaders.has('Content-Type')) {
    requestHeaders.set('Content-Type', 'application/json');
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    csrfPromise ??= request<{ headerName: string; token: string }>('/auth/csrf');
    let csrf: { headerName: string; token: string };
    try {
      csrf = await csrfPromise;
    } catch (error) {
      clearCsrfToken();
      throw error;
    }
    requestHeaders.set(csrf.headerName, csrf.token);
  }
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    method,
    cache: rest.cache ?? 'no-store',
    credentials: 'include',
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // 성공·실패 모두 본문을 한 번만 읽는다. 200 + 빈 본문 같은 서버 계약 실수도 UI의
  // JSON SyntaxError로 번지지 않게 하되, 계약 테스트는 올바른 204를 별도로 검증한다.
  const responseText = await res.text();

  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let message = res.statusText || '요청에 실패했습니다.';
    let fields: Record<string, string> | undefined;
    let requestId: string | undefined;
    try {
      const data = responseText ? JSON.parse(responseText) : null;
      if (data?.error) ({ code, message, fields, requestId } = data.error);
    } catch {
      /* 비-JSON 응답은 statusText 로 둔다 */
    }
    if (code === 'CSRF_INVALID') {
      clearCsrfToken();
      // CSRF 검증 실패 시 controller mutation은 실행되지 않았으므로 새 토큰으로 한 번만 재시도한다.
      if (retryCsrf) return execute<T>(path, init, false);
    }
    // 이전 세대에 시작된 요청의 401 은 그 세션이 끝났다는 뜻일 뿐, 지금 세션의 무효화가 아니다.
    if (res.status === 401 && path !== '/auth/login' && startedGeneration === authGeneration
      && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(AUTH_INVALID_EVENT));
    }
    throw new ApiError(code, message, res.status, fields, requestId);
  }

  if (path === '/auth/login' || path === '/auth/logout') {
    authGeneration += 1;
    clearCsrfToken();
  }
  if (res.status === 204 || res.status === 205 || responseText.trim() === '') return undefined as T;
  return JSON.parse(responseText) as T;
}
