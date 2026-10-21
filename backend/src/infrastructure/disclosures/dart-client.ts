// DART OpenAPI 클라이언트 (docs/Task_ORDER.md 12단계, D-56, D-59 ⑥)
//
// 보안 원칙:
// - 인증키는 환경변수 DART_API_KEY로만 받는다. 값은 사용자가 프로젝트 루트 `.env`에 넣고, docker-compose가
//   변수 치환으로 이 컨테이너(disclosure-collector)에만 넘긴다.
// - DART는 키를 **요청 URL의 쿼리값(crtfc_key)**으로 받는다. 그래서 요청 URL을 로그·지표·Kafka·에러 메시지에 절대 넣지 않는다.
//   에러에는 HTTP 상태와 DART 응답 상태 코드(숫자 3자리)만 남긴다.
// - 접속 대상은 아래 고정 주소 하나뿐이다 (2026-10-20 사용자 승인). 리다이렉트는 따라가지 않는다 (http-json.ts).

import { fetchJson, HttpJsonError } from '../http-json.js';

const BASE_URL = 'https://opendart.fss.or.kr/api';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 공시 목록 100건은 수십 KB 수준

// DART 응답 상태 코드
export const DART_STATUS = {
  ok: '000',
  noData: '013',
  rateLimited: '020',
  maintenance: '800',
} as const;
// 키 문제 (미등록·사용 불가·접근 불가 IP·보유기간 만료 등)
export const DART_KEY_ERRORS = new Set(['010', '011', '012', '901']);

export class DartApiError extends Error {
  constructor(message: string, readonly status: number | undefined = undefined, readonly code: string | undefined = undefined) {
    super(message);
  }
}

export interface DartConfig {
  apiKey: string;
}

// 키 형식이 이상하면(공백·제어 문자 등) 쓰지 않는다. 값은 로그에 남기지 않는다.
export function readDartConfig(): DartConfig | null {
  const apiKey = process.env.DART_API_KEY?.trim();
  if (!apiKey) return null;
  if (!/^[A-Za-z0-9]{20,100}$/.test(apiKey)) {
    console.warn('[dart] DART_API_KEY has an unexpected format (value not shown). Collection is idle.');
    return null;
  }
  return { apiKey };
}

const ENDPOINT_PATTERN = /^[A-Za-z]{2,40}\.json$/;
const PARAM_NAME_PATTERN = /^[a-z_]{2,20}$/;
const PARAM_VALUE_PATTERN = /^[0-9A-Za-z]{1,20}$/;
const safeStatus = (value: unknown) => (typeof value === 'string' && /^\d{3}$/.test(value) ? value : undefined);

export interface DartResponse {
  status: string;
  body: Record<string, unknown>;
}

export class DartClient {
  constructor(private readonly config: DartConfig) {}

  // endpoint 예: 'list.json'. 요청 값은 영문·숫자만 받는다 (주소에 다른 값이 끼어들지 않게).
  // '000'(정상)과 '013'(데이터 없음)은 돌려주고, 나머지는 DartApiError를 던진다.
  async get(endpoint: string, params: Record<string, string>): Promise<DartResponse> {
    if (!ENDPOINT_PATTERN.test(endpoint)) throw new DartApiError('invalid_request');
    for (const [name, value] of Object.entries(params)) {
      // 인증키 자리(crtfc_key)는 요청 값으로 바꿀 수 없다
      if (name === 'crtfc_key' || !PARAM_NAME_PATTERN.test(name) || !PARAM_VALUE_PATTERN.test(value)) throw new DartApiError('invalid_request');
    }
    const query = new URLSearchParams({ ...params, crtfc_key: this.config.apiKey });

    let response;
    try {
      // 이 URL에는 키가 들어 있다. 변수로 남기지 않고 바로 넘긴다.
      response = await fetchJson(`${BASE_URL}/${endpoint}?${query.toString()}`, {
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: MAX_RESPONSE_BYTES,
      });
    } catch (error) {
      throw new DartApiError(error instanceof HttpJsonError ? error.message : 'network_error', error instanceof HttpJsonError ? error.status : undefined);
    }
    const body = response.body && typeof response.body === 'object' && !Array.isArray(response.body) ? (response.body as Record<string, unknown>) : null;
    const status = safeStatus(body?.status);
    if (!response.ok || !body || !status) throw new DartApiError('request_failed', response.status, status);
    if (status !== DART_STATUS.ok && status !== DART_STATUS.noData) throw new DartApiError('api_error', response.status, status);
    return { status, body };
  }
}
