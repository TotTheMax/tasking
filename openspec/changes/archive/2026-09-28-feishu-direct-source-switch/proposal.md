# Feishu 直连专用部署：Jira 源开关

## Why

飞书直连任务（ADR 0022）已成熟，但今天它寄生在 Jira 管线上：启动校验无条件强制 tracker 配置（`validator.ts` 的 `validateDispatchConfig`），`runStart` 无条件构造 `JiraTracker`+`Scheduler`，直连消息的入口路由又写在 `CommentBridge` 里。结果是"只配飞书、不配 Jira"的部署无法启动——而直连本身（`DirectSessionManager`）没有任何 tracker 依赖。本 change 让 Jira 源可缺席，使直连专用部署成为一等公民，且 Jira+飞书现有部署零行为变化。

## What Changes

- 配置新增 `tracker.kind: none` 语义：启动校验按源分流、装配跳过 Jira 管线；tracker 块残留字段打 WARN；运行中热翻转 kind 打 WARN 提示需重启。
- 启动校验重构（Q3 矩阵）：`opencode.command` 死检查删除（有默认值）；`create_issue_type` 仅 `kind: jira` 时必填；新增两条退化拒启（无任何源 / 飞书开但 direct 关）。
- 桥内 Jira 暴露面收敛到唯一谓词——**tracker 在场性**（装配期决定，桥不读 `tracker.kind`）：镜像循环首行短路；intake `/issue``/state` 路由到"未知命令+可用清单"兜底；`/help` 按能力裁剪；卡片按钮 handler 防御短路（平台入口纪律）。
- `runStart` 装配（Q5）：`kind: none` 时不构造 `JiraTracker`/`Scheduler`；独立实例化 `ActivityStore` 供直连与 dashboard；dashboard/TUI 喂 `createInitialState()` 空快照；不跑 `startupTerminalCleanup`。无 NullTracker——缺席即缺席。
- `/agent`、`full`（完整输出）、Sweep（`/chat` 丢失兜底）零改动（无 tracker 依赖）。
- 落笔已随工作区就绪：`docs/adr/0026`（C vs D vs B 取舍与接缝约定）、`CONTEXT.md`（Tracker 缺席语义、Topic partition、feishu-direct 词条——后者在本系列 Change ② 中生效）。

## Capabilities

### New Capabilities
- `trackerless-startup`: 无 Jira 源（`tracker.kind: none`）时的启动校验、运行时装配与能力降级行为——直连专用部署的运行时基础。

### Modified Capabilities
- `cli-runtime`: `tasking start` 装配逻辑按 `tracker.kind` 分流（校验、Scheduler/Tracker 构造、dashboard 状态源、终端工作区清理）；派发预校验按源分档。
- `workflow-config`: `tracker.kind` 枚举扩展 `none`（解析 + 残留字段 WARN）。
- `comment-bridge`: 桥内 Jira 暴露面按 tracker 在场性收敛（镜像短路、命令兜底、帮助裁剪、卡片防御）。

## Impact

- 修改：`src/config/validator.ts`（校验矩阵）、`src/config/resolver.ts`（`kind: none` 解析 + 残留字段 WARN）、`src/cli/index.ts` `runStart`（装配分流）、`src/bridge/comment-bridge.ts`（唯一谓词 + 各暴露面）、`src/config/manager.ts` 或 reload 路径（kind 变化 WARN）、`src/observability/http-dashboard.ts`/`terminal-dashboard.ts`（scheduler 可选/空快照，如有硬依赖）。
- 文档：`docs/adr/0026`（已写）、`CONTEXT.md`（已写）；`docs/{zh,en}/configuration.md` 的 `tracker.kind` 枚举说明（`none` 加入取值表）——完整变体/模板交付在 Change ②。
- 测试：`tests/config.test.ts`（校验矩阵）、`tests/comment-bridge.test.ts`（能力兜底直调）、`tests/e2e.test.ts` 或新文件（direct-only 启动 e2e：零 jira 请求 + `/chat` 通 + `/issue` 得兜底）、既有全量回归。
- 风险：桥被动 → `test:e2e` 硬门禁必跑；真实环境可达时跑 `test:integration`；`test:event-flow` 作为验收冒烟。
- 非目标：不抽 FeishuIngress（D，ADR 0026 记为被许可后续）；不新增 `feishu.mirror.enabled` 键（镜像可用 ⟺ tracker 存在）；不含 init 变体与模板（Change ② `feishu-direct-init-variant`）。
