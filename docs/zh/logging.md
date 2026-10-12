# 日志约定

## 必填上下文字段

任务相关日志 MUST 含 `task_id` 与 `task_identifier`。会话生命周期日志 MUST 含 `session_id`。

## 消息格式

- 结构化 JSON 行,每行一条日志
- 字段:`ts`(ISO 8601)、`level`、`msg`、以及上下文字段
- 消息文本使用确定性措辞,便于 grep 和告警
- 含动作结果(`completed`、`failed`、`retrying` 等)
- 含简明失败原因
- 除非必要,避免大体量原始负载

## 每模块日志范围

| 模块 | 日志事件 |
|---|---|
| Scheduler | dispatch、retry、reconcile、terminal 转换、worker 退出 |
| Runner | turn 开始/完成、prompt 渲染失败、hook 执行、session 创建/删除 |
| Workspace | 创建、复用、hook 执行、删除 |
| HttpDashboard | 启动、绑定地址 |
| TerminalDashboard | 渲染失败 |

## 新日志检查清单

- [ ] 是否含 `task_id` + `task_identifier`(若任务相关)?
- [ ] 是否含 `session_id`(若会话相关)?
- [ ] 措辞是否确定性(同条件同输出)?
- [ ] 是否含结果和原因?
- [ ] 是否避免大体量负载?
