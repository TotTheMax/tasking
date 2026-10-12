# Design: Interface Language（出口翻译 + 覆盖率测试）

## Context

tasking 自产文案约 400 处中文，散布在 13 个文件（direct/manager 177、cli/init 75、bridge/comment-bridge 74、direct/card 31、cli/doctor 24、bridge/commands 22、feishu/probe 16、feishu/source 8、cli/index 6、其余零星）。日志经查证已全英文（`logger.*`/`console.*` 中文 0 处）。英文需求的读者是飞书群成员与操作者；约束为"中文源码零改动、现有 zh 测试零翻新、只中英两种"。

方案选型（详见 ADR 0031）：否决 catalog 全量 i18n（300+ 处换 key + 测试翻新）与 `L()` 内联包裹（300+ 处 diff），采用**出口翻译 + CI 覆盖率测试**——中文源码零改动由出口层保证，漏翻由覆盖率测试从"运行时运气"变成"CI 硬门禁"。

## Goals / Non-Goals

**Goals:**
- `interface_language: zh|en`（默认 zh）切换 tasking 自产文案语言，热重载即时生效
- 存量中文调用点零改动、现有 zh 测试零翻新
- 新增中文文案不配字典时 CI 红（覆盖率测试）
- sentinel 切换 `via Feishu` 后旧任务零影响

**Non-Goals:**
- 第三种语言（机制不支持，明示接受）
- 用户内容 / agent 输出翻译（邮差不改写人话）
- `/lang` 运行时切换命令、`start --lang` flag（已否决：低频操作，配置文件单一真相源）
- 日志翻译（已全英文）

## Decisions

### D1. 双层字典 + 变量透传，零依赖

`src/translate/` 内两个表 + 一个函数，不引第三方库（runner 离线 bundle 约束）：

```ts
translate(text): string
// zh 或未命中 → 原样返回
// 1) EXACT: Record<string, string> 精确匹配（静态串：ack、help 整块、按钮 label、toast）
// 2) PATTERNS: Array<{ re: RegExp, en: string }> 顺序匹配（带变量串的中文框架）
//    例：/\*\*失败：\*\* (.*)/ → "**Failed:** $1" —— 变量原样透传
```

变量透传语义上正确：插值内容是 issue key、路径、数字、opencode/Jira 的英文错误——本就不该翻。**不考虑**嵌套翻译（透传内容不再进字典）。

备选否决：ICU/MessageFormat（无复数需求，引依赖不值）；正则翻译自由文本（脆）。

### D2. 出口挂载点（全部 5 类）

| 出口 | 位置 | 说明 |
|---|---|---|
| 飞书文本 | `adapters/feishu/source.ts` send/reply | 行式文本，安全 |
| 飞书 toast | toast 产生处（comment-bridge / event-channel） | 静态串为主 |
| 飞书卡片 | 卡片发送前 JSON 遍历 | 递归翻译**字符串叶子**；`value`/`tag`/`url` 等协议字段跳过——button value 永不翻（回路测试依赖 value 稳定）；卡片内 agent 文本/工具输出不在字典，自动透传 |
| CLI | doctor/init/start 的 stdout 写入边界 | 行式输出 |
| TUI | 格子文本边界（terminal-dashboard） | **必须在宽度计算之前**翻译，否则 en 替换后列宽错位；TUI 从 `/api/v1/config` 取 effective `interface_language`（config view 已有同管道） |

Jira 无翻译出口：tasking 在 Jira 的唯一自发内容是 sentinel 前缀，由 D3 处理。

### D3. Sentinel 恒 `via Feishu`，回读双匹配

- 写入侧：`SENTINEL = "via Feishu"`（单形态，与语言无关）；`buildBridgedCommentBody` 的 sender 缺名兜底 `"用户"` → `"user"`（嵌在英文前缀行里的数据兜底，两语言共用）
- 回读侧：`SENTINEL_PREFIX = ^💬 [^\n]* (?:via 飞书|via Feishu):\n`——一行 alternation 的免费保险，旧话题不重复转发；`飞书` 由此成为覆盖率白名单的唯一初始条目（协议串，永不翻）

