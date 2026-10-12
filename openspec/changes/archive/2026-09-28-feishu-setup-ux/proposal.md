# feishu-setup-ux

## Why

飞书侧的一次性配置（建应用、开 scope、订阅事件、发布、建群）全部在开发者后台手工完成，用户只能对照文档逐步核对，出错时面对裸错误码（403 / 230027 / 99991672）自行排查。tasking 已有自己的飞书 REST 客户端，完全可以把"能自动检测的检测掉、不能检测的给出精确补救路径"，把配置体验从"人去猜"变成"程序告诉你缺什么、点哪里补"。

## What Changes

- **scope 体检（probe）**：`tasking init` 的飞书凭据验证后运行 3 个只读探针（列群 / 读群消息 / 上传探针文件），逐项输出权限状态；缺失项给出"控制台搜什么词"的精确指引。直连与接 Jira 两条 init 路径共用。缺权限只警告不阻断。
- **控制台深链（deep link）**：体检输出与运行时诊断嵌入带 app_id 的开发者后台直达链接（权限页 / 事件页 / 版本页），兜底根链 `open.feishu.cn/app/{app_id}`；具体路径真机核对，不实即退根链。
- **一键建 intake 群**：群选择器顶部加「➕ 新建 intake 群」，默认名 `tasking-intake`，`POST /im/v1/chats` 建群即选群；`im:chat` 列为第 5 个增强权限，缺失时报错 + 深链并降级回手选；非交互模式跳过建群。
- **运行时 403 诊断**：飞书 API 调用失败时将 403 映射为人话提示（版本未发布/未审批或缺权限）+ 深链；同一错误种类在 daemon 一次运行内只完整提示一次，后续单行降噪。
- **`tasking doctor` 子命令**：全链路只读体检——WORKFLOW.md 解析、飞书 token+3 探针+intake 可达、Jira 连接（复用 init 的 `testJiraConnection`）、opencode PATH 检查；中文输出，退出码 0/1，末尾汇总表。

不改变浏览器侧的平台必经步骤（建应用/开权限/订阅事件/发布仍需手工——飞书未开放对应 API）。

## Capabilities

### New Capabilities

- `feishu-setup-doctor`: 飞书配置体检与运行时诊断——scope 探针、错误码→缺失配置映射、深链、`tasking doctor` 全链路体检。

### Modified Capabilities

- `interactive-init`: init 的飞书采集流程新增体检输出与「新建 intake 群」选项（含降级与非交互跳过）。
- `cli-runtime`: 新增 `tasking doctor` 子命令（CLI 面、退出码约定）。

## Impact

- **代码**：`src/adapters/feishu/`（新 probe 模块 + `source.ts` 403 诊断）、`src/cli/init.ts`（两条采集路径）、`src/cli/index.ts` + `help.ts`（doctor）。
- **文档**：`docs/{zh,en}/feishu-app-setup.md`（`im:chat` 增强行、体检/doctor 说明）、`docs/{zh,en}/usage.md`（doctor 命令）、`README.md` 双语命令清单。
- **测试**：`tests/feishu-source.test.ts`、`tests/init.test.ts`、`tests/cli.test.ts`、`tests/cli-commands.test.ts`；Feishu adapter 变更需跑 `npm run test:integration`（内网可达时）；建群真机 final-only 冒烟。
- **不动**：scheduler、worker、workspace、bridge 核心逻辑。
