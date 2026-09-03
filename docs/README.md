# docs/

Small, scoped reference files for this project. Precision, not volume.

Belongs here:

- Our data structures: table names, field names, value types
- The exact layout of each bank export we parse: headers, delimiter, encoding,
  date and number formats, quirks
- Style/brand guide for UI decisions
- Saved changelog sections for frameworks we depend on

Does not belong:

- General tutorials the agent already knows
- Framework installation guides
- Task lists or feature ideas
- Full framework source code or node_modules
- Meeting notes or personal todos
- Screenshots or binary files
- Real bank exports, even redacted ones. Describe the layout; never paste rows.
- Secrets. Never.

Each file: one topic. If pasted from the web, include source URL and date.

## Contents

| File                | Topic                                                                                  |
| ------------------- | -------------------------------------------------------------------------------------- |
| `data-model.md`     | SQLite tables, dedupe indexes, money representation                                    |
| `import-formats.md` | CSV / xlsx / camt.053 parsing, the per-bank profiles, the Presupuesto workbook         |
| `pay-period.md`     | How the dashboard month is anchored on salary bookings, the merge window, the fallback |
| `security-model.md` | What is stored where, and the threat model behind it                                   |
