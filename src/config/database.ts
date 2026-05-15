import { Pool } from 'pg';
import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

export const pgPool = new Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
  user: process.env.POSTGRES_USER || 'nanourl',
  password: process.env.POSTGRES_PASSWORD || 'secret123',
  database: process.env.POSTGRES_DB || 'nanourl',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  },
});

export async function checkHealth(): Promise<{ postgres: boolean; redis: boolean }> {
  let postgres = false;
  let redisHealth = false;

  try {
    const client = await pgPool.connect();
    await client.query('SELECT 1');
    client.release();
    postgres = true;
  } catch (error) {
    console.error('PostgreSQL health check failed:', error);
  }

  try {
    await redis.ping();
    redisHealth = true;
  } catch (error) {
    console.error('Redis health check failed:', error);
  }

  return { postgres, redis: redisHealth };
}