# Per-developer e2e credential config (`.env`) via native `loadEnvFile`

Status: accepted (Q2-B committed-defaults fallback later removed by ADR-0029)

The real-API integration test credentials (`tests/integration-real.test.ts`) are resolved by `tests/helpers/e2e-creds.ts` as `process.env.X ?? DEFAULT`, baking six literals — including the production Jira PAT — into committed source. That couples every developer to one shared test environment (collision-prone under multi-dev) and keeps real secrets in the repo. TAS-28 replaces the baked-in mechanism with a gitignored per-developer `.env` config file loaded by Node 22's native `process.loadEnvFile()` (zero new dependencies → no `pack-deps.sh` offline-bundle refresh), plus a committed `.env.example` template; precedence is real env > `.env` file > committed defaults (`loadEnvFile` default `override=false` implements the first two tiers for free). Scope is limited to the real-API integration test creds; daemon config and the `INTEGRATION=1` gate (ADR-0010) are untouched.

Open grill decisions resolved (comment 12122, human "Q2 B 其他的按推荐的来"): Q1-A `.env` dotenv file at repo root loaded via native `process.loadEnvFile()`; Q2-B keep committed `E2E_DEFAULTS` as last-resort fallback (precedence real env > `.env` file > defaults; ADR-0010 zero-setup promise preserved); Q3-A real env wins over file (`loadEnvFile` default `override=false`); Q4-A `INTEGRATION=1` with an empty credential fails fast via `missingE2ECreds`/`assertE2ECredsComplete` listing the keys + `cp .env.example .env` hint.

## Considered Options

- `.env` dotenv format loaded via native `process.loadEnvFile()` — recommended; zero deps, key names (`FEISHU_E2E_*`/`JIRA_E2E_*`) stay 1:1.
- JSON (`e2e-creds.local.json`) — needs a small parser, no comments.
- Gitignored TS module (`e2e-creds.local.ts`) — TS compile edge cases for an optionally-missing file.
- YAML — repo has no YAML dependency; the daemon's hand-rolled `parseSimpleYaml` is for frontmatter only.
- Keep baked defaults as fallback — preserves ADR-0010 zero-setup but keeps shared-env coupling and committed secrets.