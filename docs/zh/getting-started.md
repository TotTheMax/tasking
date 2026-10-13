# 快速上手

把 tasking 跑起来的最短路径。两条路线：**飞书直连**（默认，5 分钟，无需 Jira）与**接 Jira**（调度器轮询 Jira issue 派发）。实用为主，细节见各分册。

> tasking 是个 daemon：默认以**飞书直连**方式运行——在群里 `/chat` 即可对指定目录跑 opencode coding-agent；接 Jira 后另获结构化调度（常用 **grill-openspec** 四阶段，见[状态流转](./state-flow.md)）。

## 前置准备

| 项 | 检查 |
|----|------|
| Node.js 22+ | `node --version` ≥ v22 |
| opencode CLI 在 `PATH` | `opencode --version`（装见 [opencode.ai](https://opencode.ai)） |
| 飞书自建应用管理员 | 直连主线路必需（见下） |
| Jira 账号 | 仅接 Jira 时需要（见第二章） |

## 第 1 步：从 npm 安装

tasking 以 scope 包形式发布在公共 npm。全局安装（需 Node 22+）：

```bash
npm install -g @tothemax/tasking
tasking --help
```

# 最快路径：飞书直连（默认，约 5 分钟）

无需 Jira：建一个飞书应用 → `tasking init` 一路回车 → `tasking start` → 群里发 `/chat`。

## 1.1 建飞书自建应用

[https://open.feishu.cn](https://open.feishu.cn) → 开发者后台 → 创建企业自建应用（名如 `tasking`）。记 **App ID**（`cli_xxx`）+ **App Secret**。应用能力里添加**机器人**，权限管理开通 5 个 scope：

| scope | 用途 |
|------|------|
| `im:message.group_msg` | 应用级读群组消息（收消息，必需，无替代） |
| `im:message` | 以机器人身份发消息/回复与读取消息内容 |
| `im:chat` | 列机器人所在群（init 帮选/一键建 intake 群） |
| `im:resource` | 附件上传（缺失降级纯文本） |
| `contact:user.id:readonly` | 建群时把你拉进群（缺失时需手动建群） |

「事件与回调」页**两块都配长连接**：**事件配置**添加 `接收消息 im.message.receive_v1`；**回调配置**订阅 `卡片回传交互 card.action.trigger`。

版本管理与发布 → 创建版本 → 提交，管理员审批（未审批调 API 会 403）。建一个群（如 `tasking-intake`）并把机器人拉进群。**个人版飞书无需他人审批、自助开通**；完整步骤、权限清单、事件订阅与报错对照见[飞书应用开通](./feishu-app-setup.md)，排错细节见[飞书接入 quickstart](./feishu-quickstart.md)。

## 1.2 tasking init（一路回车）

在任意目录跑：

```bash
tasking init
```

问答流程（默认路径只需填飞书三项 + 可选项目）：

1. **任务来源**：回车 = 只用飞书直连（要接 Jira 见第二章）
2. **模板语言**：回车 = 中文
3. **Feishu app_id / app_secret**：填入后 init **当场验证**（换 token 测试；失败会用人话报原因并让你重输 secret）
4. **选择 intake 群**：验证通过后列出机器人所在的群，回车选第一个
5. **常用项目名（可跳过）**：填了再填目录绝对路径——生成 `/chat <项目名> <消息>` 直接可用，且 `path_roots` 收敛到该目录；直接回车跳过则用 `/chat /绝对路径 <消息>`，完成提示会警告 path 模式不限制目录

完成后直接看到下一步命令。

## 1.3 启动 + 首条命令

```bash
tasking start --tui    # 前台 TUI；Ctrl+C 停（在飞的轮次会被立即中止并盖「已中断」章）
```

在 intake 群里发：

```text
/chat <项目名> 帮我看下这个报错
```

`<项目名>` 是你在 §1.2 第 5 问填的**目录别名**（如填了 `tasking` 就发 `/chat tasking 帮我看下这个报错`——它是你给工作目录起的名字，**不是 tasking 的子命令**）；当时跳过未填的，用绝对路径形态 `/chat /绝对路径 <消息>`。

机器人建话题并开始跑 opencode；完成后回一段总结 + 统计行。**直接在话题里回复即可续聊**（追问自动排队合并为下一轮）。

## 1.4 直连话题内常用命令

| 命令 | 作用 |
|------|------|
| 直接回复 | 续聊（运行中追问会排队合并） |
| `/collect` → `/send` | 攒多条消息（含图片/文件）合并为一轮 |
| `/auto [on\|once\|off]` | 本会话权限姿态（下一轮生效） |
| `/agent <name>` / `/model <name>` | 切本会话 agent / model（`reset` 恢复默认） |
| `/name <文本>` / `/status` / `/new` | 改名 / 状态卡 / 清空上下文重开 |
| `/stop` / `/done` / `/help` | 中断本轮 / 结束会话 / 帮助 |

全部命令与行为细节见[使用指南](./usage.md)直连会话一节。

# 第二章：接 Jira

在直连之上（或代替直连）接结构化任务源：调度器轮询 Jira issue 派发，agent 在每 issue 工作区里干活。

## 2.1 准备 Jira PAT

内部 Jira 是**自托管**（Jira Server），用 Personal Access Token + bearer 认证（不是 Cloud 的 email+API token）：

1. 登录内部 Jira → 右上角头像 → **个人访问令牌 / Personal Access Tokens** → **创建令牌**。
2. 复制保存（只显示一次）。
3. 记下 PAT，下一步写进 `WORKFLOW.md`（**可直接写明文值**，也支持 `$JIRA_API_TOKEN` 间接引用，二者皆可）。

## 2.2 tasking init --workflow grill-openspec

在**目标开发仓库**根目录（你要让 agent 在其中工作的那个仓库）跑：

```bash
tasking init --workflow grill-openspec
```

（init 首问选「接 Jira」再选 `grill-openspec` 等效。）交互采集 Jira endpoint/token/项目 key，连 Jira 测连接，写 `WORKFLOW.md` + `.opencode/skills/`（装 `land`/`install-glab` + 4 个 opsx 技能）。`--force` 覆盖已存在的 `WORKFLOW.md`。

> grill-openspec 四阶段：**拷问**（发 Jira 拷问 comment 转 review）→ 人答后 **实施**（propose+implement+建 MR 转 review）→ 人 review 后 **合并**（land+archive 转 terminal）。返工/增量修复不重新拷问。阶段路由全在 prompt body 内由 agent 自判，不硬编码状态名。详见[状态流转](./state-flow.md)。

## 2.3 检查最小 WORKFLOW.md

`tasking init` 会在连接测试后**按你项目实际状态自动预填** `active_states`/`terminal_states`/`review_state`（打印映射提议，回车确认；拒绝则保留默认）。生成的配置还会把可选段整段注释（只活跃必需段）。打开 `WORKFLOW.md` 确认 `tracker` 块至少如下（内部自托管值）：

```yaml
tracker:
  kind: jira
  endpoint: http://192.168.10.17:50050/rest/api/2
  api_key: $JIRA_API_TOKEN     # Jira PAT，可直接写明文值，也支持 $VAR 环境变量引用
  api_user: null                    # bearer 模式不用
  auth_mode: bearer                 # 自托管 PAT
  review_state: 代码评审中            # review 交接态，见下说明
  project_key: TAS                  # 换成你的项目 key
  active_states:                    # 候选态：只派发处于这些状态的 issue
    - 待办
    - 处理中
    - 合并中
    - 重置处理
  terminal_states:                  # 终态：不派发，且启动时清理其工作区
    - 完成
    - 关闭
    - 取消
    - 重复
polling:
  interval_ms: 30000
workspace:
  root: ~/tasking_workspaces
hooks:
  # 新工作区创建时 clone 目标仓库进来——agent 没代码改就什么都做不了，必填。
  # 换成你要 agent 工作的仓库。前提：daemon 机器的 SSH key 对该仓库有读权限。
  after_create: git clone ssh://git@192.168.10.180:2222/ai-agent-infra/tasking.git .
env:
  # glab CLI 自动读 GITLAB_TOKEN，agent 建 MR / push 用。可直接写明文值或 $GITLAB_TOKEN。
  GITLAB_TOKEN: glpat-xxxxxxxxxxxxxxxxxxxx
  GITLAB_HOST: 192.168.10.180
opencode:
  command: opencode run
  agent: build
```

**三个必填块才能真跑起来**：`tracker`（拉 Jira issue）+ `hooks.after_create`（clone 目标仓库进工作区）+ `env.GITLAB_TOKEN`（agent push/建 MR）。少任一块，agent 要么没任务、要么没代码、要么推不上去。

**三层状态模型**（调度器据状态名分桶，状态名要与 Jira 工作流一致）：

| 桶 | 含义 | 这里的状态 |
|----|------|-----------|
| **active** | 调度器派发、worker 跑 | 待办 / 处理中 / 合并中 / 重置处理 |
| **review** | 停 worker、保留工作区，等人决策 | 代码评审中（= `review_state`） |
| **terminal** | 不派发、清理工作区 | 完成 / 关闭 / 取消 / 重复 |

`review_state` 不放进 `active_states`/`terminal_states`，自动成为隐式 review 桶——agent 建 MR 后转入此态，调度器停 worker 但保留工作区。三层模型与返工双路径（增量修复 / 全量重置）见[状态流转](./state-flow.md)，全字段见[配置参考](./configuration.md)，完整示例见 [WORKFLOW.grill-openspec.md.example](../../assets/workflows/WORKFLOW.grill-openspec.md.example)。

## 2.4 启动 + 验证

```bash
tasking start --tui    # 前台 TUI：运行中任务表 / retry 队列 / 吞吐图 / 日志，Ctrl+C 停
tasking status         # 另一终端：运行中任务、retry 队列快照
tasking logs -f        # 跟踪日志（TUI 模式下日志只写 tasking.log）
```

在 Jira 造一个待派发 issue 验证：

- [ ] project = `WORKFLOW.md` 的 `project_key`
- [ ] 状态 ∈ `active_states`
- [ ] assignee / label 满足配置
- [ ] ≤ `polling.interval_ms`（默认 30s）后 `tasking logs -f` 出现派发
- [ ] 工作区被创建（默认 `<系统临时目录>/tasking_workspaces/<TAS-xxx>`），opencode 跑起来

跑通即 Jira 路径 OK。grill-openspec 下，agent 会按 issue 产物自判阶段（拷问/实施/合并），你只需在 review 态回答/审 MR。

## 2.5（可选）飞书 ↔ Jira 评论桥

Jira 路径之上再接飞书：issue 话题 ↔ Jira 评论双向镜像（`/issue` 在群里直接建 issue）。应用准备与 1.1 相同；在 init 的接 Jira 分支里选择启用飞书桥并采集 app_id/app_secret/intake 群即可（或手改 `WORKFLOW.md` 的 `feishu:` 块）。手把手排错见[飞书接入 quickstart](./feishu-quickstart.md)。

## 下一步

| 想看 | 去哪 |
|------|------|
| 全配置字段 | [配置参考](./configuration.md) |
| 全命令/退出码 | [使用指南](./usage.md) |
| 状态模型/返工路径 | [状态流转](./state-flow.md) |
| 超时/retry 退避 | [超时模型](./timeout-model.md) |
| 架构/安全不变式 | [架构概览](./architecture.md) |
| 源码开发/发布 | [开发编译指南](./development.md) |
| 术语表 | [CONTEXT.md](../../CONTEXT.md) |
| 文档总索引 | [文档索引](./index.md) |
