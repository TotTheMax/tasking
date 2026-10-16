import { normalizeTemplate } from "./normalize.js";

export interface PatternRule {
  re: RegExp;
  en: string;
}

export const EXACT: Record<string, string> = {
  "\n  --fresh 仅在 feishu.enabled 时生效（飞书桥未启用，忽略该选项）。\n\n":
    "\n  --fresh only takes effect with feishu.enabled (Feishu bridge disabled; option ignored).\n\n",
  "\n  tasking 启动校验失败:\n": "\n  tasking startup validation failed:\n",
  "  --agent <name>      创建时指定 agent（打 agent:<name> 标签）":
    "  --agent <name>      Set the agent at creation (adds an agent:<name> label)",
  "  --type <name|N>     覆盖 issueType（默认 feishu.create_issue_type）":
    "  --type <name|N>     Override the issueType (default feishu.create_issue_type)",
  "  (详见 tasking.log)\n\n": "  (see tasking.log for details)\n\n",
  "  （状态名无法完整映射到 active/terminal，保留模板默认，可在 WORKFLOW.md 手改）":
    "  (Some state names could not be mapped to active/terminal; template defaults kept — adjust WORKFLOW.md manually)",
  "  <description>        第 2 行起 = 描述，多行":
    "  <description>        Line 2 onwards = description (multiline)",
  "  建议：在飞书手动建群并把 tasking 机器人拉进群，然后回来选「⟳ 刷新群列表」":
    '  Tip: create a group manually in Feishu, add the tasking bot, then come back and pick "⟳ Refresh group list"',
  "  建议的状态预填：": "  Suggested state prefill:",
  "  然后在群里发：/chat /绝对路径 <消息>": "  Then in the group send: /chat /abs/path <message>",
  "配置完成！": "Configuration complete!",
  "运行：": "Run: ",
  "path 模式当前不限制目录（path_roots: []），建议在 WORKFLOW.md 配置 projects 或 path_roots":
    "path mode currently does not restrict directories (path_roots: []) — configure projects or path_roots in WORKFLOW.md",
  "  已降级回群选择——可手选已有群，或开通权限后重试新建":
    "  Fell back to group selection — pick an existing group, or grant the permission and retry creation",
  "  app_secret 已明文写入 WORKFLOW.md；如需保密可改用环境变量：export FEISHU_APP_SECRET=<secret>，再把该行改回 $FEISHU_APP_SECRET":
    "  app_secret was written in plain text into WORKFLOW.md; for secrecy use an env var instead: export FEISHU_APP_SECRET=<secret>, then change the line back to $FEISHU_APP_SECRET",
  " · ⚡ 下轮放开": " · ⚡ unlocked next turn",
  " · 运行中": " · running",
  "— 会话已过期 —": "— session expired —",
  "、": "、",
  "：": ": ",
  "· env.GITLAB_TOKEN / GITLAB_HOST   供 agent 建 MR（glab）":
    "· env.GITLAB_TOKEN / GITLAB_HOST   for the agent to open MRs (glab)",
  "（本轮无文本回复）": "(no text reply this turn)",
  "（多条排队消息将合并为一轮执行）": "(multiple queued messages will be merged into one turn)",
  "（缓冲仅在内存，daemon 重启会丢失。）":
    "(The buffer is memory-only; a daemon restart loses it.)",
  "（回答过长，文件上传不可用，已改为文本投递；完整内容亦可在 TUI 活动视图查看）":
    "(answer too long; file upload unavailable, delivered as text; the full content is also in the TUI activity view)",
  "（会话覆盖）": "(session override)",
  "（配置默认）": "(config default)",
  "（完结）": " (terminal)",
  "（未分配）": "(unassigned)",
  "（未开始）": "(not started)",
  "（未配置 — 可用 /chat /绝对路径 <消息> 直接在目录创建会话）":
    "(none configured — use /chat /abs/path <message> to create a session in any directory)",
  "（未设置）": "(unset)",
  "（未在目录中，已回退默认）": " (not in catalog, fell back to default)",
  "（未知）": "(unknown)",
  "（文件上传不可用，已改为文本投递；完整明细亦可在 TUI 活动视图查看）":
    "(file upload unavailable, delivered as text; the full detail is also in the TUI activity view)",
  "(无)": "(none)",
  "（无）": "(none)",
  "（用户发来附件，请读取下列文件后回答）":
    "(the user sent attachments; read the following files and answer)",
  "[图片]": "[image]",
  "**富输入**：直接发图片/文件 → 下载到工作区并把路径交给 agent":
    "**Rich input**: send images/files → downloaded into the workspace, paths handed to the agent",
  "**会话状态**": "**Session status**",
  "**命令**": "**Commands**",
  "**失败**": "**Failed**",
  "**续聊**：直接回复本话题 → 与 agent 对话（排队串行执行）":
    "**Continue**: reply in this thread → talk to the agent (queued, serial)",
  "/agent                查看默认 agent + 可用目录（话题内还显示当前 agent）":
    "/agent                Show the default agent + catalog (in a thread, also the current agent)",
  "/agent <name>         切换该任务 agent（话题内，下一 turn 生效）":
    "/agent <name>         Switch the task's agent (in a thread, effective next turn)",
  "/agent <name> → 切换本会话 agent（/agent reset 恢复）":
    "/agent <name> → switch this session's agent (/agent reset restores)",
  "/agent <name> 需在任务话题内使用哦～": "/agent <name> must be used inside a task thread",
  "/agent default        清除 agent 标签，回退默认":
    "/agent default        Clear the agent label and fall back to the default",
  "/auto [on|once|off] → 查看/切换本会话权限姿态（下一轮生效）":
    "/auto [on|once|off] → view/switch this session's permission posture (effective next turn)",
  "/chat                             列出可用项目":
    "/chat                             List available projects",
  "/chat                 列出可用项目": "/chat                 List available projects",
  "/chat /abs/path <msg> 在指定目录创建 opencode 会话":
    "/chat /abs/path <msg> Create an opencode session in the given directory",
  "/chat <项目名|绝对路径> <消息>  在指定目录创建 opencode 会话":
    "/chat <project|abs-path> <message>  Create an opencode session in the given directory",
  "/chat <project> <msg> 在已配置项目目录创建 opencode 会话（仅 intake 群）":
    "/chat <project> <msg> Create an opencode session in a configured project dir (intake group only)",
  "/chat 内: 直接回复续聊，/stop 中断当前任务，/done 结束会话":
    "In /chat threads: reply directly to continue; /stop interrupts; /done ends the session",
  "/chat 是群聊命令，请在群里发哦～":
    "/chat is a group command — please send it in the intake group",
  "/collect → 进入多消息收集模式（发完用 /send 提交为一轮，/cancel 丢弃）":
    "/collect → enter multi-message collect mode (/send submits as one turn, /cancel discards)",
  "/done → 结束会话": "/done → end the session",
  "/help                 本帮助": "/help                 This help",
  "/issue                列该项目可用 issueType + 默认":
    "/issue                List the project's issueTypes + default",
  "/issue <title>        创建 issue（仅 intake 群）":
    "/issue <title>        Create an issue (intake group only)",
  "/issue 是群聊命令，请在群里发哦～":
    "/issue is a group command — please send it in the intake group",
  "/issue、/chat": "、",
  "/model <name> → 切换本会话 model（/model reset 恢复）":
    "/model <name> → switch this session's model (/model reset restores)",
  "/name <文本> → 给本会话改名（卡片头部与 TUI 显示）":
    "/name <text> → rename this session (card header and TUI)",
  "/new → 清空上下文开启新会话": "/new → clear context and start a new session",
  "/state                查看当前状态 + 可用转移编号（已绑话题内）":
    "/state                Show current state + available transitions (in a bound thread)",
  "/state <N|name>       转状态": "/state <N|name>       Transition the state",
  "/state 是话题命令，请在 issue 话题内发哦～":
    "/state is a thread command — please send it inside an issue thread",
  "/status → 查看会话状态": "/status → show session status",
  "/stop → 中断当前任务（含清空排队消息）":
    "/stop → interrupt the current task (and clear queued messages)",
  "# —— 可选：以下为默认值，改动才解注释 ——":
    "# —— optional: these are defaults; uncomment only to change ——",
  "## 🔍 拷问 / Grill Questions": "## 🔍 Grill Questions",
  "`/agent <name>` · `/model <name>` → 切换 agent/model（`reset` 恢复）":
    "`/agent <name>` · `/model <name>` → switch agent/model (`reset` restores)",
  "`/auto [on|once|off|reset]` → 本会话权限姿态（下一轮生效）":
    "`/auto [on|once|off|reset]` → session permission posture (effective next turn)",
  "`/collect` → 收集多条消息；`/send` 提交为一轮；`/cancel` 丢弃":
    "`/collect` → collect messages; `/send` submits as one turn; `/cancel` discards",
  "`/done` → 结束会话": "`/done` → end the session",
  "`/name <文本>` → 会话改名（卡片头部与 TUI）":
    "`/name <text>` → rename the session (card header and TUI)",
  "`/new` → 清空上下文开启新会话": "`/new` → clear context and start a new session",
  "`/status` → 查看会话状态": "`/status` → show session status",
  "`/stop` → 中断当前任务（含清空排队）":
    "`/stop` → interrupt the current task (and clear the queue)",
  "↩️ 默认": "↩️ Default",
  "⏳ 目标目录或并发额度正被占用，排队等待中，空闲后自动开始…":
    "⏳ The target directory or concurrency budget is busy; queued and will start automatically when free…",
  "⏹ 中断": "⏹ Interrupt",
  "▶ 运行中": "▶ Running",
  "⚠️ /agent 切换需要 Jira 任务源（当前未配置）":
    "⚠️ /agent switching requires a Jira task source (not configured)",
  "⚠️ /state 需要 Jira 任务源（当前未配置）":
    "⚠️ /state requires a Jira task source (not configured)",
  "⚠️ 放开后本会话后续轮次不再询问权限；目标仓库自身的 deny 规则仍然生效。":
    "⚠️ Once unlocked, later turns in this session stop asking for permission; the target repo's own deny rules still apply.",
  "⚠️ 附件未能读取，本轮未执行；请重发，或把文件放到工作目录后把路径发给我。":
    "⚠️ Attachments could not be read; this turn did not run. Resend, or place the file in the working directory and send me the path.",
  "⚠️ 结束会话将删除该 opencode 会话（不可恢复）。":
    "⚠️ Ending the session deletes this opencode session (irrecoverable).",
  "⚠️ 上次运行被中断（daemon 重启），请重发消息继续；若当时是第一轮对话，此前内容不会保留。":
    "⚠️ The last run was interrupted (daemon restart); resend to continue. If it was the first turn, earlier content is not kept.",
  "⚠️ 同步失败，请稍后重试": "⚠️ Sync failed, please retry later",
  "⚠️ 已中断": "⚠️ Interrupted",
  "⚠️ 暂仅支持文本消息，图片/文件请用文字描述～":
    "⚠️ Only text is supported for now; describe images/files in words",
  "⚡ 仅下一轮": "⚡ Next turn only",
  "⚡ 仅下一轮放开": "⚡ Next turn only",
  "⚡ 仅下一轮放开权限（用完自动恢复默认）。":
    "⚡ Permissions unlocked for the next turn only (auto-restores afterwards).",
  "⚡ 取消": "⚡ Cancel",
  "✅ 本会话放开": "✅ Unlock session",
  "✅ 确认": "✅ Confirm",
  "✅ 完成": "✅ Done",
  "✅ 已收到，已同步到 {issue_key}": "✅ Received and synced to {issue_key}",
  "✖ 取消": "✖ Cancel",
  "❌ 失败": "❌ Failed",
  "➕ 新建 intake 群（并拉你进群）": "➕ Create a new intake group (and invite you)",
  "⟳ 刷新群列表": "⟳ Refresh group list",
  "💬 可在此话题回复": "💬 Reply in this thread",
  "📄 完整输出": "📄 Full output",
  "📋 状态": "📋 State",
  "📖 直连会话帮助": "📖 Direct session help",
  "📖 tasking 命令": "📖 tasking commands",
  "📤 提交为一轮": "📤 Submit as one turn",
  "📥 开始收集": "📥 Start collecting",
  "📥 收集模式": "📥 Collect mode",
  "📥 已进入多消息收集模式：接下来的消息（含图片/文件）都会先收集，不立即执行。发完用 /send 合并提交为一轮；/cancel 丢弃；10 分钟无新消息会自动提交。":
    "📥 Multi-message collect mode on: incoming messages (incl. images/files) are collected instead of run. Finish with /send to submit as one turn; /cancel discards; auto-submits after 10 idle minutes.",
  "🔀 转状态": "🔀 Transition",
  "🔁 重试": "🔁 Retry",
  "🔄 刷新": "🔄 Refresh",
  "🔐 权限": "🔐 Permissions",
  "🔐 权限姿态": "🔐 Permission posture",
  "🔒 恢复默认": "🔒 Restore default",
  "🔒 默认": "🔒 Default",
  "🔒 默认（不传 --auto）": "🔒 Default (no --auto)",
  "🔓 本会话放开": "🔓 Unlock this session",
  "🔓 收回": "🔓 Re-lock",
  "🔓 已放开本会话权限（下一轮生效）。目标仓库自身的 deny 规则仍然生效；/auto reset 可恢复。":
    "🔓 Session permissions unlocked (effective next turn). The target repo's own deny rules still apply; /auto reset restores.",
  "🗑 丢弃": "🗑 Discard",
  "🛑 结束": "🛑 End",
  "把接下来的多条消息（含图片/文件）攒成**一轮**再执行。":
    "Batch the next several messages (incl. images/files) into **one turn** before running.",
  保持模板默认: "Keep template defaults",
  常用项目名: "Frequent project name",
  处理中: "In Progress",
  传文件: "upload file",
  "打开 Jira": "Open in Jira",
  代码评审中: "Code Review",
  待办: "To Do",
  待评审: "Awaiting Review",
  当前不在收集模式: "Not in collect mode",
  "当前不在收集模式。": "Not in collect mode.",
  "当前不在收集模式。用 /collect 开始收集多条消息。":
    "Not in collect mode. Use /collect to collect multiple messages.",
  当前没有可用转换: "No transitions available",
  "点下方按钮开始，或直接发 `/collect`。": "Tap the button below to start, or send `/collect`.",
  读群消息: "read group messages",
  发消息: "send message",
  放开: "unlocked",
  "放开后本会话后续轮次不再询问权限；目标仓库自身的 deny 规则仍然生效。":
    "Once unlocked, later turns in this session stop asking for permission; the target repo's own deny rules still apply.",
  飞书: "Feishu",
  飞书凭据: "Feishu credentials",
  "飞书直连专用部署：/chat 在配置目录创建 opencode 会话（无需 Jira）。详见 docs/feishu-quickstart.md":
    "Feishu-direct deployment: /chat creates an opencode session in a configured directory (no Jira needed). See docs/feishu-quickstart.md",
  "该操作需要 Jira 任务源": "This action requires a Jira task source",
  该操作已处理: "This action was already processed",
  "该轮没有可导出的完整明细（可能因 daemon 重启，明细已不在内存中）。":
    "This turn has no exportable full detail (a daemon restart may have cleared it from memory).",
  该轮已结束: "This turn already ended",
  关闭: "Closed",
  合并中: "Merging",
  "后续消息（含图片/文件）都会先收集，不立即执行。":
    "Incoming messages (incl. images/files) are collected instead of run.",
  "回答过长，无法作为消息发送；请在 TUI 活动视图查看该会话的完整回答。":
    "The answer is too long to send as a message; see the session's full answer in the TUI activity view.",
  会话不存在或已清理: "Session not found or cleaned up",
  "会话创建后：在本话题内直接回复即续聊；/stop 中断当前任务；/done 结束会话":
    "After creation: reply in this thread to continue; /stop interrupts the current task; /done ends the session",
  会话已结束: "Session ended",
  "或: /chat /绝对路径 <消息> 在任意目录创建会话":
    "Or: /chat /abs/path <message> to create a session in any directory",
  "接 Jira": "Connect Jira",
  仅下一轮放开权限: "Next-turn-only unlock",
  进行中: "In Progress",
  "可用项目:": "Available projects:",
  空闲: "Idle",
  列群: "list chats",
  "列群探针未通过，无法核验 intake 群（先解决上方 ✗ 项）":
    "The list-chats probe failed; cannot verify the intake group (fix the ✗ items above first)",
  没有待提交内容: "Nothing to submit",
  没有可重试的上一轮: "No previous turn to retry",
  "没有任何任务源：tracker.kind 为 none 且 feishu 未启用 — 没有可运行的任务面":
    "No task source at all: tracker.kind is none and feishu is disabled — there is no runnable task surface",
  默认: "default",
  "目录: 未配置（任意 agent:<name> 标签直通）":
    "Catalog: not configured (any agent:<name> label passes through)",
  你的飞书邮箱或手机号: "Your Feishu email or phone",
  排队中: "Queued",
  "配置解析失败，跳过": "config parse failed, skipped",
  "评论桥：飞书话题 ↔ Jira 评论双向镜像（/issue、/state、/help）。详见 docs/feishu-quickstart.md":
    "Comment bridge: Feishu threads ↔ Jira comments mirrored both ways (/issue, /state, /help). See docs/feishu-quickstart.md",
  评审中: "In Review",
  凭据错误或应用未发布版本: "Credentials are wrong or the app version is not published",
  请确认: "Please confirm",
  请确认是否放开权限: "Confirm the permission unlock",
  请确认是否结束会话: "Confirm ending the session",
  请选择目标状态: "Pick a target state",
  "请在 /chat 命令后带上首条消息，例如 `/chat tasking 帮我跑下测试`":
    "Please include the first message after /chat, e.g. `/chat tasking run the tests for me`",
  取消: "Cancel",
  全局配置: "global config",
  "缺 im:message.group_msg（读群消息被拒）":
    "missing im:message.group_msg (group message read denied)",
  "缺 im:resource（文件上传被拒）": "missing im:resource (file upload denied)",
  确认结束: "Confirm end",
  "确认写入（默认）": "Write it (default)",
  任务不存在: "Task not found",
  任务来源: "Task source",
  "收集模式已关闭：没有待提交内容。": "Collect mode closed: nothing to submit.",
  完成: "Done",
  "完整输出过大，无法作为消息发送；请在 TUI 活动视图查看该会话的完整明细。":
    "The full output is too large to send as a message; see the session's full detail in the TUI activity view.",
  "网络不可达，无法检测": "network unreachable, cannot probe",
  未采用: "Unmatched",
  未配置: "not set",
  "未配置（tracker.kind 非 jira）": "not configured (tracker.kind is not jira)",
  "未启用（feishu.enabled: false）": "not enabled (feishu.enabled: false)",
  "未探测（发消息会在群里留痕；tasking start 后实发验证）":
    "not probed (sending leaves traces in the group; verified by a real send after tasking start)",
  "未在 PATH 找到 opencode——安装见 https://opencode.ai":
    "opencode not found on PATH — install: https://opencode.ai",
  未找到对应用户: "No matching user found",
  未知: "unknown",
  未知操作: "Unknown action",
  "未知的 /auto 参数": "Unknown /auto argument",
  "未知命令。直连会话支持：直接回复续聊、/collect、/send、/cancel、/auto、/agent、/model、/new、/name、/status、/stop、/done、/help":
    "Unknown command. Direct sessions support: reply to continue, /collect, /send, /cancel, /auto, /agent, /model, /new, /name, /status, /stop, /done, /help",
  "无事可做：tracker.kind 为 none 时评论镜像无 Jira 可用，而 feishu.direct 又被关闭 — 请启用 direct 或配置 Jira 源":
    "Nothing to do: with tracker.kind none the comment mirror has no Jira, and feishu.direct is disabled — enable direct or configure a Jira source",
  无输出超时: "no-output timeout",
  "响应缺少 chat_id": "Response is missing chat_id",
  项目目录绝对路径: "Absolute path of the project directory",
  写入状态配置: "Write state config",
  "新建会话 → 在群里发 `/chat <项目|路径> <消息>`":
    "New session → send `/chat <project|path> <message>` in the group",
  "新建其他会话 → 在群里 /chat <项目|路径> <消息>":
    "Start another session → /chat <project|path> <message> in the group",
  新群名称: "New group name",
  "选择 intake 群": "Select the intake group",
  "选择 Jira workflow 变体": "Pick a Jira workflow variant",
  "选择目标状态：": "Pick a target state:",
  已发送状态卡: "State card sent",
  已放开本会话权限: "Session permissions unlocked",
  "已放开本会话权限（下一轮生效）": "Session permissions unlocked (effective next turn)",
  已过期: "Expired",
  已恢复默认权限姿态: "Default permission posture restored",
  已结束: "Ended",
  已进入收集模式: "Entered collect mode",
  已取消: "Cancelled",
  已设置为仅下一轮放开: "Set to unlock for the next turn only",
  "已收到 ✓（/chat 创建会话，/help 看用法）":
    "Received ✓ (/chat starts a session, /help shows usage)",
  "已收到 ✓（/issue 创建任务，/help 看用法）":
    "Received ✓ (/issue creates a task, /help shows usage)",
  已收回权限放开: "Permission unlock retracted",
  已刷新: "Refreshed",
  已退出收集模式: "Left collect mode",
  "已退出收集模式。": "Left collect mode.",
  已完结: "Completed",
  已在收集模式: "Already in collect mode",
  已中断当前任务: "Interrupted the current task",
  已重试上一轮: "Retried the previous turn",
  "应用版本未发布/未审批，或缺少对应权限":
    "app version not published/approved, or the permission is missing",
  "用法: /chat <项目名> <消息>": "Usage: /chat <project> <message>",
  "用法：/agent <name>｜/agent reset": "Usage: /agent <name> | /agent reset",
  "用法：/auto on｜/auto once｜/auto off｜/auto reset":
    "Usage: /auto on | /auto once | /auto off | /auto reset",
  "用法：/auto（查看）｜/auto on｜/auto once｜/auto off｜/auto reset":
    "Usage: /auto (view) | /auto on | /auto once | /auto off | /auto reset",
  "用法：/model <name>｜/model reset": "Usage: /model <name> | /model reset",
  运行中: "Running",
  整体超时: "overall timeout",
  "正在恢复默认 agent…": "Restoring the default agent…",
  "正在整理完整内容…": "Preparing full content…",
  "正在整理完整输出…": "Preparing full output…",
  "正在转换…": "Transitioning…",
  "直接发图片/文件 → 下载到工作区并把路径交给 agent":
    "Send images/files → downloaded into the workspace and the paths handed to the agent",
  "直接回复本话题 → 继续与 agent 对话（排队串行执行）":
    "Reply in this thread → keep talking to the agent (queued, serial)",
  直连功能未启用: "Direct sessions are not enabled",
  "直连会话用法:": "Direct session usage:",
  "只用飞书直连：群里 /chat 直接跑 opencode，无需 Jira。接 Jira：调度器轮询 Jira issue 派发（三个变体）。":
    "Feishu direct only: /chat in the group runs opencode directly, no Jira. With Jira: the scheduler polls Jira issues and dispatches (three variants).",
  "只用飞书直连（默认）": "Feishu direct only (default)",
  中文: "中文",
  重复: "Duplicate",
  重置处理: "Reset Processing",
  "状态已按项目实际预填（active/terminal/review）":
    "States prefilled from the project's actual states (active/terminal/review)",
  "App ID 不正确或应用不存在": "App ID is incorrect or the app does not exist",
  "App Secret 不正确": "App Secret is incorrect",
  "daemon 重启，上一轮已中断；工具明细未保留，可点「重试」重跑上一轮。":
    'The daemon restarted and the last turn was interrupted; tool details were not kept — tap "Retry" to rerun it.',
  "HTTP 401，凭据或 token 可能不正确": "HTTP 401: credentials or token may be incorrect",
  "ℹ️ 此会话已过期。重新发起请 /chat 创建新会话。":
    "ℹ️ This session has expired. Start a new one with /chat.",
  "ℹ️ 此会话已结束（/done）。重新发起请 /chat 创建新会话。":
    "ℹ️ This session has ended (/done). Start a new one with /chat.",
  "ℹ️ 当前没有运行中的任务。": "ℹ️ No task is currently running.",
  "ℹ️ 会话空闲超时已过期。重新发起请 /chat 创建新会话。":
    "ℹ️ This session expired after being idle too long. Start a new one with /chat.",
  "ℹ️ 已过期": "ℹ️ Expired",
  "intake 群可达": "intake group reachable",
  "intake_chat_id 未配置": "intake_chat_id is not configured",
  "Jira 连接": "Jira connection",
  "Language of the generated WORKFLOW.md comments and guidance. Press enter for 中文.":
    "Language of the generated WORKFLOW.md comments and guidance. Press enter for 中文.",
  "🆕 已开启新会话：上下文已清空（话题、目录与名称不变），旧 opencode 会话已删除。":
    "🆕 New session started: context cleared (thread, directory and name unchanged), the old opencode session was deleted.",
  "tasking 命令:": "tasking commands:",
  "tasking doctor — 全链路只读体检\n\n": "tasking doctor — read-only full-chain health check\n\n",
  "Tip: 已保留 $FEISHU_APP_SECRET 引用——export FEISHU_APP_SECRET=<secret> in ~/.bashrc, or set it in env: section of WORKFLOW.md":
    "Tip: the $FEISHU_APP_SECRET reference is kept — export FEISHU_APP_SECRET=<secret> in ~/.bashrc, or set it in the env: section of WORKFLOW.md",
  "via 飞书": "via Feishu",
  飞书版本: "Feishu edition",
  "国内版（飞书）": "Feishu (China mainland)",
  "国内版（飞书）（默认）": "Feishu (China mainland) (default)",
  "海外版（Lark）": "Lark (overseas)",
  "海外版（Lark）（默认）": "Lark (overseas) (default)",
  "若应用创建于另一版飞书（国内版），请在 WORKFLOW.md 设置 feishu.edition: feishu":
    "The app may belong to the other Feishu edition (China mainland) — set feishu.edition: feishu in WORKFLOW.md",
  "若应用创建于另一版飞书（海外版 Lark），请在 WORKFLOW.md 设置 feishu.edition: lark":
    "The app may belong to the other Feishu edition (overseas Lark) — set feishu.edition: lark in WORKFLOW.md",
  审批通道未就绪: "Approval channel is not ready",
  "审批单标识缺失，无法处理": "Approval id is missing; cannot process",
  已允许: "Allowed",
  已拒绝: "Rejected",
  该审批已处理: "This approval has already been handled",
  审批单不存在或已过期: "The approval no longer exists or has expired",
  "审批提交失败，请重试": "Failed to submit the approval; please retry",
  "opencode auth list 失败": "opencode auth list failed",
  "无已认证 provider（opencode auth login）": "No authenticated provider (run opencode auth login)",
  "opencode 认证探测失败": "opencode auth probe failed",
  "opencode 版本": "opencode version",
  "opencode 服务": "opencode service",
  "opencode 认证": "opencode auth",
  空输出: "empty output",
  "✅ 已允许": "✅ Allowed",
  "♾️ 已始终允许": "♾️ Always allowed",
  "❌ 已拒绝": "❌ Rejected",
  "⏰ 超时已拒绝": "⏰ Timed out and rejected",
  "⛔ 已随任务中断": "⛔ Cancelled with the turn",
  "🕓 已在其他端处理": "🕓 Handled elsewhere",
  已处理: "Handled",
  "✅ 允许一次": "✅ Allow once",
  "♾️ 始终允许": "♾️ Always allow",
  "✖ 拒绝": "✖ Reject",
  权限审批: "Permission approval",
  "后台服务未运行——daemon 启动时会自动拉起":
    "Background service is not running — the daemon will start it automatically",
  "\n始终允许将按模式保存：": "\nAlways-allow will be saved per pattern: ",
  "已放开本会话权限（立即生效）": "Session permissions unlocked (effective now)",
  "未在 PATH 找到 opencode（tasking 0.7 需要 opencode >=2.0 <3）——安装见 https://opencode.ai":
    "opencode not found on PATH (tasking 0.7 needs opencode >=2.0 <3) — see https://opencode.ai",
};

