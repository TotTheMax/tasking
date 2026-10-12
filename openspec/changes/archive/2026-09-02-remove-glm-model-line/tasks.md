## 1. Edit WORKFLOW.md

- [x] 1.1 Remove the commented-out line `# model: alibaba-token-plan-cn/glm-5.2` from the `opencode:` block of `WORKFLOW.md`, leaving the surrounding config (including the active `model: opencode-go/deepseek-v4-flash` line and the other commented example) unchanged.
- [x] 1.2 Verify the line is gone and the rest of the `opencode:` block is intact.

## 2. Verify

- [x] 2.1 Run `npm run lint` and `npm run typecheck` (should be unaffected — no code changed).
- [x] 2.2 Run `npm test` to confirm the suite stays green.
