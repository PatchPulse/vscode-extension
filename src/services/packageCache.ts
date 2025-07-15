interface CacheEntry {
  /**
   * The latest version of the package.
   */
  version: string;
  /**
   * The timestamp of the last time the package was checked.
   */
  timestamp: number;
  /**
   * Track which files use this package.
   */
  files: Set<string>;
}

interface PackageCacheService {
  getCachedPackageLatestVersion(packageName: string): string | null;
  setCachedVersion(
    packageName: string,
    version: string,
    filePath?: string
  ): void;
  clearPackage(packageName: string): void;
  clearCacheForFile(filePath: string): void;
  clearExpiredEntries(): void;
  getStats(): { totalPackages: number; totalFiles: number };
  clearAll(): void;
}

class PackageCache implements PackageCacheService {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 30 * 60 * 1000; // 30 minutes in milliseconds

  /**
   * Get the latest version of a package from the cache.
   * @param packageName - The name of the package.
   * @returns The latest version of the package or null if not found.
   */
  getCachedPackageLatestVersion(packageName: string): string | null {
    const entry = this.cache.get(packageName);

    if (!entry) {
      return null;
    }

    // Check if entry is expired
    if (Date.now() - entry.timestamp > this.CACHE_TTL) {
      this.cache.delete(packageName);
      return null;
    }

    return entry.version;
  }

  /**
   * Set the cached version for a package.
   * @param packageName - The name of the package.
   * @param version - The version of the package.
   * @param filePath - The file path of the package.
   */
  setCachedVersion(
    packageName: string,
    version: string,
    filePath?: string
  ): void {
    const existing = this.cache.get(packageName);

    if (existing) {
      // Update existing entry
      existing.version = version;
      existing.timestamp = Date.now();
      if (filePath) {
        existing.files.add(filePath);
      }
    } else {
      // Create new entry
      const files = new Set<string>();
      if (filePath) {
        files.add(filePath);
      }

      this.cache.set(packageName, {
        version,
        timestamp: Date.now(),
        files,
      });
    }
  }

  /**
   * Clear the cache for a package.
   * @param packageName - The name of the package.
   */
  clearPackage(packageName: string): void {
    this.cache.delete(packageName);
  }

  /**
   * Clear the cache for a file.
   * @param filePath - The file path.
   */
  clearCacheForFile(filePath: string): void {
    const packagesToRemove: string[] = [];

    for (const [packageName, entry] of this.cache.entries()) {
      entry.files.delete(filePath);

      // If no files are using this package anymore, remove it
      if (entry.files.size === 0) {
        packagesToRemove.push(packageName);
      }
    }

    packagesToRemove.forEach((packageName) => {
      this.cache.delete(packageName);
    });
  }

  /**
   * Clear expired entries from the cache.
   */
  clearExpiredEntries(): void {
    const now = Date.now();
    const expiredPackages: string[] = [];

    for (const [packageName, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        expiredPackages.push(packageName);
      }
    }

    expiredPackages.forEach((packageName) => {
      this.cache.delete(packageName);
    });
  }

  /**
   * Get the stats of the cache.
   * @returns The stats of the cache.
   */
  getStats(): { totalPackages: number; totalFiles: number } {
    const allFiles = new Set<string>();

    for (const entry of this.cache.values()) {
      entry.files.forEach((file) => allFiles.add(file));
    }

    return {
      totalPackages: this.cache.size,
      totalFiles: allFiles.size,
    };
  }

  /**
   * Clear all entries from the cache.
   */
  clearAll(): void {
    this.cache.clear();
  }

  // Additional helper methods for debugging/monitoring
  getPackageFiles(packageName: string): string[] {
    const entry = this.cache.get(packageName);
    return entry ? Array.from(entry.files) : [];
  }

  getFilePackages(filePath: string): string[] {
    const packages: string[] = [];

    for (const [packageName, entry] of this.cache.entries()) {
      if (entry.files.has(filePath)) {
        packages.push(packageName);
      }
    }

    return packages;
  }

  // Method to refresh specific packages (force re-fetch)
  markForRefresh(packageNames: string[]): void {
    packageNames.forEach((packageName) => {
      const entry = this.cache.get(packageName);
      if (entry) {
        // Set timestamp to 0 to force expiration
        entry.timestamp = 0;
      }
    });
  }
}

// Create singleton instance
export const packageCache = new PackageCache();

/**
 * The interval for the cache cleanup.
 */
let cleanupInterval: NodeJS.Timeout | undefined;

/**
 * Start the cache cleanup interval.
 */
export function startCacheCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
  }

  // Clean up expired entries every 5 minutes
  cleanupInterval = setInterval(() => {
    packageCache.clearExpiredEntries();
  }, 5 * 60 * 1000);
}

/**
 * Stop the cache cleanup interval.
 */
export function stopCacheCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = undefined;
  }
}
