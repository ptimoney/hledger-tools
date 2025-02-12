import * as vscode from "vscode";
import { CheckOptions, check } from "./check";
import { JournalOptions, Journal, AlignmentType } from "./journal";

export async function activate(context: vscode.ExtensionContext) {
  const journalMap = new Map<vscode.TextDocument, Journal>();
  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("hledger");

  function getOrCreateJournal(document: vscode.TextDocument): Journal {
    if (!journalMap.has(document)) {
      const configuration = vscode.workspace.getConfiguration();

      const formatAmounts = configuration.get(
        "hledger.formatting.formatAmounts",
        true
      );
      const negativesInFrontOfCommodities = configuration.get(
        "hledger.formatting.negativesInFrontOfCommodities",
        true
      );

      const journalOptions: JournalOptions = {
        formatAmounts: formatAmounts,
        negativesInFrontOfCommodities: negativesInFrontOfCommodities,
      };
      const journal = new Journal(document, journalOptions);
      journalMap.set(document, journal);
    }
    return journalMap.get(document)!;
  }

  const completions = vscode.languages.registerCompletionItemProvider(
    "hledger",
    {
      async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
      ): Promise<vscode.CompletionItem[]> {
        const journal = getOrCreateJournal(document);
        await journal.updateJournal();

        const text = document.lineAt(position).text;
        if (!text.match(/^\s/)) {
          // Do not provide account name completions if the line is not indented.
          return [];
        }

        const beforeInLine = text.slice(0, position.character).trim();
        const accountGroup = beforeInLine.substring(
          0,
          beforeInLine.lastIndexOf(":") + 1
        );

        // generate the next leaves of the accounts which start with the accounts on the line already, triggers on : or typing
        const accountNames = Array.from(journal.accountMap)
          .filter(([accountName, account]) =>
            accountName.startsWith(accountGroup)
          )
          .map(([accountName, account]) => {
            const endIndex = accountName.indexOf(":", accountGroup.length);
            return accountName.substring(
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
          const lineStart = document
            .lineAt(position)
            .text.indexOf(beforeInLine);
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
      async provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
      ) {
        const textEdits: vscode.TextEdit[] = [];

        const configuration = vscode.workspace.getConfiguration();

        const formatPostingLines = configuration.get(
          "hledger.formatting.formatTransactions",
          true
        );

        const formatWhiteSpace = configuration.get(
          "hledger.formatting.formatWhiteSpace",
          true
        );

        if (formatPostingLines) {
          const defaultAlignments = new Proxy(
            {
              postAmountAlignment: 35,
              costTypeAlignment: 7,
              costAmountAlignment: 7,
              assertionTypeAlignment: 7,
              assertionAmountAlignment: 7,
              assertionCostTypeAlignment: 7,
              assertionCostAmountAlignment: 7,
              commentAlignment: 7,
            },
            {}
          );

          const globalAlignments = Object.values(
            configuration.get(
              `hledger.formatting.globalAlignments`,
              defaultAlignments
            )
          );

          const alignmentTypeConfig = configuration.get(
            `hledger.formatting.alignment`,
            AlignmentType.both
          );

          const alignmentType =
            AlignmentType[alignmentTypeConfig as keyof typeof AlignmentType] ||
            AlignmentType.both;

          const journal = getOrCreateJournal(document);
          await journal.updateJournal();

          journal.transactions.forEach((transaction) => {
            if (transaction.documentUri !== document.uri) {
              return;
            }

            transaction.updateTransactionAlignments(
              globalAlignments,
              alignmentType === AlignmentType.both
            );

            transaction.postings.forEach((posting) => {
              if (
                !(
                  posting.amountHasCorrectSignature &&
                  posting.postingCostHasCorrectSignature &&
                  posting.assertionHasCorrectSignature &&
                  posting.assertionCostHasCorrectSignature
                )
              ) {
                return;
              }
              const formattedPosting =
                posting.formatTransactionAlignedPostingString(
                  alignmentType,
                  globalAlignments
                );
              if (posting.postingString === formattedPosting) {
                return;
              }

              const startPos = document.positionAt(posting.postingIndex);

              const endPos = document.positionAt(
                posting.postingIndex + posting.postingString.length
              );

              textEdits.push(
                vscode.TextEdit.replace(
                  new vscode.Range(startPos, endPos),
                  formattedPosting
                )
              );
            });
          });
        }
        if (formatWhiteSpace) {
          const emptyLineRegEx = new RegExp(/^\s*$/m);

          const textSplit = document.getText().split("\n");
          textSplit.forEach((textLine, lineIndexInt) => {
            if (lineIndexInt < textSplit.length - 1) {
              if (
                textSplit[lineIndexInt + 1].match(emptyLineRegEx) &&
                textLine.match(emptyLineRegEx)
              ) {
                textEdits.push(
                  vscode.TextEdit.delete(
                    new vscode.Range(lineIndexInt, 0, lineIndexInt + 1, 0)
                  )
                );
              } else if (textLine.match(emptyLineRegEx)) {
                textEdits.push(
                  vscode.TextEdit.delete(
                    new vscode.Range(
                      lineIndexInt,
                      0,
                      lineIndexInt,
                      textLine.length
                    )
                  )
                );
              }
            } else if (textLine.match(emptyLineRegEx)) {
              textEdits.push(
                vscode.TextEdit.delete(
                  new vscode.Range(
                    lineIndexInt,
                    0,
                    lineIndexInt,
                    textLine.length
                  )
                )
              );
            }
          });
        }

        return textEdits;
      },
    }
  );

  const validator = vscode.workspace.onDidChangeTextDocument(async (e) => {
    if (e.document.languageId !== "hledger" || e.contentChanges.length === 0) {
      return;
    }
    diagnosticCollection.clear();
    const changedDocument = e.document;

    await checkDocument(changedDocument);
  });

  const closeDocument = vscode.workspace.onDidCloseTextDocument((doc) =>
    diagnosticCollection.delete(doc.uri)
  );

  context.subscriptions.push(formatter, completions, validator, closeDocument);

  async function checkDocument(document: vscode.TextDocument) {
    const journal = getOrCreateJournal(document);
    await journal.updateJournal();

    journal.documentsMap.forEach((includedDocument) => {
      if (!includedDocument.document) {
        return;
      }
      includedDocument.diagnostics = [];
    });

    const VALIDATIONS = "hledger.validations.";
    const validationKeys = [
      "commodities",
      "accounts",
      "ordered_dates",
      "payees",
      "tags",
      "recent_assertions",
      "unique_leaf_names",
    ];

    const configuration = vscode.workspace.getConfiguration();
    const validationSettings = getValidationSettings(
      configuration,
      VALIDATIONS,
      validationKeys
    );

    const checkOptions: CheckOptions = {
      checkCommodities: validationSettings.commodities,
      checkAccounts: validationSettings.accounts,
      checkOrderedDates: validationSettings.ordered_dates,
      checkPayees: validationSettings.payees,
      checkTags: validationSettings.tags,
      checkRecentAssertions: validationSettings.recent_assertions,
      checkUniqueLeafNames: validationSettings.unique_leaf_names,
    };

    const errors = check(journal, checkOptions);
    errors.forEach((error) => {
      const includedDocument = journal.documentsMap.get(error.file.toString());
      if (!includedDocument) {
        return;
      }

      if (!includedDocument.document) {
        return;
      }
      const startPos = includedDocument.document.positionAt(error.startIndex);
      const endPos = includedDocument.document.positionAt(error.endIndex);
      const range = new vscode.Range(startPos, endPos);
      const diagnostic = new vscode.Diagnostic(
        range,
        error.message,
        error.severity
      );
      includedDocument.diagnostics.push(diagnostic);
    });

    journal.documentsMap.forEach((includedDocument) => {
      if (!includedDocument.document) {
        return;
      }
      diagnosticCollection.set(
        includedDocument.document.uri,
        includedDocument.diagnostics
      );
    });
  }
  const activationDocument = vscode.window.activeTextEditor?.document;

  await checkDocument(activationDocument!);
}

function getValidationSettings(
  configuration: vscode.WorkspaceConfiguration,
  validations: string,
  keys: string[]
): Record<string, boolean> {
  const settings: Record<string, boolean> = {};
  keys.forEach((key) => {
    settings[key] = configuration.get(`${validations}${key}`, true);
  });
  return settings;
}
