## 1. 渲染（折叠逻辑）

- [x] 1.1 TDD：在 `tests/terminal-dashboard.test.ts` 新增红用例——长描述（折行后 >6 行）的 running 详情默认只渲染前 6 个折行行并显示 `… (N more lines)` 标记（N 为被省略折行行数）。
- [x] 1.2 TDD：实现折叠——`formatRunningDetailFromState` 描述块先 `wrapToWidth(desc, 48)` 折行，取前 6 行，超出追加 `… (N more lines)`；补齐 1.1 绿。
- [x] 1.3 TDD：新增红用例——折行后 ≤6 行的短描述不折叠、不显示标记；空/`null` 描述不渲染 Description 区块（保留既有用例）。
- [x] 1.4 更新既有"wraps long description lines"用例为折叠语义（短描述断言折行不破坏盒、不出现 `...`）。

## 2. 交互（e 键展开/收起）

- [x] 2.1 TDD：新增红用例——`detail-running` 折叠态按 `e` 切换展开态渲染描述全部折行行、无折叠标记；展开态再按 `e` 回到折叠态。
- [x] 2.2 TDD：新增红用例——重新进入详情默认折叠（不记忆展开状态）；无描述时 `e` 无效果。
- [x] 2.3 实现——`processKey` 在 `detail-running` 模式新增 `case "e"` 翻转 `descExpanded` 字段；footer 折叠态显示 `e expand`、展开态显示 `e collapse`；补齐 2.1/2.2 绿。

## 3. 文档与门禁

- [x] 3.1 更新 `docs/adr/0015-task-detail-description-truncation.md` 状态为 accepted 并补全最终决策（6 行、`e` 键、不记忆）。
- [x] 3.2 同步 `docs/usage.md` 与 `docs/architecture.md`（`docs/zh/` 与 `docs/en/`）中 running 详情页 Description 折叠/展开的描述（如涉及）。
- [x] 3.3 跑完整门禁：`npm run lint`、`npm run typecheck`、`npm test`（含 `tests/terminal-dashboard.test.ts`）、`npm run build` 全部通过。
- [x] 3.4 提交代码与 `openspec/changes/fix-tui-description-truncation/` 到 `feature/TAS-26-task-detail-description-truncation` 分支并推送，创建 GitLab MR。
