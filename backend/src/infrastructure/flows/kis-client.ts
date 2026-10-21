// 한국투자증권(KIS) Open API 클라이언트 (docs/Task_ORDER.md 11단계 A, D-42, D-43)
//
// 보안 원칙 (D-43, D-51):
// - 앱 키·시크릿은 환경변수(KIS_APP_KEY, KIS_APP_SECRET)로만 받는다. 값은 사용자가 프로젝트 루트 `.env`에 직접 넣고,
//   docker-compose가 변수 치환으로 이 컨테이너(flows-collector)에만 넘긴다.
// - 키·시크릿·접근 토큰은 메모리에만 두고, 로그·지표·Kafka 메시지·에러 메시지에 절대 넣지 않는다.
//   에러에는 HTTP 상태와 KIS 응답 코드(msg_cd)만 남긴다.
// - 시세 조회(GET)만 한다. 주문 API는 이 코드에 없다.
// - 호출은 공통 함수(http-json.ts)로 한다 (docs/security.md SEC-013): 리다이렉트를 따라가지 않아서
//   헤더의 키·시크릿과 토큰 요청 본문이 다른 주소로 가지 않고, 응답 크기·대기 시간을 제한한다.

import { fetchJson, HttpJsonError, type FetchJsonInit } from '../http-json.js';

const BASE_URLS = {
  // 모의투자(기본). 주문 권한 사고를 막기 위해 가능하면 모의투자 키로 시세를 받는다 (D-43)
  vps: 'https://openapivts.koreainvestment.com:29443',
  prod: 'https://openapi.koreainvestment.com:9443',
} as const;

export type KisEnv = keyof typeof BASE_URLS;

const REQUEST_TIMEOUT_MS = 5000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 시세 응답은 수십 KB 수준
// 접근 토큰은 1분에 1번만 발급된다 (공식 예제 저장소, T-57)
const TOKEN_ISSUE_MIN_INTERVAL_MS = 61_000;
// 만료 직전에 갱신한다
const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000;

export class KisApiError extends Error {
  constructor(message: string, readonly status: number | undefined = undefined, readonly code: string | undefined = undefined) {
    super(message);
  }
}

export interface KisConfig {
  appKey: string;
  appSecret: string;
  env: KisEnv;
}

// 환경변수에서 설정을 읽는다. 키가 없으면 null (수집기는 대기 상태로 뜬다).
export function readKisConfig(): KisConfig | null {
  const appKey = process.env.KIS_APP_KEY?.trim();
  const appSecret = process.env.KIS_APP_SECRET?.trim();
  if (!appKey || !appSecret) return null;
  const env: KisEnv = process.env.KIS_ENV === 'prod' ? 'prod' : 'vps';
  return { appKey, appSecret, env };
}

// 응답 코드는 짧은 영문·숫자만 남긴다 (임의 문자열이 로그에 들어가지 않게)
const safeCode = (value: unknown) => (typeof value === 'string' && /^[A-Za-z0-9_-]{1,20}$/.test(value) ? value : undefined);

// 공통 함수로 호출한다. 실패하면 종류와 HTTP 상태만 담은 KisApiError (키·URL·본문 없음)
async function call(url: string, init: Omit<FetchJsonInit, 'timeoutMs' | 'maxBytes'>) {
  try {
    const response = await fetchJson(url, { ...init, timeoutMs: REQUEST_TIMEOUT_MS, maxBytes: MAX_RESPONSE_BYTES });
    const body = response.body && typeof response.body === 'object' && !Array.isArray(response.body) ? (response.body as Record<string, unknown>) : {};
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    throw new KisApiError(error instanceof HttpJsonError ? error.message : 'network_error', error instanceof HttpJsonError ? error.status : undefined);
  }
}

export class KisClient {
  private token: string | undefined;
  private tokenExpiresAt = 0;
  private lastTokenIssuedAt = 0;

  constructor(private readonly config: KisConfig) {}

  get env() {
    return this.config.env;
  }

  private async ensureToken() {
    const now = Date.now();
    if (this.token && now < this.tokenExpiresAt - TOKEN_REFRESH_MARGIN_MS) return this.token;
    if (now - this.lastTokenIssuedAt < TOKEN_ISSUE_MIN_INTERVAL_MS) {
      if (this.token) return this.token; // 아직 쓸 수 있으면 그대로 쓴다
      throw new KisApiError('token_rate_limited');
    }

    this.lastTokenIssuedAt = now;
    const { ok, status, body } = await call(`${BASE_URLS[this.config.env]}/oauth2/tokenP`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ grant_type: 'client_credentials', appkey: this.config.appKey, appsecret: this.config.appSecret }),
    });
    if (!ok || typeof body.access_token !== 'string') {
      throw new KisApiError('token_failed', status, safeCode(body.error_code));
    }
    const expiresInSeconds = typeof body.expires_in === 'number' ? body.expires_in : 3600;
    this.token = body.access_token;
    this.tokenExpiresAt = now + expiresInSeconds * 1000;
    return this.token;
  }

  // 시세 조회 (GET). 응답 본문(JSON)을 그대로 돌려준다.
  async get(path: string, trId: string, params: Record<string, string>): Promise<Record<string, unknown>> {
    const token = await this.ensureToken();
    const { ok, status, body } = await call(`${BASE_URLS[this.config.env]}${path}?${new URLSearchParams(params).toString()}`, {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        authorization: `Bearer ${token}`,
        appkey: this.config.appKey,
        appsecret: this.config.appSecret,
        tr_id: trId,
        custtype: 'P',
      },
    });
    const code = safeCode(body.msg_cd);
    if (!ok || body.rt_cd !== '0') {
      // 토큰이 만료·무효면 다음 호출에서 다시 발급하도록 비운다
      if (status === 401 || code === 'EGW00123') this.token = undefined;
      throw new KisApiError('request_failed', status, code);
    }
    return body;
  }
}