export const PATTERNS: PatternRule[] = [
  {
    re: new RegExp(
      `^${normalizeTemplate("  然后在群里发：/chat <项目名> <消息>（如 /chat ${projectName} 帮我看个报错）")}$`,
    ),
    en: "  Then in the group send: /chat <project> <message> (e.g. /chat $1 help me look at an error)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('\n  tasking 启动失败：同一飞书应用/群已有实例在运行（pid ${held?.pid ?? "?"}，workflow: ${held?.workflow_path ?? "?"}）。\n  飞书事件为集群路由，双实例会互相抢消息、重复建话题。\n  请先 tasking stop 旧实例，或更换 app_id/intake_chat_id。\n\n')}$`,
    ),
    en: "\n  tasking failed to start: another instance is already running for this Feishu app/group (pid $1, workflow: $2).\n  Feishu events are cluster-routed; two instances steal each other's messages and duplicate threads.\n  Stop the old instance with tasking stop, or use a different app_id/intake_chat_id.\n\n",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("ℹ️ 任务 ${terminal.issue_key} 已完结，此话题已停用。如需继续，请在话题里发 /state 恢复到活跃状态，或重新 /issue 创建新任务。")}$`,
    ),
    en: "ℹ️ Task $1 has reached a terminal state; this thread is retired. To continue, send /state in this thread to move it back to an active state, or /issue to create a new task.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("\n⚠️ ${stats.permissionRejections} 个操作被权限拒绝（可在项目 .opencode 配置放行，或对该项目开 auto_approve）")}$`,
    ),
    en: "\n⚠️ $1 operations were denied by permissions (allow them in the project's .opencode config, or enable auto_approve for the project)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("warn")} 无法查询用户：缺 contact:user.id:readonly → 开通: ${consoleLinks(appId).permission} （开通后需重新发布版本）')}$`,
    ),
    en: "$1 Cannot look up the user: missing contact:user.id:readonly → grant at: $2 (republish the version afterwards)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("info")} Feishu bridge disabled; 详见 docs/feishu-quickstart.md')}$`,
    ),
    en: "$1 Feishu bridge disabled; see docs/feishu-quickstart.md",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold("Feishu app_secret")} (直接明文写入 WORKFLOW.md；留空则改用 $FEISHU_APP_SECRET 环境变量)')}$`,
    ),
    en: "$1 (written in plain text into WORKFLOW.md; leave empty to use the $$FEISHU_APP_SECRET env var instead)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('  缺 im:chat（建群）→ 开通: ${consoleLinks(appId).permission} （搜索 "im:chat"，开通后需重新发布版本）')}$`,
    ),
    en: '  Missing im:chat (create group) → grant at: $1 (search "im:chat"; republish afterwards)',
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("任务源变更需重启生效：tracker.kind 启动时为 ${this.startupTrackerKind}，现为 ${built.config.tracker.kind}（运行时装配不随热重载重建）")}$`,
    ),
    en: "Task source change requires a restart: tracker.kind was $1 at startup, now $2 (runtime wiring is not rebuilt on hot reload)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("机器人所在群列表不含 ${feishu.intake_chat_id}——确认机器人已入群（或 intake_chat_id 是否正确）")}$`,
    ),
    en: "The bot's chat list does not include $1 — make sure the bot joined the group (and intake_chat_id is correct)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold("你的飞书邮箱或手机号")}（建群后拉你进群，需 contact:user.id:readonly；回车跳过）')}$`,
    ),
    en: "$1 (you are invited after the group is created; requires contact:user.id:readonly; press Enter to skip)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("✅ 已切 ${label}（下一 turn 生效）\n⚠️ ${name} 不在配置目录中，派发时将回退默认")}$`,
    ),
    en: "✅ Switched to $1 (effective next turn)\n⚠️ $2 is not in the configured catalog; dispatch falls back to the default",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('当前会话名：${session.name ?? translate("（未设置）")}\n用法：/name <文本>（同时用于卡片头部与 TUI 区块）')}$`,
    ),
    en: "Current session name: $1\nUsage: /name <text> (shown on the card header and in the TUI)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("发完点下方按钮提交为一轮（或发 `/send`）；${idleMinutes} 分钟无新消息会自动提交。")}$`,
    ),
    en: "When done, tap the button below to submit as one turn (or send /send); auto-submits after $1 idle minutes.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("已切换 agent 为 ${name}（下一轮生效）。/agent reset 恢复默认。")}$`,
    ),
    en: "Switched agent to $1 (effective next turn). /agent reset restores the default.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("已切换 model 为 ${arg}（下一轮生效）。/model reset 恢复默认。")}$`,
    ),
    en: "Switched model to $1 (effective next turn). /model reset restores the default.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("warn")} 已跳过验证，继续配置（tasking start 前请确认凭据可用）')}$`,
    ),
    en: "$1 Verification skipped, continuing (confirm the credentials work before tasking start)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("⚠️ 附件 ${attachment.name} 超过 20MB，已跳过；可放到工作目录后把路径发给我。")}$`,
    ),
    en: "⚠️ Attachment $1 exceeds 20MB and was skipped; place it in the working directory and send me the path.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("📥 已收集 ${rt.collect.length} 条（/send 提交为一轮，/cancel 丢弃）")}$`,
    ),
    en: "📥 Collected $1 messages (/send submits as one turn, /cancel discards)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("✅ 会话已结束。${statsLine}${who}${discardNote}重新发起请 /chat <项目|路径> <消息>")}$`,
    ),
    en: "✅ Session ended.$1 To start over, send /chat <project|path> <message>",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("🛑 已中断当前任务${who}，并清空 ${queued} 条排队消息。可直接回复重新继续。")}$`,
    ),
    en: "🛑 Interrupted the current task$1 and cleared $2 queued messages. Reply to start again.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('\n⚠️ agent ${name} 不在配置目录 [${config.opencode.agents.join(", ")}] 中，派发时将回退默认')}$`,
    ),
    en: "\n⚠️ Agent $1 is not in the configured catalog [$2]; dispatch falls back to the default",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("warn")} 飞书凭据验证未通过：${tokenResult.reason}（不影响生成配置，start 前请修正）')}$`,
    ),
    en: "$1 Feishu credential check failed: $2 (does not block config generation; fix before start)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("… 还有 ${dropped} 个工具调用未展示（完整明细见 TUI 活动视图）")}$`,
    ),
    en: "… $1 more tool calls not shown (see the TUI activity view for full detail)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${base} → 开发者后台「权限管理」搜索 "${scope}" 开通后重新发布版本')}$`,
    ),
    en: '$1 → Developer console → Permissions: search "$2", grant it, then publish a new version',
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("warn")} 群已建（${created.chat_id}），但只有机器人成员——你在飞书看不到它，未选用')}$`,
    ),
    en: "$1 The group was created ($2) but the bot is its only member — you cannot see it in Feishu; not selected",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("⚠️ ${target} 不在允许的路径范围内（path_roots）。\n${this.renderProjectList(direct)}")}$`,
    ),
    en: "⚠️ $1 is not within the allowed path roots.\n$2",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold("常用项目名")}（/chat <项目名> <消息> 使用；直接回车跳过）')}$`,
    ),
    en: "$1 (used by /chat <project> <message>; press Enter to skip)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${base} → 开通: ${consoleLinks(appId).permission} （搜索 "${scope}"，开通后需重新发布版本）')}$`,
    ),
    en: '$1 → Grant at: $2 (search "$3"; republish the version afterwards)',
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold("Feishu intake_chat_id")} (承载 /chat 与会话话题的群，oc_ 开头)')}$`,
    ),
    en: "$1 (the group hosting /chat and session threads; starts with oc_)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('（本次运行统计：${session.turns} turn${session.turns === 1 ? "" : "s"} · ≈${formatTokens(session.total_tokens)} tokens）')}$`,
    ),
    en: "(run stats: $1 turn · ≈$2 tokens)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("⚠️ 本轮${reason}被中止（${durationSec}s）。可用更小的任务描述重试。")}$`,
    ),
    en: "⚠️ This turn was aborted by $1 ($2s). Try a smaller task description.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('⚠️ 本轮未完成（${result.error ?? result.status}，${durationSec}s）。${stats.lastText ? `\n\n${truncate(stats.lastText)}` : ""}')}$`,
    ),
    en: "⚠️ This turn did not complete ($1, $2s).$3",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("🛑 已清空 ${queued} 条排队消息（当前无运行中任务）。")}$`,
    ),
    en: "🛑 Cleared $1 queued messages (no task running).",
  },
  {
    re: new RegExp(`^${normalizeTemplate("${text}\n\n…（已截断，点「📄 完整输出」收全文文件）")}$`),
    en: '$1\n\n… (truncated; tap "📄 Full output" to receive the full text as a file)',
  },
  {
    re: new RegExp(`^${normalizeTemplate("${base} → 开发者后台「权限管理」开通后重新发布版本")}$`),
    en: "$1 → Developer console → Permissions; grant it, then publish a new version",
  },
  {
    re: new RegExp(`^${normalizeTemplate("未找到（${wfPath}）——先运行 tasking init")}$`),
    en: "not found ($1) — run tasking init first",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("🗑 已退出收集模式，丢弃 ${dropped.length} 条未提交消息。")}$`,
    ),
    en: "🗑 Left collect mode, dropping $1 unsubmitted messages.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold("Feishu app_id")} (${feishuApiBase(edition)} 应用凭证)')}$`,
    ),
    en: "$1 ($2 app credentials)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('  API 域名: ${feishuApiBase(choice.includes("Lark") ? "lark" : "feishu")}')}$`,
    ),
    en: "  API base: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("已恢复配置默认 agent：${config.opencode.agent}（下一轮生效）。")}$`,
    ),
    en: "Restored the configured default agent: $1 (effective next turn).",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('已恢复配置默认 model：${config.opencode.model ?? translate("（未设置）")}（下一轮生效）。')}$`,
    ),
    en: "Restored the configured default model: $1 (effective next turn).",
  },
  {
    re: new RegExp(`^${normalizeTemplate("- ${dropped} 个更早的工具调用明细因体积过大未包含")}$`),
    en: "- $1 earlier tool-call details omitted due to size",
  },
  {
    re: new RegExp(`^${normalizeTemplate("📥 收集中：已收集 **${buffered.length}** 条待提交。")}$`),
    en: "📥 Collecting: **$1** messages waiting to submit.",
  },
  {
    re: new RegExp(`^${normalizeTemplate("🛑 已中断当前任务${who}。可直接回复重新继续。")}$`),
    en: "🛑 Interrupted the current task$1. Reply to start again.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold("新群名称")}（回车默认 tasking-intake）')}$`,
    ),
    en: "$1 (press Enter for the default tasking-intake)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("warn")} 原 ${name} 已备份至 ${backupPath}\n')}$`,
    ),
    en: "$1 Original $2 backed up to $3\n",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("  下一步: 订阅事件 ${links.event} ｜ 发布版本 ${links.version}")}$`,
    ),
    en: "  Next: subscribe to the event $1 | publish the version $2",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("⚠️ 本轮未能启动（${toTaskingError(e).message}）。请重发消息重试。")}$`,
    ),
    en: "⚠️ This turn failed to start ($1). Please resend the message to retry.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("✅ 已清除 agent 标签，回退默认 ${config.opencode.agent}")}$`,
    ),
    en: "✅ Agent label cleared, falling back to default $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("🔒 已恢复默认权限姿态（下一轮生效）。${this.autoSourceLabel(session)}")}$`,
    ),
    en: "🔒 Restored the default permission posture (effective next turn). $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("- turns：${session.turns} · tokens：≈${formatTokens(session.total_tokens)}")}$`,
    ),
    en: "- turns: $1 · tokens: ≈$2",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("⏰ 收集超时，已自动提交 ${buffered.length} 条为一轮。")}$`,
    ),
    en: "⏰ Collect timed out; auto-submitted $1 messages as one turn.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("汇总: ${passed} 通过 / ${failed} 失败 / ${skipped} 跳过")}$`,
    ),
    en: "Summary: $1 passed / $2 failed / $3 skipped",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("可用 issueType: ${list}\n默认: ${config.feishu.create_issue_type}")}$`,
    ),
    en: "Available issueTypes: $1\nDefault: $2",
  },
  {
    re: new RegExp(`^${normalizeTemplate("[附件不可用] ${attachment.name}（当前未接下载能力）")}$`),
    en: "[attachment unavailable] $1 (download not supported here)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("⏳ 已排队，当前任务完成后自动继续。${mergeNote}")}$`),
    en: "⏳ Queued; continues automatically after the current turn. $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate('⚠️ 未知 agent "${name}"。可用：${catalog.join(", ")}')}$`),
    en: '⚠️ Unknown agent "$1". Available: $2',
  },
  {
    re: new RegExp(`^${normalizeTemplate("🚀 已提交 ${buffered.length} 条，合并为一轮执行。")}$`),
    en: "🚀 Submitted $1 messages, merged into one turn.",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold("Feishu intake_chat_id")} (承载所有 issue 线程的群)')}$`,
    ),
    en: "$1 (the group hosting all issue threads)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("群聊命令（intake 群内使用）：${groupOnly}")}$`),
    en: "Group commands (use in the intake group): $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("— 该轮已结束 · ${state.durationSec}s · ≈${formatTokens(state.turnTokens)} —")}$`,
    ),
    en: "— Turn finished · $1s · ≈$2 —",
  },
  {
    re: new RegExp(`^${normalizeTemplate("✅ 已切 ${label}（下一 turn 生效）")}$`),
    en: "✅ Switched to $1 (effective next turn)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold("Feishu app_secret")}（重输重试；直接回车跳过验证继续）')}$`,
    ),
    en: "$1 (re-enter to retry; press Enter to skip verification and continue)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("ok")} 已建群并选用：${groupName}（${created.chat_id}）——你已在群里')}$`,
    ),
    en: "$1 Group created and selected: $2 ($3) — you are in the group",
  },
  {
    re: new RegExp(`^${normalizeTemplate("无此 issueType 编号: ${parsed.typeOverride}")}$`),
    en: "No issueType with this number: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("ok")} 已定位你的账号，建群时拉你进群')}$`,
    ),
    en: "$1 Found your account; you will be invited when the group is created",
  },
  {
    re: new RegExp(`^${normalizeTemplate(" · 🔁 重试自 Turn ${state.retryFromTurn}")}$`),
    en: " · 🔁 retry from turn $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('- 排队：${rt.queue.length}${rt.turnInFlight ? translate(" · 运行中") : ""} · 距上次活动：${idleSec}s')}$`,
    ),
    en: "- Queue: $1 · idle for $2s",
  },
  {
    re: new RegExp(`^${normalizeTemplate("- 收集模式：📥 ${rt.collect.length} 条待提交")}$`),
    en: "- Collect mode: 📥 $1 messages waiting",
  },
  {
    re: new RegExp(`^${normalizeTemplate("✅ 会话已创建（${label}），正在开始…")}$`),
    en: "✅ Session created ($1), starting…",
  },
  {
    re: new RegExp(`^${normalizeTemplate("解析成功（tracker: ${cfg.tracker.kind}）")}$`),
    en: "parsed (tracker: $1)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("HTTP ${status}，无法归因到具体权限")}$`),
    en: "HTTP $1: cannot attribute to a specific permission",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('    review:   ${buckets.review.join(" / ") || (zh ? "（无）" : "(none)")}')}$`,
    ),
    en: "    review:   $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("⚠️ /chat 处理失败：${toTaskingError(e).message}")}$`),
    en: "⚠️ /chat failed: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('⚠️ 未找到项目 "${target}"。\n${this.renderProjectList(direct)}')}$`,
    ),
    en: '⚠️ Project "$1" not found.\n$2',
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("fail")} 路径不存在或不是目录: ${projectDir}')}$`,
    ),
    en: "$1 Path does not exist or is not a directory: $2",
  },
  {
    re: new RegExp(`^${normalizeTemplate("已退出收集模式，丢弃 ${dropped} 条")}$`),
    en: "Left collect mode, dropping $1 messages",
  },
  {
    re: new RegExp(`^${normalizeTemplate("（已丢弃 ${queued} 条排队消息）")}$`),
    en: "(dropped $1 queued messages)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("⚠️ 附件 ${attachment.name} 下载失败：${toTaskingError(e).message}")}$`,
    ),
    en: "⚠️ Attachment $1 failed to download: $2",
  },
  {
    re: new RegExp(`^${normalizeTemplate("服务不可用（HTTP ${res.status}）")}$`),
    en: "Service unavailable (HTTP $1)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("⚠️ 无法解析路径: ${candidate}")}$`),
    en: "⚠️ Cannot resolve path: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('✅ 已转 ${transitionName}${isTerminal ? "（完结）" : ""}（操作人：${who}）')}$`,
    ),
    en: "✅ Transitioned to $1 (by $2)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('未知命令。话题内可用：${threadCommandsFor(this.jiraTracker !== null).join("、")}')}$`,
    ),
    en: "Unknown command. Available in threads: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("  已刷新（${chats.length} 个群）")}$`),
    en: "  Refreshed ($1 chats)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('- session：${session.session_id ?? translate("（未开始）")}')}$`,
    ),
    en: "- session: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('（会话未覆盖时按${source}：${effective ? "放开" : "默认"}）')}$`,
    ),
    en: "(without a session override, follows $1: $2)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("⚠️ 路径不存在: ${candidate}")}$`),
    en: "⚠️ Path does not exist: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("⚠️ 完整输出失败：${toTaskingError(e).message}")}$`),
    en: "⚠️ Full output failed: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("📋 ${issueKey} · ${title} 已开始")}$`),
    en: "📋 $1 · $2 started",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('当前 agent: ${resolved.agent}${resolved.warned ? "（未在目录中，已回退默认）" : ""}')}$`,
    ),
    en: "Current agent: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("默认 agent: ${config.opencode.agent}")}$`),
    en: "Default agent: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("已将会话名改为「${trimmed}」。")}$`),
    en: 'Session renamed to "$1".',
  },
  {
    re: new RegExp(`^${normalizeTemplate("（本轮无文本回复）${statsLine}${rejectionNote}")}$`),
    en: "(no text reply this turn)$1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("⚠️ 不是目录: ${candidate}")}$`),
    en: "⚠️ Not a directory: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("⚠️ 转状态失败：${toTaskingError(e).message}")}$`),
    en: "⚠️ Transition failed: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("✅ 已转 ${chosenTransition.toName}（完结）")}$`),
    en: "✅ Transitioned to $1 (terminal)",
  },
  {
    re: new RegExp(`^${normalizeTemplate('${style.statusIcon("ok")} 飞书凭据验证通过')}$`),
    en: "$1 Feishu credentials verified",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('当前 agent：${session.agent_override ?? config.opencode.agent}${\n          session.agent_override === null ? translate("（配置默认）") : translate("（会话覆盖）")\n        }')}$`,
    ),
    en: "Current agent: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('当前 model：${session.model_override ?? config.opencode.model ?? translate("（未设置）")}${\n          session.model_override === null\n            ? translate("（配置默认）")\n            : translate("（会话覆盖）")\n        }')}$`,
    ),
    en: "Current model: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("已提交 ${buffered.length} 条为一轮")}$`),
    en: "Submitted $1 messages as one turn",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('  已选群：${picked?.name ?? ""}（${picked?.chat_id ?? ""}）')}$`,
    ),
    en: "  Selected group: $1 ($2)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('- agent：${session.agent_override ?? config.opencode.agent}${\n        session.agent_override === null ? "" : translate("（会话覆盖）")\n      }')}$`,
    ),
    en: "- Agent: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('- model：${session.model_override ?? config.opencode.model ?? translate("（未设置）")}${\n        session.agent_override === null ? "" : translate("（会话覆盖）")\n      }')}$`,
    ),
    en: "- Model: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("**失败：** ${detail}")}$`),
    en: "**Failed:** $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("warn")} 查询用户失败：${lookup.detail}')}$`,
    ),
    en: "$1 User lookup failed: $2",
  },
  {
    re: new RegExp(`^${normalizeTemplate('未匹配，可用:\n${lines.join("\n")}')}$`),
    en: "No match. Available:\n$1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('未知命令。可用：${intakeCommandsFor(this.jiraTracker !== null).join("、")}')}$`,
    ),
    en: "Unknown command. Available: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("在 PATH（${ocVersion}）")}$`),
    en: "on PATH ($1)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("- 目录：`${session.path}`")}$`),
    en: "- Directory: `$1`",
  },
  {
    re: new RegExp(`^${normalizeTemplate("- 权限姿态：${posture}")}$`),
    en: "- Permission posture: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("${base} → 检查: ${consoleLinks(appId)[link]}")}$`),
    en: "$1 → Check: $2",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold("项目目录绝对路径")}（${projectName}；回车放弃）')}$`,
    ),
    en: "$1 ($2; press Enter to skip)",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("fail")} 验证未通过：${result.reason}')}$`,
    ),
    en: "$1 Verification failed: $2",
  },
  {
    re: new RegExp(`^${normalizeTemplate("${text.slice(0, max)}\n…（已截断）")}$`),
    en: "$1\n… (truncated)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("当前权限姿态：${current}")}$`),
    en: "Current permission posture: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("连接成功（v${version}）")}$`),
    en: "connected (v$1)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("确认转为「${choice.toName}」？")}$`),
    en: 'Confirm transition to "$1"?',
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("网络不可达（${e instanceof Error ? e.message : String(e)}）")}$`,
    ),
    en: "Network unreachable ($1)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("转状态失败: ${toTaskingError(e).message}")}$`),
    en: "Transition failed: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('    ${zh ? "未采用" : "unmatched"}: ${buckets.unmatched.join(" / ")}')}$`,
    ),
    en: "    Unmatched: $2",
  },
  {
    re: new RegExp(`^${normalizeTemplate(" · 队列 ${state.queued}")}$`),
    en: " · queue $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("（操作人：${operator}）")}$`),
    en: " (by $1)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("✅ 已创建 ${created.key}")}$`),
    en: "✅ Created $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("✅ 已完结 ${b.issue_key}")}$`),
    en: "✅ $1 completed",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.statusIcon("fail")} 建群失败：${created.detail}')}$`,
    ),
    en: "$1 Group creation failed: $2",
  },
  {
    re: new RegExp(`^${normalizeTemplate("查询失败: ${toTaskingError(e).message}")}$`),
    en: "Query failed: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("创建失败: ${toTaskingError(e).message}")}$`),
    en: "Creation failed: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("切换失败: ${toTaskingError(e).message}")}$`),
    en: "Switch failed: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("项目条目「${session.project}」")}$`),
    en: 'Project entry "$1"',
  },
  {
    re: new RegExp(`^${normalizeTemplate("正在切换 ${agent}…")}$`),
    en: "Switching to $1…",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("  ${probeStatusIcon(style, item.status)} ${item.label}（${item.scope}）${tail}")}$`,
    ),
    en: "$1 $2 ($3)$4",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("[附件] ${this.writeInboxFile(session.root_id, m.message_id, index, attachment, resource.data, resource.contentType)}")}$`,
    ),
    en: "[attachment] $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("✅ 已转 ${chosenTransition.toName}")}$`),
    en: "✅ Transitioned to $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("查询失败：${toTaskingError(e).message}")}$`),
    en: "Query failed: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("解析失败：${msg}")}$`),
    en: "parse failed: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('负责人：${assignee === null || assignee === "" ? "（未分配）" : assignee}')}$`,
    ),
    en: "Assignee: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate('目录: ${config.opencode.agents.join(", ")}')}$`),
    en: "Catalog: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("缺 ${scope}（${what}）")}$`),
    en: "Missing $1 ($2)",
  },
  {
    re: new RegExp(`^${normalizeTemplate("当前：${label}")}$`),
    en: "Current: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate('可用：${catalog.join(", ")}')}$`),
    en: "Available: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("可用：${list}")}$`),
    en: "Available: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("默认：${config.feishu.create_issue_type}")}$`),
    en: "Default: $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("目录 ${basename(dir)}")}$`),
    en: "Directory $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate("项目 ${parsed.target}")}$`),
    en: "Project $1",
  },
  {
    re: new RegExp(`^${normalizeTemplate('状态：${state === "" ? "（未知）" : state}')}$`),
    en: "State: $1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${ICONS[item.status]} ${translate(item.name)}${translate("：")}${translate(item.detail)}\n')}$`,
    ),
    en: "$1 $2\n",
  },
  {
    re: new RegExp(`^${normalizeTemplate('${style.bold("任务来源")}')}$`),
    en: "$1",
  },
  {
    re: new RegExp(`^${normalizeTemplate('${style.bold("选择 intake 群")}')}$`),
    en: "$1",
  },
  {
    re: new RegExp(`^${normalizeTemplate('${style.bold("选择 Jira workflow 变体")}')}$`),
    en: "$1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('${style.bold(zh ? "写入状态配置" : "Write state config")}')}$`,
    ),
    en: "$1",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('服务已注册但不可达（${service.url ?? ""}）——尝试 opencode service restart')}$`,
    ),
    en: "Service is registered but unreachable ($1) — try opencode service restart",
  },
  {
    re: new RegExp(`^${normalizeTemplate("${auth.detail}——模型调用将失败")}$`),
    en: "$1 — model calls will fail",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('无法识别 opencode 版本（${raw || "空输出"}），tasking 0.7 需要 opencode >=2.0 <3')}$`,
    ),
    en: "Unrecognized opencode version ($1); tasking 0.7 needs opencode >=2.0 <3",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("opencode 版本不支持：检测到 ${normalized}，tasking 0.7 需要 opencode >=2.0 <3，请运行 opencode upgrade --major 升级")}$`,
    ),
    en: "Unsupported opencode version: found $1; tasking 0.7 needs opencode >=2.0 <3 — run opencode upgrade --major",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("opencode ${normalized} 未经验证（已验证：2.${VALIDATED_MINOR}.x），如遇异常请反馈")}$`,
    ),
    en: "opencode $1 is not yet validated (validated: 2.$2.x); report any anomalies",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate("🔐 **等待审批** · ${req.action}\n${resources}${saveNote}")}$`,
    ),
    en: "🔐 **Waiting for approval** · $1\n$2",
  },
  {
    re: new RegExp(
      `^${normalizeTemplate('🔐 等待审批：${request.action} ${request.resources.join("、")}（当前客户端不支持卡片，30 分钟未处理将自动拒绝）')}$`,
    ),
    en: "🔐 Waiting for approval: $1 $2 (this client does not support cards; auto-reject in 30 minutes)",
  },
];
