# Jara comment 去重用可见 sentinel，不用作者/隐藏标记（共享凭证强制）

Feishu→Jara 桥过去的 comment 带可见前缀 `💬 {sender} via 飞书 [msg:{message_id}]:`，该字符串**同时**当归属（给读者看谁说的、来自飞书）和 sentinel（Jara→飞书 转发器按 `via 飞书 [msg:` 跳过、不回投，防环）。Feishu→Jara 侧另用"跳过 bot 作者 + `/` 命令前缀"免回投。两边机制不对称各有事实根据。

理由（被事实强制）：`buildMcpConfig` 把 `tracker.api_key`/`api_user` 原样注入 agent 的 MCP——tasking 与 agent **共用同一个 Jira 账号**，所以 Jara 侧 comment 作者相同，**无法靠作者区分** agent 评论和 tasking 桥过去的评论。因此 Jara→飞书方向**必须**用内容标记跳过自己桥过去的，没有"按作者跳过"这条路。飞书侧相反——bot 与人是不同身份，可按作者跳过。可见 sentinel 一字符串兼两职，比 Jara `properties` 隐藏 marker 少一套读写机制。

被否：① 给 tasking 配第二个 Jira 服务账号恢复作者去重（多配用户+token+配置字段，运维不值，除非已有第二账号）；② Jara `properties` 藏隐藏 marker（更干净但多机制）。代价：Jara comment 多一行归属前缀（对 agent 轻微噪声但也是有用的归属）；sentinel 碰撞由带 `message_id` 的独特形态降到几乎为零。
