import * as vscode from "vscode";
import { escapeRegex } from "./utils";

export enum AlignmentType {
  global = "global",
  transaction = "transaction",
  both = "both",
}

export interface JournalOptions {
  formatAmounts: boolean;
  negativesInFrontOfCommodities: boolean;
}

export class Journal {
  transactions: Transaction[] = [];
  journalDocument: vscode.TextDocument;
  documentsMap: Map<string, IncludedDocument> = new Map<
    string,
    IncludedDocument
  >();
  commodityMap: Map<string, Commodity> = new Map<string, Commodity>();
  accountMap: Map<string, Account> = new Map<string, Account>();
  journalOptions: JournalOptions;

  constructor(
    journalDocument: vscode.TextDocument,
    journalOptions: JournalOptions
  ) {
    this.journalOptions = journalOptions;
    this.documentsMap.set(
      journalDocument.uri.toString(),
      new IncludedDocument(0, "", journalDocument.uri, journalDocument)
    );
    this.journalDocument = journalDocument;
  }

  async updateJournal() {
    while (await this.updateIncludes()) {}
    this.updateDefaultDecimalMarks();
    this.updateCommodityMap();
    this.updateAccounts();
    this.parseTransactions();
  }

  updateDefaultDecimalMarks() {
    const defaultDecimalMarkRegex = new RegExp(
      /^(?:decimal-mark )(?<defaultDecimalMark>[.,])/m
    );

    this.documentsMap.forEach((includedDocument, includedURI) => {
      if (!includedDocument.document) {
        return;
      }

      const defaultDecimalMarkMatch = includedDocument.document
        .getText()
        .match(defaultDecimalMarkRegex);

      if (!defaultDecimalMarkMatch) {
        return;
      }

      includedDocument.defaultDecimalMark =
        defaultDecimalMarkMatch.groups?.defaultDecimalMark ?? "?";
    });
  }

  async updateIncludes(): Promise<boolean> {
    const includesRegEx = new RegExp(/^include[\t ]?(.+)$/gm);
    let hasAddedDocuments = false;

    let documentOpens: PromiseLike<void>[] = [];

    await Array.from(this.documentsMap).reduce(
      async (promise, [includedDocumentURI, includedDocument]) => {
        await promise;

        if (!includedDocument.document) {
          return;
        }
        const includeMatches = includedDocument.document
          .getText()
          .matchAll(includesRegEx);

        for await (const includeMatch of includeMatches) {
          const includeRelativeFilePath = includeMatch[1];
          const thisFileLocation = vscode.workspace.getWorkspaceFolder(
            includedDocument.document.uri
          );
          if (!thisFileLocation) {
            continue;
          }
          const includeUri =
            includeRelativeFilePath[0] === "/"
              ? vscode.Uri.file(includeRelativeFilePath)
              : vscode.Uri.joinPath(
                  thisFileLocation.uri,
                  includeRelativeFilePath
                );

          if (this.documentsMap.has(includeUri.toString())) {
            continue;
          }

          await vscode.workspace.openTextDocument(includeUri).then(
            (doc) => {
              const includedDocumentToAdd = new IncludedDocument(
                includeMatch.index,
                includeMatch[0],
                vscode.Uri.parse(includedDocumentURI),
                doc
              );
              this.documentsMap.set(
                includeUri.toString(),
                includedDocumentToAdd
              );
              hasAddedDocuments = true;
            },
            () => {
              const includedDocumentToAdd = new IncludedDocument(
                includeMatch.index,
                includeMatch[0],
                vscode.Uri.parse(includedDocumentURI)
              );
              this.documentsMap.set(
                includeUri.toString(),
                includedDocumentToAdd
              );
              hasAddedDocuments = true;
            }
          );
        }
      },
      Promise.resolve()
    );

    return hasAddedDocuments;
  }

