# Raeltek L&I inquiry reports instructions

This repository holds an n8n workflow that answers `[L&I Inquiry]` emails from an allowed list with a PDF report built from Washington L&I contractor open data. It is internal and private.

- `src/` is the master copy; run `npm test` and `npm run build:workflow` after changing it, and never edit Code nodes in the committed JSON by hand.
- The only email the workflow sends is the report, as a Gmail reply to the inquiry's sender (Josh, 2026-10-20). Clarifying questions stay drafts. Don't add any other send path unless Josh explicitly asks; tests/workflow.test.cjs enforces this.
- Use L&I's official open data (data.wa.gov). Don't scrape secure.lni.wa.gov/verify; the report links to it for manual checks.
- Never commit the allowed-sender list, credentials, tokens or report PDFs.
- Use a feature branch and PR for every change; Josh merges. Never claim a workflow run or test succeeded unless it actually ran.
