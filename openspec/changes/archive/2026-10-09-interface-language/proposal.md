# Interface Language（界面语言：zh/en 双语支持）

## Why

tasking 自产的全部界面文案（飞书回复/toast/卡片、CLI 输出、TUI）目前硬编码中文，英文使用者无法阅读；团队内两类读者并存（飞书群成员 + 操作者），需要一条开关将其切换为英文。约束：中文源码零改动、现有 zh 测试零翻新、只支持中英两种语言。

## What Changes

- 新增顶层配置字段 `interface_language: zh | en`（默认 `zh`），WORKFLOW.md front matter 中声明，热重载即时生效；`tasking start` 不加 flag，配置文件是唯一真相源。
- 新增**出口翻译层**：tasking 自产文案在离开系统的出口（飞书 send/reply、toast、卡片渲染、CLI stdout、TUI 宽度计算前）经 `translate()` 查双层字典——静态串精确匹配、带变量串中文框架正则 + 变量透传；`zh` 或未命中时原样放行。中文调用点一行不改。
- 新增 **CI 覆盖率测试**：扫描 `src/` 全部字符串/模板字面量中的汉字（`${...}` 归一为通配），每条必须被字典命中或在显式白名单（初始仅 `SENTINEL_PREFIX` 兼容正则）。新增中文文案不配字典 → CI 红。
- **Sentinel 恒为 `via Feishu`**（与语言无关）：写入侧单形态；回读侧 `hasSentinel` 双匹配 `via 飞书|via Feishu`，旧任务零影响。sender 缺名兜底 `"用户"` 改为 `"user"`。
- `init --lang`（flag 与交互问答）同时种子 `interface_language`：选 `en` 时写入字段，选 `zh` 时省略（默认值，遵循 generated-config-trimming）；`init --update` 按"新字段+默认值"报告 drift。
- 用户内容与 agent 输出**永不翻译**（桥接镜像正文、`/chat` 提示词、卡片内 agent 文本）；日志现状已全英文（查证 0 处中文），零工作。
- 新术语 **Interface language（界面语言）** 已入 CONTEXT.md（区别于 Template language 与文档站 Default locale）。

## Capabilities

### New Capabilities
- `interface-language`: 界面语言机制——`interface_language` 配置解析与校验、出口翻译层（双层字典 + 变量透传）、字典覆盖率 CI 门禁、en 冒烟测试集、运行时汉字残留 warn 兜底。

### Modified Capabilities
- `workflow-config`: 新增 `interface_language` 字段要求（取值 `zh|en`、默认 `zh`、非法值拒绝、热重载后下一条外发即用新语言）。
- `comment-bridge`: Sentinel 要求变更——写入侧恒为 `via Feishu`（原 `via 飞书`），回读侧兼容双前缀，防止 Jira→Feishu 重复转发旧评论。
- `interactive-init`: Template language 问答与 `--lang` 的效果扩展——除选择模板文件外，同时种子 `interface_language`（en 写入、zh 省略）。

## Impact

- **代码**：新增 `src/translate/`（translate、双层字典、归一函数）；出口接线触及 `src/adapters/feishu/source.ts`（send/reply）、`src/bridge/comment-bridge.ts`（toast/卡片）、`src/direct/card.ts`（卡片渲染入口，button value 跳过）、`src/cli/doctor.ts`/`init.ts`/`index.ts`（stdout）、`src/observability/terminal-dashboard.ts`（宽度计算前）、`src/config/`（字段）、`src/cli/init.ts`（种子）。
- **测试**：新增覆盖率测试 + en 冒烟（help 渲染、卡片 en、doctor 无汉字、round-trip en、sentinel 双匹配）；现有 zh 测试全不动；按 AGENTS.md，触及 bridge → `npm run test:e2e` 必跑，内网可达时 `npm run test:integration`。
- **文档**：`docs/{zh,en}/configuration.md`（新字段）、`docs/{zh,en}/usage.md`（切换说明）、`help.ts` `--lang` 描述、ADR 0031（出口翻译 + 覆盖率测试的取舍）、CONTEXT.md（已更新）。
- **协议影响**：sentinel 形态变化对旧 bindings.db / 已发 Jira 评论兼容（双匹配），无迁移工作。
- **非目标**：第三种语言、用户/agent 内容翻译、`/lang` 运行时切换命令、`start --lang` flag、日志翻译。
