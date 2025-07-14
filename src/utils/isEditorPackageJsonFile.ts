import * as vscode from "vscode";
import { log } from "../services/logger";

/**
 * Check if the editor is a package.json file.
 * @param editor - The editor to check.
 * @returns True if the editor is a package.json file, false otherwise.
 */
export function isEditorPackageJsonFile(editor: vscode.TextEditor | undefined) {
  if (!editor) {
    return false;
  }

  if (
    editor.document.uri.path.endsWith("package.json") &&
    editor.document.languageId === "json"
  ) {
    return true;
  }

  return false;
}
