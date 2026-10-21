// 증시 자금 흐름: 시장별 투자자 순매수 (docs/Task_ORDER.md 11단계 A, D-47, D-53)
// 소스별 어댑터가 이 공통 형식으로 정규화하고, Kafka `investor-flows`를 거쳐 DB·화면으로 간다.
// 금액 단위는 소스 단위(백만원)를 그대로 쓴다. 화면에서 억원으로 바꾼다.

export const FLOW_MARKETS = ['KOSPI', 'KOSDAQ'] as const;
export type FlowMarket = (typeof FLOW_MARKETS)[number];

// provisional: 장중 잠정치, final: 장 마감 후 확정치 (B단계)
export const FLOW_STATUSES = ['provisional', 'final'] as const;
export type FlowStatus = (typeof FLOW_STATUSES)[number];

export interface InvestorFlow {
  market: FlowMarket;
  time: number;            // 기준 시각 (ms). 장중 잠정치는 수집 시각을 분 단위로 내림한 값
  foreignNet: number;      // 외국인 순매수 금액 (백만원, 순매도면 음수)
  institutionNet: number;  // 기관계 순매수 금액 (백만원)
  individualNet: number;   // 개인 순매수 금액 (백만원)
  status: FlowStatus;
  source: 'kis';
  collectedAt?: number;
  producedAt?: number;
}

const MARKET_SET = new Set<string>(FLOW_MARKETS);
const STATUS_SET = new Set<string>(FLOW_STATUSES);

export const isFlowMarket = (value: unknown): value is FlowMarket => typeof value === 'string' && MARKET_SET.has(value);

// Socket.io 방 이름: 시세 심볼과 겹치지 않게 접두어를 붙인다 (SEC-005 허용 목록에 포함)
export const flowRoom = (market: FlowMarket) => `flows:${market}`;
export const FLOW_ROOMS = FLOW_MARKETS.map(flowRoom);

export type FlowParseResult = { ok: true; flow: InvestorFlow } | { ok: false; reason: string };

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPositiveNumber = (value: unknown): value is number => isFiniteNumber(value) && value > 0;
const fail = (reason: string): FlowParseResult => ({ ok: false, reason });

// Kafka 메시지 검증. Gateway와 DB Sink가 같은 함수를 쓰고, 실패하면 사유를 돌려준다(예외를 던지지 않음, SEC-002).
// 순매수는 음수(순매도)와 0이 정상값이다.
export function parseInvestorFlow(value: Buffer | null): FlowParseResult {
  if (!value || value.length === 0) return fail('empty');

  let data: unknown;
  try {
    data = JSON.parse(value.toString());
  } catch {
    return fail('invalid_json');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return fail('not_object');

  const record = data as Record<string, unknown>;
  const { market, time, foreignNet, institutionNet, individualNet, status, source, collectedAt, producedAt } = record;

  if (!isFlowMarket(market)) return fail('market');
  if (!isPositiveNumber(time)) return fail('time');
  if (!isFiniteNumber(foreignNet)) return fail('foreign_net');
  if (!isFiniteNumber(institutionNet)) return fail('institution_net');
  if (!isFiniteNumber(individualNet)) return fail('individual_net');
  if (typeof status !== 'string' || !STATUS_SET.has(status)) return fail('status');
  if (source !== 'kis') return fail('source');
  if (collectedAt !== undefined && !isPositiveNumber(collectedAt)) return fail('collected_at');
  if (producedAt !== undefined && !isPositiveNumber(producedAt)) return fail('produced_at');

  // 알려진 필드만 남긴다 (임의 필드가 브라우저까지 전달되지 않음)
  const flow: InvestorFlow = { market, time, foreignNet, institutionNet, individualNet, status: status as FlowStatus, source };
  if (collectedAt !== undefined) flow.collectedAt = collectedAt as number;
  if (producedAt !== undefined) flow.producedAt = producedAt as number;
  return { ok: true, flow };
}