  updateCommodityMap() {
    const commodityLineRegex = new RegExp(
      /^(?<commodityDirective>commodity|D) (?<leadingNegative>-?)(?:[ \t])*(?<leadingUnit>(?:"[^0-9"\n;\-]+"|[^ "0-9\n\-;]+)?[ \t]*)(?<trailingNegative>-?)(?<amount>[0-9,. ]+[0-9,.]|[0-9])?(?<trailingUnit> ?(?:"[^0-9"\n;\-]+"|[^ "=0-9\n\-;]+))?/gm
    );

    this.documentsMap.forEach((includedDocument, includedUri) => {
      if (!includedDocument.document) {
        return;
      }
      const commodityMatches = includedDocument.document
        .getText()
        .matchAll(commodityLineRegex);
      for (const commodityMatch of commodityMatches) {
        const leadingUnit = commodityMatch.groups?.leadingUnit ?? "";
        const trailingUnit = commodityMatch.groups?.trailingUnit ?? "";
        const amountString = commodityMatch.groups?.amount ?? "";

        const commodity = new Commodity(
          leadingUnit,
          trailingUnit,
          amountString,
          true,
          includedDocument.defaultDecimalMark
        );
        const commodityID =
          commodityMatch[1] === "D" ? "" : commodity.commodityID;
        this.commodityMap.set(commodityID + includedUri, commodity);
      }
    });
  }

  updateAccounts() {
    const accountRegex = new RegExp(/^account ([^;\n ]+(?: [^;\n ]+)*)/gm);

    this.documentsMap.forEach((includedDocument) => {
      if (!includedDocument.document) {
        return;
      }
      const accountMatches = includedDocument.document
        .getText()
        .matchAll(accountRegex);
      for (const accountMatch of accountMatches) {
        const account = new Account(
          accountMatch[1],
          includedDocument.document.uri
        );
        this.accountMap.set(accountMatch[1], account);
      }
    });
  }

  parseTransactions() {
    const transactionGroupRegex2 = new RegExp(
      /^(?<date>(?:\d{2,4}[-\/.])?\d{2}[-\/.]\d{2})(?: (?<status>[!*]))?(?: (?<code>\([^;\n()]+\)))?(?: (?<description>[^;\n]+))?(?:;[^\n]*)?$\n^(?: +;[^\n]*$\n)*(?<postingLines>(?: +[\S][^\n]*)(?:\n +[\S][^\n]*)+)?/gm
    );

    let transactions: Transaction[] = [];

    this.documentsMap.forEach((includedDocument) => {
      if (!includedDocument.document) {
        return;
      }
      const transactionMatches = includedDocument.document
        .getText()
        .matchAll(transactionGroupRegex2);

      for (const transactionMatch of transactionMatches) {
        const transaction = new Transaction(
          transactionMatch,
          this.commodityMap,
          this.accountMap,
          includedDocument.document.uri,
          this.documentsMap,
          this.journalOptions
        );

        transactions.push(transaction);
      }
    });

    this.transactions = transactions;
  }
}

class Commodity {
  leadingUnit: string;
  trailingUnit: string;
  thousandSeparator: string;
  decimalMark: string;
  zerosAfterDecimal: number;
  declared: boolean;
  commodityID: string;

  constructor(
    leadingUnit: string,
    trailingUnit: string,
    amountString: string,
    declared: boolean,
    defaultDecimalMark: string
  ) {
    this.declared = declared;
    if (declared) {
      this.leadingUnit = leadingUnit;
      this.trailingUnit = trailingUnit;
    } else {
      this.leadingUnit = leadingUnit.trim();
      this.trailingUnit = trailingUnit.trim();
    }
    const lastDecimalTypeMarkRegex = new RegExp(/(,|\.)(?!.*(,|\.))/);
    const lastDecimalTypeMark =
      amountString.match(lastDecimalTypeMarkRegex)?.[0] ?? "";
    const hasDecimalTypeMark = lastDecimalTypeMark.length;
    let possibleThousandSeparator;
    let decimalMark;
    if (hasDecimalTypeMark > 0) {
      const lastDecimalTypeMarkCount =
        amountString.split(lastDecimalTypeMark).length - 1;
      if (lastDecimalTypeMarkCount > 1) {
        if (lastDecimalTypeMark === ",") {
          possibleThousandSeparator = ",";
          decimalMark = ".";
        } else {
          possibleThousandSeparator = ".";
          decimalMark = ",";
        }
      } else {
        if (lastDecimalTypeMark === ",") {
          possibleThousandSeparator = ".";
          decimalMark = ",";
        } else {
          possibleThousandSeparator = ",";
          decimalMark = ".";
        }
      }
    } else {
      decimalMark = defaultDecimalMark;
      possibleThousandSeparator = ",";
    }

    this.thousandSeparator =
      (amountString.match(possibleThousandSeparator)?.length ?? 0) > 0
        ? possibleThousandSeparator
        : "";

    this.decimalMark = decimalMark;
    const zerosAfterDecimalRegex = new RegExp(`\\${this.decimalMark}(\\d+)`);
    const zerosAfterDecimalMatch = amountString.match(zerosAfterDecimalRegex);
    this.zerosAfterDecimal = zerosAfterDecimalMatch
      ? zerosAfterDecimalMatch[1].length
      : 0;
    this.commodityID = this.leadingUnit.trim() + this.trailingUnit.trim();
  }

