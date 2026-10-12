## Context

`tasking init` 现以 `--workflow <name>` 从三个中文模板（`WORKFLOW.md.example` / `WORKFLOW.code-mr.md.example` / `WORKFLOW.grill-openspec.md.example`）选择入门配置：非交互模式静默复制，交互模式弹 workflow 选择框；`init --update` 用 prompt body 哨兵（`detectWorkflow`）识别 variant 后对同款模板做漂移报告。TAS-19 要求新增纯英文版本：中文模板内容逐字节保留，语言成为与 variant 正交的新维度。产品已确认 grill 推荐方案（Jira 评论「都按推荐的来」），决策记录见 `docs/adr/0013-template-language-axis.md`。

## Goals / Non-Goals

**Goals:**
- 英文用户可一键获得全英文注释/说明的 starter 模板（3 变体全覆盖）。
- `--lang <zh|en>` 显式指定；未指定时默认 zh，交互模式有引导问答。
- `init --update` 漂移报告对同语言模板比对。
- 零破坏：不传新选项时行为与现状一致。

**Non-Goals:**
- 不改 init 交互 UI 既有的中英混排提示文案（i18n 化 UI 文案不在本票范围）。
- 不翻译 skills 内容、不按语言区分 skills 安装集合。
- 不做运行时语言切换/多 locale 配置——语言只在 init 时选定并固化进 WORKFLOW.md。

## Decisions

1. **独立 `--lang <zh|en>` 选项，不扩 `--workflow` 枚举**。3×2 正交组合优于 6 个平铺值：variant 继续独占 skills 安装集合与哨兵探测，枚举不翻倍，help 文案清晰。备选（`grill-openspec-en` 式组合值）被否决：污染现有取值空间、`skillsForWorkflow`/`detectWorkflow` 均需分支处理组合值。

2. **英文模板顶部加哨兵注释 `<!-- tasking-workflow-lang: en -->`；zh 由「无标记」表达**。需求禁止改动中文模板内容，无法在 zh 侧加标记；单侧标记即可双向判别且确定性强，与既有 `detectWorkflow` 哨兵模式同构（同一实现风格，ADR 0001 精神）。备选（CJK 字符计数启发式）被否决：启发式可被用户内容误触发，且引入第二套识别机制。

3. **协议性内容跨语言逐字节不变**：`<!-- tasking-workflow: code-mr -->`、`## 🔍 拷问 / Grill Questions`、YAML key、Liquid 语法、状态名占位值（如 active_states 下的中文示例值——它们本就是用户必须按自己 Jira 实际状态名修改的配置值）。保证 `detectWorkflow` 与工作流协议在两种语言下行为完全一致。

4. **默认 zh + 交互引导**：非交互模式未指定 → 静默 zh（现状字节级兼容）；TTY 交互未指定 → 「Template language」选择框（`中文 / English`，zh 在前，回车即 zh）；显式指定任一模式均跳过引导。输出摘要行增加 `Language:` 一项以便确认所选语言。

5. **文件平铺于仓库根**：`WORKFLOW.en.md.example` 等 3 个文件与现有布局一致，package.json `files` 同步补齐（npm 发布完整性）。

6. **`--update` 语言探测与显式覆盖并存**：读 WORKFLOW.md 全文找 en 哨兵 → en，否则 zh（与 `detectWorkflow` 并列执行）；`--lang` 显式传入时覆盖探测并在输出标注 `(explicit --lang)`，与 `--workflow` 的显式覆盖语义对称。`.tasking/WORKFLOW.md.reference` 引用副本随之使用同语言模板。

## Risks / Trade-offs

- [用户删除 en 哨兵注释后被误判为 zh] → 漂移报告仅是咨询性输出，误判后果轻微；可在报告行展示检测到的语言供用户发现异常。
- [英文模板与中文模板后续演进不同步] → 实现中以测试断言两版结构等价（YAML key 集合一致、prompt body Liquid 表达式集合一致），防止单侧漏改。
- [`generateWorkflowContent` 凭据正则依赖 YAML key] → key 跨语言不变（决策 3），正则天然兼容，无需分支。

## Migration Plan

纯增量发布：新文件 + 新可选选项。回滚 = 删新增文件与选项解析分支即可，无数据迁移。

## Open Questions

（无——grill 五项决策已全部获产品确认。）
