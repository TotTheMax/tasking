## 1. 修正 init 帮助描述

- [x] 1.1 写失败测试：`tasking init --help` 输出中 `--update` 的选项描述同时含技能备份与 WORKFLOW.md 漂移报告语义（如 "WORKFLOW.md drift"），当前描述仅含技能同步故测试先红
- [x] 1.2 实现：`src/cli/help.ts` 中 `init --update` 的 description 改为 "Re-sync tasking skills (modified files backed up as <file>.bak) and report WORKFLOW.md drift vs the detected template"；改动后测试转绿
- [x] 1.3 同类修复：`--workflow`/`--lang` 描述补充其在 `--update` 模式下用于选择漂移报告模板；新增回归断言校验两者描述提及 `--update`

## 2. 核对全部命令描述

- [x] 2.1 逐条对照 `start`/`status`/`logs`/`stop`/`tui` 及其 option 的帮助描述与 `src/cli/index.ts`、`src/cli/daemon-info.ts` 实现，确认无其他失真；如有则同法修正
- [x] 2.2 全量验证：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 均通过
