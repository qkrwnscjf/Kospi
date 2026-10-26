// Prometheus 즉시 조회(instant query) 응답 해석 (docs/Task_ORDER.md T-112). 테스트할 수 있도록 순수 함수로 둔다.

export interface Sample { labels: Record<string, string>; value: number }

// 응답 본문 → 표본 목록. 형식이 다르면 null. 숫자가 아닌 값(NaN 등)은 버리고, 레이블 값은 길이를 자른다
export function parseVector(body: unknown): Sample[] | null {
  if (!body || typeof body !== 'object') return null;
  const { status, data } = body as Record<string, unknown>;
  if (status !== 'success' || !data || typeof data !== 'object') return null;
  const result = (data as Record<string, unknown>).result;
  if (!Array.isArray(result)) return null;
  return result.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const { metric, value } = item as Record<string, unknown>;
    const raw = Array.isArray(value) ? Number(value[1]) : Number.NaN;
    if (!Number.isFinite(raw)) return [];
    const labels: Record<string, string> = {};
    if (metric && typeof metric === 'object') {
      for (const [key, label] of Object.entries(metric as Record<string, unknown>)) if (typeof label === 'string') labels[key] = label.slice(0, 80);
    }
    return [{ labels, value: raw }];
  });
}

// 지표의 job 레이블은 Prometheus가 수집 대상의 job과 겹치면 exported_job으로 바꾼다
export const dbJobName = (labels: Record<string, string>) => labels.exported_job ?? labels.job ?? 'unknown';
