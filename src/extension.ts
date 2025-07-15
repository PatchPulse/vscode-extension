import * as vscode from "vscode";

import { getPackageInfo } from "./api/npm";
import { activateLogger, disposeLogger, log } from "./services/logger";
import { packageCache } from "./services/packageCache";
import { isEditorPackageJsonFile } from "./utils/isEditorPackageJsonFile";
import { createDecoration } from "./utils/createDecoration";

const decorationType = vscode.window.createTextEditorDecorationType({
  after: { margin: "0 0 0 1em" },
});

/**
 * Debounce timer for decoration updates.
 */
let decorationTimeout: NodeJS.Timeout | undefined;

export function activate(_context: vscode.ExtensionContext) {
  activateLogger();
  log("=== PATCH PULSE EXTENSION ACTIVATED ===");

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

    const packageJsonDocumentText = packageJsonDocument.getText();
    const packageJson = JSON.parse(packageJsonDocumentText);

    const decorations: {
      range: vscode.Range;
      renderOptions: vscode.DecorationRenderOptions;
    }[] = [];

    let pendingOperations = 0;
    let hasCompletedOperations = false;

    function updateDecorations() {
      if (!editor || decorations.length === 0) {
        return;
      }

      editor.setDecorations(decorationType, decorations);
      log(`Applied ${decorations.length} decorations.`);
    }

    function checkAndUpdateDecorations() {
      pendingOperations--;
      if (pendingOperations === 0 && hasCompletedOperations) {
        decorationTimeout = setTimeout(updateDecorations, 100);
      }
    }

    for (const [packageName, version] of Object.entries(
      packageJson.dependencies as Record<string, string>
    )) {
      const cachedPackageLatestVersion =
        packageCache.getCachedPackageLatestVersion(packageName);
      if (cachedPackageLatestVersion) {
        log(
          `${packageName}: CACHE FOUND! Latest version: ${cachedPackageLatestVersion}`
        );
        decorations.push(
          createDecoration({
            packageName,
            currentVersion: version,
            latestVersion: cachedPackageLatestVersion,
            packageJsonDocument,
          })
        );
        hasCompletedOperations = true;
      } else {
        log(`${packageName}: CACHE MISS! Fetching from npm...`);
        pendingOperations++;
        getPackageInfo(packageName)
          .then((packageInfo) => {
            const latestVersion = packageInfo["dist-tags"]?.latest;
            if (!latestVersion) {
              log(`No latest version found for package ${packageName}`);
              checkAndUpdateDecorations();
              return;
            }

            packageCache.setCachedVersion(packageName, latestVersion);

            log(
              `${packageName}: Latest version found from npm: ${latestVersion}`
            );
            decorations.push(
              createDecoration({
                packageName,
                currentVersion: version,
                latestVersion,
                packageJsonDocument,
              })
            );

            hasCompletedOperations = true;
            checkAndUpdateDecorations();
          })
          .catch((error) => {
            log(`Error fetching package ${packageName}: ${error}`);
            checkAndUpdateDecorations();
          });
      }
    }

    if (pendingOperations === 0 && hasCompletedOperations) {
      decorationTimeout = setTimeout(updateDecorations, 100);
    }
  });
}

export function deactivate() {
  if (decorationTimeout) {
    clearTimeout(decorationTimeout);
  }
  decorationType.dispose();
  disposeLogger();
}
