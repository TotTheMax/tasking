## ADDED Requirements

### Requirement: WORKFLOW.md opencode block does not reference glm-5.2
The `opencode:` block of `WORKFLOW.md` SHALL NOT contain a commented-out `model: alibaba-token-plan-cn/glm-5.2` line. The active `model: opencode-go/deepseek-v4-flash` line and the other commented example line SHALL remain present and unchanged.

#### Scenario: glm-5.2 example line removed
- **WHEN** inspecting the `opencode:` block of `WORKFLOW.md`
- **THEN** the line `# model: alibaba-token-plan-cn/glm-5.2` is absent, while the active `model: opencode-go/deepseek-v4-flash` line and the `# model: deepseek/deepseek-v4-flash` comment remain.
