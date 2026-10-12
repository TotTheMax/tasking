# Config view is served from the daemon's resolved config, not the local file

Status: proposed

The TUI config view (and any future consumer) must reflect exactly what the daemon is running, so the HTTP dashboard exposes the daemon's live `EffectiveConfig` (secrets masked at the boundary) via `GET /api/v1/config`; the attached TUI reads it over the same HTTP channel as `/api/v1/state`. Reading the local `WORKFLOW.md` in the attach TUI was rejected: the raw file diverges from the running config after hot reloads and after env-var/home resolution, and it cannot supply runtime-only properties (pid, started_at, actual port, log path) that only the daemon knows authoritatively.
