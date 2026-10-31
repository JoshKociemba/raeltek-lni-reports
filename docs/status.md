# Status

Updated 2026-10-31. Where the workflow stands and what's still open. Setup is in [setup.md](setup.md); what's in L&I's data is in [datasets.md](datasets.md).

## Live
- Runs in Josh's outreach n8n (<http://localhost:5680>, Docker on his Mac) as "L&I inquiry reports", workflow id `aGTNuQAQgmLhjQuM`, **active** since 2026-10-20. It polls Gmail every minute, so it only answers while the Mac is awake. Gotenberg from this repository's `compose.yaml` makes the PDFs; Ollama (`qwen3:4b`) runs natively on the Mac.
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
- Offering this to insurance brokers (Josh, 2026-10-25; recorded in the website repository's `decisions.md`): a fixed-price build on the agency's own n8n and email, or a Raeltek-run service with a setup fee, a monthly fee and exclusive territories. The run service has no price yet, and L&I Verify's terms of use need checking before it's sold. Charge flat fees, never per policy.
