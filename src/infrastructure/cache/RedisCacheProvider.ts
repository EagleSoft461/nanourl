import Redis from "ioredis";
import { CacheProvider } from "./cacheProvider";

export class RedisCacheProvider implements CacheProvider {
    constructor(private readonly redis: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);

    if (!value) {
      return null;
    }

    return JSON.parse(value) as T;
  }

  async set(
    key: string,
    value: unknown,
    ttlSeconds?: number
  ): Promise<void> {
    const serialized = JSON.stringify(value);

    if (ttlSeconds) {
      await this.redis.set(
        key,
        serialized,
        "EX",
        ttlSeconds
      );
      return;
    }

    await this.redis.set(key, serialized);
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }
}