  hasCorrectSignature(amountString: string): boolean {
    const precisionInAmountString = (
      amountString.split(this.decimalMark)[1] ?? ""
    ).length;
    const signatureRegex = RegExp(
      `^(?:(?:\\d{1,3}(?:${escapeRegex(
        this.thousandSeparator
      )}\\d{3})*(?:\\.\\d{0,2})?)|(?:\\d*(?:${escapeRegex(
        this.decimalMark
      )}\\d{0,${precisionInAmountString.toString()}})?))[ \\t]*$`,
      "m"
    );

    const signatureMatch = amountString.match(signatureRegex);

    return signatureMatch ? true : false;
  }

  formatAmount(amount: number, zerosAfterDecimalInString: number): string {
    const precision =
      zerosAfterDecimalInString > this.zerosAfterDecimal
        ? zerosAfterDecimalInString
        : this.zerosAfterDecimal;
    const thousandGroupRegEX = /\B(?=(\d{3})+(?!\d))/g;

    const amountString = Math.abs(amount)
      .toFixed(precision)
      .replace(/\./g, this.decimalMark)
      .replace(thousandGroupRegEX, this.thousandSeparator);
    return amountString;
  }

  formatAmountWithCommodity(
    amount: number,
    zerosAfterDecimalInString: number,
    negativesInFrontOfCommodities: boolean,
    formatAmounts: boolean,
    originalAmountString: string
  ): string {
    const amountString = this.formatAmount(amount, zerosAfterDecimalInString);

    const formattedString =
      (negativesInFrontOfCommodities ? (amount < 0 ? "-" : " ") : "") +
      this.leadingUnit +
      (negativesInFrontOfCommodities ? "" : amount < 0 ? "-" : " ") +
      (formatAmounts ? amountString : originalAmountString) +
      this.trailingUnit;

    return formattedString;
  }

  alignmentPosition(formattedString: string): number {
    const lastDecimalMarkIndex = formattedString
      .substring(
        this.leadingUnit.length,
        formattedString.length - this.trailingUnit.length - 1
      )
      .lastIndexOf(this.decimalMark);
    return lastDecimalMarkIndex !== -1
      ? lastDecimalMarkIndex + this.leadingUnit.length
      : formattedString.length - this.trailingUnit.length;
  }

  formattedSplitAtDecimalMark(
    amount: number,
    zerosAfterDecimalInString: number,
    formatAmounts: boolean,
    negativesInFrontOfCommodities: boolean,
    amountString: string
  ): [string, string] {
    const formattedString = this.formatAmountWithCommodity(
      amount,
      zerosAfterDecimalInString,
      negativesInFrontOfCommodities,
      formatAmounts,
      amountString
    );

    const splitIndex = this.alignmentPosition(formattedString);
    const firstString = formattedString.substring(0, splitIndex);
    const secondString = formattedString.substring(splitIndex);
    return [firstString, secondString];
  }
}

class Transaction {
  index: number;
  transactionString: string;
  dateString: string;
  status: string;
  code: string;
  description: string;
  postingLines: string;
  postings: Posting[];
  commodityTotals: Map<string, number>;
  total: number;
  autoBalancePostings: number;
  documentUri: vscode.Uri;
  transactionAlignments: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  defaultDecimalMark: string;

  constructor(
    regExMatch: RegExpMatchArray,
    commodityMap: Map<string, Commodity>,
    accountMap: Map<string, Account>,
    documentUri: vscode.Uri,
    documentMap: Map<string, IncludedDocument>,
    journalOptions: JournalOptions
  ) {
    this.defaultDecimalMark =
      documentMap.get(documentUri.toString())?.defaultDecimalMark ?? "?";
    this.index = regExMatch.index ?? 0;
    this.documentUri = documentUri;
    this.transactionString = regExMatch[0];
    this.dateString = regExMatch.groups?.date ?? "";
    this.status = regExMatch.groups?.status ?? "";
    this.code = regExMatch.groups?.code ?? "";
    this.description = regExMatch.groups?.description ?? "";
    this.postingLines = regExMatch.groups?.postingLines ?? "";

    const postingsIndex =
      this.transactionString.match(escapeRegex(this.postingLines))?.index ?? 0;

    this.postings = this.postingLines
      .split("\n")
      .map((postingLine, lineIndex) => {
        const priorPostings = this.postingLines
          .split("\n")
          .slice(0, lineIndex)
          .join("\n");

        const indexInPostings =
          (this.postingLines
            .substring(priorPostings.length)
            .match(escapeRegex(postingLine))?.index ?? 0) +
          priorPostings.length;

        const postingLineIndex = postingsIndex + indexInPostings;

        return new Posting(
          postingLine,
          commodityMap,
          accountMap,
          this.index + postingLineIndex,
          this.documentUri,
          this,
          journalOptions
        );
      });
    this.autoBalancePostings = this.postings.reduce(
      (accumulator, currentValue) => {
        return accumulator + (currentValue.isAutoBalancing ? 1 : 0);
      },
      0
    );

    this.commodityTotals = this.postings.reduce(
      (accumulator, currentPosting) => {
        let costedAmount = currentPosting.amount;
        let costedCommodityID = currentPosting.postingCommodityID;
        if (currentPosting.hasPostingCost) {
          costedAmount =
            currentPosting.postingCostTypeString === "@@"
              ? currentPosting.postingCostAmount
              : currentPosting.postingCostAmount * currentPosting.amount;
          costedCommodityID = currentPosting.postingCostCommodityID;
        }
        if (accumulator.has(costedCommodityID)) {
          const currentSumOfCommodity = accumulator.get(costedCommodityID) ?? 0;
          accumulator.set(
            costedCommodityID,
            Number((currentSumOfCommodity + costedAmount).toFixed(10))
          );
        } else {
          accumulator.set(costedCommodityID, Number(costedAmount));
        }
        return accumulator;
      },
      new Map<string, number>()
    );

    let total = 0;
    for (const [commodityID, commodityTotal] of this.commodityTotals) {
      total += Math.abs(commodityTotal);
    }
    this.total = total;
  }

