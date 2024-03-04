/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/

import child_process = require("child_process");
import * as vscode from "vscode";

export function activate(context: vscode.ExtensionContext) {
  const state = stateManager(context);
  updateCache();

  const provider = vscode.languages.registerCompletionItemProvider(
    "hledger",
    {
      async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
      ): Promise<vscode.CompletionItem[]> {
        const text = document.lineAt(position).text;
        if (!text.match(/^\s/)) {
          // Do not provide account name completions if the line is not indented.
          return [];
        }

        const linePrefix = document
          .lineAt(position)
          .text.slice(0, position.character)
          .trim();
        const accountGroup = linePrefix.substring(
          0,
          linePrefix.lastIndexOf(":") + 1
        );

        const accounts = state.read() as String;

        const accountNames = accounts
          .split("\n")
          .map((x) => x.trim())
          .filter((x) => x.startsWith(accountGroup))
          .map((x) => {
            const endIndex = x.indexOf(":", accountGroup.length);
            return x.substring(
              accountGroup.length,
              endIndex > 0 ? endIndex + 1 : undefined
            );
          })
          .filter((elem, index, self) => index === self.indexOf(elem));

        const completion = accountNames.map((x) => {
          const completionEntry = new vscode.CompletionItem(x);
          completionEntry.commitCharacters = [":"];
          if (x.endsWith(":")) {
            completionEntry.command = {
              command: "editor.action.triggerSuggest",
              title: "Re-trigger completions...",
            };
          }

          const wordStart = document
            .lineAt(position)
            .text.slice(0, position.character)
            .lastIndexOf(":");
          const lineStart = document.lineAt(position).text.indexOf(linePrefix);
          const wordStartPosition = new vscode.Position(
            position.line,
            wordStart > 0 ? wordStart + 1 : lineStart
          );
          const wordEnd = document
            .lineAt(position)
            .text.indexOf(":", wordStart + 1);
          const lineEnd = document.lineAt(position).text.length;
          const lineEndPosition = new vscode.Position(
            position.line,
            wordEnd > 0 ? wordEnd : lineEnd
          );

          completionEntry.range = {
            inserting: new vscode.Range(wordStartPosition, position),
            replacing: new vscode.Range(wordStartPosition, lineEndPosition),
          };
          return completionEntry;
        });

        return completion;
      },
    },
    ":"
  );

  const formatter = vscode.languages.registerDocumentFormattingEditProvider(
    "hledger",
    {
      provideDocumentFormattingEdits(document, options, token) {
        const dotPos = 75;
        const editor = vscode.window.activeTextEditor;
        if (editor) {
          const document = editor.document;
          const p = new RegExp(
            "^\\s+([\\[\\]\\w:\\s\\&_-]+)\\s+([-$£¥€¢\\d,_]+)(?:.\\d*)?.*$"
          );

          const textEdits: vscode.TextEdit[] = [];

          document
            .getText()
            .split("\n")
            .map((line, lineNumber) => {
              const match = line.match(p);
              if (!match) {
                return;
              }
              const linePosDot = line.indexOf(match[2]) + match[2].length;
              const linePosAmount = line.indexOf(match[2]);
              const adjustment = dotPos - linePosDot;
              if (adjustment > 0) {
                const insertString = " ".repeat(adjustment);
                textEdits.push(
                  vscode.TextEdit.insert(
                    new vscode.Position(lineNumber, linePosAmount),
                    insertString
                  )
                );
              } else if (adjustment < 0) {
                textEdits.push(
                  vscode.TextEdit.delete(
                    new vscode.Range(
                      lineNumber,
                      linePosAmount + adjustment,
                      lineNumber,
                      linePosAmount
                    )
                  )
                );
              }
            });
          return textEdits;
        }
      },
    }
  );

  const saveEvent = vscode.workspace.onDidSaveTextDocument(() => {
    updateCache();
  });

  async function updateCache() {
    const configuration = vscode.workspace.getConfiguration();
    const hledgerPath = configuration.get(`hledger.hledgerPath`, "hledger");
    const ledgerFile = configuration.get(`hledger.ledgerFile`, "");
    const options = ledgerFile ? ` -f ${ledgerFile} accounts` : " accounts";
    const command = hledgerPath + options;

    const readAccounts = child_process.exec(command, (error, stdout) => {
      if (error) {
        console.log(error);
        return;
      }
      state.write(stdout);
    });
  }

  context.subscriptions.push(provider, formatter, saveEvent);
}

function stateManager(context: vscode.ExtensionContext) {
  return {
    read,
    write,
  };

  function read() {
    const accounts = context.workspaceState.get("accounts");
    return accounts;
  }

  async function write(newState: String) {
    await context.workspaceState.update("accounts", newState);
  }
}
