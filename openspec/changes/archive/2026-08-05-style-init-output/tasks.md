## 1. Shared style module (`src/cli/style.ts`)

- [x] 1.1 Create `src/cli/style.ts` with ANSI constants (`RESET`/`BOLD`/`DIM`/`CYAN`/`GREEN`/`YELLOW`/`RED`/`GRAY`), `stripAnsi()` function, and `createStyle(useColor)` factory returning `bold()`/`dim()`/`green()`/`red()`/`yellow()`/`gray()`/`cyan()` text wrappers — write failing test in `tests/style.test.ts` asserting constants are correct escape sequences and `stripAnsi` removes them, then implement
- [x] 1.2 Add `boxHeader(title)`/`boxLine(text)`/`boxFooter()`/`statusIcon(kind)` to the style factory — write failing test asserting `boxHeader("Prerequisites")` produces `╭─ Prerequisites`, `boxLine("text")` produces `│  text`, `boxFooter()` produces `╰──`, `statusIcon("ok")` returns `✓`, `statusIcon("fail")` returns `✗`, `statusIcon("warn")` returns `⚠`, `statusIcon("info")` returns `·`, and `useColor=false` produces plain text without ANSI codes, then implement

## 2. Non-interactive init output

- [x] 2.1 Add `✓` success banner with config file path, workspace root, and skill install path to `runNonInteractiveInit` using no-color mode (mock output stream has `isTTY=false`) — write failing test asserting output contains `✓`, `tasking initialized`, `Config file:`, `Workspace root:`, and `skill`, and does not contain ANSI escape codes (`\x1b`), then implement

## 3. Interactive init: Prerequisites section

- [x] 3.1 Move `checkOpencode`/`checkGlab`/`printGitLabHint` before credential collection in `runInteractiveInit`, wrap in `╭─ Prerequisites` box section with `✓`/`✗`/`⚠` status icons, and wire up `useColor` detection from `output.isTTY` — write failing test asserting `opencode` appears in output before `Jira REST API endpoint`, that `╭─ Prerequisites` appears, and that `✓` or `✗` prefixes check lines, then implement

## 4. Interactive init: Jira Setup section (prompt styling)

- [x] 4.1 Add `│` border prefix and `BOLD` styling to question text, `GRAY DIM` to hints in `prompts.ts` `ask`/`askSelect` format strings — write failing test asserting `prompts.calls` entries contain `│` prefix and bold ANSI code (`\x1b[1m`) in question text, then implement

## 5. Interactive init: Connection Test section

- [x] 5.1 Wrap `testJiraConnection` output in `╭─ Connection Test` box, replace plain text with `✓`/`✗`/`⚠` status icons, add `·` prefix for project status list — write failing test asserting `╭─ Connection Test` appears, `✓` prefixes success message, `✗` prefixes failure, `⚠` prefixes project key failure, and `·` prefixes status names, then implement

## 6. Interactive init: Initialization section

- [x] 6.1 Wrap file write, skill copy, and workspace creation output in `╭─ Initialization` box with `✓` icons for each completed step — write failing test asserting `╭─ Initialization` appears, `✓` prefixes `WORKFLOW.md written` and `skill` installed, then implement

## 7. Interactive init: Next Steps section

- [x] 7.1 Restyle `printCompletionHint` as `╭─ Next Steps` box with `GRAY DIM` field descriptions and `GREEN BOLD` `tasking start` call-to-action, include editor-open status line — write failing test asserting `╭─ Next Steps` appears, `tasking start` has green+bold ANSI codes, and field names have dim ANSI codes, then implement

## 8. Verify

- [x] 8.1 Run `npm run lint && npm run typecheck && npm test`, fix any failures
