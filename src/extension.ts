// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

interface PackageInfo {
  name: string;
  currentVersion: string;
  latestVersion?: string;
  line: number;
  range: vscode.Range;
}

interface NpmPackageData {
  "dist-tags": {
    latest: string;
  };
}

class PatchPulseProvider {
  private decorationType: vscode.TextEditorDecorationType;
  private packageCache = new Map<
    string,
    { version: string; timestamp: number }
  >();
  private readonly CACHE_DURATION = 3600000; // 1 hour in milliseconds
  private outputChannel: vscode.OutputChannel;

  private updateTimeout: NodeJS.Timeout | undefined;
  private pendingUpdates = new Map<vscode.TextEditor, PackageInfo[]>();

  constructor() {
    // Create decoration type for package version annotations
    this.decorationType = vscode.window.createTextEditorDecorationType({
      after: {
        margin: "0 0 0 1em",
        color: new vscode.ThemeColor("editorComment.foreground"),
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

      packages.forEach((pkg) => {
        pkg.latestVersion = "loading";
      });

      /**
       * Shows loading state immediately.
       */
      this.updateDecorations(editor, packages);

      this.checkPackageVersionsStreaming(editor, packages);
    } catch (error) {
      this.outputChannel.appendLine(
        `Error checking package versions: ${error}`
      );
    }
  }

  private async checkPackageVersionsStreaming(
    editor: vscode.TextEditor,
    packages: PackageInfo[]
  ) {
    const promises = packages.map(async (pkg) => {
      try {
        const lastVersion = await this.getLatestVersion(pkg.name);
        pkg.latestVersion = lastVersion;
        this.scheduleUpdate(editor, packages);
      } catch (error) {
        this.outputChannel.appendLine(
          `Error checking version for ${pkg.name}: ${error}`
        );
        pkg.latestVersion = "error";
        this.scheduleUpdate(editor, packages);
      }
    });

    await Promise.all(promises);
  }

  private scheduleUpdate(editor: vscode.TextEditor, packages: PackageInfo[]) {
    this.pendingUpdates.set(editor, packages);

    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

    this.updateTimeout = setTimeout(() => {});

    this.updateTimeout = setTimeout(() => {
      this.pendingUpdates.forEach((packages, editor) => {
        this.updateDecorations(editor, packages);
      });
      this.pendingUpdates.clear();
    }, 1_000);
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

  private async getLatestVersion(packageName: string): Promise<string> {
    const cacheKey = packageName;
    const cached = this.packageCache.get(cacheKey);

    if (cached && Date.now() - cached.timestamp < this.CACHE_DURATION) {
      return cached.version;
    }

    try {
      const https = require("https");
      const url = `https://registry.npmjs.org/${packageName}`;

      const response = await new Promise<any>((resolve, reject) => {
        https
          .get(url, (res: any) => {
            let data = "";
            res.on("data", (chunk: any) => {
              data += chunk;
            });
            res.on("end", () => {
              try {
                resolve(JSON.parse(data));
              } catch (e) {
                reject(e);
              }
            });
          })
          .on("error", reject);
      });

      const latestVersion = response["dist-tags"].latest;

      this.packageCache.set(cacheKey, {
        version: latestVersion,
        timestamp: Date.now(),
      });

      return latestVersion;
    } catch (error) {
      this.outputChannel.appendLine(
        `Failed to fetch version for ${packageName}: ${error}`
      );
      throw error;
    }
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

      if (!pkg.latestVersion || pkg.latestVersion === "error") {
        continue;
      }

      if (pkg.latestVersion === "loading") {
        decoration = {
          range,
          renderOptions: {
            after: {
              contentText: "checking...",
              color: new vscode.ThemeColor("editorComment.foreground"),
              fontWeight: "normal",
              fontStyle: "italic",
            },
          },
        };
      } else {
        const isOutdated = this.isVersionOutdated(
          pkg.currentVersion,
          pkg.latestVersion
        );

        const contentText = isOutdated
          ? `new version available: ${pkg.latestVersion}`
          : `up to date`;

        decoration = {
          range,
          renderOptions: {
            after: {
              contentText,
              color: isOutdated ? "yellow" : "green",
              fontWeight: "normal",
              fontStyle: "italic",
            },
          },
        };
      }

      decorations.push(decoration);
    }

    editor.setDecorations(this.decorationType, decorations);
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
    if (this.updateTimeout) {
      clearTimeout(this.updateTimeout);
    }

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
