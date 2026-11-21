# SoleStats

**What AI tells runners to buy.** A public index of how AI shopping assistants recommend, describe and route
sales for running shoe brands, and which retailers AI sends people to. Open method, open data, a new edition each
round. Round 1 is being collected. (Six more categories of running gear are parked in `data/later/` for a later round.)

- Live: https://solestats.com (not published yet; a preview banner shows until the first edition)
- Plan and decisions: the DogHaus project "SoleStats: AI Running Index" (private)
- Setup: `2026-11-21-setup-guide.md`

## How it works

1. `data/2026-11-21-prompts.csv` holds 138 prompts (102 shoes, 28 head-to-head, 8 about where to buy). `data/2026-11-21-brands.csv` and `data/2026-11-21-retailers.csv` are the watch lists.
   `data/2026-11-21-spec-sheet.csv` is the hand-verified truth for the Accurate subject (shoes).
2. `npm run run -- --round 2026-12` asks every prompt on three engines, three times each, with web search on,
   and writes `data/rounds/2026-12/runs.jsonl` (resumable; a spend cap stops it).
3. `npm run import -- --round 2026-12` detects brands, citations and routes in every answer and writes SQL for D1
   plus `runs.scored.jsonl`.
4. `npm run score -- --round 2026-12` turns that into 0 to 100 scores per brand per subject, the overall score
   and the retailer routing table.
5. `npm run export -- --round 2026-12` writes the open dataset CSVs; the Worker also serves them live from D1
   at `/download/<round>/<file>.csv`.
6. `npm run deploy` applies migrations and deploys the Worker + static site.

Nothing is final until a person has looked at the detections: `mentions.checked` is there for that.

## Stack

Cloudflare Worker (free plan) + D1 + static assets. Plain JavaScript, ES modules, no build step. One dependency
for the scripts: `@anthropic-ai/sdk` (the official client; the other engines are plain `fetch`).
The Worker itself has no dependencies and only reads.

## Checks

```
npm test
```
