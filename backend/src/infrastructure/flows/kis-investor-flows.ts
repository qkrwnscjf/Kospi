// KIS "시장별 투자자매매동향(시세)" → InvestorFlow 정규화 (docs/Task_ORDER.md 11단계 A, T-57)
//
// ⚠️ 미확인 사항 (T-57): 요청 파라미터의 시장 코드와 응답 필드 이름은 공식 문서로 확인하지 못했다.
// - API 경로와 TR ID는 공식 예제 저장소에서 확인했다.
// - 시장 코드 기본값과 필드 이름은 KIS의 다른 투자자 API 명명 규칙을 따른 가정이다. 환경변수로 바꿀 수 있게 하고,
//   첫 응답에서 필드 이름(값 제외)을 한 번 로그로 남겨 확정한다.
// - 필드가 맞지 않으면 값을 0으로 채우지 않고 실패로 처리한다(잘못된 값이 화면에 나가지 않게).

import type { KisClient } from './kis-client.js';
import type { FlowMarket, InvestorFlow } from '../../shared/flows.js';

const PATH = '/uapi/domestic-stock/v1/quotations/inquire-investor-time-by-market';
const TR_ID = 'FHPTJ04030000';

// 시장별 요청 파라미터 (가정, 환경변수로 덮어쓸 수 있음)
const MARKET_PARAMS: Record<FlowMarket, { iscd: string; iscd2: string }> = {
  KOSPI: {
    iscd: process.env.KIS_FLOW_KOSPI_ISCD ?? '0001',
    iscd2: process.env.KIS_FLOW_KOSPI_ISCD2 ?? 'S001',
  },
  KOSDAQ: {
    iscd: process.env.KIS_FLOW_KOSDAQ_ISCD ?? '1001',
    iscd2: process.env.KIS_FLOW_KOSDAQ_ISCD2 ?? 'S001',
  },
};

// 응답 필드 이름 (가정). 순매수 거래대금(백만원)
export const FIELD_MAP = {
  foreignNet: 'frgn_ntby_tr_pbmn',
  institutionNet: 'orgn_ntby_tr_pbmn',
  individualNet: 'prsn_ntby_tr_pbmn',
} as const;

export type MappingResult = { ok: true; values: Pick<InvestorFlow, 'foreignNet' | 'institutionNet' | 'individualNet'> } | { ok: false; reason: string };

// 숫자 문자열을 숫자로. 빈 값·숫자가 아닌 값은 null (0으로 대체하지 않음, D-14와 같은 원칙)
function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

// 응답의 output에서 첫 행을 꺼낸다. 배열이면 첫 원소(가장 최근으로 가정), 객체면 그대로.
export function firstRow(body: Record<string, unknown>): Record<string, unknown> | null {
  const output = body.output ?? body.output1;
  if (Array.isArray(output)) {
    const first = output[0];
    return first && typeof first === 'object' ? (first as Record<string, unknown>) : null;
  }
  return output && typeof output === 'object' ? (output as Record<string, unknown>) : null;
}

// 순수 함수 (테스트 대상): 응답 행 → 순매수 값
export function mapInvestorRow(row: Record<string, unknown> | null): MappingResult {
  if (!row) return { ok: false, reason: 'no_output' };
  const foreignNet = toNumber(row[FIELD_MAP.foreignNet]);
  const institutionNet = toNumber(row[FIELD_MAP.institutionNet]);
  const individualNet = toNumber(row[FIELD_MAP.individualNet]);
  if (foreignNet === null) return { ok: false, reason: 'field_foreign' };
  if (institutionNet === null) return { ok: false, reason: 'field_institution' };
  if (individualNet === null) return { ok: false, reason: 'field_individual' };
  return { ok: true, values: { foreignNet, institutionNet, individualNet } };
}

const loggedFieldNames = new Set<FlowMarket>();

export async function fetchInvestorFlow(client: KisClient, market: FlowMarket, now: number): Promise<InvestorFlow | { error: string }> {
  const params = MARKET_PARAMS[market];
  const body = await client.get(PATH, TR_ID, { FID_INPUT_ISCD: params.iscd, FID_INPUT_ISCD_2: params.iscd2 });
  const row = firstRow(body);

  // 필드 매핑 확정용: 첫 응답의 필드 이름만 한 번 남긴다 (값은 남기지 않음)
  if (!loggedFieldNames.has(market)) {
    loggedFieldNames.add(market);
    console.log(`[flows] ${market} response fields: ${row ? Object.keys(row).join(',') : '(no output)'}`);
  }

  const mapped = mapInvestorRow(row);
  if (!mapped.ok) return { error: mapped.reason };

  return {
    market,
    time: Math.floor(now / 60_000) * 60_000, // 분 단위로 내림 (같은 분의 반복 수집은 같은 키로 덮어씀)
    ...mapped.values,
    status: 'provisional',
    source: 'kis',
  };
}
