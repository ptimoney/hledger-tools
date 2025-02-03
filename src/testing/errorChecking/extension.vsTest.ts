import * as assert from "assert";

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
import * as vscode from "vscode";
import { Journal, JournalOptions } from "../../journal";
import { check, CheckOptions } from "../../check";

suite("Extension Test Suite", () => {
  suiteTeardown(() => {
    vscode.window.showInformationMessage("All tests done!");
  });

  test("Sample test", async () => {
    const journalOptions: JournalOptions = {
      formatAmounts: false,
      negativesInFrontOfCommodities: true,
    };
    const journalDoc = await vscode.workspace.openTextDocument(
      vscode.Uri.parse("unbalancedTransaction.want.journal")
    );
    // const journal = new Journal(journalDoc, journalOptions);
    // await journal.updateJournal();
    // const checkOptions: CheckOptions = {
    //   checkCommodities: true,
    //   checkAccounts: true,
    //   checkOrderedDates: true,
    //   checkPayees: true,
    //   checkTags: true,
    //   checkRecentAssertions: true,
    //   checkUniqueLeafNames: true,
    // };
    // const errors = check(journal, checkOptions);
    // console.log(errors);

    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });
});
