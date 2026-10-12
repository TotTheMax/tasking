## Context

`tests/helpers/e2e-creds.ts` exports `E2E_DEFAULTS` (6 credential literals incl. the production Jira PAT) and `resolveE2ECreds(env)` = `env.X ?? E2E_DEFAULTS.X`. The sole consumer is `tests/integration-real.test.ts` (`INTEGRATION=1`-gated; CI never runs it). ADR-0010/TAS-12 baked defaults in to keep `INTEGRATION=1 npm test` zero-setup. `.gitignore` already ignores `.env`/`.env.local`. Node 22 (repo engines `>=22`) provides native `process.loadEnvFile(path)` — verified on v22.16: it populates `process.env` from a dotenv-style file **without overriding** keys already present (real env wins), which is exactly the Q3-A precedence. No dotenv dependency exists and adding one would force a `pack-deps.sh` offline-bundle refresh, so native is the zero-dependency choice.

Human decisions (grill 12121/12122): **Q1-A** `.env` file at repo root loaded via native `loadEnvFile`; **Q2-B** keep committed `E2E_DEFAULTS` as last-resort fallback (env > file > default); **Q3-A** real shell env > `.env` file; **Q4-A** `INTEGRATION=1` with empty cred → fail fast listing missing keys + `cp .env.example .env` hint.

## Goals / Non-Goals

**Goals:**
- Add a gitignored `.env` config-file layer so each dev points at their own test env, zero new deps.
- Preserve ADR-0010 zero-setup: no `.env` + no env vars → committed defaults still work.
- Precedence real env > `.env` file > defaults (matches `loadEnvFile` default `override=false`).
- Fail fast (not silent skip/partial) when `INTEGRATION=1` but a resolved cred is empty.
- Commit `.env.example` template; keep `tests/helpers/e2e-creds.ts` the single source of key names + defaults.
- Keep `resolveE2ECreds` pure/testable; unit-test the new loader + validator.

**Non-Goals:**
- Do NOT remove committed defaults (human chose Q2-B; ADR-0010 zero-setup promise stands).
- Do NOT add dotenv or any new dependency.
- Do NOT touch daemon config, production code, or the `INTEGRATION=1` gate.
- Do NOT change the real-e2e test scenarios themselves.
- Do NOT load `.env` for the mock-driven E2E or unit tests (only the real-API integration test).

## Decisions

- **D1 Native `process.loadEnvFile()` (Q1-A)**: `tests/helpers/e2e-creds.ts` exports `loadE2ECredsEnvFile(path = ".env")` that calls `process.loadEnvFile(path)` only if `existsSync(path)`. Zero deps (native Node ≥22), robust dotenv parsing for free, and `override=false` default gives the Q3-A precedence without extra logic. Rejected: hand-rolled dotenv parser (reimplements quoting/comments for no benefit), JSON file (no comments, needs custom parser), TS module (optional-file dynamic import + tsconfig excludes `tests`), YAML (no YAML lib in repo for tests).
- **D2 Keep `E2E_DEFAULTS` as fallback (Q2-B)**: `resolveE2ECreds(env)` stays `env.X ?? DEFAULT`. The `.env` layer only feeds `env` (via `process.env`), so fallback order is naturally env > file > default. `docs/known-issues.md` and AGENTS.md wording updated to mention the file layer, not just "baked in".
- **D3 Pure resolver + separate loader/validator**: `resolveE2ECreds(env)` remains pure (unit tests pass explicit env records). New exports: `loadE2ECredsEnvFile(path?)` (mutates `process.env`, returns whether file existed) and `missingE2ECreds(creds): string[]` (returns empty-valued keys). The integration test calls `loadE2ECredsEnvFile()` before `resolveE2ECreds(process.env)`, then on `INTEGRATION=1` asserts `missingE2ECreds(CREDS)` is empty, else throws a clear error.
- **D4 Fail-fast (Q4-A)**: when `enabled` (`INTEGRATION === "1"`) and `missingE2ECreds(CREDS).length > 0`, throw an `Error` listing the missing `FEISHU_E2E_*`/`JIRA_E2E_*` keys and the `cp .env.example .env` hint. Keeps `INTEGRATION != 1` skipping untouched.
- **D5 `.env.example` committed**: repo-root template with the 6 keys and descriptive placeholder comments. `.env` itself stays gitignored (already in `.gitignore`).

## Risks / Trade-offs

- [`.env` values could be committed accidentally] → `.env`/`.env.local` are already gitignored; docs state the file is personal.
- [`loadEnvFile` mutates global `process.env`] → acceptable; scoped to the integration test (only loaded there), and it never overrides existing env. Unit tests call the loader with explicit temp paths only.
- [Default creds still in repo] → human-chosen (Q2-B), consistent with ADR-0010/ADR-0017; not a new leak (same literals already committed).
- [Empty-string env override still wins (existing semantics)] → documented; `missingE2ECreds` treats it as missing so `INTEGRATION=1` fails fast rather than running against a broken env.