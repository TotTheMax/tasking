## 1. Settings layer

- [x] 1.1 先写失败测试断言 `direct_sessions` 新增 `agent_override`/`model_override`/`auto_approve_override` 的迁移与读写；再实现列与 patch
- [x] 1.2 先写失败测试断言命令构建的优先级（会话覆盖 > 项目条目 > 全局）与"下一轮生效"；再在 `buildDirectCommand`/`resolveAutoApprove` 前置解析中实现

## 2. Commands

- [x] 2.1 先写失败测试断言 `/auto on|off|once|reset` 与无参数回显（含来源），含 `once` 只作用于下一轮、`on` 落库；再实现
- [x] 2.2 先写失败测试断言 `/agent`、`/model`（含 reset 与回显）影响后续轮命令；再实现
- [x] 2.3 先写失败测试断言 `/new` 清 session_id/last_prompt、保留话题与目录、不删旧 opencode 会话；再实现
- [x] 2.4 先写失败测试断言 `/status` 卡片含目录/session/agent/model/姿态/turns/tokens/队列/空闲；再实现

## 3. Card

- [x] 3.1 先写失败测试断言头部姿态与 agent 覆盖标记、`🔐 权限` 按钮四种形态与确认行（开启需确认、收回即时）；再实现
- [x] 3.2 先写失败测试断言运行中心跳（假时钟下至少每 5s 触发一次 flush，结束后停止）；再实现

## 3b. /name

- [x] 3b.1 先写失败测试断言 `/name <文本>` 改名（落库、ACK 回显、下次刷新出现在卡片头）与无参数回显；再实现（`direct_sessions.name` 可 patch）

## 4. Docs & gates

- [x] 4.1 更新 `docs/{zh,en}/configuration.md`（会话覆盖与新命令）与 `docs/{zh,en}/usage.md`（命令表、按钮用法）
- [x] 4.2 跑门禁：`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e`；真机验收（`/auto`、按钮、`/agent`、`/new`、`/status`、心跳）——2026-09-22 依据 daemon 日志验收：auto_*/perm/perm_once/done 均有真实点击且零失败告警
