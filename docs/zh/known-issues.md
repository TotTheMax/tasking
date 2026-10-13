# 已知问题

> 含**已知限制**与**待做（TODO）**两类。待做项是已设计但未实现的增强。

## 已知限制

### buildContinuationGuidance 在 grill 阶段略偏

`src/worker/prompt.ts` 的 `buildContinuationGuidance` 是全局共享的 turn 2+ 续轮指引，内容偏 MR 中心（增量修复/全量重置/land 合并）。

- **影响**：grill-openspec workflow 的 grill 阶段（无 MR）若跑到 turn 2+，会收到与当前阶段略偏的续轮提示。
- **缓解**：grill 阶段通常 turn 1 就发完拷问 comment 并转 review 退出，实战中很少跑到 turn 2。
- **彻底修复需越界**：要彻底修需改 `src/worker/prompt.ts`（让续轮指引 workflow 感知），违反 grill-openspec"运行时零改动"的边界（见 `docs/adr/0001-phase-routing-in-prompt.md`），故 v1 不修。

## 待做（TODO）

### 飞书集成测试不足：mock 假阳性导致大量手动 bug

> 已在 TAS-10（feishu-mock-e2e-tests）修复改进方案 1、2；方案 3 本次未做。

**问题**：飞书↔Jira comment bridge 实现后，491 个单元测试全绿，但手动测试持续暴露 bug（约 17 个）。根因是 mock HTTP server 的响应结构基于对飞书/Jira API 的**假设**，假设错了 mock 也跟着错——测试验证的是"代码逻辑是否跟错误假设一致"，而非"代码逻辑是否跟真实 API 一致"。

**典型假阳性案例**：

| bug | mock 为什么没拦住 | TAS-10 修复 |
|---|---|---|
| `thread_id` 未捕获 | mock 的 `replyInThread` 响应不返回 `thread_id`（真实 API 返回） | mock 补 `thread_id`，E2E 断言 binding 持久化 |
| `create_time` 毫秒→秒 | mock 用 `"1000"` 模拟，真实 API 返回 13 位毫秒戳 | mock 用 13 位毫秒，`toSecondsStr` 归一化 |
| `normalizeAssignee` 跳过 `name` | mock assignee 对象只有 `emailAddress`，没有 `name`（Server/DC 有） | mock 补 `name`，补 Server/DC assignee 用例 |
| `onDispatch` 无话题 | 测试只验 `postMessage` 被调用，没验话题是否创建 | E2E 断言 `thread_id` + 话题消息 |
| `container_id_type=thread` | mock 不区分 `chat` vs `thread` 容器类型 | mock 按容器类型区分，断言分别命中 |

**三类根因**：

1. **API 知识盲区（~40%）**：飞书 IM API 文档分散，`reply_in_thread`、`thread_id`、`container_id_type=thread` 等行为只有实际调用才暴露。mock 基于不完整理解构造，必然偏离真实。
2. **mock 假阳性（~35%）**：mock 的准确性受限于对 API 的理解——理解错 → mock 错 → 测试全绿但生产挂。`thread_id` 缺失、`create_time` 格式、`assignee` 字段、`onDispatch` 话题创建均属此类。
3. **设计共识盲区（~15%）**：设计聚焦 `/issue` → 话题 happy path，`onDispatch` → 话题这条路径未被显式 spec（话题是否创建？`thread_id` 从哪来？）。
4. **纯代码质量（~10%）**：busy-loop、cursor 逻辑等，mock 本应拦住但未覆盖。

**改进方案（三层，优先级递减）**：

1. **修 mock 响应结构**（低成本，立即收益）✅：把现有 mock 的响应补全（加 `thread_id`、`name` 字段、`create_time` 毫秒等），让它跟真实 API 一致。能立刻拦截之前的 bug 类别。落地：`tests/helpers/feishu-mock.ts`（真实感飞书 mock，区分 chat/thread 容器、13 位毫秒时间戳、`thread_id` 返回）。
2. **端到端流程测试**（中成本）✅：模拟完整链路 dispatch→话题→用户回复→Jira comment→agent comment→话题，用修正后的 mock 跑完整周期，验证 cursor 推进、sentinel 去重、binding 生命周期。落地：`tests/bridge-flow.test.ts`，覆盖飞书 `/issue` 与 Jira 派发两个入口的全流程。
3. **可选：录制真实 API 响应做契约测试**（高成本，长期收益）⏳ 未做：在 `FeishuSource`/`JiraTracker` 的 `fetchImpl` 包 recorder，手动测试时自动保存 request/response 到 fixture，测试加载这些 fixture 而非手写 mock。可选 `INTEGRATION=1 npm test` 跑真实 API 冒烟测试（CI 不跑）。TAS-10 按 issue 约定暂不做，真实凭据保留在 issue 描述供手动验证。

