# Jira 源开关（tracker.kind: none）而不抽入口

直连专用部署（只配飞书、无 Jira）需要 tracker 可缺席。三个方案中选了"桥内开关"（C）而非"抽 FeishuIngress"（D）：`tracker.kind: none` 使启动校验按源分流；`CommentBridge.deps.tracker` 可空，桥内全部 Jira 暴露面（镜像循环、`/issue`、`/state`、状态卡按钮）收敛到唯一谓词——**tracker 在场性**（装配期决定，桥不读 `tracker.kind`，运行中热翻转 kind 双向均优雅降级而非崩溃，变更时 WARN 需重启生效）；scheduler 与 JiraTracker 缺席时不构造（独立 ActivityStore + 空运行时快照），不用 NullTracker——缺席即缺席。

被否：① D（抽 FeishuIngress，终局形状但触碰生产在跑的 Jira+Feishu 路径）——记为被许可的后续，届时"可缺席 Jira 参与者"即现成的搬迁边界；② B（各调用点逐处判空）——if 级联 +N 且行为发散；③ A（占位假值 + 空实现）——配置撒谎、`/issue` 静默假成功。

Consequences：镜像可用 ⟺ tracker 存在（不设 `feishu.mirror.enabled` 键）；`/help` 按能力裁剪；`/agent` 不设门（intake 列表与直连版均无 tracker 依赖）；卡片 Jira 动作集含 `full`（需从 Jira 取评论全文，非纯飞书投递）；卡片按钮入口做能力短路（平台入口纪律：外部输入显式降级，不抛异常）；`feishu-direct` 成为第 4 个 init 变体（唯一以配置而非 prompt body 区分的变体）。
