# Status

Updated 2026-11-07. Where the workflow stands and what's still open. Setup is in [setup.md](setup.md); what's in L&I's data is in [datasets.md](datasets.md).

## Live
- Runs in Josh's outreach n8n as "L&I inquiry reports", workflow id `aGTNuQAQgmLhjQuM`, **active** since 2026-10-20. Since 2026-11-07 that n8n runs on Raeltek's always-on Mac mini server instead of Josh's MacBook (see the outreach repository's `project-status.md`, November 7 record), so reports no longer wait for the MacBook to be awake. It polls Gmail every minute. On the mini, Gotenberg runs in the same compose file as n8n (outside this repository) and `GOTENBERG_URL` is `http://gotenberg:3000`; this repository's `compose.yaml` is only for running it elsewhere. Ollama (`qwen3:4b`) runs natively on the mini at the same address as before.
- The move was tested end to end on 2026-11-07: a real request produced and sent its PDF in about a minute.
- The Gmail trigger searches the inbox only, so a request email archived before the next poll is skipped. Leave "[L&I Report]" emails in the inbox until the reply arrives.
- The live copy matches `main` through PR #12 (general-contractor searches start from the expiring policies, 2026-10-22).
- `AUTO_SEND` is on, so replies go straight to the requester. `MAX_ROWS` is 300 and the window is capped at 90 days (Josh's OK).
- The allowed senders live only in the live workflow's Settings node, never in Git. There are three as of 2026-10-31: Josh's two addresses and one insurance-agent contact.
- First live send 2026-10-20; reports since then have matched independent queries against data.wa.gov.

## Rules Josh set
- Only list businesses that will end up with no coverage (2026-10-21). That's why each listed row is checked on L&I's Verify site (`src/verify.cjs`, 750 ms apart): the open data leaves out policies that haven't started yet.
- Overlapping policies: the newest policy and its expiry count; an older policy that runs later is noted as "Also on file".
- Requested counts ("5 painters") list the soonest-expiring first; "a week or two" means 14 days; replies in a report thread reuse the earlier request.
- Replies go only to the person who asked, and the workflow never starts an email of its own.

## Open
- Same-day expiry ties sort by name; Josh hasn't decided whether he wants another order.
- Bonds aren't supported (L&I keeps bond expiry as text, with history).
- Offering this to insurance brokers (Josh, 2026-10-25; recorded in the website repository's `decisions.md`): a fixed-price build on the agency's own n8n and email, or a Raeltek-run service with a setup fee, a monthly fee and exclusive territories. The run service has no price yet. Charge flat fees, never per policy.

## L&I terms check (2026-10-31)
An agent's reading, not legal advice. L&I's [Access Agreement](https://lni.wa.gov/agency/access-agreement) covers its whole site, Verify included. Among prohibited conduct it lists: "Post or transmit or in any way exploit any information, software or other material for commercial purposes" and "Participate in the unauthorized use or disclosure by any party of any information accessed for any purpose". It says nothing about scripts or automated lookups. L&I's [privacy and security statement](https://lni.wa.gov/agency/privacy-security-statement) allows copying site content with credit, but says lists of individuals can't be used for commercial purposes (RCW 42.56.070), and it monitors traffic for unauthorized activity. The data.wa.gov datasets are published as open data, separately from these terms.

What that means:
- Josh's own use (reports for himself and a few contacts, no charge) is low risk at today's pace: a few hundred lookups at most per report, 750 ms apart.
- A paid Raeltek-run report service (option B) built on Verify lookups is the risky case: selling the results reads as commercial exploitation under the Access Agreement, and sole-proprietor contractors are individuals under RCW 42.56.070. Before selling B, either ask L&I in writing whether paid reports using Verify checks are allowed, or run B on the data.wa.gov open data only, with the report saying early renewals can look like lapses.
- Option A (a build on the agency's own n8n) puts the lookups in the agency's hands; tell them about these terms in the proposal.
