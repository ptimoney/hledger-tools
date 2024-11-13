# hledger Tools

VSCode extension for the text-based double-entry accounting tool
[hledger](https://hledger.org/start.html)

## Features:

- Diagnostics:
  - Balanced transaction checking - with multiple commodities & costs
  - Handles autobalanced single currency transactions
  - Commodity declaration checking
  - Account declaration checking
  - Checks signatures (thousand & decimal markers) of commodities
- Account completion
- Auto formatting
  - Auto formatting of commodities.
  - Auto alignment
- Syntax Highlighting (heavily based on [mhansen/hledger-vscode](https://github.com/mhansen/hledger-vscode))

## Known issues:

- Performance is likely terrible.

## Unsupported

- Auto postings - balance or assertion checking
- Secondary dates

## TODO

- Diagnostic if commodity declared without decimal (warning) and no default declared (error)
- Assertion checking
- Payee declaration checking
- Tag declaration checking
- Goto Account declaration
- Account renaming
- Balance on Hover
- Performance
