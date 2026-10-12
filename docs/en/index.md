# tasking Documentation

This directory provides the English documentation set for the `tasking` project. `tasking` is a TypeScript CLI daemon that orchestrates opencode coding-agent work from two task sources: Jira (structured) and Feishu (unstructured).

## Documentation Index

| Document | Purpose | Audience |
|------|------|----------|
| [Quick Start](./getting-started.md) | One-page linear onboarding: install → prepare → configure → start → verify (with optional Feishu bot creation) | New users |
| [Usage Guide](./usage.md) | Install, commands, config, credentials, workspace, prompt templates, typical scenarios | Operators, new users |
| [Development & Build Guide](./development.md) | Environment setup, directory structure, build/test/release flow, code style | Contributors, secondary developers |
| [Architecture Overview](./architecture.md) | Dual-source dual-scheduler, shared Task model, worker isolation, state persistence, safety invariants | Secondary developers, those seeking understanding |
| [Configuration Reference](./configuration.md) | Full `WORKFLOW.md` field table, resolution rules, dynamic reload, validation | Operators, configurers |
| [Feishu Integration Quickstart](./feishu-quickstart.md) | Hands-on Feishu integration: create app → authorize → create group → get chat_id → configure → verification checklist | Operators, new users |
| [Feishu App Setup](./feishu-app-setup.md) | One-time Feishu-side preparation: personal vs enterprise differences, app creation, scope list, event subscription, publishing, WORKFLOW config | Operators, new users |
| [Timeout Model](./timeout-model.md) | Three-tier timeout (inactivity/wall-clock/stall) flow, signal chain, retry behavior, scenario analysis | Secondary developers, operators |
| [State Flow](./state-flow.md) | Three-tier state model (active/review/terminal), dual-path review handling, scheduler reconcile three branches, Mermaid flowcharts, grill-openspec variant four phases | Operators, configurers, secondary developers |
| [Skills System](./skills.md) | 6 opencode skills (commit/pull/push/debug/land/jira), land_watch.py, usage | Operators, configurers |
| [Known Issues](./known-issues.md) | Known limitations (e.g. grill-openspec continuation guidance drift) and to-do enhancements (e.g. `tasking upgrade` upgrade flow) | Secondary developers, operators |
| [Logging](./logging.md) | Structured JSON log conventions: required context fields, message format, grep/alerting-friendly deterministic wording | Secondary developers, operators |
| [Token Accounting](./token-accounting.md) | How token usage is extracted from the `opencode run` event stream and accumulated into runtime totals | Secondary developers, operators |

## Quick Navigation

- First time? Start with [Quick Start](./getting-started.md), a one-page end-to-end run (install → prepare → configure → start → verify, with optional Feishu).
- Want details on a command/config? Start from the "Install" and "Quick Start" sections of the [Usage Guide](./usage.md).
- Integrating Feishu? See [Feishu Integration Quickstart](./feishu-quickstart.md); for how to set up the Feishu app and permissions (including personal Feishu) see [Feishu App Setup](./feishu-app-setup.md).
- Developing locally? See [Development & Build Guide](./development.md).
- Want to understand the overall design? See [Architecture Overview](./architecture.md).
- Looking up a config field? See [Configuration Reference](./configuration.md).
- Want to understand the timeout mechanism? See [Timeout Model](./timeout-model.md).
- Want to understand state flow? See [State Flow](./state-flow.md).
- Want to understand the skills system? See [Skills System](./skills.md).
- Want to understand the grill-openspec variant's design tradeoffs? See [ADR 0001](../adr/0001-phase-routing-in-prompt.md) and the [Project Glossary](../../CONTEXT.md).

## Glossary

To keep terminology consistent, this documentation set uses the following translations:

| English | Chinese | Explanation |
|------|------|------|
| dispatch | 派发 | Hand a task to the worker for execution |
| reconcile | 对账 | Reconcile running tasks against the tracker's current state |
| retry | 重试 | Re-dispatch after failure per a backoff strategy |
| claim | 认领 | The scheduler locks a task to prevent duplicate dispatch |
| workspace | 工作区 | per-task isolated working directory |
| backoff | 退避 | Exponential growth strategy for retry intervals |
| route agent | 路由 agent | LLM subprocess that triages unstructured inbox entries (**not implemented**, planned) |
| inbox | 收件箱 | Persistent pre-triage queue for unstructured tasks (**not implemented**, planned) |
| stall | 停滞 | A running task with no activity signal for a long time |
| terminal state | 终端状态 | Task is done or cancelled; no longer dispatched |
| active state | 活跃状态 | Task is pending or in progress; can be dispatched |
