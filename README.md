# This tool has been deprecated and is replaced by [hledger-vscode](https://github.com/ptimoney/hledger-vscode)

# hledger Tools

VSCode extension for the text-based double-entry accounting tool
[hledger](https://hledger.org/start.html)

## Features

- Diagnostics:
  - Balanced transaction checking - with multiple commodities & costs
  - Handles autobalanced single currency transactions
  - Commodity declaration checking
  - Account declaration checking
  - Checks signatures (thousand & decimal markers) of commodities
- Account completion
- Auto formatting
  - Auto formatting of commodities.
  - Auto alignmentled
- Syntax Highlighting (heavily based on [mhansen/hledger-vscode](https://github.com/mhansen/hledger-vscode))
- Parsing of included files with some support for glob patterns.

## Known issues

- Minimal/No windows support. This is planned to be fixed
- Issues using globs in includes
  - Globs don't function in abosolute file references
- Performance is likely terrible.

## Unsupported

- Auto postings - balance or assertion checking
- Secondary dates

## ToDo

- Windows support
- Diagnostic if a commodity is declared without decimal (warning) and no default declared (error)
- Assertion checking
- Payee declaration checking
- Tag declaration checking
- Goto Account declaration
- Account renaming
- Balance on Hover
- Performance improvements

### V0.1

- Fixed an issue after trying to include a file which wasn't there
- (Reverted) Added support for glob patterns in include statements
- Some performance improvments
- Some functionality improvements for windows
