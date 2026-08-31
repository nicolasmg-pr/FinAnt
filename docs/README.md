# docs/

Small, scoped reference files for this project. Precision, not volume.

Belongs here:
- API documentation pasted from services we integrate
- Our data structures: table names, field names, value types
- Style/brand guide for UI decisions
- Saved changelog sections for frameworks we depend on
- Auth flow notes: endpoints, tokens, headers
- Webhook payload examples from third-party services

Does not belong:
- General tutorials the agent already knows
- Framework installation guides
- Task lists or feature ideas
- Full framework source code or node_modules
- Meeting notes or personal todos
- Screenshots or binary files
- Secrets. Never.

Each file: one topic. If pasted from the web, include source URL and date.

## Contents

| File | Topic |
|------|-------|
| `gocardless.md` | Bank Account Data API: endpoints, the consent flow, quotas |
| `data-model.md` | SQLite tables, dedupe indexes, money representation |
| `import-formats.md` | CSV/camt.053 parsing, the Google Sheets profile |
| `security-model.md` | What is stored where, and the threat model behind it |
