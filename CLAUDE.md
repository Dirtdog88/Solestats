# SoleStats

Public index of what AI shopping assistants tell runners to buy, scoped to running shoes for now (2026-11-21;
six more gear categories are parked in `data/later/`, read by nothing). Alex's personal project (personal time,
keys and billing; nothing from Weleda repos). On screen and in the domain: **SoleStats**, tagline
"What AI tells runners to buy". Decisions and history live in the DogHaus project "SoleStats: AI Running Index";
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
- New files use dated names `YYYY-MM-DD-name.ext` except the ones tools require (`wrangler.toml`, `package.json`,
  `migrations/NNNN_*.sql`, `README.md`, `CLAUDE.md`, `.gitignore`, workflow files).
- Publishing waits for the gate in Alex's consulting plan (employment attorney, then Gannon). Until then
  `PREVIEW_NOTICE` in `wrangler.toml` stays set and the site is not announced.

## Checks before pushing

```
npm test
```
