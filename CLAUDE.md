# SoleStats

Public index of what AI shopping assistants tell runners to buy, scoped to running shoes for now (2026-11-21;
six more gear categories are parked in `data/later/`, read by nothing). Alex's personal project (personal time,
keys and billing; nothing from Weleda repos). On screen and in the domain: **SoleStats**, tagline
"The running shoe AI index" (Alex, 2026-11-22; was "What AI tells runners to buy"), public address solestats.net.
Decisions and history live in the DogHaus project "SoleStats: the running shoe AI index";
update that project, not a notes file here, when a decision changes.

## Stack

Cloudflare Worker (free plan) + D1 + static assets, plain JavaScript, ES modules, **no build step**, same shape as
Alex's DogHouse and Lego list repos. Scripts run on Node 22 (`node:test`, no test framework). The one dependency
is `@anthropic-ai/sdk` for the Anthropic engine adapter; OpenAI, Gemini and Perplexity are called with `fetch`.
Add nothing else without a strong reason.

| Path | What it is |
|---|---|
| `data/2026-11-21-prompts.csv` | the 138 prompts: source of truth (id, set, category, text, tags, pair_a, pair_b) |
| `data/later/` | the parked scan categories: 122 prompts and 76 brands, kept for a later round |
| `data/2026-11-21-brands.csv`, `data/2026-11-21-retailers.csv` | watch lists with aliases and domains |
| `data/2026-11-21-spec-sheet.csv` | hand-verified shoe facts; only rows with `verified_on` are loaded |
| `data/rounds/<round>/` | one round's `runs.jsonl` (raw answers), `runs.scored.jsonl`, `scores.csv`, `routing.json`; `raw/` is gitignored |
| `scripts/2026-11-21-engines.js` | the four engine adapters, one output shape |
| `scripts/2026-11-21-run.js` | the resumable runner with a spend cap |
| `scripts/2026-11-21-import.js`, `-score.js`, `-export.js`, `-seed.js` | detection to SQL, scoring, the open dataset, CSV to D1 |
| `src/2026-11-21-detect.js` | pure: brand mentions, head-to-head winner, citation kinds, routes |
| `src/2026-11-21-score.js` | pure: the rubric (weights, eligibility, subjects, overall, routing table) |
| `src/2026-11-21-worker.js` | read-only JSON API and CSV downloads over D1; static files otherwise |
| `public/` | the site: index, brand page, method page, styles, scripts (built with `textContent`) |
| `migrations/NNNN_name.sql` | D1 schema, `IF NOT EXISTS`, never edit an applied one |

## Rules

- **Never present a single AI answer as a finding.** Every number is a rate across repeats with a margin.
- Outside the head-to-head set, no prompt names a brand (a test enforces it).
- Detection is automated and reviewable; the raw answer is always kept so anything can be re-scored.
- The scoring rules live only in `src/2026-11-21-score.js`; the rubric text on the method page must match them.
- The site is public and read-only: no sign-in, no cookies, no writes from the Worker. CSP is strict
  (`script-src 'self'`, no inline scripts or styles). The page is built with `textContent`, never `innerHTML` with data.
- Keys live in the environment, never in the repo. Spend caps are set at each provider as well as `--cap-usd`.
  The Anthropic key is read from `SOLESTATS_ANTHROPIC_KEY` first (cloud sessions drop `ANTHROPIC_API_KEY`), then `ANTHROPIC_API_KEY`.
- **Cloud sessions** (Claude Code on the web, environment "Dirtdog Collective apps"): Node's `fetch` ignores the session
  proxy, so start the runner with `npm run run` (it passes `--use-env-proxy`; harmless on a PC) and prefix any other
  script or wrangler command that calls out with `NODE_USE_ENV_PROXY=1`. Each API host must be on the environment's
  allowed list (api.openai.com and generativelanguage.googleapis.com were added 2026-11-21). The Cloudflare token is a
  network secret the proxy injects: D1 commands run as `CLOUDFLARE_API_TOKEN=proxy-injected NODE_USE_ENV_PROXY=1 npx
  wrangler@4 d1 ...`. `wrangler deploy` does not work from a cloud session (the static-asset upload gets 401), so
  deploys happen through the Cloudflare GitHub connection on every push to main, or `npm run deploy` on a PC.
- Engines not yet in the current edition are listed in `PENDING_ENGINES` in `wrangler.toml`; the site shows them as
  pending. Clear the entry once their runs are imported.
- New files use dated names `YYYY-MM-DD-name.ext` except the ones tools require (`wrangler.toml`, `package.json`,
  `migrations/NNNN_*.sql`, `README.md`, `CLAUDE.md`, `.gitignore`, workflow files).
- The publishing gate (employment attorney, then Gannon) was cleared on 2026-11-21. `PREVIEW_NOTICE` in
  `wrangler.toml` stays set until the first full edition (all three engines, three repeats) is imported, then it
  is set to "" and the site can be announced.
- Cadence (Alex, 2026-11-21): a full round every month, run by a scheduled task. Accurate's spec questions and the hand
  checks (spec sheet, Shoppable checklist) run once a quarter; a round without its own `fact-checks.jsonl` or
  `site-checks.jsonl` is scored on the latest earlier round's (`checked_round` in the detail). The `pulse` column and
  `--set pulse` stay as a cheaper fallback but are not used.
- Shoppable by AI is the checklist in `data/2026-11-21-shoppable-checklist.csv`, scored by hand per brand per round
  into `data/rounds/<round>/site-checks.jsonl` ({brand_slug, item, result 1|0, notes}).

## Checks before pushing

```
npm test
```
