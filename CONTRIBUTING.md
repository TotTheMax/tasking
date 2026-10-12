[简体中文](./CONTRIBUTING.zh-CN.md) | English

# Contributing to tasking

Thanks for your interest in contributing!

## Setup

- Node.js 22+
- npm

```bash
git clone https://github.com/TotTheMax/tasking.git
cd tasking
npm install
```

## Development gates

Run all of these before opening a PR; keep them green:

```bash
npm run lint        # biome check
npm run typecheck   # tsc --noEmit
npm test            # vitest run (unit + mock-driven E2E)
npm run build       # tsc -> dist/
```

When touching a specific subsystem, also run that subsystem's test file — see the routing map in [AGENTS.md](./AGENTS.md) for file-to-test mapping.

## Testing notes

- Unit and mock-driven E2E tests run everywhere with `npm test` — no external services needed.
- Real-API integration suites (`INTEGRATION=1`, `npm run test:integration` / `npm run test:event-flow`) require the maintainers' internal Feishu/Jira test environment. They fail fast listing missing credentials and are skipped otherwise — external contributors are not expected to run them. If your change touches the Feishu adapter, Jira adapter, scheduler, or bridge, say so in the PR and a maintainer will run them.

## Docs are bilingual

Every page under `docs/zh/` must have a matching slug under `docs/en/` (and vice versa). `tests/docs-links.test.ts` enforces parity and link integrity — update both locales together. Architectural decisions go in `docs/adr/` (numbered, record tradeoffs not just outcomes).

## Change process

Substantive changes go through [OpenSpec](./openspec/): a proposal (`openspec/changes/<change>/proposal.md|design.md|tasks.md`) is written and implemented before archiving. See AGENTS.md for the workflow and the repo's own opsx skills/commands that drive it. Small fixes (typos, doc clarifications, bug fixes with tests) can go straight to a PR.

## Code style

- Biome enforces style (double quotes, semicolons, trailing commas, 100-col); `npm run lint:fix` auto-fixes.
- ESM + NodeNext: relative imports must use the `.js` extension even in `.ts` files.
- Strict TypeScript (`noUncheckedIndexedAccess`, `noImplicitOverride`).
- No code comments unless explicitly requested.

## Pull requests

Use the PR template (`.github/pull_request_template.md`): context, TL;DR, summary, alternatives considered, and a test plan confirming the gates above pass.
