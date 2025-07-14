import * as vscode from "vscode";

import { activateLogger, disposeLogger, log } from "./services/logger";
import { isEditorPackageJsonFile } from "./utils/isEditorPackageJsonFile";
import { getPackageLineNumber } from "./utils/getPackageLineNumber";
import { createRangeFromPackageName } from "./utils/createRangeFromLineNumber";

const decorationType = vscode.window.createTextEditorDecorationType({
  after: { margin: "0 0 0 1em" },
});

export function activate(context: vscode.ExtensionContext) {
  activateLogger();
  log("=== PATCH PULSE EXTENSION ACTIVATED ===");

  vscode.window.onDidChangeActiveTextEditor((editor) => {
    const isPackageJsonFile = isEditorPackageJsonFile(editor);
    if (!isPackageJsonFile) {
      return; // Don't do anything if the active editor is not a package.json file.
    }
    log("=== PACKAGE.JSON FILE ACTIVE ===");

    const packageJsonDocument = editor?.document;
    if (!packageJsonDocument) {
      return; // Don't do anything if the active editor is not a package.json file.
    }

    const packageJsonDocumentText = packageJsonDocument.getText();
    const packageJson = JSON.parse(packageJsonDocumentText);

    for (const [packageName, version] of Object.entries(
      packageJson.dependencies
    )) {
      // For each package, fetch the latest version from npm, and identify if it is outdated.
      const https = require("https");
      const url = `https://registry.npmjs.org/${packageName}`;
      const options = {
        headers: {
          "User-Agent": "VSCode-PatchPulse-Extension",
        },
      };

      const req = https.get(url, options, (res: any) => {
        let data = "";
        res.on("data", (chunk: any) => {
          data += chunk;
        });

        res.on("error", (err: any) => {
          log(`Error fetching package ${packageName}: ${err}`);
        });

        res.on("end", () => {
          const latestVersion = JSON.parse(data)["dist-tags"]?.latest;

          if (!latestVersion) {
            log(`No latest version found for package ${packageName}`);
            return;
          }

          const isOutdated = version !== latestVersion; // TODO: refine this

          const range = createRangeFromPackageName(
            packageJsonDocument,
            packageName
          );

          editor?.setDecorations(decorationType, [
            {
              range,
              renderOptions: {
                after: {
                  contentText: isOutdated
                    ? `new version available (${latestVersion})`
                    : "up to date",
                  fontStyle: "italic",
                  color: "#888888",
                },
              },
            },
          ]);

          if (isOutdated) {
            log(
              `Package ${packageName} is outdated. Current: ${version}, Latest: ${latestVersion}`
            );
          }
        });
      });
    }
  });
}

export function deactivate() {
  decorationType.dispose();
  disposeLogger();
}
