## Why

`tests/helpers/e2e-creds.ts` bakes 6 credential literals (incl. the production Jira PAT) into committed source via `process.env.X ?? DEFAULT`. Every developer then defaults to the same shared test environment — awkward for multi-dev work where each person has their own test env, and keeps real secrets in the repo. The human confirmed (grill comment 12121, answer comment 12122): keep the baked defaults as a last-resort fallback (Q2-B) but add a gitignored per-developer `.env` config file (Q1-A) with precedence real env > file > defaults (Q3-A), and fail fast when `INTEGRATION=1` yet creds are empty (Q4-A).

## What Changes

- **New config-file layer**: a gitignored `.env` at the repo root holds per-developer overrides, loaded by Node 22's native `process.loadEnvFile()` (zero new deps → no `pack-deps.sh` offline-bundle refresh). Precedence: real shell env > `.env` file > committed `E2E_DEFAULTS`.
- **Committed `.env.example`**: a template documenting all 6 keys (`FEISHU_E2E_APP_ID`/`FEISHU_E2E_APP_SECRET`/`FEISHU_E2E_INTAKE_CHAT_ID`/`JIRA_E2E_ENDPOINT`/`JIRA_E2E_API_KEY`/`JIRA_E2E_PROJECT_KEY`) so a dev can `cp .env.example .env` and fill in their own test env.
- **Fast-fail validator**: when `INTEGRATION=1` and a resolved credential is empty, throw a clear error naming the missing keys with the `cp .env.example .env` hint instead of silently proceeding/skipping.
- **`tests/helpers/e2e-creds.ts`** gains `loadE2ECredsEnvFile()` (native `loadEnvFile` guarded by `existsSync`) and `missingE2ECreds()`; `resolveE2ECreds` stays pure (env > default). `tests/integration-real.test.ts` loads `.env` before resolving.
- **Docs**: `docs/{zh,en}/{development,known-issues}.md`, `CONTEXT.md` term, ADR-0017 (accepted), and the `bridge-e2e-flow` spec updated for the new layer.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bridge-e2e-flow`: the real-API e2e credential requirements change — credentials resolve from gitignored `.env` file + env vars + committed defaults (precedence env > file > default), and `INTEGRATION=1` with an empty credential fails fast with a clear message.

## Impact

- `tests/helpers/e2e-creds.ts` (+ unit tests) — new loader + validator, existing exports unchanged.
- `tests/integration-real.test.ts` — load `.env` before `resolveE2ECreds(process.env)`; validate on `INTEGRATION=1`.
- New `.env.example` at repo root (gitignored `.env` already in `.gitignore`).
- Docs both locales; ADR-0017 accepted; `CONTEXT.md` term (already drafted); `AGENTS.md` e2e table line.
- No production code, no config schema, no dependency changes.