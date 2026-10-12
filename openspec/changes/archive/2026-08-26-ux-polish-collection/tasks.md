## 1. 飞书 intake 回执与 /issue 首条 comment

- [x] 1.1 Intake 非命令根消息回执（TDD）：在 `tests/comment-bridge.test.ts` 写失败测试——`discoverIntake` 对非命令自由文本根消息回复"已收到"类回执、命令消息不回执；实现 `discoverIntake` 回执分支（`commands.ts` 加回执常量，`!parsed && !isCommand` 时 `replyFlat`）。
- [x] 1.2 `/issue` 首条 sentinel comment（TDD）：在 `tests/comment-bridge.test.ts` 写失败测试——`executeIssue` 建 issue 成功后写入含 `via 飞书` sentinel 的首条 comment（含标题+多行描述全文）；实现 `discoverIntake` 把 `sender_name` 透传 `executeIssue`，建后 `postComment(buildBridgedCommentBody(...))`。
- [x] 1.3 description 按 API 版本封装（TDD）：在 `tests/jira-tracker-comments.test.ts` 写失败测试——v2 端点描述为含换行字符串、v3 端点为 ADF doc 多段；在 `src/adapters/jira/tracker.ts` 加 `wrapDescription`，`executeIssue` 构造 fields 时按 `isApiV3()` 封装。

## 2. init Feishu Setup 与 glab 提示

- [x] 2.1 交互 init Feishu Setup（TDD）：在 `tests/init.test.ts` 写失败测试——启用时采集 app_id/app_secret/intake_chat_id/create_issue_type 并写入生成 WORKFLOW.md 的 `feishu:` 块（`enabled: true`、app_secret 为 `$FEISHU_APP_SECRET`）；不启用保持 `enabled: false`。实现 `collectFeishuConfig` + `generateWorkflowContent` 飞书段替换。
- [x] 2.2 非交互 init 飞书指引（TDD）：在 `tests/init.test.ts` 写失败测试——非交互输出含 `docs/feishu-quickstart.md` 指引；实现非交互输出提示行。
- [x] 2.3 glab 缺失打印安装命令（TDD）：在 `tests/init.test.ts` 写失败测试——glab 缺失时 `printPrerequisites` 输出含安装命令；实现（依赖 install-glab 技能安装完成，4.1 之后）。

## 3. tui 端口解析

- [x] 3.1 `tasking tui` 端口解析（TDD）：在 `tests/cli-commands.test.ts` 写失败测试——解析优先级 `--port` > `.tasking/daemon.json` port > `8080` 兜底、无 daemon.json 时以 8080 探测、不可达报错含解析端口与 `--port` 提示；实现 `runTui` 解析逻辑（移除无 daemon.json 即报错的硬门）。

## 4. install-glab 技能

- [x] 4.1 新增 install-glab 技能并在 init 安装（TDD）：新建 `assets/skills/install-glab/SKILL.md`（检测 `command -v glab`；缺失经 GitLab releases API 装 `~/.local/bin` 或打印 brew/snap/scoop 命令；验证 `glab auth status`）；`src/cli/init.ts` 将 install-glab 加入两 workflow 技能列表；在 `tests/skills.test.ts`/`tests/init.test.ts` 验证资产存在与复制。
- [x] 4.2 prompt 模板引用 install-glab：`WORKFLOW.md.example` 与 `WORKFLOW.grill-openspec.md.example` Skills 段落加入 install-glab 行（"任何 glab 步骤前若 `which glab` 失败先运行 install-glab 技能"）；保持 `tests/prompt.test.ts` 通过。

## 5. 文档与收尾

- [x] 5.1 更新文档：`docs/skills.md`（技能列表加 install-glab）、`docs/usage.md`（tui 端口解析、init 飞书引导、glab 自装、/issue 首条 comment、intake 回执）、`docs/configuration.md` 如有必要。
- [x] 5.2 全量验证：`npm run lint && npm run typecheck && npm test` 全部通过。
