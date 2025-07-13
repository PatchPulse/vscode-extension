// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

interface PackageInfo {
  name: string;
  currentVersion: string;
  latestVersion?: string;
  line: number;
  range: vscode.Range;
  status: "loading" | "success" | "error" | "not-found" | "timeout";
}

class PatchPulseProvider {
  private decorationType: vscode.TextEditorDecorationType;
  private packageCache = new Map<
    string,
    { version: string; timestamp: number }
  >();
  private readonly CACHE_DURATION = 3600000; // 1 hour in milliseconds
  private outputChannel: vscode.OutputChannel;

  private failedPackages = new Map<
    string,
    { attempts: number; lastAttempt: number }
  >();
  private readonly MAX_ATTEMPTS = 3;
  private readonly RETRY_DELAY = 30_000;
  private readonly REQUEST_TIMEOUT = 10_000;

  constructor() {
    // Create decoration type for package version annotations
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 1em",
        color: "#6a737d", // Use a neutral gray color that works across themes
      },
    });

    this.outputChannel = vscode.window.createOutputChannel("Patch Pulse");
  }

  public async activate(context: vscode.ExtensionContext) {
    this.outputChannel.appendLine("=== PATCH PULSE EXTENSION ACTIVATING ===");
    this.outputChannel.show();

    // Register commands
    const checkVersionsCommand = vscode.commands.registerCommand(
      "patch-pulse.checkVersions",
      () => {
        this.checkVersionsForActiveEditor();
      }
    );

    const refreshVersionsCommand = vscode.commands.registerCommand(
      "patch-pulse.refreshVersions",
      () => {
        this.clearCache();
        this.checkVersionsForActiveEditor();
      }
    );

    // Move this INTO the activate method
    const retryFailedCommand = vscode.commands.registerCommand(
      "patch-pulse.retryFailed",
      () => {
        this.retryFailedPackages();
      }
    );

    // Register file watcher for package.json files
    const fileWatcher =
      vscode.workspace.createFileSystemWatcher("**/package.json");

    // Listen for file changes
    fileWatcher.onDidChange(() => {
      this.checkVersionsForActiveEditor();
    });

    fileWatcher.onDidCreate(() => {
      this.checkVersionsForActiveEditor();
    });

    // Listen for active editor changes
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor && this.isPackageJsonFile(editor.document)) {
        this.checkVersionsForEditor(editor);
      }
    });

    // Check versions for current editor if it's a package.json
    const activeEditor = vscode.window.activeTextEditor;
    if (activeEditor && this.isPackageJsonFile(activeEditor.document)) {
      this.checkVersionsForEditor(activeEditor);
    }

    context.subscriptions.push(
      checkVersionsCommand,
      refreshVersionsCommand,
      retryFailedCommand, // Add this line
      fileWatcher,
      this.decorationType
    );

    this.outputChannel.appendLine(
      "=== PATCH PULSE EXTENSION ACTIVATED SUCCESSFULLY ==="
    );
  }

  private isPackageJsonFile(document: vscode.TextDocument): boolean {
    return (
      document.fileName.endsWith("package.json") &&
      document.languageId === "json"
    );
  }

  private async checkVersionsForActiveEditor() {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      await this.checkVersionsForEditor(editor);
    }
  }

  private async checkVersionsForEditor(editor: vscode.TextEditor) {
    if (!this.isPackageJsonFile(editor.document)) {
      return;
    }

    try {
      const packages = this.parsePackageJson(editor.document);
      if (packages.length === 0) {
        return;
      }

      // Initialize all packages as loading
      packages.forEach((pkg) => {
        pkg.status = "loading";
        pkg.latestVersion = undefined;
      });

      this.updateDecorations(editor, packages);

      // Process packages with timeout
      await this.fetchPackageVersions(editor, packages);
    } catch (error) {
      this.outputChannel.appendLine(
        `Error checking package versions: ${error}`
      );
    }
  }

  private async fetchPackageVersions(
    editor: vscode.TextEditor,
    packages: PackageInfo[]
  ) {
    const promises = packages.map(async (pkg) => {
      try {
        // Check if we should skip this package due to recent failures
        const failureInfo = this.failedPackages.get(pkg.name);
        if (failureInfo && failureInfo.attempts >= this.MAX_ATTEMPTS) {
          const timeSinceLastAttempt = Date.now() - failureInfo.lastAttempt;
          if (timeSinceLastAttempt < this.RETRY_DELAY) {
            pkg.status = "error";
            pkg.latestVersion = "max-retries";
            return;
          }
        }

        const version = await this.getLatestVersionWithTimeout(
          pkg.name,
          this.REQUEST_TIMEOUT
        );
        pkg.latestVersion = version;
        pkg.status = "success";

        // Clear failure info on success
        this.failedPackages.delete(pkg.name);
      } catch (error) {
        this.handlePackageFailure(pkg, error);
      }
    });

    await Promise.all(promises);
    this.updateDecorations(editor, packages);
  }

  private async getLatestVersionWithTimeout(
    packageName: string,
    timeoutMs: number
  ): Promise<string> {
    const cacheKey = packageName;
    const cached = this.packageCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.version;
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("TIMEOUT"));
      }, timeoutMs);

      const https = require("https");
      const url = `https://registry.npmjs.org/${packageName}`;

      const options = {
        timeout: timeoutMs - 1_000,
        headers: {
          "User-Agent": "VSCode-PatchPulse-Extension",
        },
      };

      const req = https.get(url, options, (res: any) => {
        let data = "";

        if (res.statusCode === 404) {
          clearTimeout(timeout);
          reject(new Error("NOT_FOUND"));
          return;
        }

        if (res.statusCode === 429) {
          clearTimeout(timeout);
          reject(new Error("RATE_LIMITED"));
          return;
        }

        if (res.statusCode !== 200) {
          clearTimeout(timeout);
          reject(new Error(`HTTP_${res.statusCode}`));
          return;
        }

        res.on("data", (chunk: any) => {
          data += chunk;
        });

        res.on("end", () => {
          clearTimeout(timeout);
          try {
            const response = JSON.parse(data);
            const latestVersion = response["dist-tags"]?.latest;

            if (!latestVersion) {
              reject(new Error("NO_LATEST_VERSION"));
              return;
            }

            this.packageCache.set(packageName, {
              version: latestVersion,
              timestamp: Date.now(),
            });

            resolve(latestVersion);
          } catch (e) {
            reject(new Error("PARSE_ERROR"));
          }
        });

        res.on("error", (error: any) => {
          clearTimeout(timeout);
          reject(new Error("RESPONSE_ERROR"));
        });
      });

      req.on("timeout", () => {
        req.destroy();
        clearTimeout(timeout);
        reject(new Error("REQUEST_TIMEOUT"));
      });

      req.on("error", (error: any) => {
        clearTimeout(timeout);
        reject(new Error("NETWORK_ERROR"));
      });
    });
  }

  private handlePackageFailure(pkg: PackageInfo, error: any) {
    const errorMessage = error.message || error.toString();

    if (errorMessage.includes("NOT_FOUND")) {
      pkg.status = "not-found";
      pkg.latestVersion = "not-found";
      this.outputChannel.appendLine(
        `Package '${pkg.name}' not found in registry`
      );
      return;
    }

    // Track failure attempts
    const failureInfo = this.failedPackages.get(pkg.name) || {
      attempts: 0,
      lastAttempt: 0,
    };
    failureInfo.attempts++;
    failureInfo.lastAttempt = Date.now();
    this.failedPackages.set(pkg.name, failureInfo);

    if (
      errorMessage.includes("TIMEOUT") ||
      errorMessage.includes("REQUEST_TIMEOUT")
    ) {
      pkg.status = "timeout";
      pkg.latestVersion = "timeout";
    } else if (errorMessage.includes("RATE_LIMITED")) {
      pkg.status = "error";
      pkg.latestVersion = "rate-limited";
    } else {
      pkg.status = "error";
      pkg.latestVersion = "error";
    }

    this.outputChannel.appendLine(
      `Error fetching '${pkg.name}': ${errorMessage} (attempt ${failureInfo.attempts}/${this.MAX_ATTEMPTS})`
    );
  }

  private updateDecorations(
    editor: vscode.TextEditor,
    packages: PackageInfo[]
  ) {
    const decorations: vscode.DecorationOptions[] = [];

    for (const pkg of packages) {
      const line = editor.document.lineAt(pkg.line);
      const range = new vscode.Range(
        pkg.line,
        line.text.length,
        pkg.line,
        line.text.length
      );

      let decoration: vscode.DecorationOptions;

      switch (pkg.status) {
        case "loading":
          decoration = {
            range,
            renderOptions: {
              after: {
                contentText: " ⏳ checking...",
                color: "#6a737d",
                fontWeight: "normal",
                fontStyle: "italic",
              },
            },
          };
          break;

        case "not-found":
          decoration = {
            range,
            renderOptions: {
              after: {
                contentText: " ❓ package not found",
                color: "#ff9500",
                fontWeight: "normal",
                fontStyle: "italic",
              },
            },
          };
          break;

        case "timeout":
          const failureInfo = this.failedPackages.get(pkg.name);
          const attempts = failureInfo ? failureInfo.attempts : 0;

          decoration = {
            range,
            renderOptions: {
              after: {
                contentText: ` ⏱️ slow network (${attempts}/${this.MAX_ATTEMPTS})`,
                color: "#ff6b6b",
                fontWeight: "normal",
                fontStyle: "italic",
              },
            },
          };
          break;

        case "error":
          const errorFailureInfo = this.failedPackages.get(pkg.name);
          const isMaxRetries =
            errorFailureInfo && errorFailureInfo.attempts >= this.MAX_ATTEMPTS;
          const errorAttempts = errorFailureInfo
            ? errorFailureInfo.attempts
            : 0;

          let errorText = " ❌ error";
          if (pkg.latestVersion === "rate-limited") {
            errorText = " 🚦 rate limited";
          }

          decoration = {
            range,
            renderOptions: {
              after: {
                contentText: isMaxRetries
                  ? `${errorText} (max retries reached)`
                  : `${errorText} (${errorAttempts}/${this.MAX_ATTEMPTS})`,
                color: "#ff6b6b",
                fontWeight: "normal",
                fontStyle: "italic",
              },
            },
          };
          break;

        case "success":
          if (pkg.latestVersion) {
            const isOutdated = this.isVersionOutdated(
              pkg.currentVersion,
              pkg.latestVersion
            );
            const contentText = isOutdated
              ? ` ⚠️ ${pkg.latestVersion} available`
              : ` ✅ up to date`;

            decoration = {
              range,
              renderOptions: {
                after: {
                  contentText,
                  color: isOutdated ? "#ffc107" : "#28a745",
                  fontWeight: "normal",
                  fontStyle: "italic",
                },
              },
            };
          } else {
            continue;
          }
          break;

        default:
          continue;
      }

      decorations.push(decoration);
    }

    editor.setDecorations(this.decorationType, decorations);
  }

  private async retryFailedPackages() {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !this.isPackageJsonFile(editor.document)) {
      vscode.window.showInformationMessage("Please open a package.json file");
      return;
    }

    // Get current packages
    const packages = this.parsePackageJson(editor.document);
    if (packages.length === 0) {
      return;
    }

    // Find packages that need retrying (failed or timeout status)
    const failedPackages = packages.filter(
      (pkg) => pkg.status === "error" || pkg.status === "timeout"
    );

    if (failedPackages.length === 0) {
      vscode.window.showInformationMessage("No failed packages to retry");
      return;
    }

    // Clear failure history to allow retries
    this.failedPackages.clear();
    vscode.window.showInformationMessage(
      `Retrying ${failedPackages.length} failed packages...`
    );

    // Set only failed packages to loading
    failedPackages.forEach((pkg) => {
      pkg.status = "loading";
      pkg.latestVersion = undefined;
    });

    // Update decorations to show loading state for failed packages
    this.updateDecorations(editor, packages);

    // Retry only the failed packages
    await this.fetchPackageVersions(editor, packages);
  }

  private parsePackageJson(document: vscode.TextDocument): PackageInfo[] {
    const packages: PackageInfo[] = [];
    const text = document.getText();

    try {
      const packageJson = JSON.parse(text);

      // Parse dependencies
      if (packageJson.dependencies) {
        this.parseDependencySection(
          document,
          packageJson.dependencies,
          packages
        );
      }

      // Parse devDependencies
      if (packageJson.devDependencies) {
        this.parseDependencySection(
          document,
          packageJson.devDependencies,
          packages
        );
      }

      // Parse peerDependencies
      if (packageJson.peerDependencies) {
        this.parseDependencySection(
          document,
          packageJson.peerDependencies,
          packages
        );
      }
    } catch (error) {
      console.error("Error parsing package.json:", error);
    }

    return packages;
  }

  private parseDependencySection(
    document: vscode.TextDocument,
    dependencies: any,
    packages: PackageInfo[]
  ) {
    for (const [packageName, version] of Object.entries(dependencies)) {
      const packageNameStr = packageName as string;
      const versionStr = version as string;

      // Find the line where this package is defined
      const packageLine = this.findPackageLine(document, packageNameStr);
      if (packageLine !== -1) {
        packages.push({
          name: packageNameStr,
          currentVersion: versionStr,
          line: packageLine,
          range: new vscode.Range(packageLine, 0, packageLine, 0),
          status: "success",
        });
      }
    }
  }

  private findPackageLine(
    document: vscode.TextDocument,
    packageName: string
  ): number {
    const text = document.getText();
    const lines = text.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Look for lines that contain the package name with quotes
      if (
        line.includes(`"${packageName}"`) ||
        line.includes(`'${packageName}'`)
      ) {
        return i;
      }
    }

    return -1;
  }

  private isVersionOutdated(current: string, latest: string): boolean {
    // Simple version comparison - you might want to use a proper semver library
    const currentClean = current.replace(/[\^~]/, "");
    return currentClean !== latest;
  }

  private clearCache() {
    this.packageCache.clear();
  }

  public dispose() {
    this.decorationType.dispose();
    this.outputChannel.dispose();
  }
}

export function activate(context: vscode.ExtensionContext) {
  const provider = new PatchPulseProvider();
  provider.activate(context);

  context.subscriptions.push({
    dispose: () => provider.dispose(),
  });
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("=== PATCH PULSE EXTENSION DEACTIVATED ===");
}
