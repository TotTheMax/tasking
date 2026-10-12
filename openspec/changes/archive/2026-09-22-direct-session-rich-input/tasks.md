## 1. Attachment parsing (adapter)

- [x] 1.1 先写失败测试断言 post 内联图片 / 独立 image / 独立 file 都解析出 `attachments`（REST 与事件两条路径同逻辑），文本行为不变；再实现共享解析
- [x] 1.2 先写失败测试断言 `downloadMessageResource` 的请求形状与返回（字节 + Content-Type），失败抛 `TaskingError`；再实现

## 2. Attachment delivery (manager)

- [x] 2.1 先写失败测试断言：带附件的话题消息 → 下载 → 写入 inbox → prompt 含绝对路径；仅附件也能起一轮；目标仓库无新文件；再实现
- [x] 2.2 先写失败测试断言：超限/下载失败时话题内可见，且仍有文字时该轮照常执行；再实现体积上限与失败降级
- [x] 2.3 先写失败测试断言 `/done`、`/new`、TTL 过期会删除该会话 inbox 目录；再实现清理

## 3. Quote / forward (adapter + manager)

- [x] 3.1 payload 实测：**引用部分砍掉**（2026-09-22 实测：话题内无引用回复交互，用户确认不做）；转发部分待用户提供真实样本后钉死结构
- [x] 3.2 **无需实现**（2026-09-22 用户实测确认）：`merge_forward` 消息既有解析已可处理；"转发+留言拆成两条消息（两轮）"的场景由 `/collect` 覆盖，不做额外处理

## 3b. Collect mode (B)

- [x] 3b.1 先写失败测试断言 `/collect` 缓冲（含附件下载与路径进缓冲、不立即开跑、回执条数）、`/send` 合并为一轮、`/cancel` 丢弃、空闲超时自动提交、其它命令不影响缓冲、`/done`/`/new`/过期清空缓冲；再实现
- [x] 3b.2 更新 `/help`、未知命令提示、`/status`（收集条数）与 `docs/{zh,en}/usage.md`

## 4. Docs & gates

- [x] 4.1 更新 `docs/{zh,en}/usage.md`（附件与引用/转发的支持范围、inbox 位置与体积上限、模型视觉的限制）与 `docs/{zh,en}/configuration.md`（如有新键）
- [x] 4.2 跑门禁：`npm run lint`、`npm run typecheck`、`npm test`、`npm run test:e2e`；真机验收（发图、发文件、文字+截图、转发；引用已裁撤）——2026-09-22 用户实测确认（附件/收集/转发），门禁与 `test:integration` 均通过

## 3c. Command info cards

- [x] 3c.1 先写失败测试断言 `/help` 与 `/auto` 查看返回卡片（卡片不可用时回落纯文本）；再实现 `buildInfoCard` + `replyInfoCard`
- [x] 3c.2 先写失败测试断言 `/auto` 与 `/collect` 卡片按钮（`auto_on`/`auto_once`/`auto_off`、`collect_start`/`collect_send`/`collect_cancel`）执行对应动作并就地刷新；再实现按钮动作分发
- [x] 3c.3 修掉"仅附件且全部下载失败会以空 prompt 开跑"：改为话题内说明且不开跑（含测试）
