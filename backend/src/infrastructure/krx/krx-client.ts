// KRX Open API 클라이언트 (docs/Task_ORDER.md T-67, D-60)
//
// 보안 원칙 (D-51, D-56과 같은 방식):
// - 인증키는 환경변수 KRX_API_KEY로만 받는다. 값은 사용자가 프로젝트 루트 `.env`에 넣고, docker-compose가
//   변수 치환으로 이 컨테이너(krx-collector)에만 넘긴다.
// - 키는 요청 헤더(AUTH_KEY)로만 보내고, 로그·지표·Kafka 메시지·에러 메시지에 넣지 않는다.
//   에러에는 HTTP 상태와 KRX 응답 코드만 남긴다.
// - 접속 대상은 아래 고정 주소 하나뿐이다 (2026-10-20 사용자 승인). 환경변수로 바꿀 수 없게 해서 다른 곳으로 키가 가지 않게 한다.
//   리다이렉트는 따라가지 않는다 (http-json.ts).

import { fetchJson, HttpJsonError } from '../http-json.js';

const BASE_URL = 'https://data-dbg.krx.co.kr/svc/apis';
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 지수 일별 시세는 수십 KB 수준

export class KrxApiError extends Error {
  constructor(message: string, readonly status: number | undefined = undefined, readonly code: string | undefined = undefined) {
    super(message);
  }
}

export interface KrxConfig {
  apiKey: string;
}

// 키 형식이 이상하면(공백·제어 문자 등) 쓰지 않는다. 값은 로그에 남기지 않는다.
export function readKrxConfig(): KrxConfig | null {
  const apiKey = process.env.KRX_API_KEY?.trim();
  if (!apiKey) return null;
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(apiKey)) {
    console.warn('[krx] KRX_API_KEY has an unexpected format (value not shown). Collection is idle.');
    return null;
  }
  return { apiKey };
}

// 응답 코드는 짧은 영문·숫자만 남긴다 (임의 문자열이 로그에 들어가지 않게)
export const safeCode = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(value) ? value : undefined);

export class KrxClient {
  constructor(private readonly config: KrxConfig) {}

  // path 예: '/idx/krx_dd_trd'. basDd: YYYYMMDD
  async get(path: string, basDd: string): Promise<Record<string, unknown>> {
    if (!/^\/[a-z_]+\/[a-z_]+$/.test(path) || !/^\d{8}$/.test(basDd)) throw new KrxApiError('invalid_request');
    let response;
    try {
      response = await fetchJson(`${BASE_URL}${path}?basDd=${basDd}`, {
        headers: { AUTH_KEY: this.config.apiKey },
        timeoutMs: REQUEST_TIMEOUT_MS,
        maxBytes: MAX_RESPONSE_BYTES,
      });
    } catch (error) {
      throw new KrxApiError(error instanceof HttpJsonError ? error.message : 'network_error', error instanceof HttpJsonError ? error.status : undefined);
    }
    const body = response.body && typeof response.body === 'object' && !Array.isArray(response.body) ? (response.body as Record<string, unknown>) : null;
    if (!response.ok || !body) {
      throw new KrxApiError('request_failed', response.status, safeCode(body?.respCode));
    }
    return body;
  }
}
