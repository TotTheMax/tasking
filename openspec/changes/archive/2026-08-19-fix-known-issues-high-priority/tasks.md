## 1. TUI 详情视图全量显示描述

- [x] 1.1 写失败测试：`tests/terminal-dashboard.test.ts` 新增——running 详情视图对超过 200 字符 / 超过 5 行的 `task.description` 全量渲染（不出现 `...` 截断、行数完整）
- [x] 1.2 实现：`src/observability/terminal-dashboard.ts` `formatRunningDetailFromState` 移除 200 字符截断与 `.slice(0, 5)` 行数上限，改为对描述全部行渲染
- [x] 1.3 确认空/`null` 描述不渲染 Description 区块（既有 `if (task.description)` 守卫保持）

## 2. 移除 /issue 首条冗余 comment

- [x] 2.1 改测试：`tests/comment-bridge.test.ts` 删除"建后写入首条 sentinel comment"断言（line ~1019-1054），改为断言建 issue 后不 POST comment；确认"creates issue + binds + acks"测试不依赖 comment
- [x] 2.2 实现：`src/bridge/comment-bridge.ts` `executeIssue` 删除 `postComment(buildBridgedCommentBody(...))` 整段与 `commentText` 局部量；确认 `buildBridgedCommentBody` import 仍被 `bridgeMessages` 使用而保留

## 3. 文档与 ADR 同步

- [x] 3.1 新增 `docs/adr/0009-issue-first-comment-removed.md` 记录首条 comment 反转及理由
- [x] 3.2 更新 `docs/known-issues.md`：高优先级两项标注已修复（移出或标注完成）
- [x] 3.3 更新 `docs/usage.md` 与 `docs/feishu-quickstart.md`：删除"首条 comment"相关描述，保持与实际行为一致

## 4. 验证

- [x] 4.1 `npm run lint && npm run typecheck && npm test` 全绿
