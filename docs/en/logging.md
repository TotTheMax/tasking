# Logging Conventions

## Required Context Fields

Task-related logs MUST include `task_id` and `task_identifier`. Session lifecycle logs MUST include `session_id`.

## Message Format

- Structured JSON lines, one log entry per line
- Fields: `ts` (ISO 8601), `level`, `msg`, plus context fields
- Message text uses deterministic wording, for easy grep and alerting
- Includes the action result (`completed`, `failed`, `retrying`, etc.)
- Includes a concise failure reason
- Avoids large raw payloads unless necessary

## Per-Module Logging Scope

| Module | Log events |
|---|---|
| Scheduler | dispatch, retry, reconcile, terminal transitions, worker exit |
| Runner | turn start/finish, prompt render failure, hook execution, session create/delete |
| Workspace | create, reuse, hook execution, delete |
| HttpDashboard | startup, bind address |
| TerminalDashboard | render failure |

## New Log Checklist

- [ ] Does it include `task_id` + `task_identifier` (if task-related)?
- [ ] Does it include `session_id` (if session-related)?
- [ ] Is the wording deterministic (same condition → same output)?
- [ ] Does it include the result and the reason?
- [ ] Does it avoid large payloads?
