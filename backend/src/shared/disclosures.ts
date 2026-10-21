// DART 공시 (docs/Task_ORDER.md 12단계, R-16, D-56 ~ D-59)
// 수집기가 이 공통 형식으로 정규화하고, Kafka `disclosures`를 거쳐 DB·화면으로 간다.
// 개인 이름(공시 제출인 등)은 이 형식에 없다 (D-59 ⑤). 금액이 없으면 0이 아니라 null이다 (D-59 ④, R-04 원칙).

import { KOSPI100 } from './disclosure-targets.js';

// 분류 그룹 (D-59 ③)
export const DISCLOSURE_GROUPS = ['dilution', 'shareholder_return', 'treasury_disposal', 'earnings', 'ownership', 'other'] as const;
export type DisclosureGroup = (typeof DISCLOSURE_GROUPS)[number];

// 세부 종류. 금액을 조회하는 종류는 dart-disclosures.ts의 DETAIL_ENDPOINTS에 있다.
export const DISCLOSURE_KINDS = [
  'rights_offering', 'cb', 'bw', 'eb',            // 희석: 유상증자, 전환사채, 신주인수권부사채, 교환사채
  'buyback', 'buyback_trust', 'cancellation',     // 주주환원: 자사주 취득, 자사주 취득 신탁, 주식 소각
  'disposal',                                     // 자사주 처분
  'earnings', 'periodic_report',                  // 실적: 영업(잠정)실적·손익구조 변경, 정기보고서
  'ownership',                                    // 지분: 대량보유, 임원·주요주주 소유, 최대주주 변동
  'bonus_issue', 'other',                         // 기타: 무상증자, 그 밖의 공시
] as const;
export type DisclosureKind = (typeof DISCLOSURE_KINDS)[number];

export interface Disclosure {
  rceptNo: string;          // 접수번호 14자리 (DART 고유, 중복 제거 키)
  rceptDate: string;        // 접수일 YYYY-MM-DD (DART는 날짜만 제공)
  corpCode: string;         // DART 고유번호 8자리
  stockCode: string;        // 종목코드 6자리
  corpName: string;
  reportName: string;       // 공시 제목
  group: DisclosureGroup;
  kind: DisclosureKind;
  isCorrection: boolean;    // [기재정정] 등 정정 공시
  amount: number | null;    // 원. 금액이 없거나 조회하지 못하면 null
  market: 'KOSPI';
  live: boolean;            // 수집 주기에 새로 발견한 공시(true) / 시작 시 과거 채우기(false). 화면 실시간 전송은 true만
  collectedAt?: number;
  producedAt?: number;
}

// Socket.io 방 이름 (SEC-005 허용 목록에 포함)
export const DISCLOSURE_ROOM = 'disclosures:KOSPI';

// 대상 범위: KOSPI 100 명단이 있으면 그 종목만, 없으면 유가증권 전체 (D-57, 명단은 disclosure-targets.ts)
const TARGET_CODES = new Set<string>(KOSPI100.codes);
export const DISCLOSURE_SCOPE = TARGET_CODES.size > 0 ? 'kospi100' : 'kospi_all';
export const isTargetStock = (stockCode: string) => TARGET_CODES.size === 0 || TARGET_CODES.has(stockCode);
export const targetStockCodes = () => [...TARGET_CODES];

const GROUP_SET = new Set<string>(DISCLOSURE_GROUPS);
const KIND_SET = new Set<string>(DISCLOSURE_KINDS);
export const isDisclosureGroup = (value: unknown): value is DisclosureGroup => typeof value === 'string' && GROUP_SET.has(value);

export const RCEPT_NO_PATTERN = /^\d{14}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CORP_CODE_PATTERN = /^\d{8}$/;
// 종목코드: 숫자 6자리. 최근 상장 종목은 영문이 섞인 6자리도 있다
const STOCK_CODE_PATTERN = /^[0-9A-Z]{6}$/;
// 제어 문자가 없는 짧은 문자열만 받는다
const isText = (value: unknown, max: number): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const isPositiveNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

export type DisclosureParseResult = { ok: true; disclosure: Disclosure } | { ok: false; reason: string };
const fail = (reason: string): DisclosureParseResult => ({ ok: false, reason });

// Kafka 메시지 검증. Gateway와 DB Sink가 같은 함수를 쓰고, 실패하면 사유를 돌려준다(예외를 던지지 않음, SEC-002).
export function parseDisclosure(value: Buffer | null): DisclosureParseResult {
  if (!value || value.length === 0) return fail('empty');

  let data: unknown;
  try {
    data = JSON.parse(value.toString());
  } catch {
    return fail('invalid_json');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return fail('not_object');

  const r = data as Record<string, unknown>;
  if (typeof r.rceptNo !== 'string' || !RCEPT_NO_PATTERN.test(r.rceptNo)) return fail('rcept_no');
  if (typeof r.rceptDate !== 'string' || !DATE_PATTERN.test(r.rceptDate)) return fail('rcept_date');
  if (typeof r.corpCode !== 'string' || !CORP_CODE_PATTERN.test(r.corpCode)) return fail('corp_code');
  if (typeof r.stockCode !== 'string' || !STOCK_CODE_PATTERN.test(r.stockCode)) return fail('stock_code');
  if (!isText(r.corpName, 100)) return fail('corp_name');
  if (!isText(r.reportName, 300)) return fail('report_name');
  if (typeof r.group !== 'string' || !GROUP_SET.has(r.group)) return fail('group');
  if (typeof r.kind !== 'string' || !KIND_SET.has(r.kind)) return fail('kind');
  if (typeof r.isCorrection !== 'boolean') return fail('is_correction');
  if (r.amount !== null && !(typeof r.amount === 'number' && Number.isFinite(r.amount) && r.amount >= 0)) return fail('amount');
  if (r.market !== 'KOSPI') return fail('market');
  if (typeof r.live !== 'boolean') return fail('live');
  if (r.collectedAt !== undefined && !isPositiveNumber(r.collectedAt)) return fail('collected_at');
  if (r.producedAt !== undefined && !isPositiveNumber(r.producedAt)) return fail('produced_at');

  // 알려진 필드만 남긴다 (임의 필드가 브라우저까지 전달되지 않음)
  const disclosure: Disclosure = {
    rceptNo: r.rceptNo,
    rceptDate: r.rceptDate,
    corpCode: r.corpCode,
    stockCode: r.stockCode,
    corpName: r.corpName,
    reportName: r.reportName,
    group: r.group as DisclosureGroup,
    kind: r.kind as DisclosureKind,
    isCorrection: r.isCorrection,
    amount: r.amount as number | null,
    market: 'KOSPI',
    live: r.live,
  };
  if (r.collectedAt !== undefined) disclosure.collectedAt = r.collectedAt as number;
  if (r.producedAt !== undefined) disclosure.producedAt = r.producedAt as number;
  return { ok: true, disclosure };
}
