import pg from 'pg';

const { Pool } = pg;

export const dbPool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'kospi',
  password: process.env.DB_PASSWORD || 'password',
  port: parseInt(process.env.DB_PORT || '5432', 10),
});

export const initDB = async () => {
  const client = await dbPool.connect();
  try {
    // Enable TimescaleDB extension
    await client.query('CREATE EXTENSION IF NOT EXISTS timescaledb;');
    
    // Create the market_ticks table
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_ticks (
        time TIMESTAMPTZ NOT NULL,
        symbol TEXT NOT NULL,
        category TEXT NOT NULL,
        price DOUBLE PRECISION NOT NULL,
        change_rate DOUBLE PRECISION NOT NULL,
        change_price DOUBLE PRECISION NOT NULL,
        volume BIGINT
      );
    `);

    // Turn into hypertable
    await client.query(`
      SELECT create_hypertable('market_ticks', 'time', if_not_exists => TRUE);
    `);
    
    console.log('TimescaleDB schema initialized successfully');
  } catch (err) {
    console.error('Failed to initialize TimescaleDB schema:', err);
  } finally {
    client.release();
  }
};
