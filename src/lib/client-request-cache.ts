type CacheEntry = {
  url: string;
  expiresAt: number;
  value?: unknown;
  pending?: Promise<unknown>;
};

export class ClientRequestCache {
  private readonly entries = new Map<string, CacheEntry>();

  get<T>(
    scope: string,
    url: string,
    staleTimeMs: number,
    load: () => Promise<T>,
  ): Promise<T> {
    const key = `${scope}\u0000${url}`;
    const existing = this.entries.get(key);
    if (existing?.pending) return existing.pending as Promise<T>;
    if (existing && existing.expiresAt > Date.now())
      return Promise.resolve(existing.value as T);

    const entry: CacheEntry = { url, expiresAt: 0 };
    const pending = load().then(
      (value) => {
        if (this.entries.get(key) === entry) {
          entry.value = value;
          entry.expiresAt = Date.now() + staleTimeMs;
          entry.pending = undefined;
        }
        return value;
      },
      (error: unknown) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      },
    );
    entry.pending = pending;
    this.entries.set(key, entry);
    return pending;
  }

  invalidateUrl(pathname: string) {
    for (const [key, entry] of this.entries) {
      if (entry.url.split("?")[0] === pathname) this.entries.delete(key);
    }
  }

  clear() {
    this.entries.clear();
  }
}

export const clientRequestCache = new ClientRequestCache();
