interface CacheEntry {
  /**
   * The latest version of the package.
   */
  version: string;
  /**
   * The timestamp of the last time the package was checked.
   */
  timestamp: number;
}

class PackageCache {
  private cache: Record<string, CacheEntry> = {};
  private readonly ttl = 1000 * 60 * 60; // 1 hour

  /**
   * Get the cached version of a package.
   * @param packageName The name of the package.
   * @returns The cached version of the package, or undefined if the package is not in the cache.
   *
   * Also clears the cache for the package if the cache is older than the 1 hour TTL.
   */
  getCachedPackageLatestVersion(packageName: string): string | undefined {
    const entry = this.cache[packageName];
    if (!entry) {
      return undefined;
    }

    const now = Date.now();
    if (now - entry.timestamp > this.ttl) {
      delete this.cache[packageName];
      return undefined;
    }

    return entry.version;
  }

  setCachedVersion(packageName: string, version: string) {
    this.cache[packageName] = {
      version,
      timestamp: Date.now(),
    };
  }
}

export const packageCache = new PackageCache();
