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
2. Pick the Gmail credential (`Gmail account`) on **New inquiry email**, **Send report reply** and **Draft clarification**.
3. Open **Settings**. `ALLOWED_SENDERS` starts as just `josh@raeltek.com`; add one address per line, or `@domain.com` for a whole domain. Leave the rest unless you need to change them:
   - `DEFAULT_DAYS` (14) when a request gives no window, `MAX_DAYS` (90) the longest allowed.
   - `MAX_ROWS` (300) rows printed in one PDF.
   - `SOCRATA_APP_TOKEN` optional; a free token from data.wa.gov stops throttling if usage grows.
   - `SIGN_OFF` the line before your name (default `Thanks,`). Don't put a signature here: Raeltek's Workspace adds your signature when the email is sent.
   - `REQUIRE_DMARC_PASS` keep on. It's what stops someone faking an allowed sender's address. Mail you send yourself counts as authenticated (Gmail marks it Sent, which only your account can do).
   - `MAILBOX` the Gmail account the trigger reads.

Every reply has the line "Report prepared from Washington L&I open data." just before the sign-off. Leave it in: a reply sent to yourself comes back to the inbox with the tag in the subject, and that line is how the workflow knows not to answer its own reply.
4. Save and **activate** the workflow. Until it's active, the trigger only runs when you click **Execute workflow** (it then takes the most recent matching email).

## 4. Test
From josh@raeltek.com, email yourself with subject `[L&I Inquiry] test` and a request in the body. Within five minutes a reply with the PDF should arrive in the same thread. Open the PDF and spot-check a few rows on the Verify links. A request it can't read leaves a clarifying-question draft in Gmail's Drafts instead.

## What it can and can't report
- Liability insurance expiring (or cancelled) and contractor registration expiring, by trade, city and number of days. Only active registrations are listed.
- Trades map to L&I license types and specialty codes in `TRADES` in `src/understand.cjs`. "Plumbing" means the plumbing contractor (PC) license; the old construction plumbing specialty (AD) has no active registrations. A trade not in the list is matched by name against construction specialties.
- A contractor with a policy ending in the window is left out if another policy on file runs past it (they've renewed, or have other coverage). L&I's data doesn't say which policy is general liability, so any policy counts. The report counts how many were left out.
- Bonds aren't supported yet (L&I stores bond expiry as text and keeps bond history). Requests for them get a clarification reply.
- L&I's data has no county column, so a county in a request is noted in the report and not applied; ask by city instead.
- L&I has insurance on file for very few electrical contractors and no elevator contractors, so those trades rarely appear in insurance reports. The report says so.
- The open data is a daily snapshot (refreshed each business day), not live. The report says so, and each row links to Verify for the live record.

Column names, codes and data quirks are in [datasets.md](datasets.md). To try a query against live data without n8n: `npm run try -- --trade plumbing --days 14 --city Vancouver` writes `report.html`.

## When something goes wrong
- An email that was ignored (not on the list, failed DMARC, no tag) shows the reason in the **Check inquiries** node's log for that execution.
- If data.wa.gov returns an error (for example, a renamed column), the execution fails at **Match** or **Build report** with the message. Run `npm run check:fields`.
- If Ollama is off, request parsing fails at **Plan query**; the reply note falls back to a fixed sentence.
