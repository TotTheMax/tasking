# 飞书接入 quickstart

手把手把 tasking 接到飞书：建应用 → 授权 → 拉群 → 取 chat_id → 配 WORKFLOW → 启动 → 验证。飞书成已存在 Jira issue 的评论同步镜像（人只在飞书、agent 只认 Jira，runtime 不动，见 [ADR 0002](../adr/0002-feishu-jira-comment-bridge.md)）。

> **Lark（海外版）用户**：本文步骤同样适用，但需在 **Lark 开发者后台**（<https://open.larksuite.com>）单独创建应用——飞书与 Lark 的应用/凭据/租户互不相通（同一手机号登录不影响这一点）。配置 `feishu.edition: lark` 后，API 域名与文档中所有 `open.feishu.cn` 控制台链接替换为 `open.larksuite.com`。

## 前提

- tasking 已安装、Jira 已通：`tasking init` 跑过、`tasking start` 能派发 Jira issue。
- 飞书「企业自建应用」的管理员权限（建应用、授权、发布版本、审批）。个人版飞书自助即可；应用开通与权限的完整说明（含个人版/企业版差异、增强 scope、事件订阅）见[飞书应用开通](./feishu-app-setup.md)。

## 1. 建飞书自建应用

1. 浏览器开 <https://open.feishu.cn> → 登录 → 进「开发者后台」。
2. 「创建企业自建应用」→ 填名称（如 `tasking`）、描述、logo → 创建。
3. 应用详情 → 「凭证与基础信息」→ 记下 **App ID**（`cli_xxx`）与 **App Secret**（后面 `app_id`/`app_secret` 用）。

## 2. 开机器人能力

应用详情 → 「应用能力」→「机器人」→ 点「添加机器人能力」→ 确认。让应用能收发 IM 消息。

## 3. 授权 scope

「权限管理」→「权限」→ 搜索并开通：

| scope | 用途 |
|------|------|
| `im:message.group_msg` | 应用级读群组所有消息（轮询 `GET /im/v1/messages`，**必需**——少这个会报 230027，无替代） |
| `im:message` | 发消息/回复（`POST /im/v1/messages`、`.../reply`）与读取消息内容 |
| `im:chat` | 列机器人所在群（`GET /im/v1/chats`，取 intake 群 chat_id）与一键建群 |
| `im:resource` | 上传图片/文件（缺失时降级纯文本回复） |

> 未开通 `im:message` / `im:chat` 时的替代授权：发送 `im:message:send_as_bot`、读内容 `im:message:readonly`、列群 `im:chat:readonly`（详见[飞书应用开通](./feishu-app-setup.md)）。

## 4. 发布版本并审批

1. 「版本管理与发布」→「创建版本」→ 填版本号、可用范围（全员或指定）→ 提交。
2. 企业管理员在飞书「管理后台」→「工作台」→「应用管理」审批通过。

未发布/未审批的应用调 API 会 403。

## 5. 建 intake 群并拉机器人入群

1. 飞书客户端建一个群（如 `tasking-intake`）——**所有 issue 线程都在这一个群里**，每条 `/issue` 成一个话题。
2. 群「设置」→「群机器人」→ 添加你刚建的 `tasking` 机器人。

## 6. 取 intake 群 chat_id

机器人入群后，用 API 列群拿 chat_id。先取 tenant_access_token：

```bash
curl -X POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal \
  -H "Content-Type: application/json" \
  -d '{"app_id":"cli_xxx","app_secret":"你的secret"}'
# → {"tenant_access_token":"t-xxx","expire":7200}
```

再列群：

```bash
curl "https://open.feishu.cn/open-apis/im/v1/chats?page_size=20" \
  -H "Authorization: Bearer t-xxx"
# → {"data":{"items":[{"chat_id":"oc_xxxxx","name":"tasking-intake",...}]}}
```

找到 intake 群名，记下 **chat_id**（`oc_xxx`）。

## 7. 配 WORKFLOW.md

挑一个 Jira issueType 作 `/issue` 默认（不确定就跑 `tasking init`，连接测试里会列「Project issue types」）。编辑 `WORKFLOW.md` front matter：

```yaml
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxxxxxxxxxxxxxxx
  forward_interval_ms: 5000
  create_issue_type: Task
```

