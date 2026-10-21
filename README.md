# Raeltek L&I inquiry reports

An n8n workflow that answers report requests by email. Someone on the allowed list emails Josh with `[L&I Report]` in the subject and a plain request, such as:

> Can you find plumbing companies whose insurance is going to expire in the next 14 days?

The workflow then:

1. Checks the sender is on `ALLOWED_SENDERS` and that Gmail's DMARC check passed for them, so a forged From address is ignored. Anyone else gets no reply.
2. Works out the query: report type (insurance or contractor registration expiring), trades, number of days, cities and an optional count ("5 painters"). Plain wording rules settle most of it; local Ollama (`qwen3:4b`) adds cities. A reply in the same thread reuses the last request for anything it leaves out ("can you also send one with 4 plumbers?"), and an answer to a clarifying question completes the request that raised it. A trade with no report type means insurance. If there's still no report type, it replies with one fixed question offering the two choices.
3. Queries L&I's official contractor open data on data.wa.gov ([General](https://data.wa.gov/d/m8qx-ubtq) and [Insurance](https://data.wa.gov/d/ciwg-agsx)), refreshed each business day.
4. Verifies each match: the registration must be active and in the trade and city asked for, and every policy L&I has on file for the contractor is checked. L&I keeps an old policy listed until it expires, so it can overlap a renewal; only the newest policy (latest effective date) counts. A contractor is listed when that policy ends in the window, so anyone who has already renewed is left out (and counted). A cancellation date counts as the coverage end. Duplicate policy rows are merged.
5. Prints a PDF report with Gotenberg, soonest expiry first. When the request names a count ("5 painters", "top 10 roofers"), the report lists only that many and notes how many matched in all. Each license number links to its [L&I Verify](https://secure.lni.wa.gov/verify/) page for spot checks.
6. **Replies to the requester** in the same thread, with the PDF attached and a short note written by Ollama (with a fixed fallback). With `AUTO_SEND` off, it saves the reply as a Gmail draft for Josh to review instead. It never emails anyone except the person who asked.

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
