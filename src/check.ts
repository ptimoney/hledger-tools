import * as vscode from "vscode";
import { Journal } from "./journal";

export interface CheckOptions {
  checkCommodities: boolean;
  checkAccounts: boolean;
  checkOrderedDates: boolean;
  checkPayees: boolean;
  checkTags: boolean;
  checkRecentAssertions: boolean;
  checkUniqueLeafNames: boolean;
}

interface HledgerError {
  message: string;
  startIndex: number;
  endIndex: number;
  severity: vscode.DiagnosticSeverity;
  file: vscode.Uri;
}

export function check(
  journal: Journal,
  checkOptions: CheckOptions
): HledgerError[] {
  let errors: HledgerError[] = [];

  const checkCmdts = checkOptions.checkCommodities;
  const checkAccounts = checkOptions.checkAccounts;
  const checkDO = checkOptions.checkOrderedDates;
  const checkPayees = checkOptions.checkPayees;
  const checkTags = checkOptions.checkTags;
  const checkRA = checkOptions.checkRecentAssertions;
  const checkULN = checkOptions.checkUniqueLeafNames;

  // CHECK INCLUDES
  journal.documentsMap.forEach((document, documentURI) => {
    if (!document.document) {
      const message = "This file does not exist at " + documentURI;
      const includeOffset = "include ".length;
      const error: HledgerError = {
        message: message,
        startIndex: document.includeIndex + includeOffset,
        endIndex: document.includeIndex + document.includeString.length,
        severity: vscode.DiagnosticSeverity.Error,
        file: document.includingDocumentURI,
      };
      errors.push(error);
    }
  });

  // CHECK TRANSACTIONS
  journal.transactions.forEach((transaction, transactionIndex) => {
    // CHECK BALANCED
    if (transaction.autoBalancePostings === 0) {
      if (transaction.total !== 0) {
        const postings = transaction.postings;

        let totalsString = "";
        transaction.commodityTotals.forEach((value, number) => {
          totalsString += " " + number.toString() + value.toString() + ",";
        });

        const message = `This transaction is unbalanced. The real postings' sum should be 0 but is:${totalsString} Consider adjusting this entry's amounts, or adding missing postings.`;

        const error: HledgerError = {
          message: message,
          startIndex: postings[0].postingIndex,
          endIndex:
            postings[postings.length - 1].postingIndex +
            postings[postings.length - 1].postingString.length,
          severity: vscode.DiagnosticSeverity.Error,
          file: transaction.documentUri,
        };

        errors.push(error);
      }
    }
    // CHECK AT MOST ONE AUTOBALANCE
    if (transaction.autoBalancePostings > 1) {
      const postings = transaction.postings;

      const error: HledgerError = {
        message:
          "Multiple auto balancing posts in are included in this transaction",
        startIndex: postings[0].postingIndex,
        endIndex:
          postings[postings.length - 1].postingIndex +
          postings[postings.length - 1].postingString.length,
        severity: vscode.DiagnosticSeverity.Error,
        file: transaction.documentUri,
      };

      errors.push(error);
    }
    // CHECK TRANSACTION ORDERING
    if (checkDO) {
      if (transactionIndex > 0) {
        const x = journal.transactions[transactionIndex - 1];
        const CompDate = Date.parse(x.dateString);
        const CompURI = x.documentUri;
        const ThisDate = Date.parse(transaction.dateString);
        const ThisURI = transaction.documentUri;
        if (ThisURI === CompURI && CompDate > ThisDate) {
          const error: HledgerError = {
            message:
              "This transaction is out of date order with the previous transaction. Consider moving this entry into date order, or adjusting its date.",
            startIndex: transaction.index,
            endIndex: transaction.index + transaction.dateString.length,
            severity: vscode.DiagnosticSeverity.Warning,
            file: transaction.documentUri,
          };
          errors.push(error);
        }
      }
    }
    // CHECK POSTINGS
    transaction.postings.forEach((posting) => {
      if (!posting.postingMatch) {
        return;
      }
      // CHECK ACCOUNT DECLARED
      if (checkAccounts) {
        if (!posting.account && posting.hasAccount) {
          const error: HledgerError = {
            message: `The account "${posting.accountString}" has not been declared. Consider adding an account directive.`,
            startIndex:
              posting.postingIndex +
              posting.postingString.indexOf(posting.accountString),
            endIndex:
              posting.postingIndex +
              posting.postingString.indexOf(posting.accountString) +
              posting.accountString.length,
            severity: vscode.DiagnosticSeverity.Warning,
            file: transaction.documentUri,
          };
          errors.push(error);
        }
      }

      // CHECK COMMODITIES DECLARED
      if (checkCmdts) {
        // CHECK POSTING COMMODITY
        if (
          !posting.isAutoBalancing &&
          posting.hasPostingAmount &&
          !posting.postingCommodity.declared
        ) {
          const error: HledgerError = {
            message: `The commodity "${posting.postingCommodityID}" has not been declared. Consider adding a commodity directive`,
            startIndex: posting.postingIndex + posting.postingCommodityIndex[0],
            endIndex: posting.postingIndex + posting.postingCommodityIndex[1],
            severity: vscode.DiagnosticSeverity.Warning,
            file: transaction.documentUri,
          };
          errors.push(error);
        }
        // CHECK ASSERTION COMMODITY
        if (posting.hasAssertion && !posting.assertionCommodity.declared) {
          const error: HledgerError = {
            message: `The commodity "${posting.assertionCommodityID}" has not been declared. Consider adding a commodity directive`,
            startIndex:
              posting.postingIndex + posting.assertionCommodityIndex[0],
            endIndex: posting.postingIndex + posting.assertionCommodityIndex[1],
            severity: vscode.DiagnosticSeverity.Warning,
            file: transaction.documentUri,
          };
          errors.push(error);
        }
        // CHECK COST COMMODITY
        if (posting.hasPostingCost && !posting.postingCostCommodity.declared) {
          const error: HledgerError = {
            message: `The commodity "${posting.postingCostCommodityID}" has not been declared. Consider adding a commodity directive`,
            startIndex:
              posting.postingIndex + posting.postingCostCommodityIndex[0],
            endIndex:
              posting.postingIndex + posting.postingCostCommodityIndex[1],
            severity: vscode.DiagnosticSeverity.Warning,
            file: transaction.documentUri,
          };
          errors.push(error);
        }
        // CHECK ASSERTION COST COMMODITY
        if (
          posting.hasAssertionCost &&
          !posting.assertionCostCommodity.declared
        ) {
          const error: HledgerError = {
            message: `The commodity "${posting.assertionCostCommodityID}" has not been declared. Consider adding a commodity directive`,
            startIndex:
              posting.postingIndex + posting.assertionCostCommodityIndex[0],
            endIndex:
              posting.postingIndex + posting.assertionCostCommodityIndex[1],
            severity: vscode.DiagnosticSeverity.Warning,
            file: transaction.documentUri,
          };
          errors.push(error);
        }
      }

      // CHECK CORRECT SIGNATURES
      // CHECK CORRECT POST SIGNATURE
      if (!posting.amountHasCorrectSignature) {
        const error: HledgerError = {
          message: "The signature of this doesn't match the declared commodity",
          startIndex:
            posting.postingIndex + posting.postingAmountStringIndex[0],
          endIndex: posting.postingIndex + posting.postingAmountStringIndex[1],
          severity: vscode.DiagnosticSeverity.Error,
          file: transaction.documentUri,
        };
        errors.push(error);
      }

      // CHECK CORRECT POST COST SIGNATURE
      if (!posting.postingCostHasCorrectSignature) {
        const error: HledgerError = {
          message: "The signature of this doesn't match the declared commodity",
          startIndex:
            posting.postingIndex + posting.postingCostAmountStringIndex[0],
          endIndex:
            posting.postingIndex + posting.postingCostAmountStringIndex[1],
          severity: vscode.DiagnosticSeverity.Error,
          file: transaction.documentUri,
        };
        errors.push(error);
      }

      // CHECK CORRECT ASSERTION SIGNATURE
      if (!posting.assertionHasCorrectSignature) {
        const error: HledgerError = {
          message: "The signature of this doesn't match the declared commodity",
          startIndex:
            posting.postingIndex + posting.assertionAmountStringIndex[0],
          endIndex:
            posting.postingIndex + posting.assertionAmountStringIndex[1],
          severity: vscode.DiagnosticSeverity.Error,
          file: transaction.documentUri,
        };
        errors.push(error);
      }

      // CHECK CORRECT ASSERTION COST SIGNATURE
      if (!posting.assertionCostHasCorrectSignature) {
        const error: HledgerError = {
          message: "The signature of this doesn't match the declared commodity",
          startIndex:
            posting.postingIndex + posting.assertionCostAmountStringIndex[0],
          endIndex:
            posting.postingIndex + posting.assertionCostAmountStringIndex[1],
          severity: vscode.DiagnosticSeverity.Error,
          file: transaction.documentUri,
        };
        errors.push(error);
      }
    });
  });

  return errors;
}