  updateTransactionAlignments(
    globalAlignments: number[],
    includeGlobalAlignments: boolean
  ) {
    if (this.postings.length > 0) {
      for (
        let componentIndex = 0;
        componentIndex < this.postings[0].postingLineComponents.length;
        componentIndex++
      ) {
        let maxAlignment = 0;
        this.postings.forEach((posting) => {
          const postingLineLength =
            posting.postingLineComponents[componentIndex][0].length +
            posting.postingLineComponents[componentIndex][1].length;
          const alignment =
            postingLineLength +
            (componentIndex > 0
              ? this.transactionAlignments[componentIndex - 1]
              : 0);
          if (maxAlignment < alignment) {
            maxAlignment = alignment;
          }
          if (
            includeGlobalAlignments &&
            maxAlignment < globalAlignments[componentIndex]
          ) {
            maxAlignment = globalAlignments[componentIndex];
          }
        });
        this.transactionAlignments[componentIndex] = maxAlignment;
      }
    }
  }
}

class Posting {
  transaction: Transaction;
  postingString: string;
  postingIndex: number;
  isAutoBalancing: boolean = false;
  documentUri: vscode.Uri;
  postingMatch: RegExpMatchArray | null;
  accountString: string = "";
  account: Account | undefined;
  hasAccount: boolean = false;
  postingLineComponents: [string, string][] = [];

  postingAmountString: string = "";
  postingAmountStringIndex: [number, number] = [0, 0];
  amount: number = 0;
  precisionInAmountString: number = 0;
  postingIsNegative: boolean = false;
  postingCommodityID: string = "";
  postingCommodityIndex: [number, number] = [0, 0];
  postingCommodity: Commodity = new Commodity("", "", "0.00", false, "?");
  amountHasCorrectSignature = true;
  hasPostingAmount = false;

  postingCostAmountString = "";
  postingCostAmountStringIndex: [number, number] = [0, 0];
  postingCostAmount: number = 0;
  precisionInPostingCostString: number = 0;
  postingCostIsNegative: boolean = false;
  postingCostTypeString: string = "";
  postingCostCommodityID: string = "";
  postingCostCommodityIndex: [number, number] = [0, 0];
  postingCostCommodity: Commodity = new Commodity("", "", "0.00", false, "?");
  hasPostingCost: boolean = false;
  postingCostHasCorrectSignature = true;

  assertionAmountString = "";
  assertionAmountStringIndex: [number, number] = [0, 0];
  assertionAmount: number = 0;
  precisionInAssertionString: number = 0;
  assertionIsNegative: boolean = false;
  assertionTypeString: string = "";
  assertionCommodityID: string = "";
  assertionCommodityIndex: [number, number] = [0, 0];
  assertionCommodity: Commodity = new Commodity("", "", "0.00", false, "?");
  hasAssertion: boolean = false;
  assertionHasCorrectSignature = true;

  assertionCostAmountString = "";
  assertionCostAmountStringIndex: [number, number] = [0, 0];
  assertionCostAmount: number = 0;
  precisionInAssertionCostString: number = 0;
  assertionCostIsNegative: boolean = false;
  assertionCostTypeString: string = "";
  assertionCostCommodityID: string = "";
  assertionCostCommodityIndex: [number, number] = [0, 0];
  assertionCostCommodity: Commodity = new Commodity("", "", "0.00", false, "?");
  hasAssertionCost: boolean = false;
  assertionCostHasCorrectSignature = true;

  hasComment: boolean = false;
  postingComment: string = "";

