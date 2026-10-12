# tasks.md — feishu-setup-ux

按依赖排序：探针模块先行（1），init 消费它（2、3），运行时诊断独立（4），doctor 聚合（5），文档收口（6）。每个可测任务按"先写失败测试 → 再实现"的红绿循环执行。

## 1. 探针模块 `src/adapters/feishu/probe.ts`

- [x] 1.1 探针结果模型与深链（写失败测试先：`probeFeishuSetup` 返回逐项 `{ scope, status: ok|missing|unknown, hint }`；`consoleLinks("cli_xxx")` 各 URL 含 app_id 且根链为 `https://open.feishu.cn/app/cli_xxx`；发消息项恒为"未探测"标注；然后实现模块与常量）
- [x] 1.2 列群探针（写失败测试先：mock HTTP 成功 → `im:chat:readonly` 项 `ok`；403 → `missing` 且 hint 含"版本未发布"与深链；网络异常 → `unknown`；然后实现，复用 `FeishuSource` 列群方法）
- [x] 1.3 读群消息探针（写失败测试先：`GET /im/v1/messages` 成功 → `im:message.group_msg`+`im:message:readonly` 项 `ok`；错误码 230027 → `missing` 且 hint 含 `im:message.group_msg` 与权限页深链；然后实现，探针需传入 chat_id）
- [x] 1.4 上传探针文件（写失败测试先：`POST /im/v1/files` 成功 → `im:resource` 项 `ok`；99991672/Access denied → `missing` 且 hint 含 `im:resource`；然后实现 10 字节 `tasking-probe.txt` 上传，复用 `FeishuSource.uploadFile` 错误路径）

## 2. init 体检输出（两路径共用）

- [x] 2.1 直连路径体检（写失败测试先：mock 探针含一项 missing → 交互输出含 ✗ 行、搜索词与深链，且 init 正常完成不阻断；全 ok → 各 ✓；然后接入 `collectFeishuDirectConfig`：凭据验证通过后跑探针，列群探针结果兼作选择器数据源）
- [x] 2.2 接 Jira 路径体检（写失败测试先：桥启用时启用飞书采集后输出同一体检块；然后接入 `collectFeishuConfig`）
- [x] 2.3 体检时机与选群顺序（写失败测试先：读群消息探针在选定 intake 群之后执行且以其 chat_id 为参数；然后调整流程顺序并断言调用参数）

## 3. 群选择器「新建 intake 群」

- [x] 3.1 选项与建群流程（写失败测试先：选择器列表首项为「➕ 新建 intake 群」，选中并回车默认名 → 调 `POST /im/v1/chats`（名为 `tasking-intake`）→ 生成的 WORKFLOW.md `intake_chat_id` 为返回 chat_id；然后实现交互与建群方法）
- [x] 3.2 缺权限降级（写失败测试先：建群 API 返回权限错误 → 输出含 `im:chat` 缺失说明与权限页深链，重新回到选择器可手选已有群；然后实现降级路径）
- [x] 3.3 非交互跳过（写失败测试先：`--non-interactive` 全程零建群请求；然后确认非交互路径不暴露该选项）
- [x] 3.4 建群拉人进群（写失败测试先：填邮箱 → batch_get_id 查 open_id → 建群请求 user_id_list 含该 id → 选用并提示"你已在群里"；跳过/查询失败 → 明确警告"只有机器人成员"且不选用，提示手动建群+⟳刷新；选择器加 ⟳刷新群列表 选项；真机发现 bot-only 群人不可见后补）

## 4. 运行时 403 诊断与降噪

- [x] 4.1 错误映射（写失败测试先：`FeishuSource` 发送/上传等方法收到 403 → TaskingError 附人话 hint 与版本页深链；230027 → `im:message.group_msg` hint；99991672 → `im:resource` hint；然后在错误路径集中接入映射，复用 probe 模块的深链常量）
- [x] 4.2 同签名降噪（写失败测试先：同一方法第二次同状态码失败 → 日志单行、不重复 hint/深链；不同方法或不同状态码 → 仍完整提示；然后实现进程内 `Set<string>` 签名去重）

## 5. `tasking doctor` 子命令

- [x] 5.1 命令注册与骨架（写失败测试先：`tasking doctor` 出现在 help 与子命令帮助；未知参数报错；然后接入 `src/cli/index.ts` + `help.ts`）
- [x] 5.2 检查序列与汇总（写失败测试先：WORKFLOW 解析失败 → 该项 ✗ 且飞书/Jira 项标 −、退出码 1；全部正常 → 全 ✓、退出码 0；缺 opencode PATH → ✗ 附安装指引；然后实现：WORKFLOW → 飞书（token+探针+intake 可达，复用 1.x）→ Jira（复用 `testJiraConnection`）→ opencode，中文输出 + 末尾汇总表）
- [x] 5.3 CLI 面测试保绿（跑 `tests/cli.test.ts` 与 `tests/cli-commands.test.ts`，补 doctor 用例后的回归确认）

## 6. 文档同步与门禁

- [x] 6.1 文档（`docs/{zh,en}/feishu-app-setup.md`：`im:chat` 增强行、体检/doctor 交叉引用；`docs/{zh,en}/usage.md` 与 README 双语：doctor 命令；`tests/docs-links.test.ts` 保绿）
- [x] 6.2 门禁：lint / typecheck / `npm test` / `npm run test:e2e` 全绿
- [x] 6.3 `npm run test:integration`（内网可达时必须跑；不可达在 MR 注明原因）
- [x] 6.4 真机 final-only 冒烟：真凭据 init 一条路到建群 → 核对三个深链路径可达（不实即退根链并改常量）→ 核对建群后机器人自动入群（若否，补添加成员步骤或降级文案）→ `tasking doctor` 全链路输出与退出码