凭据用 `$VAR` 间接引用，设环境变量：

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=你的secret
```

字段含义见 [配置参考 · `feishu` 块](./configuration.md)。

## 8. 启动

```bash
tasking start
```

日志应见 `feishu comment bridge ready` + `event channel connected` + `daemon started`。**无公网端口监听**——收消息走 WS 长连接（出站建连），发送走 REST（[ADR 0018](../adr/0018-event-driven-feishu-ingress.md)）。

### 8.1 事件订阅一次性配置（必须）

收消息依赖飞书事件订阅（WS 长连接）。在[开发者后台](https://open.feishu.cn/app)该应用下：

1. **事件与回调 → 订阅方式** → 改为「使用长连接接收事件」并保存（需先 `tasking start`，客户端在线才能保存成功）。
2. **事件与回调 → 添加事件** → 搜索并添加 `接收消息 im.message.receive_v1`。
3. **版本管理与发布** → 创建新版本 → 发布。**不发布不生效**。
4. 常见误配症状：控制台事件日志显示 `FAIL app not online`（=没发布版本）；事件推到了别的应用（认准 `app_id`）。

注意：**单实例约束**——同一飞书应用只允许一个 tasking daemon 在线；多连接时平台按集群模式随机路由，会互相抢事件。

## 9. 验证清单

在 intake 群里发：

- [ ] `/help` → 机器人秒回命令列表。
- [ ] `/issue 暗色模式` 换行 `需要暗色主题切换` → 回 `✅ 已创建 ENG-xxx`，该命令消息成话题根；Jira 里该 issue 的 summary=暗色模式、description 字段含多行内容（不额外写首条 comment）。**多行/富文本（`post` 类型）消息同样支持**——飞书会把带换行的消息投递为富文本，桥会把它拍平成纯文本再解析，效果与纯文本一致。
- [ ] 在该 issue 的话题里发 `/state` → 回 `当前: To Do` + 可用转移编号列表。
- [ ] 在 intake 群直接发一句非命令文本（如 `你好`）→ 机器人回 `已收到 ✓（/issue 创建任务，/help 看用法）`，且不产生 Jira 评论/binding。
- [ ] 秒级内（事件推送）去 Jira 看 `ENG-xxx` 评论里有一条 `💬 你的名 via 飞书 [msg:om_xxx]:\n需要暗色主题切换`（人发→Jira，带 sentinel）。若毫无反应，先看自检法（下方常见问题），再查 `feishu` 事件日志页的推送记录。
- [ ] 在该话题里再发一句非命令自由文本（如 `帮我看看这个`）→ 机器人回 `✅ 已收到，已同步到 ENG-xxx`，Jira 评论出现带 sentinel 的对应消息。
- [ ] 在 Jira 直接给 `ENG-xxx` 加一条评论 → ≤5s 后飞书话题里出现 `🤖 agent:` 或 `💬 {人} (Jira):` 转发（Jira→人，保完整性）。
- [ ] `/state <某个 terminal 编号>` → 回 `✅ 已转 ...（完结）`，话题标 terminal、停同步。

## 10. 常见问题

- **机器人不回**：scope 没开通 / 版本没发布审批 / 机器人没进 intake 群 / `intake_chat_id` 填错。`tasking start` 日志找 `feishu_api_status` 4xx。
- **`/issue` 建了 issue 但 scheduler 不派发**：桥已把 `tracker.project_key`/`assignee`/`required_labels` 锁定复用，正常必匹配。若仍不派发，去 Jira 查该 issue 状态是否在 `active_states`、assignee/labels 是否与 tracker 一致。
- **事件自检法（1 分钟）**：`tasking start` 日志里应有 `event channel connected`；在群里发条消息，日志出现 `ingest`/`已创建`/桥接记录即通。没通就按 8.1 核对三步（订阅方式/事件/发布）。
- **延迟感**：飞书→Jira 走事件推送，秒级；Jira→飞书评论镜像 ≤ `forward_interval_ms`（默认 5s）。断线/停机窗口由 Sweep 兜底补拉（默认 12h 一轮，见 [ADR 0018](../adr/0018-event-driven-feishu-ingress.md)）。
- **重启重发/重建**：不会——游标持久化在 `bindings.db`（`workspace.root` 下），重启续上；intake 游标也持久，不重建 issue。
- **换新机器**：无需迁移 db 文件。`bindings.db` 不存在时 intake 游标为空，桥会先跑一次冷启动探测（一次不带时间参数的请求 → 飞书返回最新一页）把游标锚定到飞书自己的时钟，因此不会回放/重建历史 issue。取舍：换机停机窗口内的消息不被消费，旧话题绑定停摆（见 [ADR 0016](../adr/0016-cold-start-intake-cursor.md)）。
- **切回旧机器**（另一台机器跑过之后）：旧机器的 `bindings.db` 游标落后，重启会重放停机窗口历史、重复建单。用 `tasking start --fresh` 以新机器方式启动：清本地 intake 游标（下轮 Sweep 走冷启动探测，不回放）+ 按 Jira 现状对账（已完结/消失的 binding 标 terminal，仍 active 的保留）——停机窗口内两台机器都未消费的消息不补消费，需人工补发（见 [ADR 0019](../adr/0019-fresh-start-intake.md)）。
- **tasking 与 agent 共用 Jira 账号**：设计如此（`buildMcpConfig` 注入同一套凭证），去重靠可见 sentinel 而非作者（[ADR 0004](../adr/0004-sentinel-comment-dedup.md)）。

## 进阶 / 限制

- v1 文本语义：飞书消息的 `text` 与 `post`（富文本）两种类型都会被拍平成纯文本处理——多行 `/issue`、话题内多行自由文本均可用；图片等无文本内容的消息忽略。Jira comment（ADF）拍平成纯文本发飞书；图片、编辑/删除同步 deferred（见 [usage.md](./usage.md) 飞书节）。
- 一个 intake 群承载所有线程；要多群分论、跨群扇出后加。
- 想理解决策取舍：[ADR 0002](../adr/0002-feishu-jira-comment-bridge.md) / [0003](../adr/0003-rest-poll-feishu-ingress.md) / [0004](../adr/0004-sentinel-comment-dedup.md)。
