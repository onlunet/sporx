import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
  private static readonly RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

  async get<T>(key: string): Promise<T | null> {
    const value = await this.redis.get(key);
    if (!value) {
      return null;
    }

    try {
      return JSON.parse(value) as T;
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number, tags: string[] = []) {
    await this.redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    for (const tag of tags) {
      await this.redis.sadd(`cache:tag:${tag}`, key);
      await this.redis.expire(`cache:tag:${tag}`, ttlSeconds);
    }
  }

  async invalidateTag(tag: string) {
    const tagKey = `cache:tag:${tag}`;
    const keys = await this.redis.smembers(tagKey);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
    await this.redis.del(tagKey);
  }

  async incrementRateLimit(key: string, windowSeconds: number) {
    const namespacedKey = `ratelimit:${key}`;
    const hits = await this.redis.incr(namespacedKey);

    if (hits === 1) {
      await this.redis.expire(namespacedKey, windowSeconds);
    }

    const ttl = await this.redis.ttl(namespacedKey);
    return {
      hits,
      remainingSeconds: ttl > 0 ? ttl : windowSeconds
    };
  }

  async acquireLock(key: string, owner: string, ttlMs: number) {
    const response = await this.redis.set(`lock:${key}`, owner, "PX", ttlMs, "NX");
    return response === "OK";
  }

  async releaseLock(key: string, owner: string) {
    const response = await this.redis.eval(CacheService.RELEASE_LOCK_LUA, 1, `lock:${key}`, owner);
    return response === 1;
  }

  async onModuleDestroy() {
    await this.redis.quit();
  }
}
