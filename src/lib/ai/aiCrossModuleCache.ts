import type { FederatedResult } from './aiCrossModuleTypes';

interface CacheEntry {
  result: FederatedResult;
  expiresAt: number;
}

export class CrossModuleCache {
  private static instance: CrossModuleCache;
  private cache = new Map<string, CacheEntry>();
  private defaultTTLMs = 120 * 1000; // 2 minutes TTL

  public static getInstance(): CrossModuleCache {
    if (!CrossModuleCache.instance) {
      CrossModuleCache.instance = new CrossModuleCache();
    }
    return CrossModuleCache.instance;
  }

  private buildKey(userId: string, queryPlanId: string, paramsHash: string): string {
    return `${userId}:${queryPlanId}:${paramsHash}`;
  }

  public get(userId: string, queryPlanId: string, paramsHash: string): FederatedResult | null {
    const key = this.buildKey(userId, queryPlanId, paramsHash);
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return {
      ...entry.result,
      fromCache: true,
    };
  }

  public set(userId: string, queryPlanId: string, paramsHash: string, result: FederatedResult, ttlMs?: number): void {
    const key = this.buildKey(userId, queryPlanId, paramsHash);
    const expiresAt = Date.now() + (ttlMs || this.defaultTTLMs);
    this.cache.set(key, { result, expiresAt });
  }

  public invalidateAll(): void {
    this.cache.clear();
  }

  public invalidateUser(userId: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(`${userId}:`)) {
        this.cache.delete(key);
      }
    }
  }
}
