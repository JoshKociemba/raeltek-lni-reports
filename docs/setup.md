# Setting up the L&I inquiry workflow

The workflow runs in the **outreach n8n** (`raeltek-outreach`, <http://localhost:5680>), which already has Josh's `josh@raeltek.com` Gmail credential and reaches Ollama on the Mac. The Gmail trigger polls the inbox every five minutes, so no public webhook or tunnel is needed.

## 1. Start Gotenberg (makes the PDFs)
Docker Desktop running, then in this folder:

```sh
docker compose up -d
```

It listens on `127.0.0.1:3010` only. n8n reaches it at `http://host.docker.internal:3010`.

## 2. Check the dataset columns
```sh
npm run check:fields
```
Every line should say `ok`. If one says `MISSING`, fix the name in `FIELDS` in `src/lni.cjs`, run `npm test` and `npm run build:workflow`.

## 3. Import
1. In n8n: **Workflows › Import from file**, choose `n8n/lni-inquiry-reports.workflow.json`.
2. Pick the Gmail credential (`Gmail account`) on **New inquiry email**, **Draft report reply** and **Draft clarification**.
3. Open **Settings** and fill in `ALLOWED_SENDERS`: one address per line, or `@domain.com` for a whole domain. Leave the rest unless you need to change them:
   - `DEFAULT_DAYS` (14) when a request gives no window, `MAX_DAYS` (90) the longest allowed.
   - `MAX_ROWS` (300) rows printed in one PDF.
   - `SOCRATA_APP_TOKEN` optional; a free token from data.wa.gov stops throttling if usage grows.
   - `SIGNATURE` the sign-off on replies.
   - `REQUIRE_DMARC_PASS` keep on. It's what stops someone faking an allowed sender's address.
4. Save and **activate** the workflow. Until it's active, the trigger only runs when you click **Execute workflow** (it then takes the most recent matching email).

## 4. Test
Send an email from an allowed address (not from josh@raeltek.com; the trigger skips mail from yourself) with subject `[L&I Inquiry] test` and a request in the body. Within five minutes a draft reply with the PDF should appear in Gmail's Drafts, in the same thread. Open the PDF and spot-check a few rows on the Verify links before sending.

## What it can and can't report
- Liability insurance expiring, and contractor registration expiring, by trade (L&I specialty), city and number of days.
- Bonds aren't supported yet. Requests for them get a clarification reply.
- L&I's general dataset has no county column, so a county in a request is noted in the report and not applied; ask by city instead.
- Electrical contractors are licensed under a separate L&I electrical program; this data covers construction contractor registrations, which may not include every electrician.
- The open data is a daily snapshot, not live. The report says so, and each row links to Verify for the live record.

## When something goes wrong
- An email that was ignored (not on the list, failed DMARC, no tag) shows the reason in the **Check inquiries** node's log for that execution.
- If data.wa.gov returns an error (for example, a renamed column), the execution fails at **Match** or **Build report** with the message. Run `npm run check:fields`.
- If Ollama is off, request parsing fails at **Plan query**; the reply note falls back to a fixed sentence.
