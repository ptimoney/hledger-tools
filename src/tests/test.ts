import * as assert from "assert";
import * as fs from "fs";
import build from "./build";
import { testsPath, snapshotsPath } from "./main";

let files = fs
  .readdirSync(testsPath, { encoding: "utf8" })
  .filter((f) => f.match(/.in.hledger$/));

describe("Hledger test case files", () => {
  for (let f of files) {
    it(f, async () => {
      let inHledger = fs.readFileSync(`./src/tests/cases/${f}`, {
        encoding: "utf8",
      });
      let wantFilename =
        snapshotsPath +
        f.substring(0, f.length - ".in.hledger".length) +
        ".want";
      let want = fs.readFileSync(wantFilename, { encoding: "utf8" });
      let got = await build(inHledger);
      assert.equal(got, want);
    });
  }
});
