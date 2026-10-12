# 飞书应用开通与权限配置

tasking 与飞书的所有交互（直连 `/chat`、Jira 桥 `/issue`、卡片按钮）都通过一个**飞书自建应用**完成。本页讲清飞书侧的一次性准备：创建应用 → 开权限 → 订阅事件 → 发布 → 拿到配置写进 `WORKFLOW.md`，并说明**个人版飞书**与**企业版飞书**的差异。跑通后回到 [快速上手](./getting-started.md)（直连主线）或 [飞书接入](./feishu-quickstart.md)（Jira 桥全流程排错）。

## 1. 个人版与企业版的差异

| | 个人版飞书 | 企业版飞书 |
|---|---|---|
| 谁能建应用 | 本人即可（个人账号就是自己租户的管理员） | 普通成员可创建，发布需企业管理员 |
| 权限（scope）开通 | 自己开通即生效 | 视后台策略，敏感权限可能需管理员审批 |
| 版本发布 | 自己创建版本发布即生效，无需审批 | 需管理员在飞书「管理后台」审批通过 |
| 适用场景 | 个人开发者、试用、PoC | 团队/公司正式使用 |

两版操作步骤**完全一致**，差别只在「谁审批」。企业版下你没有管理员权限时，把本页的权限清单（§4）、事件清单（§5）、可用范围要求（§6）发给管理员代为开通即可。

> tasking 只用 IM（消息/群/机器人/卡片）能力，不依赖企业通讯录等企业专属能力，个人版功能上没有缺失。

## 2. 创建自建应用

1. 浏览器打开 <https://open.feishu.cn> → 登录（个人版或企业版账号均可）→ 进入「开发者后台」。
2. 「创建企业自建应用」→ 填名称（如 `tasking`）、描述、logo → 创建。个人版账号创建的应用挂在你的个人租户下，名称里的「企业」无需在意。
3. 应用详情 → 「凭证与基础信息」→ 记下 **App ID**（`cli_xxx`）与 **App Secret**（后面 `app_id` / `app_secret` 用；Secret 只显示一次，忘了就在该页重置）。

## 3. 添加机器人能力

应用详情 → 「应用能力」→「机器人」→「添加机器人能力」。tasking 收发消息、出现在群里的身份就是这个机器人。

## 4. 开通权限（scope）

「权限管理」→「API 权限」→ 搜索并开通：

**必需（3 个）——不开通对应功能不可用：**

| scope | tasking 用它做什么 |
|---|---|
| `im:message.group_msg` | 应用级读取群组所有消息——收 `/chat`、`/issue` 等群消息；缺失时轮询 `GET /im/v1/messages` 报 **230027**，无替代 |
| `im:message` | 获取与发送单聊、群组消息——tasking 的所有回复与卡片（`POST /im/v1/messages`、`.../reply`）、消息内容读取（断线对账补拉），以及更新/撤回已发消息（`PATCH` / `DELETE` `/im/v1/messages/:id`，直连会话卡片**原地刷新**；缺失时卡片不刷新、改为多条新消息） |
| `im:chat` | 获取与更新群组信息——`tasking init` 列出候选 intake 群 + 群选择器的「➕ 新建 intake 群（并拉你进群）」（`POST /im/v1/chats`）；缺失新建时报缺权限，init 降级回手选已有群 |

**增强（2 个）——建议一并开通：**

| scope | tasking 用它做什么 | 缺失时的表现 |
|---|---|---|
| `im:resource` | 上传图片/文件（`POST /im/v1/files`），agent 产物附件直接发群 | 上传报 **99991672 / Access denied**，tasking 降级为纯文本回复 |
| `contact:user.id:readonly` | 新建群时通过你的邮箱/手机号查 open_id 把你拉进群（`POST /contact/v3/users/batch_get_id`）——**不拉人进群的话，机器人建的群里只有机器人，你在飞书看不到它** | 新建时无法定位你的账号：init 会警告并建"只有机器人"的群且不选用，引导手动建群后「⟳ 刷新群列表」 |

**替代授权（不愿开组合权限时）：**scope 按端点授权、存在覆盖。未开 `im:message` 时可用 `im:message:send_as_bot`（发送）+ `im:message:readonly`（读内容）替代，但会失去卡片原地刷新（PATCH/DELETE 专属）；未开 `im:chat` 时可用 `im:chat:readonly` 替代（仅列群，无建群）。`im:message.group_msg` 无替代。最小可用集即上表 3 + 2（已在 Lark 实测验证）。

企业版注意：部分权限开通后会显示「待审批」状态，需管理员在管理后台批准才生效。

## 5. 订阅事件（WS 长连接）

