## 1. S1 门禁与配置地基

- [x] 1.1 拷入 spike fixtures：从 spike 分支取 `tests/fixtures/opencode-v2/` 全量文件到 main（provenance 一并），作为后续 mock 剧本与契约断言素材
- [x] 1.2 版本门禁纯函数（写失败测试先：1.x/3.x 拒绝、2.0.x 通过、2.3.1 警告、版本串 `opencode v2.0.29`/`2.0.29` 双格式解析；再实现 `SUPPORTED`/`VALIDATED` 常量与 classify 函数）
- [x] 1.3 doctor 升级 opencode 项（写失败测试先：PATH 缺失、版本不符、未验证警告、探活失败各分支；再实现版本探测 + `server.info` 探活 + 模型认证探测）
- [x] 1.4 配置面（写失败测试先：command 默认 `opencode`、三新键默认值与校验、model/variant 独立解析；再改 config-types DEFAULTS/resolver/validator）
- [x] 1.5 `buildMcpConfig` v2 化（写失败测试先：输出含 `mcp.servers.jira`、`codemode:false`、不写 permissions、保留既有键；再改实现）

## 2. S2 turn 驱动器

- [x] 2.1 api-CLI 调用封装（写失败测试先：命令拼装（server_url 透传/sessionID 路径参数/JSON body）、成功/失败/超时解析；再实现 spawn 封装——可注入 exec 以便 mock）
- [x] 2.2 会话生命周期门面（写失败测试先：首 turn create 参数（location/model ref 拆分/agent/全放 ruleset）、续轮 prompt、删除；再实现，含 Model.Ref `{id,providerID,variant}` 映射）
- [x] 2.3 轮询循环（写失败测试先：outcome 三态结算、message diff 产活动事件（text/tool 详情字段）、tokens 合计口径（input+output+reasoning）、单次轮询失败不判败；再实现——用假 opencode CLI 剧本驱动）
- [x] 2.4 中断梯子（写失败测试先：interrupt 后宽限内出终态、宽限后清理残留、interrupt 产生 interrupted 终态；再实现）
- [x] 2.5 计时器矩阵（写失败测试先：pending 期间 turn_timeout/inactivity 暂停、permission_timeout 接管并倒计时、超时自动 reject 后恢复执行计时；再实现）
- [x] 2.6 假 opencode CLI mock helper（实现 `tests/helpers/opencode-mock.ts`：生成可执行脚本 + PATH 注入 + 剧本断言，剧本覆盖 fixtures 各场景）
- [x] 2.7 worker 切换（写失败测试先：runAttempt 经驱动器跑通首轮/续轮/sidecar 写入/tracker 检查循环/重试语义、agent 每 turn 解析与边界切换、auto_approve=true 全链路；再改 runner.ts 接线，删 spawnRunner 子进程路径调用）
- [x] 2.8 重启清扫（写失败测试先：active 会话被 interrupt、非 active 不动作、清扫失败不阻塞启动；再在 daemon 启动接入，sidecar 与 direct_sessions 为来源）

## 3. S3 同步审批

- [x] 3.1 审批状态机（写失败测试先：pending 发现→发卡→reply once/always/reject→恢复、超时自动 reject 盖章、重复点击/换卡/缺字段安全应答；再实现，Jira 与直连两投放面共用核心）
- [x] 3.2 Jira 审批卡投放绑定话题（写失败测试先：挂起时经桥接管线发卡到绑定话题、回复后卡片盖章与 turn 恢复；再实现）
- [x] 3.3 直连审批卡投放会话话题（写失败测试先：挂起时会话话题出现审批卡、轮次卡片显示等待状态与倒计时、审批后恢复；再实现）
- [x] 3.4 姿态翻译（写失败测试先：perm_on→session.update 立即生效、perm_once 一轮后收回、perm toggle/`/auto off` 清空、`/auto on` 持久化跨重启；再替换 manager.ts 的 handlePermissionAction 实现，验证点：ruleset 清空 API 语义与已挂起单子是否被更新覆盖）
- [x] 3.5 回路测试（tests/card-roundtrip.test.ts 增审批卡与姿态按钮三场景：再点一次/换卡后点/payload 缺字段）

## 4. S4 直连切换

- [x] 4.1 直连执行切驱动器（写失败测试先：首 turn/续跑经驱动器、auto_approve 项目覆盖映射 ruleset、日志 `direct turn starting` 字段更新；再改 manager.ts 执行路径）
- [x] 4.2 卡片数据源切轮询 diff（写失败测试先：工具面板/文本/stats 由 diff 事件驱动、token 展示合计口径、等待审批标记；再改卡片刷新链路）
- [x] 4.3 `/stop`/`/done` 语义（写失败测试先：/stop 走中断梯子并作废挂起审批、/done 删会话；再实现）
- [x] 4.4 合并队列保持（写失败测试先：运行中追问排队合并续跑语义不变、daemon 中止丢队列行为不变；再回归验证既有用例）

## 5. S5 收尾

- [x] 5.1 删除旧 run 路径（buildOpencodeCommand/buildDirectCommand/runDefaultSubprocess 子进程语义、相关测试改写；typecheck/lint 全绿）
- [x] 5.2 TUI 等待审批状态与倒计时（详情页/直连区块显示，写失败测试先再实现）
- [x] 5.3 契约测试（`@opencode/sdk` devDep pin 2.0.29：内存运行时断言 operation 名、decision 枚举、Model.Ref 字段、mcp.servers 行为——版本区间扩容工装）
- [x] 5.4 真机冒烟（INTEGRATION 体系新增 v2 用例：本机 wrapper 或 ljw 跑 create/prompt/pending/reply/interrupt 全链路；不可达时记录原因）
- [x] 5.5 文档双语（configuration.md opencode 段重写、usage.md 审批卡与姿态说明、architecture.md 运行时流程、getting-started 前置 opencode v2 + `opencode upgrade --major`、development.md 测试策略更新；docs-links 测试过）
- [x] 5.6 CONTEXT.md 术语更新（Turn 定义改写、Opencode event stream→轮询快照术语、Step usage 合计口径、新增 Approval card/Permission posture；ADR 四篇：v2-only 与驱动形态、三层权限模型、轮询替代事件流、分支与版本策略）
- [x] 5.7 全门禁与发布准备（lint/typecheck/test/test:e2e 全绿；CHANGELOG 0.7.0 破坏性说明：要求 opencode >=2.0 <3、command 默认值变化、auto_approve=false 行为升级为审批）
