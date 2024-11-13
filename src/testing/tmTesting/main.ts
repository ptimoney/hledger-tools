import * as fs from "fs";
import * as path from "path";
import { build, testsPath, snapshotsPath } from "./build";

async function main() {
  const inFiles = fs
    .readdirSync(testsPath, { withFileTypes: true })
    .filter((file) => file.isFile() && file.name.endsWith(".in.hledger"));

  for (let inFileDirent of inFiles) {
    let inFile = path.join(testsPath, inFileDirent.name);
    let outFile = path.join(
      snapshotsPath,
      inFileDirent.name.substring(
        0,
        inFileDirent.name.length - ".in.hledger".length
      ) + ".want.hledger"
    );
    let converted: string = await build(
      fs.readFileSync(inFile, { encoding: "utf8" }),
      inFileDirent.name
    );
    fs.writeFileSync(outFile, converted, { encoding: "utf8" });
  }
}

main();