  postingRegex: RegExp = RegExp(
    /^(?=.*[^\s].*)(?:[ \t]+)(?<account>[^;\n ]+(?: [^;\n ]+)*)?(?:[ \t]{2,})?(?:(?<postingLeadingNegative>[-+]?)(?:[ \t]*)(?<postingLeadingCommodityUnit>(?:"[^"\n]+"|[^ "0-9\n\-;@]+)?(?:[ \t]*))(?<postingTrailingNegative>[-+]?)(?:[ \t]*)(?<postingAmount>(?:[0-9]+[0-9,. ]?[0-9,.]+)|[0-9])?(?<postingTrailingCommodityUnit>(?:[ \t]*)(?:"[^"\n]+"|[^ "=0-9\n\-;@]+))?)?(?:(?:[ \t]*)(?<postingCostType>@{1,2})(?:[ \t]*)(?:(?<postingCostLeadingNegative>[-+]?)(?:[ \t]*)(?<postingCostLeadingCommodityUnit>(?:"[^"\n]+"|[^ "0-9\n\-;@]+)?(?:[ \t]*))(?<postingCostTrailingNegative>[-+]?)(?:[ \t]*)(?<postingCostAmount>(?:[0-9]+[0-9,. ]?[0-9,.]+)|[0-9])(?<postingCostTrailingCommodityUnit>(?:[ \t]*)(?:"[^"\n]+"|[^ "=0-9\n\-;@]+))?))?(?:(?:[ \t]*)(?<assertionType>={1,2})(?:[ \t]*)(?:(?<assertionLeadingNegative>[-+]?)(?:[ \t]*)(?<assertionLeadingCommodityUnit>(?:"[^"\n]+"|[^ "0-9\n\-;@]+)?(?:[ \t]*))(?<assertionTrailingNegative>[-+]?)(?:[ \t]*)(?<assertionAmount>(?:[0-9]+[0-9,. ]?[0-9,.]+)|[0-9])(?<assertionTrailingCommodityUnit>(?:[ \t]*)(?:"[^"\n]+"|[^ "=0-9\n\-;@]+))?))?(?:(?:[ \t]*)(?<assertionCostType>@{1,2})(?:[ \t]*)(?:(?<assertionCostLeadingNegative>[-+]?)(?:[ \t]*)(?<assertionCostLeadingCommodityUnit>(?:"[^"\n]+"|[^ "0-9\n\-;@]+)?(?:[ \t]*))(?<assertionCostTrailingNegative>[-+]?)(?:[ \t]*)(?<assertionCostAmount>(?:[0-9]+[0-9,. ]?[0-9,.]+)|[0-9])(?<assertionCostTrailingCommodityUnit>(?:[ \t]*)(?:"[^"\n]+"|[^ "=0-9\n\-;@]+))?))?(?:[ \t]*)(?<postingComment>;[^\n]*)?(?:[ \t])*$/dm
  );

  constructor(
    postingString: string,
    commodityMap: Map<string, Commodity>,
    accountMap: Map<string, Account>,
    postingIndex: number,
    documentUri: vscode.Uri,
    transaction: Transaction,
    journalOptions: JournalOptions
  ) {
    this.transaction = transaction;
    this.documentUri = documentUri;
    this.postingIndex = postingIndex;
    this.postingString = postingString;

    const match = postingString.match(this.postingRegex);
    this.postingMatch = match;

    if (!match) {
      return;
    }

    this.postingComment = match.groups?.postingComment ?? "";
    this.hasComment = this.postingComment.length > 0;

    this.accountString = match.groups?.account ?? "";
    this.account = accountMap.get(this.accountString);
    this.hasAccount = match.groups?.account ?? false ? true : false;

    this.hasPostingAmount = match.groups?.postingAmount ?? false ? true : false;
    this.postingAmountString = match.groups?.postingAmount ?? "";
    this.postingIsNegative =
      (match.groups?.postingLeadingNegative ?? "") === "-" ||
      (match.groups?.postingTrailingNegative ?? "") === "-";
    const postingLeadingCommodityUnit =
      match.groups?.postingLeadingCommodityUnit ?? "";
    const postingTrailingCommodityUnit =
      match.groups?.postingTrailingCommodityUnit ?? "";
    this.postingCommodityID =
      postingLeadingCommodityUnit.trim() + postingTrailingCommodityUnit.trim();
    this.postingCommodity =
      commodityMap.get(this.postingCommodityID + this.documentUri.toString()) ??
      new Commodity(
        postingLeadingCommodityUnit,
        postingTrailingCommodityUnit,
        this.postingAmountString,
        false,
        transaction.defaultDecimalMark
      );

    this.isAutoBalancing =
      !this.hasPostingAmount && this.accountString.length > 0;

    this.postingAmountStringIndex = match.indices?.groups?.account ?? [0, 0];
    this.postingCostAmountStringIndex = match.indices?.groups
      ?.postingCostAmount ?? [0, 0];
    this.assertionAmountStringIndex = match.indices?.groups
      ?.assertionAmount ?? [0, 0];
    this.assertionCostAmountStringIndex = match.indices?.groups
      ?.assertionCostAmount ?? [0, 0];

    const postingLeadingCommodityIndex = match.indices?.groups
      ?.postingLeadingCommodityUnit ?? [0, 0];
    const postingCostLeadingCommodityIndex = match.indices?.groups
      ?.postingCostLeadingCommodityUnit ?? [0, 0];
    const assertionLeadingCommodityIndex = match.indices?.groups
      ?.assertionLeadingCommodityUnit ?? [0, 0];
    const assertionCostLeadingCommodityIndex = match.indices?.groups
      ?.assertionCostLeadingCommodityUnit ?? [0, 0];

    const postingTrailingCommodityIndex = match.indices?.groups
      ?.postingTrailingCommodityUnit ?? [0, 0];
    const postingCostTrailingCommodityIndex = match.indices?.groups
      ?.postingCostTrailingCommodityUnit ?? [0, 0];
    const assertionTrailingCommodityIndex = match.indices?.groups
      ?.assertionTrailingCommodityUnit ?? [0, 0];
    const assertionCostTrailingCommodityIndex = match.indices?.groups
      ?.assertionCostTrailingCommodityUnit ?? [0, 0];

    this.postingCommodityIndex =
      postingLeadingCommodityIndex[1] - postingLeadingCommodityIndex[0] >=
      postingTrailingCommodityIndex[1] - postingTrailingCommodityIndex[0]
        ? postingLeadingCommodityIndex
        : postingTrailingCommodityIndex;
    this.postingCostCommodityIndex =
      postingCostLeadingCommodityIndex[1] -
        postingCostLeadingCommodityIndex[0] >=
      postingCostTrailingCommodityIndex[1] -
        postingCostTrailingCommodityIndex[0]
        ? postingCostLeadingCommodityIndex
        : postingCostTrailingCommodityIndex;
    this.assertionCommodityIndex =
      assertionLeadingCommodityIndex[1] - assertionLeadingCommodityIndex[0] >=
      assertionTrailingCommodityIndex[1] - assertionTrailingCommodityIndex[0]
        ? assertionLeadingCommodityIndex
        : assertionTrailingCommodityIndex;
    this.assertionCostCommodityIndex =
      assertionCostLeadingCommodityIndex[1] -
        assertionCostLeadingCommodityIndex[0] >=
      assertionCostTrailingCommodityIndex[1] -
        assertionCostTrailingCommodityIndex[0]
        ? assertionCostLeadingCommodityIndex
        : assertionCostTrailingCommodityIndex;

    this.hasAssertion = match.groups?.assertionAmount ?? false ? true : false;
    this.assertionTypeString = match.groups?.assertionType ?? "";
    this.assertionAmountString = match.groups?.assertionAmount ?? "";
    this.assertionIsNegative =
      (match.groups?.assertionLeadingNegative ?? "") === "-" ||
      (match.groups?.assertionTrailingNegative ?? "") === "-";
    const assertionLeadingCommodityUnit =
      match.groups?.assertionLeadingCommodityUnit ?? "";
    const assertionTrailingCommodityUnit =
      match.groups?.assertionTrailingCommodityUnit ?? "";
    this.assertionCommodityID =
      assertionLeadingCommodityUnit.trim() +
      assertionTrailingCommodityUnit.trim();
    this.assertionCommodity =
      commodityMap.get(
        this.assertionCommodityID + this.documentUri.toString()
      ) ??
      new Commodity(
        assertionLeadingCommodityUnit,
        assertionTrailingCommodityUnit,
        this.assertionAmountString,
        false,
        transaction.defaultDecimalMark
      );

    this.hasPostingCost =
      match.groups?.postingCostAmount ?? false ? true : false;
    this.postingCostTypeString = match.groups?.postingCostType ?? "";
    this.postingCostAmountString = match.groups?.postingCostAmount ?? "";
    this.postingCostIsNegative =
      (match.groups?.postingCostLeadingNegative ?? "") === "-" ||
      (match.groups?.postingCostTrailingNegative ?? "") === "-";

    const postingCostLeadingCommodityUnit =
      match.groups?.postingCostLeadingCommodityUnit ?? "";
    const postingCostTrailingCommodityUnit =
      match.groups?.postingCostTrailingCommodityUnit ?? "";

    this.postingCostCommodityID =
      postingCostLeadingCommodityUnit.trim() +
      postingCostTrailingCommodityUnit.trim();
    this.postingCostCommodity =
      commodityMap.get(
        this.postingCostCommodityID + this.documentUri.toString()
      ) ??
      new Commodity(
        postingCostLeadingCommodityUnit,
        postingCostTrailingCommodityUnit,
        this.postingCostAmountString,
        false,
        transaction.defaultDecimalMark
      );

    this.hasAssertionCost =
      match.groups?.assertionCostAmount ?? false ? true : false;
    this.assertionCostTypeString = match.groups?.assertionCostType ?? "";
    this.assertionCostAmountString = match.groups?.assertionCostAmount ?? "";
    this.assertionCostIsNegative =
      (match.groups?.assertionCostLeadingNegative ?? "") === "-" ||
      (match.groups?.assertionCostTrailingNegative ?? "") === "-";

    const assertionCostLeadingCommodityUnit =
      match.groups?.assertionCostLeadingCommodityUnit ?? "";
    const assertionCostTrailingCommodityUnit =
      match.groups?.assertionCostTrailingCommodityUnit ?? "";

    this.assertionCostCommodityID =
      assertionCostLeadingCommodityUnit.trim() +
      assertionCostTrailingCommodityUnit.trim();
    this.assertionCostCommodity =
      commodityMap.get(
        this.assertionCostCommodityID + this.documentUri.toString()
      ) ??
      new Commodity(
        assertionCostLeadingCommodityUnit,
        assertionCostTrailingCommodityUnit,
        this.assertionCostAmountString,
        false,
        transaction.defaultDecimalMark
      );

    if (this.hasPostingAmount) {
      this.amount =
        parseFloat(
          this.postingAmountString
            .replace(
              RegExp(`[^0-9\\${this.postingCommodity.decimalMark}]`, "g"),
              ""
            )
            .replace(this.postingCommodity.decimalMark, ".")
        ) * (this.postingIsNegative ? -1 : 1);

      this.precisionInAmountString = (
        this.postingAmountString.split(this.postingCommodity.decimalMark)[1] ??
        ""
      ).length;

      this.amountHasCorrectSignature =
        this.postingCommodity.hasCorrectSignature(this.postingAmountString);
    }

    if (this.hasPostingCost) {
      this.postingCostAmount =
        parseFloat(
          this.postingCostAmountString
            .replace(
              RegExp(`[^0-9\\${this.postingCostCommodity.decimalMark}]`, "g"),
              ""
            )
            .replace(this.postingCostCommodity.decimalMark, ".")
        ) * (this.postingCostIsNegative ? -1 : 1);

      this.precisionInPostingCostString = (
        this.postingCostAmountString.split(
          this.postingCostCommodity.decimalMark
        )[1] ?? ""
      ).length;

      this.postingCostHasCorrectSignature =
        this.postingCostCommodity.hasCorrectSignature(
          this.postingCostAmountString
        );
    }

    if (this.hasAssertion) {
      this.assertionAmount =
        parseFloat(
          this.assertionAmountString
            .replace(
              RegExp(`[^0-9\\${this.assertionCommodity.decimalMark}]`, "g"),
              ""
            )
            .replace(this.assertionCommodity.decimalMark, ".")
        ) * (this.assertionIsNegative ? -1 : 1);

      this.precisionInAssertionString = (
        this.assertionAmountString.split(
          this.assertionCommodity.decimalMark
        )[1] ?? ""
      ).length;

      this.assertionHasCorrectSignature =
        this.assertionCommodity.hasCorrectSignature(this.assertionAmountString);
    }

    if (this.hasAssertionCost) {
      this.assertionCostAmount =
        parseFloat(
          this.assertionCostAmountString
            .replace(
              RegExp(`[^0-9\\${this.assertionCostCommodity.decimalMark}]`, "g"),
              ""
            )
            .replace(this.assertionCostCommodity.decimalMark, ".")
        ) * (this.assertionCostIsNegative ? -1 : 1);

      this.precisionInAssertionCostString = (
        this.assertionCostAmountString.split(
          this.assertionCostCommodity.decimalMark
        )[1] ?? ""
      ).length;

      this.assertionCostHasCorrectSignature =
        this.assertionCostCommodity.hasCorrectSignature(
          this.assertionCostAmountString
        );
    }

    // [stringFromPriorALignmentToPaddingPoint,stringFromPaddingPointToNextAlignment]}

    let accountString = "    ";
    if (this.hasAccount) {
      accountString += this.accountString + "  ";
    }

    let amountStringPriorToAlignment = "";
    let amountStringPostAlignment = "";
    if (this.hasPostingAmount) {
      [amountStringPriorToAlignment, amountStringPostAlignment] =
        this.postingCommodity.formattedSplitAtDecimalMark(
          this.amount,
          this.precisionInAmountString,
          journalOptions.formatAmounts,
          journalOptions.negativesInFrontOfCommodities,
          this.postingAmountString
        );
    }

    let postCostStringPriorAlignment = "";
    let postCostStringPostAlignment = "";
    let amountToCostTypePadding = "";
    let postCostsToPadding = "";
    if (this.hasPostingCost) {
      [postCostStringPriorAlignment, postCostStringPostAlignment] =
        this.postingCostCommodity.formattedSplitAtDecimalMark(
          this.postingCostAmount,
          this.precisionInPostingCostString,
          journalOptions.formatAmounts,
          journalOptions.negativesInFrontOfCommodities,
          this.postingCostAmountString
        );
      amountToCostTypePadding = " ";
      postCostsToPadding = this.postingCostTypeString + " ";
    }

    let assertionStringPriorAlignment = "";
    let assertionStringPostAlignment = "";
    let costToAssertionTypePadding = "";
    let assertionToPadding = "";
    if (this.hasAssertion) {
      [assertionStringPriorAlignment, assertionStringPostAlignment] =
        this.assertionCommodity.formattedSplitAtDecimalMark(
          this.assertionAmount,
          this.precisionInAssertionString,
          journalOptions.formatAmounts,
          journalOptions.negativesInFrontOfCommodities,
          this.assertionAmountString
        );
      costToAssertionTypePadding = " ";
      assertionToPadding = this.assertionTypeString + " ";
    }

    let assertionCostStringPriorAlignment = "";
    let assertionCostStringPostAlignment = "";

    let assertionCostToPadding = "";
    if (this.hasAssertionCost) {
      [assertionCostStringPriorAlignment, assertionCostStringPostAlignment] =
        this.assertionCostCommodity.formattedSplitAtDecimalMark(
          this.assertionCostAmount,
          this.precisionInAssertionCostString,
          journalOptions.formatAmounts,
          journalOptions.negativesInFrontOfCommodities,
          this.assertionCostAmountString
        );
      assertionCostToPadding = this.assertionCostTypeString + " ";
    }

    let commentStringPostAlignment = "";
    let assertionCostToComment = "";
    if (this.hasComment) {
      assertionCostToComment = " ";
      commentStringPostAlignment = this.postingComment;
    }

    this.postingLineComponents.push([
      accountString,
      amountStringPriorToAlignment,
    ]);
    this.postingLineComponents.push([
      amountStringPostAlignment,
      amountToCostTypePadding,
    ]);

    this.postingLineComponents.push([
      postCostsToPadding,
      postCostStringPriorAlignment,
    ]);
    this.postingLineComponents.push([
      postCostStringPostAlignment,
      costToAssertionTypePadding,
    ]);

    this.postingLineComponents.push([
      assertionToPadding,
      assertionStringPriorAlignment,
    ]);
    this.postingLineComponents.push([
      assertionStringPostAlignment,
      costToAssertionTypePadding,
    ]);

    this.postingLineComponents.push([
      assertionCostToPadding,
      assertionCostStringPriorAlignment,
    ]);
    this.postingLineComponents.push([
      assertionCostStringPostAlignment,
      assertionCostToComment,
    ]);
    this.postingLineComponents.push([commentStringPostAlignment, ""]);
  }

  formatTransactionAlignedPostingString(
    alignmentType: AlignmentType,
    globalAlignmentOffsets: number[]
  ): string {
    let formattedLine = "";

    this.postingLineComponents.forEach((postingLineComponent, index) => {
      const globalAlignment = globalAlignmentOffsets[index];
      const localAlignment = this.transaction.transactionAlignments[index];

      const alignment =
        alignmentType === AlignmentType.global
          ? globalAlignment
          : localAlignment;

      const currentLength =
        formattedLine.length +
        postingLineComponent[0].length +
        postingLineComponent[1].length;
      const padding =
        currentLength < alignment && currentLength > formattedLine.length
          ? " ".repeat(alignment - currentLength)
          : "";

      formattedLine +=
        postingLineComponent[0] + padding + postingLineComponent[1];
    });

    return formattedLine.trimEnd();
  }
}

class Account {
  accountName: string;
  documentURI: vscode.Uri;

  constructor(accountName: string, documentURI: vscode.Uri) {
    this.accountName = accountName;
    this.documentURI = documentURI;
  }
}

class IncludedDocument {
  document?: vscode.TextDocument;
  includeIndex: number;
  includeString: string;
  includingDocumentURI: vscode.Uri;
  diagnostics: vscode.Diagnostic[];
  defaultDecimalMark: string = "?";

  constructor(
    includeIndex: number,
    includeString: string,
    includingDocumentURI: vscode.Uri,
    document?: vscode.TextDocument
  ) {
    this.document = document;
    this.includeIndex = includeIndex;
    this.includingDocumentURI = includingDocumentURI;
    this.diagnostics = [];
    this.includeString = includeString;
  }
}
