// 외부 API 호출 공통 처리 (docs/Task_ORDER.md T-67, 12단계 보안 검토)
// - 시간 제한: 응답이 오지 않아도 수집 주기가 멈추지 않게 한다.
// - 리다이렉트 거부: 인증키가 담긴 요청(DART는 URL, KRX는 헤더)이 승인되지 않은 다른 주소로 따라가지 않게 한다.
// - 응답 크기 상한: 비정상적으로 큰 응답으로 메모리가 고갈되지 않게 한다.
// - 오류에는 종류만 남긴다. 요청 URL·헤더·응답 본문은 오류 메시지에 넣지 않는다 (키가 섞일 수 있음).

// 외부 응답에서 온 문자열(필드 이름, 지수 이름 등)을 로그에 쓸 때: 제어 문자(줄바꿈 포함)와 줄·문단 구분 문자를 지우고 길이를 자른다.
// 외부 서버가 보낸 값으로 로그 줄을 위조하거나 로그를 부풀릴 수 없게 한다.
const LOG_UNSAFE = /[\p{Cc}\p{Zl}\p{Zp}]/gu;
export const safeLogText = (value: unknown, max = 60) =>
  (typeof value === 'string' ? value : String(value)).replace(LOG_UNSAFE, '').slice(0, max);
export const safeLogList = (values: unknown[], maxItems = 40) =>
  values.slice(0, maxItems).map(value => safeLogText(value)).join(',');

export class HttpJsonError extends Error {
  constructor(message: 'timeout' | 'network_error' | 'redirect_blocked' | 'too_large' | 'invalid_json', readonly status: number | undefined = undefined) {
    super(message);
  }
}

export interface HttpJsonResponse {
  status: number;
  ok: boolean;
  body: unknown;
}

export interface FetchJsonInit {
  method?: 'GET' | 'POST';  // POST는 KIS 토큰 발급에만 쓴다 (SEC-013)
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  maxBytes: number;
}

export async function fetchJson(url: string, init: FetchJsonInit): Promise<HttpJsonResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs);
  try {
    let response: Response;
    try {
      const request: RequestInit = {
        method: init.method ?? 'GET',
        headers: { accept: 'application/json', ...init.headers },
        // 리다이렉트를 따라가지 않는다. 따라가면 사용자 정의 헤더(키)와 307/308의 본문(시크릿)이 다른 주소로 다시 갈 수 있다
        redirect: 'manual',
        signal: controller.signal,
      };
      if (init.body !== undefined) request.body = init.body;
      response = await fetch(url, request);
    } catch (error) {
      throw new HttpJsonError(error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error');
    }
    // redirect: 'manual'이면 3xx 응답을 그대로 받는다. 따라가지 않고 실패로 처리한다.
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel().catch(() => undefined);
      throw new HttpJsonError('redirect_blocked', response.status);
    }

    const declared = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > init.maxBytes) {
      await response.body?.cancel().catch(() => undefined);
      throw new HttpJsonError('too_large', response.status);
    }

    // 본문을 읽으면서 크기를 센다 (content-length가 없거나 틀린 경우 대비)
    const chunks: Uint8Array[] = [];
    let total = 0;
    const reader = response.body?.getReader();
    if (reader) {
      for (;;) {
        let result: Awaited<ReturnType<typeof reader.read>>;
        try {
          result = await reader.read();
        } catch (error) {
          throw new HttpJsonError(error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network_error', response.status);
        }
        if (result.done) break;
        total += result.value.byteLength;
        if (total > init.maxBytes) {
          await reader.cancel().catch(() => undefined);
          throw new HttpJsonError('too_large', response.status);
        }
        chunks.push(result.value);
      }
    }

    const text = Buffer.concat(chunks).toString('utf8');
    let body: unknown;
    try {
      body = text.length > 0 ? JSON.parse(text) : null;
    } catch {
      // 오류 응답은 JSON이 아닐 수 있다. 상태 코드로 판단하도록 body는 null
      if (response.ok) throw new HttpJsonError('invalid_json', response.status);
      body = null;
    }
    return { status: response.status, ok: response.ok, body };
  } finally {
    clearTimeout(timer);
  }
}
