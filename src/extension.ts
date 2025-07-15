import * as vscode from "vscode";

import { activateLogger, disposeLogger, log } from "./services/logger";
import {
  packageCache,
  startCacheCleanup,
  stopCacheCleanup,
} from "./services/packageCache";
import { isEditorPackageJsonFile } from "./utils/isEditorPackageJsonFile";
import { createDecoration } from "./utils/createDecoration";
import {
  initializePreFetching,
  setupFileWatchers,
} from "./services/packagePreFetcher";

const decorationType = vscode.window.createTextEditorDecorationType({
  after: { margin: "0 0 0 1em" },
});

/**
 * Debounce timer for decoration updates.
 */
let decorationTimeout: NodeJS.Timeout | undefined;

export function activate(context: vscode.ExtensionContext) {
  activateLogger();
  log("=== PATCH PULSE EXTENSION ACTIVATED ===");

  startCacheCleanup();
  initializePreFetching();
  setupFileWatchers(context);

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    const isPackageJsonFile = isEditorPackageJsonFile(editor);
    if (!isPackageJsonFile) {
      return;
    }
    const packageJsonDocument = editor?.document;
    if (!packageJsonDocument) {
      return;
    }
    log("=== PACKAGE.JSON FILE ACTIVE ===");

    if (decorationTimeout) {
      clearTimeout(decorationTimeout);
    }

    decorationTimeout = setTimeout(() => {
      updateDecorationsForEditor(editor);
    }, 200);
  });
}

function updateDecorationsForEditor(editor: vscode.TextEditor) {
  if (decorationTimeout) {
    clearTimeout(decorationTimeout);
  }

  const packageJsonDocument = editor.document;
  const packageJsonDocumentText = packageJsonDocument.getText();

  let packageJson;
  try {
    packageJson = JSON.parse(packageJsonDocumentText);
  } catch (error) {
    log(`Error parsing package.json: ${error}`);
    return;
  }

  // Use the same extraction logic as the prefetcher
  const allDependencies = extractAllDependencies(packageJson);

  log(`Processing ${allDependencies.length} dependencies for decorations`);

  const decorations: {
    range: vscode.Range;
    renderOptions: vscode.DecorationRenderOptions;
  }[] = [];

  let cacheHits = 0;
  let cacheMisses = 0;

  // Process each dependency
  for (const packageName of allDependencies) {
    const cachedPackageLatestVersion =
      packageCache.getCachedPackageLatestVersion(packageName);

    if (cachedPackageLatestVersion) {
      cacheHits++;
      log(
        `${packageName}: CACHE HIT! Latest version: ${cachedPackageLatestVersion}`
      );

      // Find the version in the package.json
      const packageVersion = findPackageVersionInJson(packageJson, packageName);

      if (packageVersion) {
        decorations.push(
          createDecoration({
            packageName,
            currentVersion: packageVersion,
            latestVersion: cachedPackageLatestVersion,
            packageJsonDocument,
          })
        );
      } else {
        log(
          `Warning: Could not find version for ${packageName} in package.json`
        );
      }
    } else {
      cacheMisses++;
      log(`${packageName}: CACHE MISS! Should be pre-fetching...`);
    }
  }

  log(`Cache stats: ${cacheHits} hits, ${cacheMisses} misses`);

  // Apply decorations immediately
  if (decorations.length > 0) {
    editor.setDecorations(decorationType, decorations);
    log(`Applied ${decorations.length} decorations.`);
  } else {
    log("No decorations to apply - waiting for prefetch to complete");
  }
}

// Helper function to find version in package.json
function findPackageVersionInJson(
  packageJson: any,
  packageName: string
): string | null {
  return (
    packageJson.dependencies?.[packageName] ||
    packageJson.devDependencies?.[packageName] ||
    packageJson.peerDependencies?.[packageName] ||
    packageJson.optionalDependencies?.[packageName] ||
    null
  );
}

// Move this function to a shared utility file or copy it here
function extractAllDependencies(packageJson: any): string[] {
  const dependencies = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
    ...packageJson.peerDependencies,
    ...packageJson.optionalDependencies,
  };

  return Object.keys(dependencies);
}

export function deactivate() {
  if (decorationTimeout) {
    clearTimeout(decorationTimeout);
  }
  decorationType.dispose();
  stopCacheCleanup();
  disposeLogger();
}
