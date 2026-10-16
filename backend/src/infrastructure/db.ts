import pg from 'pg';

const { Pool } = pg;

export const dbPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'kospi',
  password: process.env.DB_PASSWORD || 'password',
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

// 버전별 스키마 마이그레이션 (docs/Task_ORDER.md T-15 ~ T-18)
// 실행한 버전은 schema_migrations에 기록되어 한 번만 실행된다.
// 연속 집계(continuous aggregate) 관련 문장은 트랜잭션 안에서 실행할 수 없어서 문장 단위로 실행한다.
interface Migration {
  version: number;
  name: string;
  statements: string[];
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'base schema (market_ticks hypertable)',
    statements: [
      `CREATE TABLE IF NOT EXISTS market_ticks (
        time TIMESTAMPTZ NOT NULL,
        symbol TEXT NOT NULL,
        category TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        change_rate DOUBLE PRECISION NOT NULL,
        change_price DOUBLE PRECISION NOT NULL,
        volume BIGINT
      )`,
      `SELECT create_hypertable('market_ticks', 'time', if_not_exists => TRUE)`,
    ],
  },
  {
    version: 2,
    name: 'T-18 reset, T-15 unique (symbol, time), T-16 hierarchical aggregates, T-17 retention',
    statements: [
      // T-18 (D-22, 2026-10-16 사용자 승인): 중복·잘못된 심볼·0값이 섞인 기존 데이터를 삭제한다.
      // 이 마이그레이션은 한 번만 실행되므로 이후 기동에서는 데이터를 지우지 않는다.
      `TRUNCATE market_ticks`,
      // T-15: 같은 심볼·시각의 중복을 막는다. 심볼별 시간 범위 조회 인덱스도 겸한다 (P-14).
      `CREATE UNIQUE INDEX IF NOT EXISTS market_ticks_symbol_time_key ON market_ticks (symbol, time)`,
      // T-17: 원본은 몇 시간만 보관하므로 청크를 작게 잡아 바로 지울 수 있게 한다 (D-02).
      `SELECT set_chunk_time_interval('market_ticks', INTERVAL '1 hour')`,
      // T-16 (D-23): 원본 → 5분 → 1시간 → 1일 계층형 집계.
      // 1일 봉을 원본에서 바로 만들면, 원본이 3시간 뒤 지워진 상태에서 갱신할 때 하루치 봉이 망가진다.
      `CREATE MATERIALIZED VIEW IF NOT EXISTS market_5m
       WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
       SELECT time_bucket(INTERVAL '5 minutes', time) AS bucket,
              symbol,
              first(price, time) AS open,
              max(price) AS high,
              min(price) AS low,
              last(price, time) AS close,
              count(*) AS ticks
       FROM market_ticks
       GROUP BY time_bucket(INTERVAL '5 minutes', time), symbol
       WITH NO DATA`,
      `CREATE MATERIALIZED VIEW IF NOT EXISTS market_1h
       WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
       SELECT time_bucket(INTERVAL '1 hour', bucket) AS bucket,
              symbol,
              first(open, bucket) AS open,
              max(high) AS high,
              min(low) AS low,
              last(close, bucket) AS close,
              sum(ticks) AS ticks
       FROM market_5m
       GROUP BY time_bucket(INTERVAL '1 hour', bucket), symbol
       WITH NO DATA`,
      `CREATE MATERIALIZED VIEW IF NOT EXISTS market_1d
       WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
       SELECT time_bucket(INTERVAL '1 day', bucket) AS bucket,
              symbol,
              first(open, bucket) AS open,
              max(high) AS high,
              min(low) AS low,
              last(close, bucket) AS close,
              sum(ticks) AS ticks
       FROM market_1h
       GROUP BY time_bucket(INTERVAL '1 day', bucket), symbol
       WITH NO DATA`,
      // 갱신 정책: 각 집계는 바로 아래 단계가 보관하는 범위 안에서만 다시 계산한다.
      `SELECT add_continuous_aggregate_policy('market_5m',
         start_offset => INTERVAL '2 hours', end_offset => INTERVAL '5 minutes',
         schedule_interval => INTERVAL '1 minute', if_not_exists => true)`,
      `SELECT add_continuous_aggregate_policy('market_1h',
         start_offset => INTERVAL '2 days', end_offset => INTERVAL '1 hour',
         schedule_interval => INTERVAL '5 minutes', if_not_exists => true)`,
      `SELECT add_continuous_aggregate_policy('market_1d',
         start_offset => INTERVAL '7 days', end_offset => INTERVAL '1 day',
         schedule_interval => INTERVAL '1 hour', if_not_exists => true)`,
      // T-17 보관 정책: 원본 3시간(5분 봉 갱신 범위 2시간보다 길게, D-02), 집계 1년(매일 이동, D-01).
      `SELECT add_retention_policy('market_ticks', drop_after => INTERVAL '3 hours', if_not_exists => true)`,
      `SELECT add_retention_policy('market_5m', drop_after => INTERVAL '1 year', if_not_exists => true)`,
      `SELECT add_retention_policy('market_1h', drop_after => INTERVAL '1 year', if_not_exists => true)`,
      `SELECT add_retention_policy('market_1d', drop_after => INTERVAL '1 year', if_not_exists => true)`,
    ],
  },
];

// 마이그레이션이 실패하면 예외를 던진다. backend는 스키마 없이 뜨지 않고 종료한다 (restart: on-failure가 다시 시도).
export const initDB = async () => {
  const client = await dbPool.connect();
  try {
    await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb;');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);

    const { rows } = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map(row => row.version));

    for (const migration of MIGRATIONS) {
      if (applied.has(migration.version)) continue;
      console.log(`Applying DB migration ${migration.version}: ${migration.name}`);
      for (const statement of migration.statements) {
        await client.query(statement);
      }
      await client.query('INSERT INTO schema_migrations (version, name) VALUES ($1, $2)', [migration.version, migration.name]);
      console.log(`DB migration ${migration.version} applied.`);
    }

    const extension = await client.query<{ extversion: string }>(
      "SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'"
    );
    console.log(`TimescaleDB schema ready (extension ${extension.rows[0]?.extversion ?? 'unknown'}, migrations up to ${MIGRATIONS.length}).`);
  } finally {
    client.release();
  }
};
