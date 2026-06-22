// 공통 fetch 래퍼. 모든 엔드포인트가 이 한 곳을 거친다(에러 형식·기본 헤더 단일화).
// 개발 환경에서는 MSW 가 동일 경로를 가로챈다.

const BASE = `${process.env.NEXT_PUBLIC_API_BASE ?? ''}/api/v1`;

/** 서버 공통 에러 형식 {error:{code,message,detail?}} 을 표현 */
export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestInitJson extends Omit<RequestInit, 'body'> {
  body?: unknown; // 객체를 받으면 JSON 직렬화
}

export async function request<T>(path: string, init: RequestInitJson = {}): Promise<T> {
  const { body, headers, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!res.ok) {
    let code = 'INTERNAL_ERROR';
    let message = res.statusText || '요청에 실패했습니다.';
    let detail: string | undefined;
    try {
      const data = await res.json();
      if (data?.error) ({ code, message, detail } = data.error);
    } catch {
      /* 비-JSON 응답은 statusText 로 둔다 */
    }
    throw new ApiError(code, message, res.status, detail);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
