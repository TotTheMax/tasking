# No committed credentials: env/`.env` only, plus feishu `$VAR` expansion and daemon `.env` loading

Status: accepted

Supersedes the Q2-B decision of ADR-0017 (keep committed `E2E_DEFAULTS` as a last-resort fallback) and the TAS-12 stance recorded in ADR-0010.

## Context

Preparing the repo for public open-source distribution surfaced that real secrets were committed in three places: `tests/helpers/e2e-creds.ts` `E2E_DEFAULTS` (Feishu test bot secret, production Jira PAT, intranet endpoints), the root `WORKFLOW.md` (Feishu app_id/app_secret, Jira `api_key`, a GitLab PAT inside the `env:` block), and doc examples. GitHub push protection rejected a push for exactly these token types. Even for the internal GitLab, rotation-safe hygiene argues for zero committed secrets; ADR-0017's Q2-B tradeoff (zero-setup `INTEGRATION=1 npm test` vs. secrets in source) resolved toward zero-setup at the time, which we now revoke.

A second latent gap: `docs/configuration.md` already documented feishu credential fields as `string|$VAR`, and `tasking init` writes `app_secret: $FEISHU_APP_SECRET` into generated WORKFLOW.md files, but the resolver only applied `resolveEnvVar` to `tracker.api_key`, `workspace.root`, direct paths, and `env:` values — feishu fields passed the literal `$FEISHU_APP_SECRET` string through as the secret.

## Decision

1. **`E2E_DEFAULTS` values become empty strings.** Credentials resolve from real env vars or the gitignored repo-root `.env` (precedence unchanged: real env wins, `loadEnvFile` `override=false`). `INTEGRATION=1` with no credentials fails fast via `assertE2ECredsComplete` listing the missing keys and the `cp .env.example .env` hint. The zero-setup promise of ADR-0010 is revoked; each developer (and CI, if it ever gains intranet route) supplies their own `.env`. `tests/helpers/e2e-creds.ts` remains the single source of key names.
2. **Feishu credential fields support `$VAR`.** `app_id`, `app_secret`, `verification_token`, `encrypt_key`, `intake_chat_id` now resolve through `resolveEnvVar` (exact `$NAME` form only; unresolved → treated as missing, caught by startup validation). This closes the docs/impl gap rather than introducing new surface.
3. **The daemon loads `.env`.** `tasking start` and `tasking doctor` call `loadDotenvIfPresent(workflowDir)` before parsing `WORKFLOW.md`, so `$VAR` references in the front matter resolve from the repo-root `.env` (native `process.loadEnvFile`, no override of real env, zero dependencies). Other subcommands (`status`/`logs`/`tui` are HTTP clients; `init` prompts for its own values) do not need it.
4. The root `WORKFLOW.md` keeps its tracked status but carries only `$VAR` references (`$JIRA_API_TOKEN`, `$FEISHU_APP_ID`, `$FEISHU_APP_SECRET`, `$GITLAB_TOKEN`); real values live in the gitignored `.env`.

## Consequences

- Secret rotation is now decoupled from code: rotating the Jira PAT or Feishu secret touches only `.env`.
- History still contains the old literals on the internal GitLab (and in local clones); the affected credentials (Jira PAT, Feishu app secrets, GitLab PAT) should be rotated — removing them from HEAD does not scrub history.
- `openspec/specs/bridge-e2e-flow/spec.md` updated: the "non-empty code defaults" requirement becomes "env/`.env` are the only sources; empty → fail fast".

## Considered Options

- Keep committed defaults, rely on GitHub unblock links for public pushes — rejected: publishes live secrets, and they persist in history.
- Untrack the root WORKFLOW.md entirely — deferred: it doubles as this repo's daemon config and contains no secrets once `$VAR`-ified; untracking would also lose the drift signal against templates.
- dotenv dependency for fancier `.env` semantics — rejected: Node 22 native `loadEnvFile` already provides the needed no-override semantics (same argument as ADR-0017 D1).
