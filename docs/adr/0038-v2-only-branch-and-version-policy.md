# v2-only, support/v1 maintenance branch, major-gate version policy

tasking's main line drops opencode v1 entirely; the last v1-compatible release (0.6.19) is frozen on a `support/v1` maintenance branch (bug fixes only). The first v2 baseline is 0.7.0. The daemon refuses to start on a non-2.x opencode (guiding `opencode upgrade --major`), warns but runs on an unvalidated 2.x minor, and probes the shared service plus provider auth at startup.

**Context.** Only two users run tasking, so carrying a v1 compatibility layer costs more than it saves. opencode v2 ships multiple releases per day and has no documented compatibility policy; its own clients (TUI, desktop, web) pin its API, which makes minor-version breakage unlikely but not promised. The v2 HTTP API is labelled experimental.

**Consequences.** v1 machines stay on the 0.6.x branch (no archiving; the branch simply sits there). Widening the validated range is a deliberate act: bump the pinned `@opencode/sdk`/`@opencode/client` devDeps, run the contract suite and the integration smoke, then update the `VALIDATED` constant. The registry of validated versions lives in `src/shared/opencode-version.ts`.
