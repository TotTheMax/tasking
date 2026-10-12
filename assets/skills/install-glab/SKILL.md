---
name: install-glab
description:
  Idempotently ensure the GitLab CLI (glab) is installed and authenticated.
  Run before any glab step when `command -v glab` fails, or when a glab
  command reports "command not found".
---

# Install glab

Ensure `glab` is available before running any MR/gitlab operation. The daemon
injects `GITLAB_TOKEN`/`GITLAB_HOST` into the workspace environment, so no
interactive `glab auth login` is needed — `glab` picks the token up itself.

## Steps

1. Check whether glab is already installed and authenticated:

   ```bash
   command -v glab && glab auth status
   ```

   - If it succeeds (exit 0), stop here — glab is ready.

2. Otherwise install the official binary. Choose the block for your platform:

   **Linux (amd64/arm64)** or **macOS (arm64/amd64)** — download the latest
   release from the GitLab CLI releases API into `~/.local/bin`:

   ```bash
   set -e
   mkdir -p ~/.local/bin
   ARCH="$(uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/')"
   OS="$(uname -s | tr '[:upper:]' '[:lower:]')"   # darwin for macOS
   URL="$(
     curl -fsSL "https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest/assets/links" \
       | grep -oE "https://[^\"]*glab_[^\"]*_${OS}_${ARCH}\.tar\.gz" | head -n1
   )"
   curl -fsSL "$URL" -o /tmp/glab.tar.gz
   tar -xzf /tmp/glab.tar.gz -C /tmp
   install -m 0755 /tmp/bin/glab ~/.local/bin/glab
   export PATH="$HOME/.local/bin:$PATH"
   ```

   **Package managers (fallback):**

   ```bash
   brew install glab       # macOS
   snap install glab       # linux (snap)
   scoop install glab      # windows
   ```

3. Verify it works end-to-end:

   ```bash
   glab auth status
   ```

   A successful run lists the authenticated GitLab host from `GITLAB_HOST`
   without prompting.

## Notes

- Idempotent: if `command -v glab` already succeeds, step 1 exits early.
- If the release download fails (network/proxy), do NOT pretend the install
  succeeded — print the package-manager fallback commands and continue; if a
  `glab` step is then still blocked, escalate to a human.
- `~/.local/bin` must be on PATH; if not, add
  `export PATH="$HOME/.local/bin:$PATH"` to the shell rc or prepend it in the
  same command that runs `glab`.
