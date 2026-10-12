## Context

`docs/known-issues.md` 高优先级下有两个实际问题待修：

1. **TUI 详情 Description 截断**：`src/observability/terminal-dashboard.ts` 的 `formatRunningDetailFromState`（line ~709-717）把 description 先截断到 200 字符再只取前 5 行。真实任务描述（如备份恢复脚本需求）超过这个量就被吞掉。
2. **`/issue` 首条 comment 冗余**：TAS-4（ux-polish-collection）曾设计"建 issue 后把原始消息写成带 sentinel 的首条 comment"（`src/bridge/comment-bridge.ts` `executeIssue` 内 `postComment(buildBridgedCommentBody(...))`，line ~446-458）。但该信息与 issue 的 summary/description 字段完全重复，用户反馈多余。

## Goals / Non-Goals

**Goals:**
- 详情视图完整渲染 description（所有行、所有字符）。
- `executeIssue` 不再写首条 comment，消除重复。
- 不破坏桥接防环（sentinel 去重）与 binding 生命周期。

**Non-Goals:**
- 不给详情视图增加滚动/分页能力（描述全量显示即可，超长时终端自然滚动；加滚动属于独立增强）。
- 不改 overview 列表的展示。
- 不改为 snapshot 源渲染补 description（`RuntimeSnapshot` 不含 description 字段，是独立缺口，超出本任务）。

## Decisions

- **D1：详情描述全量渲染。** 删除 200 字符截断与 `.slice(0, 5)` 行数上限，改为对 `task.description.split("\n")` 逐行渲染，并去掉末尾换行产生的空行。`compose()` 以 `CURSOR_HOME` 起每行 `CLEAR_LINE`，高度不限、自然增长，超长由终端滚动。备选：加详情滚动键——复杂度高、非本次诉求，否决。
- **D2：删除首条 comment。** `executeIssue` 建 issue 成功后移除 `postComment(buildBridgedCommentBody(...))` 整段与 `commentText` 局部量（`meta` 参数仅服务于该 comment，一并删除签名并同步调用点）。`buildBridgedCommentBody` import 仍被 `bridgeMessages` 使用，保留。防环不依赖该首条 comment（`forwardComments` 按 sentinel 跳过、binding 由飞书 ack 建立），删除安全。
- **D3：文档同步。** `docs/usage.md`、`docs/feishu-quickstart.md` 删除首条 comment 相关描述；新增 ADR 记录该反转（防止未来有人按旧设计重加）。`openspec/specs/feishu-source/spec.md` 与 `terminal-dashboard/spec.md` 用 delta spec 同步。

## Risks / Trade-offs

- [详情视图超长描述使框高超过终端屏幕，顶部（标题/状态）滚出视野] → 罕见场景；用户明确要求"全显示"，且详情是临时查看态，Esc/q 即回列表，接受。
- [旧 spec/文档仍描述首条 comment 行为，未来被误解为"缺功能"] → 新增 ADR + delta spec + 文档同步三处闭环；`docs/known-issues.md` 对应项勾除。
