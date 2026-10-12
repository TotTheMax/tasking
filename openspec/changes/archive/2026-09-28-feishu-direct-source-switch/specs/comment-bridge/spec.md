# comment-bridge

## ADDED Requirements

### Requirement: Jira 缺席时桥的能力降级

桥作为飞书入口宿主在 `kind: none` 部署下 SHALL 照常构造与运行，但其 tracker 依赖为空。桥内全部 Jira 暴露面 SHALL 收敛到**唯一谓词——tracker 在场性**（装配期决定，桥不读 `tracker.kind`；全桥只允许这一处消费 tracker 可空性）。缺席时：镜像循环在 tick 首行短路（零 Jira 调用）；intake 的 `/issue` 与 `/state` 命中解析后路由到"未知命令。可用：<能力裁剪后清单>"兜底（不使用 Jira 专用错误文案——与 `/help` 裁剪语义自洽："不宣传 ⇒ 即不存在"）；`/help` 帮助卡与文本按能力裁剪（隐藏 `/issue`/`/state`，保留 `/chat`/`/agent` 与直连会话命令）；桥侧卡片按钮 handler（Jira 动作集 `state_open`/`state_refresh`/`state_summon`/`tr`/`tr_confirm`/`tr_cancel`/`agent_set`/`full`——`full` 亦依赖 Jira：它从 Jira 拉取评论全文后投递文件）首判谓词并返回提示 toast——平台入口纪律：外部输入显式降级，不抛异常。Sweep 照常执行（`/chat` 丢失兜底），逐绑定 Jira 拉取因无绑定自然为空。

#### Scenario: intake 敲 /issue 得兜底
- **WHEN** 直连专用部署中用户在 intake 群发 `/issue 修个 bug`
- **THEN** 回复"未知命令。可用：…"（含 `/chat`、`/agent`、`/help`），不创建任何 Jira issue，不抛异常

#### Scenario: /help 按能力裁剪
- **WHEN** 直连专用部署中用户发 `/help`
- **THEN** 帮助内容不含 `/issue` 与 `/state`，含 `/chat` 与 `/agent`

#### Scenario: 镜像循环零 Jira 调用
- **WHEN** 直连专用部署运行并触发 forwardTick
- **THEN** 不产生任何 Jira HTTP 请求，Sweep 正常执行

#### Scenario: 桥卡片按钮防御降级
- **WHEN** 桥侧卡片动作（如 `state_open`）在 tracker 缺席时被触发（防御场景）
- **THEN** 返回提示 toast"该操作需要 Jira 任务源"，不抛异常、不产生 Jira 请求

#### Scenario: /agent 不受影响
- **WHEN** 直连专用部署中用户在 intake 群发 `/agent`
- **THEN** 正常返回 agent 目录列表（该路径无 tracker 依赖）

#### Scenario: Jira 在场零变化
- **WHEN** 现有 Jira+飞书部署运行
- **THEN** 镜像、`/issue`、`/state`、`/help`、卡片按钮行为与现状一致（谓词为真，全路径放行）；唯一变化是 intake 未知命令兜底文案升级为能力清单式（两种模式同构，见上文）
