import * as vscode from "vscode";

const outputChannel = vscode.window.createOutputChannel("Patch Pulse");

export function log(message: string) {
  outputChannel.appendLine(message);
}

export function activateLogger() {
  outputChannel.show();
}

export function disposeLogger() {
  outputChannel.dispose();
}