**真实 API 集成测试（TAS-10 补充，TAS-11 扩展为全流程）** ✅：`tests/integration-real.test.ts` 直接打真实飞书 bot/群 与真实 Jira TEST 项目跑两个入口全流程——Jira 入口（建 issue → `onDispatch` 建真实话题 → agent stub 真实 `postComment`/`transitionIssue` → `forwardComments` 桥回真实话题 → `onTerminate` 完结）与飞书入口（bot 发真实消息作话题根 → `executeIssue` 走真实 `createIssue` + `replyInThread` 建话题与 binding → agent stub 真实操作 → 桥接 → 完结）。修复了 mock 掩盖的真实 bug——飞书 REST 拉取返回的 sender 是 `{id, id_type, sender_type}`（无 `sender.sender_id.open_id`/`sender_name`），`parsePolledMessage` 已补 REST 形状解析。运行方式：`INTEGRATION=1 npm test`（凭据从真实 `FEISHU_E2E_*`/`JIRA_E2E_*` 环境变量或仓库根 `.env` 文件解析（`cp .env.example .env` 填写个人测试环境；无代码默认值）；默认跳过、CI 不跑；`INTEGRATION=1` 且某凭据为空则快速失败并列出缺失键）。测试自清理创建的真实 Jira issue。**限制**：飞书→Jira 用户回复方向与 `/state` 命令因 bridge 跳过 `sender_type=app` 消息、且 bot 无法冒充非 app 发送者，无法全自动真实测，由 mock E2E（`tests/bridge-flow.test.ts`）覆盖。

**信息补充）**：
1. 已经准备好端到端测的专用飞书测试群与机器人（app_id / app_secret / intake_chat_id）——个人凭据放 gitignored 的仓库根 `.env`（`cp .env.example .env`）；无代码默认值。
2. jira侧已创建测试项目（project_key 为 `TEST`）、endpoint、api_key、auth_mode=bearer ——同上，凭据放仓库根 `.env`（`JIRA_E2E_*` 键）；其他信息（如 gitlab）参考 WORKFLOW.md。
3. 仓库用 after_create: git clone ssh://git@192.168.10.180:2222/jiangxy/test2.git .
4. 采用改进方案中的1和2，3先暂时不做了
5. 端到端测试最好可以模拟整个流程，agent的完成的任务可以是非常简单的，着重整个流程测试。最少包括两个入口（飞书和jira）创建issue--》agent执行--》飞书上和jira上修改状态--》opencode agent添加注释--》jira和飞书看到新增注释和消息--》opencode执行完成--》到最终jira完结。agent里面的具体执行有不确定性，如果不能覆盖的话可以先不管，可以执行最简单的任务（能够创建MR并且merge就行），重点在固定的流程上。

## 高优先级

> 以下两项已在 TAS-9（fix-known-issues-high-priority）修复，保留作为历史记录。

### task描述如果过多显示不全
```
╭─ tasking — HEIH-55
│
│  Title:        生成恢复脚本
│  State:        处理中
│  Assignee:     postgres
│  Priority:     3
│  Source:       jira
│  URL:          http://192.168.10.17:50050/browse/HEIH-55
│
│  Workspace:    /home/xjiang3/tasking_workspaces/HEIH-55
│  Session:      ses_feba5dfbcffeo2FrXWA8CZA6dV
│  Started:      44m 25s ago
│  Turn:         2
│  Last event:   turn_started
│  Last message: turn 2 of 20
│
│  Tokens:       in 0 | out 0 | total 0
│
│
│  Description:
│  备份pipeline（jobs/Manage/Backups/ReplicateBackups180To182）会产生备份产物到182机器的目录上,
│  之前针对备份产物对服务进行了恢复测试，docs/recovery-summary目录下是备份测试的总结文档。现在需要
│  把这三个备份过程一对一的生成对应的恢复脚本。
│  要求：
│  1. 脚本能实际进行恢复
│
│  Esc/q back
╰──────────────────────────────────────────────────
```
其中Description只显示了一部分, 正常应该全显示
**修复**：TUI 运行中详情视图改为全量渲染描述（不再 200 字符/5 行截断），见 TAS-9。

### 在飞书通过/issue创建issue的时候的问题
在飞书通过/issue创建issue的时候描述会被同时加到了描述和comments（评论中的包含了标题和描述）,comments的有些多余可以不加。
**修复**：`executeIssue` 建 issue 后不再写首条 comment（summary/description 已承载全部内容），见 TAS-9 与 `docs/adr/0009-issue-first-comment-removed.md`。
### Lark 国际版链路不稳定导致卡片更新 5xx
国内网络直连或经劣质代理访问 Lark 国际版 API（open.larksuite.com）时，卡片更新/消息发送/文件上传可能间歇性返回 504/502。tasking 对可重试错误（5xx/429/网络错误）会延迟重试一次，仍失败时该轮降级为文本并在下一轮自动恢复卡片；飞书版（open.feishu.cn）不受影响。根治需为 daemon 所在机器提供稳定的国际线路。
