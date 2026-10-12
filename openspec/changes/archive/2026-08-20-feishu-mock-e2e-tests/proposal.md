# 飞书桥 mock 修正 + 端到端流程测试

## Why

`docs/known-issues.md` 待做项"飞书集成测试不足：mock 假阳性导致大量手动 bug"：bridge 上线后 491 个单测全绿，但手动测试持续暴露约 17 个 bug。根因是 mock 响应结构基于对飞书/Jira API 的假设，假设错则 mock 跟着错——测试验证的是"代码逻辑是否与错误假设一致"而非"与真实 API 一致"。按改进方案 1、2 修复（方案 3 录制真实响应做契约测试本次不做）。

## What Changes

- **修 mock 响应结构**：新增真实感飞书 mock（`tests/helpers/`），使其与真实飞书 IM API 一致：`reply_in_thread` 响应返回 `thread_id`、`create_time` 用 13 位毫秒时间戳（代码 `toSecondsStr` 归一化）、`listMessages` 与 `listThreadReplies` 区分 `container_id_type=chat` vs `thread`、消息 sender 含 `name`/`sender_type` 等真实字段。Jira mock assignee 补 `name` 字段（Server/DC 有，`normalizeAssignee` 依赖）。
- **端到端流程测试**：用修正后的 mock 跑完整周期，覆盖两个入口（飞书 `/issue` 与 Jira 派发）创建 issue → agent 执行 → 飞书/Jira 改状态 → agent 添加注释 → Jira/飞书互相看到新增注释与消息 → 完结 → 最终 Jira 关闭。验证 cursor 推进、sentinel 去重、binding 生命周期。
- 可选项 `INTEGRATION=1 npm test` 真实 API 冒烟测试与录制 fixture 的契约测试（改进方案 3）本次**不做**。

## Capabilities

### New Capabilities

- `bridge-e2e-flow`: 基于修正后 mock 的飞书↔Jira comment bridge 端到端全流程测试覆盖。

### Modified Capabilities

- `feishu-source`: 新增要求——测试 mock 响应 SHALL 与真实飞书 IM API 形状一致（`thread_id`、13 位毫秒 `create_time`、`container_id_type` 区分、sender 真实字段），并补充对应断言。

## Impact

- 新增 `tests/helpers/feishu-mock.ts`（真实感飞书 mock）。
- 新增/扩展 `tests/comment-bridge.test.ts`、`tests/e2e.test.ts`（或独立 `tests/bridge-flow.test.ts`）端到端流程用例。
- 修正 `tests/feishu-source.test.ts`、`tests/jira-tracker.test.ts` 中不符合真实 API 的 mock 形状。
- 文档：`docs/known-issues.md`（勾除待做项）、`docs/usage.md`（如涉及 INTEGRATION 开关）。
- 无生产代码改动（纯测试层）、无新依赖、无配置变更。
