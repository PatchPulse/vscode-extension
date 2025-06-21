// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from "vscode";

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
  try {
    // Use the console to output diagnostic information (console.log) and errors (console.error)
    // This line of code will only be executed once when your extension is activated
    console.log("=== PATCH PULSE EXTENSION ACTIVATING ===");
    console.log('Congratulations, your extension "patch-pulse" is now active!');

    // The command has been defined in the package.json file
    // Now provide the implementation of the command with registerCommand
    // The commandId parameter must match the command field in package.json
    const disposable = vscode.commands.registerCommand(
      "patch-pulse.helloWorld",
      () => {
        // The code you place here will be executed every time your command is executed
        // Display a message box to the user
        console.log("Hello World command executed!");
        vscode.window.showInformationMessage("Hello World from vscode-plugin!");
      }
    );

    context.subscriptions.push(disposable);
    console.log("Hello World command registered successfully");
    console.log("=== PATCH PULSE EXTENSION ACTIVATED SUCCESSFULLY ===");
  } catch (error) {
    console.error("ERROR activating patch-pulse extension:", error);
    vscode.window.showErrorMessage(
      `Failed to activate patch-pulse extension: ${error}`
    );
  }
}

// This method is called when your extension is deactivated
export function deactivate() {
  console.log("=== PATCH PULSE EXTENSION DEACTIVATED ===");
}
