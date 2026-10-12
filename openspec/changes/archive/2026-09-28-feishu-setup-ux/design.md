# design.md — feishu-setup-ux

## Context

`tasking init` 的飞书采集流程（`src/cli/init.ts` 的 `collectFeishuDirectConfig` 与接 Jira 分支的 `collectFeishuConfig`）目前只做凭据验证（换 `tenant_access_token`），成功即过。运行时（`src/adapters/feishu/source.ts`）所有 API 失败抛 `feishu_api_status` TaskingError，裸带 HTTP 状态码，用户无从对应到"控制台哪一步没做"。平台的限制是硬边界：建应用/开 scope/订阅事件/发布版本没有开放 API，只能在开发者后台手工完成——因此本设计的定位是**检测与指路**，不是代替操作。

## Goals / Non-Goals

**Goals:**
- init 时自动探测飞书权限缺失，输出精确到"控制台搜什么词、点哪个链接"
- 运行时 403 等错误翻译为人话 + 深链，且不刷屏
- 没有群的用户在 init 内一条路建群到底
- `tasking doctor` 事后随时全链路复检（只读、可脚本化）

**Non-Goals:**
- 不自动化开发者后台操作（平台无 API）
- 不引入 lark-cli 或任何外部工具依赖
- 不改 bridge/scheduler/worker 核心逻辑
- 不做 doctor 的双语/英文输出（先中文，与 init 交互同一人设）

## Decisions

### D1：探针作为独立模块 `src/adapters/feishu/probe.ts`

三个只读探针 + 映射表集中一处，init 两条路径与 doctor 共用：

| 探针 | 请求 | 验证 | 错误码含义 |
|---|---|---|---|
| 列群 | `GET /im/v1/chats`（已有方法复用） | `im:chat:readonly` | 403→未发布/未开 |
| 读群消息 | `GET /im/v1/messages?container_id_type=chat` | `im:message.group_msg` + `im:message:readonly` | 230027→缺 group_msg |
| 上传探针文件 | `POST /im/v1/files`（10 字节 `tasking-probe.txt`） | `im:resource` | 99991672→缺 im:resource |

- **发消息不探**：任何真实发送都在群里留痕，无无损手段；输出如实标 `- 未探测（start 后实发验证）`，运行时诊断兜底。替代方案（建临时群发删）需要 `im:chat` 写权限且副作用更大，否决。
- **探针结果模型**：`{ scope, status: "ok" | "missing" | "unknown", hint }[]`——`unknown` 覆盖网络异常等无法归因的情况，不假装确定。
- 失败只警告不阻断：init 的硬门槛保持只有凭据正确性（现状不变），用户可能正处于"先 init 后补权限"的正常节奏。

### D2：深链常量集中 + 根链兜底

`consoleLinks(appId)` 返回 `{ app, permission, event, version }` 四个 URL，集中在一个模块。具体子路径没有官方稳定性承诺 → 兜底链 `https://open.feishu.cn/app/{app_id}`（模式稳定）；实现期真机人工核对三个子路径，核对不实的立即退回根链。**宁可保守不给死链。**

### D3：建群挂载在群选择器内

- 选择器列表顶部加「➕ 新建 intake 群」→ 问群名（默认 `tasking-intake`）→ `POST /im/v1/chats` → 用返回 `chat_id` 直接完成选择。
- `im:chat` 定位为第 5 个**增强**权限（文档同步）：没开通时点新建 → 报"缺 im:chat" + 深链 → 降级回选择器手选。不为便利抬高必开门槛。
- 非交互模式跳过建群选项（`--non-interactive` 下零惊喜写操作）。
- **真机核实结论（2026-09 冒烟）**：`POST /im/v1/chats` 空 `user_id_list` 建出的是**只有机器人的群，人不可见**。按预案补添加成员步骤：新建时询问用户邮箱/手机号 → `batch_get_id` 查 open_id（需第 6 个增强权限 `contact:user.id:readonly`）→ 建群时带入 `user_id_list`；跳过/查询失败时建群成功也**不选用**，明确警告并引导手动建群 + 选择器新增「⟳ 刷新群列表」闭环。

### D4：运行时 403 诊断与降噪

- 位置：`source.ts` 现有错误路径。403 → TaskingError 的 hint 字段附"版本未发布/未审批或缺权限"人话 + version 深链；230027/99991672 同法映射到权限页深链。
- 降噪：daemon 内一个 `Set<string>` 记录已完整提示过的错误签名（method+status），首次完整提示，后续同类只打单行 `(hint already shown)`。进程生命周期内有效，重启复位——简单且够用；不做时间窗（额外复杂度无对应收益）。

### D5：doctor 为纯只读聚合命令

`tasking doctor`（`src/cli/index.ts` + `help.ts`）按序执行：WORKFLOW.md 解析 → 飞书（token → 3 探针 → intake 群可达）→ Jira（复用 `testJiraConnection`）→ opencode PATH。每项 ✓/✗/− 与补救提示，末尾汇总表；`0` 全过 / `1` 有失败。中文输出。不做参数（无 `--fix`，修正是人来做的）。

## Risks / Trade-offs

- [深链子路径失效/改版] → 根链兜底 + 真机核对；常量集中一处改动成本最小
- [探针文件在飞书侧留孤儿文件] → 10 字节、不发任何会话、不可见；换取 im:resource 的确定性检测，接受
- [建群后机器人未入群（若真机核实属实）] → 创建后补 `im/v1/chats/{chat_id}/members` 添加机器人，或降级提示手动拉群
- [体检造成 init 变慢] → 3 个探针请求，总耗时 <1s（正常网络），可接受
- [doctor 覆盖面膨胀] → 本期锁死四类检查；新检查项走新 change

## Migration Plan

纯增量，无迁移。回滚 = revert 单 commit 集。发布节奏按载体分四个 tasks 组，每组独立可验证。

## Open Questions

（无——深链路径与机器人入群两个事实问题在实现期真机核实，不阻塞编码。）