### D4. 覆盖率测试 = 维护契约

`tests/translate-coverage.test.ts`：

1. 读 `src/**/*.ts`（排除 `*.test.ts`），正则提取**字符串/模板字面量**中含汉字的条目（注释不扫）
2. 模板字面量归一：`${expr}` → `(.*)`（相邻通配合并）——归一函数与 D1 的模式字典**共用同一实现**（放 `src/translate/`，测试 import，杜绝两套规则漂移）
3. 断言每条归一结果：能被 EXACT 命中，或作为 regex 与 PATTERNS 某条等价/被覆盖，或在白名单（每条带理由注释）

白名单初始：`SENTINEL_PREFIX` 的 `飞书`。由此契约：**新增中文文案不配字典 → CI 红**。

### D5. 配置管道

- `config-types.ts`：`EffectiveConfig.interface_language: "zh" | "en"`，`DEFAULTS.interface_language = "zh"`（缺失字段行为与今天完全一致）
- `validator.ts`：非 `zh|en` 报配置错误（该错误文案本身走 CLI 出口翻译）
- 热重载：translate 模块持有 `() => Locale`（由 config manager 在 load/reload 时更新），出口每次调用现取——下一条外发即新语言，无运行时装配、无需重启（区别于 tracker.kind）
- CLI 子命令（doctor 等）：进程启动时读一次配置即用

### D6. init 种子与 --update

- `--lang en` / 交互问答选 English → front matter 写 `interface_language: en`
- `--lang zh` / 选中文 → 省略（默认值，遵循 generated-config-trimming 的"只写非默认字段"）
- `init --update`：`interface_language` 作为"新字段（默认 zh）"进入 drift 报告，不写入
- `help.ts` 的 `--lang` 描述更新：注明同时种子 `interface_language`

### D7. 运行时兜底（第二张网）

`interface_language=en` 时出口翻译后仍含汉字（`/[\u4e00-\u9fff]/`）且非用户内容路径 → `logger.warn` 并附原文，当漏翻清单用。防线顺序：CI 覆盖率（主）→ 运行时 warn（辅）。

### D8. 回访路径（卡片交互规约要求）

本变更不新增按钮/交互面，卡片 button value 不变。界面语言开关的回访路径为**常驻**：WORKFLOW.md 字段 + config view（TUI `c`）始终可见 effective 值。

## Risks / Trade-offs

- [字典与源码中文漂移（有人改了中文文案，模式失配）] → 覆盖率测试 CI 红；运行时 warn 兜底
- [用户/agent 内容与字典条目整行精确碰撞（如用户恰好发送整行「（无）」被镜像时误翻）] → 接受的架构取舍：翻译只作用于已知 tasking 文案的整行匹配，自由正文概率极低；运行时 warn 可暴露此类残留（ADR 0031 记录）
- [TUI 宽度计算前翻译被漏接（新格子直写中文）] → 覆盖率测试扫描全 src，新中文必红
- [卡片 JSON 遍历误伤协议字段] → 遍历白名单式跳过（value/tag/url 等按字段名），round-trip en 用例守护
- [en 英文文案质量] → 字典条目由实现 agent 起草、MR 人工复核；help 英文版按英文习惯重排版（非逐字翻译）
- [第三语言将来要支持] → 机制需重做（明示接受，ADR 0031 记录）
- [sentinel 切换的窗口期（旧进程写旧前缀）] → 回读双匹配使新旧前缀均可识别，无窗口风险

## Migration Plan

无数据迁移。部署顺序：合入即生效（默认 zh 行为不变）；想切英文的用户改 WORKFLOW.md 加 `interface_language: en`。回滚：删除 `src/translate/` 接线或改回 zh 即可，中文源码从未被改动。

## Open Questions

无——所有决策已在拷问阶段收敛（方案 D、范围、sentinel 双匹配、术语、配置语义、严格覆盖、测试集、切片顺序、final-only 冒烟）。
