[简体中文](./SECURITY.zh-CN.md) | English

# Security Policy

## Supported versions

Only the latest published release line (`0.x`) receives security fixes.

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting instead: open this repository on GitHub → **Security** tab → **Report a vulnerability**. This notifies the maintainers privately.

Please include:

- A description of the issue and its impact
- Steps or a proof of concept to reproduce it
- Affected version (`npm ls -g @tothemax/tasking`)

We aim to acknowledge reports within 72 hours and will coordinate disclosure timing with you.

## Trust boundary (read before deploying)

`tasking` is designed for **trusted environments**:

- `WORKFLOW.md` hooks (`after_create`, `before_run`, ...) run arbitrary shell commands in workspace directories. Only use hook configurations from sources you control.
- The `opencode run` worker executes with the daemon's OS privileges. Tighten via opencode's own approval/sandbox settings where needed.
- API tokens are read from environment variables or a gitignored `.env` file and are never logged.
