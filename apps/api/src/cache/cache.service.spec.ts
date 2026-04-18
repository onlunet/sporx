const redisMock = {
  on: jest.fn(),
  get: jest.fn(),
  set: jest.fn(),
  sadd: jest.fn(),
  expire: jest.fn(),
  smembers: jest.fn(),
  del: jest.fn(),
  incr: jest.fn(),
  ttl: jest.fn(),
  eval: jest.fn(),
  quit: jest.fn()
};

jest.mock("ioredis", () => {
  return jest.fn().mockImplementation(() => redisMock);
});

import { CacheService } from "./cache.service";

describe("CacheService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    redisMock.smembers.mockResolvedValue([]);
  });

  it("can invalidate tag with no keys", async () => {
    const cache = new CacheService();
    await expect(cache.invalidateTag("matches")).resolves.toBeUndefined();
  });

  it("increments rate limit and returns hit counts", async () => {
    const cache = new CacheService();
    redisMock.incr.mockResolvedValue(3);
    redisMock.ttl.mockResolvedValue(20);

    const result = await cache.incrementRateLimit("api-default:127.0.0.1", 60);

    expect(result.hits).toBe(3);
    expect(result.remainingSeconds).toBe(20);
  });

  it("acquires and releases distributed lock safely", async () => {
    const cache = new CacheService();
    redisMock.set.mockResolvedValue("OK");
    redisMock.eval.mockResolvedValue(1);

    await expect(cache.acquireLock("jobs", "owner-1", 1000)).resolves.toBe(true);
    await expect(cache.releaseLock("jobs", "owner-1")).resolves.toBe(true);
  });

  it("renews distributed lock when owner matches", async () => {
    const cache = new CacheService();
    redisMock.eval.mockResolvedValue(1);

    await expect(cache.renewLock("jobs", "owner-1", 1000)).resolves.toBe(true);
  });
});
