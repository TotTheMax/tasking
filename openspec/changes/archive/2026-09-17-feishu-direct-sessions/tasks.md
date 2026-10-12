## 1. 配置基座

- [x] 1.1 `DirectConfig` 类型 + DEFAULTS（config-types.ts）：先在 tests/config.test.ts 写失败用例（`direct` 段缺省填充 path_roots/auto_approve/verbosity/max_concurrent/idle_ttl_ms 默认值；段缺失时 enabled=false），再实现类型与默认值
- [x] 1.2 resolver 支持 `projects`（字符串或 `{path, auto_approve}` 对象两种形态）与各字段解析：先写失败用例（两种项目形态、非法 verbosity/max_concurrent/idle_ttl_ms 报错），再实现
- [x] 1.3 validator 校验规则（未知 verbosity、非正数并发/TTL、projects 值类型）：失败用例先行，实现后过绿；更新 tests/daemon-config.test.ts 中 effective-config 快照类断言

## 2. 持久层

- [x] 2.1 BindingStore 新增 `direct_sessions` 表与 CRUD（upsert/getByRootId/listActive/listAll/markStatus/advanceCursor）：先写 tests/binding-store.test.ts 失败用例（建表幂等、root_id 主键 upsert、状态流转、游标推进），再实现

## 3. 命令解析

- [x] 3.1 commands.ts 新增 parseChat（`/chat`、`/chat list`、`/chat <project> <msg>`、`/chat /abs/path <msg>`）与 HELP_TEXT 补充：先写 tests/commands.test.ts 失败用例（各形态与边界：无参、未知形态、多词 project 名不含空格约定），再实现

## 4. DirectSessionManager 核心

- [x] 4.1 buildDirectCommand（runner.ts 或 src/direct/command.ts）：固定 `--format json` + 显式 `--dir`、条件 `--auto`、续跑 `-s`、继承 `opencode.agent/model/variant`；不传 `--title`（标题交 opencode 原生按内容生成）；先写失败用例断言命令形状（含"永不丢 --dir"），再实现
- [x] 4.2 会话创建路径：解析 project/path（path_roots 前缀校验、realpath、存在性检查）→ 建 direct_sessions 记录 → 话题 ACK → 首 turn spawn；用注入的 fake spawnRunner 写 tests/direct-sessions.test.ts 失败用例（创建 ACK、首 turn 命令、无 --title 标记），再实现 manager 骨架
- [x] 4.3 turn 完成后的总结交付：从 JSON 事件提取末条 assistant text + 统计行（耗时/工具数/tokens），summary 模式一条消息、detailed 模式逐工具消息、超长截断、失败/超时文案；失败用例先行
- [x] 4.4 追问排队与合并续跑：运行中消息排队 ACK、FIFO 合并（`\n---\n`）为下一 turn；同目录串行与 max_concurrent 全局预算（独立于 Jira）；失败用例先行再实现
- [x] 4.5 生命周期命令：/done（累计统计 + 终结提示一次性）、/stop（AbortSignal 终止当前 turn + 中断说明 + 回 idle；无 turn 时提示）；失败用例先行再实现
- [x] 4.6 重启恢复与 TTL：start() 时 running→idle（发中断说明）、idle 可续跑、游标去重、慢速定时器按 idle_ttl_ms 标 expired；失败用例先行再实现

## 5. 桥接与装配

- [x] 5.1 CommentBridge 路由交派：processItem 先查 directStore（direct 话题消息交 DirectSessionPort，不查 Jira binding）、intake 根消息 `/chat` 交派、direct 未配置时 `/chat` 走未知命令；先写 tests/comment-bridge.test.ts 失败用例，再实现（保持单队列/游标语义不变）
- [x] 5.2 runStart() 装配（src/cli/index.ts）：feishu.enabled 且配置 direct 时创建 BindingStore 复用、DirectSessionManager、注入 bridge；config view 显示 direct 段（tests/config-view.test.ts 失败用例先行）；help 文本更新（tests/cli-commands.test.ts 如涉及）

## 6. 端到端与真实集成测试

- [x] 6.1 tests/bridge-flow.test.ts 扩展：mock 飞书 + fake spawnRunner 全链路 —— `/chat project` 建会话→总结回贴→追问合并续跑→/done 终结；先红后绿
- [x] 6.2 新增 tests/integration-direct.test.ts（INTEGRATION=1 门控，跳过语义与既有 integration-real 一致）：真实机器人 + 临时 git 仓库跑真 opencode run —— 建会话、总结回贴、续跑、/done、清理；凭证复用 tests/helpers/e2e-creds.ts
- [x] 6.3 package.json：若新增独立集成测试文件则并入相应 script 约定（不进 CI 门）

## 7. 文档与收尾

- [x] 7.1 双语文档：docs/{zh,en}/configuration.md（feishu.direct 段 + 默认值表）、docs/{zh,en}/usage.md（/chat 用法）；保持 docs-links 双语 parity 测试绿
- [x] 7.2 README 命令面补 `/chat`（与 docs 同步）
- [x] 7.3 全量门：npm run lint、npm run typecheck、npm test（含 test:e2e）、npm run build 全绿；可达时跑 INTEGRATION=1 集成与 test:event-flow（ingress 路径变更）