tasking 收消息走 **WebSocket 长连接**（出站建连，机器无需公网 IP / 域名 / 证书，见 [ADR 0018](../adr/0018-event-driven-feishu-ingress.md)）。在[开发者后台](https://open.feishu.cn/app)该应用下：

1. **事件与回调 → 订阅方式** → 选「使用长连接接收事件」→ 保存。保存时要求客户端在线：先在机器上把 `tasking start` 跑起来再回来保存。
2. **事件与回调 → 添加事件**，添加两个：
   - `接收消息 im.message.receive_v1` —— 群消息入口（`/chat`、`/issue`、自由文本）。
   - `卡片回传交互 card.action.trigger` —— 卡片按钮点击（直连 `/stop`、状态转移等交互卡片的回调）。
3. 事件订阅改动后需**重新发布版本**（下一步）才生效。

> 单实例约束：同一飞书应用只允许一个 tasking daemon 在线。多台机器同时连同一个 `app_id` 时，平台按集群模式随机路由事件，会互相抢消息。

## 6. 发布应用

- **个人版**：「版本管理与发布」→「创建版本」→ 填版本号（可用范围默认即可）→ 发布，即时生效。
- **企业版**：创建版本时选择可用范围（全员或指定部门/成员——**至少要覆盖建 intake 群的人和使用者**）→ 提交 → 企业管理员在飞书「管理后台」→「工作台」→「应用管理」审批通过。

未发布 / 未审批的应用调 API 一律 **403**。

## 7. 建 intake 群并拉机器人入群

1. 飞书客户端建一个群（如 `tasking-intake`）——**所有任务线程都在这一个群里**（直连的每个项目会话、桥的每条 `/issue` 话题）。
2. 群「设置」→「群机器人」→ 添加你刚创建的 `tasking` 机器人。
3. 群的 `chat_id` **不需要手动查**：`tasking init` 在验证 app_id/app_secret 后会调用列群接口，把机器人所在群列出来让你选（依赖 §4 的 `im:chat`）；一个群都没有时，选择器顶部的「➕ 新建 intake 群」可以直接建群（依赖 §4 的 `im:chat`，默认名 `tasking-intake`，建完即选用）。需要手动获取时用 curl 两步法，见 [飞书接入 §6](./feishu-quickstart.md#_6-取-intake-群-chat-id)。

## 8. 写进 WORKFLOW.md

两种形态共用同一个 `feishu:` 块，`tasking init` 交互会替你生成；手改时最小配置如下。

**直连（无需 Jira，`tracker` 为 `none`）：**

```yaml
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxxxxxxxxxxxxxxx
  direct:
    enabled: true
```

**桥（接 Jira，`tracker` 为 `jira`）：**

```yaml
feishu:
  enabled: true
  app_id: $FEISHU_APP_ID
  app_secret: $FEISHU_APP_SECRET
  intake_chat_id: oc_xxxxxxxxxxxxxxxx
  forward_interval_ms: 5000
  create_issue_type: Task
```

常用字段：

| 字段 | 含义 |
|---|---|
| `enabled` | 飞书总开关 |
| `app_id` / `app_secret` | §2 记下的应用凭证；建议 `$ENV_VAR` 间接引用（见下），避免明文入库 |
| `intake_chat_id` | §7 的接待群 ID（`oc_` 开头） |
| `direct.enabled` | 直连会话（`/chat`）开关，直连形态必开 |
| `forward_interval_ms` / `sweep_interval_ms` | 桥的评论转发/兜底扫描间隔 |
| `create_issue_type` | `/issue` 建单用的 Jira issueType（如 `Task`） |

环境变量方式注入凭证：

```bash
export FEISHU_APP_ID=cli_xxx
export FEISHU_APP_SECRET=你的secret
```

完整字段与默认值见 [配置参考 · `feishu` 块](./configuration.md)。

## 9. 报错对照表

> 更快的排错方式：跑 `tasking doctor` ——它自动做本节的对照（凭据/三个 scope 探针/intake 群可达），直接打印缺什么与本页指引链接。`tasking init` 的飞书采集流程也会自动跑同款体检。

| 症状 | 缺的步骤 |
|---|---|
| API 一律 403 | 版本未发布/未审批（§6），或 scope 全没开（§4） |
| 轮询报 **230027** | 缺 `im:message.group_msg`（§4） |
| 上传报 **99991672 / Access denied** | 缺 `im:resource`（§4） |
| 事件日志 `FAIL app not online` | 订阅方式没改长连接 / 事件没加 / 改完没重新发布（§5） |
| 机器人能发不收 | 事件订阅问题（§5）；或另一台机器也在用同一 `app_id`（单实例约束） |
| `tasking init` 列不出群 | 机器人没进群（§7）或缺 `im:chat`（§4） |
| 点「➕ 新建 intake 群」建群失败 | 缺 `im:chat`（§4）——init 会降级回手选已有群 |
| 群里看不到机器人 | 机器人能力没添加（§3）或可用范围没覆盖你（§6） |

## 相关

- [快速上手](./getting-started.md) —— 5 分钟直连主线
- [飞书接入](./feishu-quickstart.md) —— Jira 桥全流程与排错
- [配置参考](./configuration.md) —— `feishu` 块完整字段
- [ADR 0018](../adr/0018-event-driven-feishu-ingress.md) —— 为什么用 WS 长连接而不是 webhook
