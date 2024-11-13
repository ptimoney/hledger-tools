import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as vsctm from "vscode-textmate/release/main";
import * as oniguruma from "vscode-oniguruma";

const basePath = "./tests";
export const testsPath = basePath + "/cases";
export const snapshotsPath = basePath + "/specs";

/**
 * Utility to read a file as a promise
 */
function readFile(path: fs.PathOrFileDescriptor): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    fs.readFile(path, (error, data) => (error ? reject(error) : resolve(data)));
  });
}

const wasmBin = fs.readFileSync(
  path.join(__dirname, "../../node_modules/vscode-oniguruma/release/onig.wasm")
).buffer;
const vscodeOnigurumaLib = oniguruma.loadWASM(wasmBin).then(() => {
  return {
    createOnigScanner(patterns: string[]) {
      return new oniguruma.OnigScanner(patterns);
    },
    createOnigString(s: string) {
      return new oniguruma.OnigString(s);
    },
  };
});

// Create a registry that can create a grammar from a scope name.
const registry = new vsctm.Registry({
  onigLib: vscodeOnigurumaLib,
  loadGrammar: async (scopeName) => {
    const fileName = "syntaxes/hledger.tmLanguage.json";
    if (scopeName === "source.hledger") {
      // https://github.com/textmate/javascript.tmbundle/blob/master/Syntaxes/JavaScript.plist
      const data = await readFile(fileName);
      return vsctm.parseRawGrammar(data.toString(), fileName);
    }
    console.log(`Unknown scope name: ${scopeName}`);
    return null;
  },
});

export async function build(input: string, fileName: string): Promise<string> {
  const grammar = await registry.loadGrammar("source.hledger");
  if (!grammar) {
    return "";
  }
  let title = fileName.substring(0, fileName.length - ".in.hledger".length);

  let ruleStack = null;
  let lines = [];
  lines.push(`; SYNTAX TEST "source.hledger" "${title}"`);
  for (let inputLine of input.split(/\r?\n/)) {
    let r = grammar.tokenizeLine(inputLine, ruleStack);
    lines.push(inputLine);
    for (let t of r.tokens) {
      // First element is always source.hledger. Drop it.
      t.scopes.shift();
      if (t.scopes.length === 0) {
        // If we have no scopes, skip
        continue;
      }
      let outputLine = ";";
      let i = 1;
      for (; i < t.startIndex; i++) {
        if (inputLine.charAt(i) === "\t") {
          outputLine += "\t";
        } else {
          outputLine += " ";
        }
      }
      for (; i < t.endIndex; i++) {
        outputLine += "^";
      }
      t.scopes.forEach((scope) => {
        outputLine += " " + scope.toString();
      });

      lines.push(outputLine);
    }
    ruleStack = r.ruleStack;
  }
  return lines.join(os.EOL);
}
