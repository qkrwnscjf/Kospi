import type { TickData } from './types.js';

// Kafka 메시지 검증 (docs/Task_ORDER.md T-13, SEC-002)
// Gateway와 DB Sink가 같은 함수를 쓴다. 검증에 실패한 메시지는 예외를 던지지 않고 사유를 돌려준다.

const SYMBOL_PATTERN = /^[A-Z0-9/_]{1,20}$/;
const CATEGORIES = new Set(['domestic', 'macro', 'global', 'sector']);

export type TickParseResult = { ok: true; tick: TickData } | { ok: false; reason: string };

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPositiveNumber = (value: unknown): value is number => isFiniteNumber(value) && value > 0;
const fail = (reason: string): TickParseResult => ({ ok: false, reason });

export function parseTick(value: Buffer | null): TickParseResult {
  if (!value || value.length === 0) return fail('empty');

  let data: unknown;
  try {
    data = JSON.parse(value.toString());
  } catch {
    return fail('invalid_json');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return fail('not_object');

  const record = data as Record<string, unknown>;
  const { symbol, category, price, changeRate, timestamp, changePrice, volume, collectedAt, producedAt } = record;

  if (typeof symbol !== 'string' || !SYMBOL_PATTERN.test(symbol)) return fail('symbol');
  if (typeof category !== 'string' || !CATEGORIES.has(category)) return fail('category');
  if (!isPositiveNumber(price)) return fail('price');
  if (!isFiniteNumber(changeRate)) return fail('change_rate');
  if (!isPositiveNumber(timestamp)) return fail('timestamp');
  // 선택 필드는 없어도 되지만, 있으면 유한한 숫자여야 한다.
  if (changePrice !== undefined && !isFiniteNumber(changePrice)) return fail('change_price');
  if (volume !== undefined && !isFiniteNumber(volume)) return fail('volume');
  if (collectedAt !== undefined && !isPositiveNumber(collectedAt)) return fail('collected_at');
  if (producedAt !== undefined && !isPositiveNumber(producedAt)) return fail('produced_at');

  // 선택 필드는 위에서 "없거나 유한한 숫자"임을 확인했으므로 number로 다룬다.
  const tick: TickData = { symbol, category, price, changeRate, timestamp };
  if (changePrice !== undefined) tick.changePrice = changePrice as number;
  if (volume !== undefined) tick.volume = volume as number;
  if (collectedAt !== undefined) tick.collectedAt = collectedAt as number;
  if (producedAt !== undefined) tick.producedAt = producedAt as number;
  return { ok: true, tick };
}
