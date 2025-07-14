import * as vscode from "vscode";
import { getPackageLineNumber } from "./getPackageLineNumber";

export function createRangeFromPackageName(
  packageJsonDocument: vscode.TextDocument,
  packageName: string
): vscode.Range {
  const lineNumber = getPackageLineNumber({
    packageJsonDocumentText: packageJsonDocument.getText(),
    packageName,
  });

  const line = packageJsonDocument.lineAt(lineNumber);

  return new vscode.Range(
    lineNumber,
    line.text.length,
    lineNumber,
    line.text.length
  );
}
