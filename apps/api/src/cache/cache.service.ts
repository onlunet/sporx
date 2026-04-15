import { Injectable, OnModuleDestroy } from "@nestjs/common";
import Redis from "ioredis";

type MemoryEntry = {
  value: string;
  expiresAtMs: number;
};

type MemoryLockEntry = {
  owner: string;
  expiresAtMs: number;
};

type MemoryRateLimitEntry = {
  hits: number;
  expiresAtMs: number;
};

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 800,
    lazyConnect: false,
    retryStrategy: (attempt) => (attempt <= 1 ? 200 : null)
  });
  private redisAvailable = true;
  private readonly memoryStore = new Map<string, MemoryEntry>();
  private readonly memoryTagIndex = new Map<string, Set<string>>();
  private readonly memoryLocks = new Map<string, MemoryLockEntry>();
  private readonly memoryRateLimit = new Map<string, MemoryRateLimitEntry>();
  private static readonly RELEASE_LOCK_LUA = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

  constructor() {
    this.redis.on("ready", () => {
      this.redisAvailable = true;
    });
    this.redis.on("error", () => {
      this.redisAvailable = false;
    });
    this.redis.on("close", () => {
      this.redisAvailable = false;
    });
  }

  private now() {
    return Date.now();
  }

  private memoryGetRaw(key: string) {
    const entry = this.memoryStore.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAtMs <= this.now()) {
      this.memoryStore.delete(key);
      return null;
    }
    return entry.value;
  }

  private memorySetRaw(key: string, value: string, ttlSeconds: number, tags: string[] = []) {
    const expiresAtMs = this.now() + Math.max(1, ttlSeconds) * 1000;
    this.memoryStore.set(key, { value, expiresAtMs });
    for (const tag of tags) {
      const bucket = this.memoryTagIndex.get(tag) ?? new Set<string>();
      bucket.add(key);
      this.memoryTagIndex.set(tag, bucket);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const memoryValue = this.memoryGetRaw(key);
    if (memoryValue) {
      try {
        return JSON.parse(memoryValue) as T;
      } catch {
        this.memoryStore.delete(key);
      }
    }

    if (!this.redisAvailable) {
      return null;
    }

    try {
      const value = await this.redis.get(key);
      if (!value) {
        return null;
      }
      this.memorySetRaw(key, value, 15);
      return JSON.parse(value) as T;
    } catch {
      this.redisAvailable = false;
      return null;
    }
  }

  async set(key: string, value: unknown, ttlSeconds: number, tags: string[] = []) {
    const serialized = JSON.stringify(value);
    this.memorySetRaw(key, serialized, ttlSeconds, tags);

    if (!this.redisAvailable) {
      return;
    }

    try {
      await this.redis.set(key, serialized, "EX", ttlSeconds);
    } catch {
      this.redisAvailable = false;
      return;
    }

    for (const tag of tags) {
      try {
        await this.redis.sadd(`cache:tag:${tag}`, key);
        await this.redis.expire(`cache:tag:${tag}`, ttlSeconds);
      } catch {
        this.redisAvailable = false;
        break;
      }
    }
  }

  async invalidateTag(tag: string) {
    const memoryKeys = this.memoryTagIndex.get(tag);
    if (memoryKeys) {
      for (const key of memoryKeys) {
        this.memoryStore.delete(key);
      }
      this.memoryTagIndex.delete(tag);
    }

    if (!this.redisAvailable) {
      return;
    }

    const tagKey = `cache:tag:${tag}`;
    let keys: string[] = [];
    try {
      keys = await this.redis.smembers(tagKey);
    } catch {
      this.redisAvailable = false;
      return;
    }

    try {
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      await this.redis.del(tagKey);
    } catch {
      this.redisAvailable = false;
    }
  }

  async incrementRateLimit(key: string, windowSeconds: number) {
    const namespacedKey = `ratelimit:${key}`;
    if (this.redisAvailable) {
      try {
        const hits = await this.redis.incr(namespacedKey);

        if (hits === 1) {
          await this.redis.expire(namespacedKey, windowSeconds);
        }

        const ttl = await this.redis.ttl(namespacedKey);
        return {
          hits,
          remainingSeconds: ttl > 0 ? ttl : windowSeconds
        };
      } catch {
        this.redisAvailable = false;
      }
    }

    const now = this.now();
    const existing = this.memoryRateLimit.get(namespacedKey);
    if (!existing || existing.expiresAtMs <= now) {
      this.memoryRateLimit.set(namespacedKey, {
        hits: 1,
        expiresAtMs: now + windowSeconds * 1000
      });
      return {
        hits: 1,
        remainingSeconds: windowSeconds
      };
    }

    existing.hits += 1;
    const remainingSeconds = Math.max(1, Math.ceil((existing.expiresAtMs - now) / 1000));
    return {
      hits: existing.hits,
      remainingSeconds
    };
  }

  async acquireLock(key: string, owner: string, ttlMs: number) {
    const namespaced = `lock:${key}`;
    if (this.redisAvailable) {
      try {
        const response = await this.redis.set(namespaced, owner, "PX", ttlMs, "NX");
        return response === "OK";
      } catch {
        this.redisAvailable = false;
      }
    }

    const now = this.now();
    const existing = this.memoryLocks.get(namespaced);
    if (existing && existing.expiresAtMs > now) {
      return false;
    }
    this.memoryLocks.set(namespaced, { owner, expiresAtMs: now + ttlMs });
    return true;
  }

  async releaseLock(key: string, owner: string) {
    const namespaced = `lock:${key}`;
    if (this.redisAvailable) {
      try {
        const response = await this.redis.eval(CacheService.RELEASE_LOCK_LUA, 1, namespaced, owner);
        return response === 1;
      } catch {
        this.redisAvailable = false;
      }
    }

    const existing = this.memoryLocks.get(namespaced);
    if (!existing || existing.owner !== owner) {
      return false;
    }
    this.memoryLocks.delete(namespaced);
    return true;
  }

  async onModuleDestroy() {
    try {
      await this.redis.quit();
    } catch {
      // no-op
    }
  }
}
