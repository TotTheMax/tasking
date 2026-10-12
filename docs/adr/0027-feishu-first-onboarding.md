# 0027 — feishu-first onboarding: feishu-direct 为默认变体, default 改名 minimal

tasking 面向首批真实用户交付前,把 init 的默认门面从 Jira 最小变体翻转为 feishu-direct:目标用户活在飞书里,最短路径应是"一路回车 + 三个飞书配置 + `/chat` 一句话"。同时把 `default` 变体改名 `minimal`——默认翻转后,一个叫 "default" 却不是默认的变体会永久误导;趁无存量用户时零成本改名。feishu-direct 模板的 prompt body 从"完整 minimal Jira 正文(供切回 jira)"缩为哨兵 + 两行用户说明:直连会话以用户消息为 prompt,body 从不执行,切 Jira 的通道改为重跑 init。

被否决的选项:保留变体四选一只把 feishu-direct 排第一(变体黑话对非 Jira 用户是噪音,首问改为"任务来源"二选一);保留完整 body 供将来切回 jira(正是"没用还躺在文件里"的噪音来源);body 整个删除(变体/语言哨兵必须住在 body,`detectWorkflow`/`--update` 漂移机器依赖它);保留 `default` 别名兼容(无存量用户,别名只会延长误解)。

决策背景与逐项取舍见 openspec/changes/feishu-first-onboarding/(proposal/design)。
