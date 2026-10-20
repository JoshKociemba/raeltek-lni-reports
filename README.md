# Raeltek L&I inquiry reports

An n8n workflow that answers report requests by email. Someone on the allowed list emails Josh with `[L&I Inquiry]` in the subject and a plain request, such as:

> Can you find plumbing companies whose insurance is going to expire in the next 14 days?

The workflow then:

1. Checks the sender is on `ALLOWED_SENDERS` and that Gmail's DMARC check passed for them, so a forged From address is ignored. Anyone else gets no reply.
2. Has local Ollama (`qwen3:4b`) turn the request into a query: report type (insurance or contractor registration expiring), trades, number of days, cities. If it can't tell what's wanted, it drafts a short "can you clarify?" reply instead.
3. Queries L&I's official contractor open data on data.wa.gov ([General](https://data.wa.gov/d/m8qx-ubtq) and [Insurance](https://data.wa.gov/d/ciwg-agsx)), refreshed each business day.
4. Verifies each match: the registration must be active and in the trade and city asked for, and a contractor is dropped if a newer policy is already on file (they've renewed). A cancellation date counts as the coverage end. Duplicate policy rows are merged.
5. Prints a PDF report with Gotenberg. Each license number links to its [L&I Verify](https://secure.lni.wa.gov/verify/) page for spot checks.
6. Saves a **Gmail draft** replying in the same thread, with the PDF attached and a short note written by Ollama (with a fixed fallback). Josh reviews and sends it. Nothing sends automatically.

Setup is in [docs/setup.md](docs/setup.md). What's in L&I's data is in [docs/datasets.md](docs/datasets.md).

## Development

`src/` is the master copy of the logic; `scripts/build-workflow.cjs` pastes it into the workflow's Code nodes.

```sh
npm test                 # unit tests and workflow checks
npm run build:workflow   # regenerate n8n/lni-inquiry-reports.workflow.json
npm run check:fields     # confirm L&I's dataset columns still match src/lni.cjs (needs internet)
npm run try -- --trade plumbing --days 14   # run a query against live data and write report.html
```

No dependencies to install; Node 18+.
