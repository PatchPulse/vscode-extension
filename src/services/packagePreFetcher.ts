import * as vscode from "vscode";

import { getPackageInfo } from "../api/npm";
import { log } from "./logger";
import { packageCache } from "./packageCache";

class PackagePreFetcher {
  /**
   * Package names to prefetch
   */
  private queue: { packageName: string; filePath?: string }[] = [];
  private isProcessing = false;
  private readonly BATCH_SIZE = 5;
  private readonly DELAY_BETWEEN_BATCHES_MS = 1_000; // 1 second
  private inProgress = new Set<string>();

  /**
   * Add packages to the prefetcher queue
   * if they are not already in the cache or queue
   * and starts processing the queue if it is not already processing.
   * @param packageNames - The package names to add to the queue.
   */
  async addPackages(packageNames: string[], filePath?: string) {
    const newPackages = packageNames
      .filter(
        (pkg) =>
          !packageCache.getCachedPackageLatestVersion(pkg) &&
          !this.inProgress.has(pkg) &&
          !this.queue.some((item) => item.packageName === pkg)
      )
      .map((pkg) => ({ packageName: pkg, filePath }));

    if (newPackages.length === 0) {
      return;
    }

    this.queue.push(...newPackages);
    log(`Added ${newPackages.length} packages to the pre-fetch queue`);

    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  private async processQueue() {
    this.isProcessing = true;

    while (this.queue.length > 0) {
      const batch = this.queue.splice(0, this.BATCH_SIZE);

      batch.forEach((item) => this.inProgress.add(item.packageName));

      const promises = batch.map(async ({ packageName, filePath }) => {
        try {
          const packageInfo = await getPackageInfo(packageName);
          const latestVersion = packageInfo["dist-tags"]?.latest;

          if (latestVersion) {
            packageCache.setCachedVersion(packageName, latestVersion, filePath);
            log(`Pre-fetched ${packageName}: ${latestVersion}`);
          }
        } catch (error) {
          log(`Pre-fetch failed for ${packageName}: ${error}`);
        } finally {
          this.inProgress.delete(packageName);
        }
      });

      await Promise.allSettled(promises);

      if (this.queue.length > 0) {
        await new Promise((resolve) =>
          setTimeout(resolve, this.DELAY_BETWEEN_BATCHES_MS)
        );
      }
    }

    this.isProcessing = false;
  }

  async refreshPackages(packages: string[]) {
    packageCache.markForRefresh(packages);
    await this.addPackages(packages);
  }
}

const preFetcher = new PackagePreFetcher();

export async function initializePreFetching() {
  log("=== STARTING WORKSPACE PRE-FETCH ===");

  const packageJsonFiles = await vscode.workspace.findFiles(
    "**/package.json",
    "**/node_modules/**"
  );

  log(`Found ${packageJsonFiles.length} package.json files`);

  for (const uri of packageJsonFiles) {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const packageJson = JSON.parse(document.getText());

      const allDependencies = Object.keys({
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
        ...packageJson.peerDependencies,
        ...packageJson.optionalDependencies,
      });

      log(`Found ${allDependencies.length} dependencies in ${uri.fsPath}`);

      await preFetcher.addPackages(allDependencies, uri.fsPath);
    } catch (error) {
      log(`Error processing ${uri.fsPath}: ${error}`);
    }
  }

  setTimeout(() => {
    const stats = packageCache.getStats();
    log(
      `=== PREFETCH COMPLETE: ${stats.totalPackages} packages cached from ${stats.totalFiles} files ===`
    );
  }, 5000);
}

/**
 * Setup file watchers for package.json and package-lock.json files.
 * @param context - The extension context.
 */
export function setupFileWatchers(context: vscode.ExtensionContext) {
  const packageJsonWatcher = vscode.workspace.createFileSystemWatcher(
    "**/package.json",
    false, // Don't ignore creates
    false, // Don't ignore changes
    false // Don't ignore deletes
  );

  packageJsonWatcher.onDidChange(async (uri) => {
    log(`Package.json changed: ${uri.fsPath}`);
    await handlePackageJsonChange(uri);
  });

  packageJsonWatcher.onDidCreate(async (uri) => {
    log(`Package.json created: ${uri.fsPath}`);
    await handlePackageJsonChange(uri);
  });

  packageJsonWatcher.onDidDelete((uri) => {
    log(`Package.json deleted: ${uri.fsPath}`);
  });

  context.subscriptions.push(packageJsonWatcher);
}

/**
 * Handle package.json change.
 * @param uri - The URI of the package.json file.
 */
async function handlePackageJsonChange(uri: vscode.Uri) {
  try {
    const document = await vscode.workspace.openTextDocument(uri);
    const packageJsonText = document.getText();
    const packageJson = JSON.parse(packageJsonText);
    const allDependencies = extractAllDependencies(packageJson);

    const filePath = uri.fsPath;

    // Clear cache entries for this file first
    packageCache.clearCacheForFile(filePath);

    log(`Found ${allDependencies.length} dependencies in ${filePath}`);

    // Add to pre-fetcher queue with file path for tracking
    await preFetcher.addPackages(allDependencies, filePath);
  } catch (error) {
    log(`Error handling package.json change for ${uri.fsPath}: ${error}`);
  }
}

function extractAllDependencies(packageJson: any): string[] {
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
    ...packageJson.optionalDependencies,
  };

  return Object.keys(dependencies);
}
