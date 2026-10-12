## Context

ADR 0007 设立 `init --update`：不写用户拥有的 WORKFLOW.md，报告"新增 config 字段 + prompt body diff"，漂移时复制完整新模板到 `.tasking/<basename>.reference` 供 diff 工具核对。ADR 0028 让 `init` 生成物按段裁剪（非本变体的段整段注释、zh 省略 `interface_language`、未启用桥只保 `feishu.enabled: false`），且明确列出"三处以模板为基准的机器"：漂移检测、语言对齐、DEFAULTS 覆盖。

问题正出在第一台机器：漂移检测以**未裁剪的原始模板**为基线，而生成物被 0028 有意裁剪——fresh 文件必然报一堆"缺失"（polling/workspace/opencode/…/interface_language），且 `newFields.length > 0` 即判有漂移、写 reference，尽管 body identical。报告噪音淹没了升级感知这一本职。

## Goals / Non-Goals

**Goals:**

- fresh（未手改）文件跑 `--update`：`no missing config fields`、不写/清除 reference。
- 真实升级感知保留：当前生成器**会写**的键（active 段，含启用形态的 feishu 段）用户缺失时照报。
- 基线与生成器同源，不引入第二份真相（遵循 ADR 0028 否决"骨架序列化"的同一理由）。

**Non-Goals:**

- 不改 prompt body diff（裁剪不触及 body，模板 body == 生成 body，现状即正确）。
- 不改 reference 副本内容（仍为原始模板）。
- 不做 B 案（对用户手工解注释的段做完整模板比对）——留作日后按需增量。
- 不改语言探测、变体探测、技能同步。

## Decisions

1. **基线 = 生成器当日产物，只比键。** 实现：把 `generateWorkflowContent` 里"读模板 → `trimFrontmatter` → interface_language 处理"抽成共享 helper（如 `applyTemplateTrimming(content, workflow, feishuEnabled, lang)`），`reportWorkflowDrift` 用它产基线并 `parseWorkflowContent` 取键。占位凭证值与用户真实值不参与比较（`collectNewConfigFields` 本就只看键存在性）。
2. **feishu 段形态镜像用户的 `feishu.enabled`（A+）。** 纯 A 会让桥用户（本仓库主力）听不到 feishu 段的新字段——基线里该段只有 `enabled: false`。镜像后语义仍是单句："按你自己的结构选择重放生成器"。
3. **触发条件 = 缺失 ∨ body diff。** fresh 文件二者皆无 → 不写 reference；沿用"无漂移即删旧 reference"逻辑。
4. **`--workflow` / `--lang` 显式覆盖同切基线。** 变体/语言单一真相；跨变体比对报全量差异是预期行为（今天更夸张，变少是改善）。
5. **表头只改括号半句**（`fields missing vs a fresh init today — they fall back to DEFAULTS`）；`no missing config fields`、`- xxx (default: …)` 行、reference 提示行全部不动。`help.ts` 的 `--update` 描述从 "vs the detected template" 改为基线措辞。

**Alternatives considered：** 纯 A（否决：桥用户 feishu 段失去升级感知，代价落在主力用户群）；B 混合基线（否决：两条规则、双重心智模型，且用户手工解注释段的场景频率低，A+ 落地后可增量叠加）；C 措辞分级（否决：正确分类所需信息恰是 A 的基线——算出来后当比对基线反而更简单，且噪音仍在）。

## Risks / Trade-offs

- **[被裁剪段的新可选字段不再列入报告]** → 接受。它们本就走 DEFAULTS；文档/reference（真实漂移时）可见；`generated-config-trimming` 的分段护栏测试保证模板新增顶层段时生成器必须跟进、失败可见。
- **[用户误解"以前报的字段去哪了"]** → 表头新措辞点明基线；ADR 0034 + 0028 指针留痕。
- **[基线生成读一次模板的成本]** → `--update` 本就 `readFileSync` 模板一次，再读/裁剪一次为常量级，无感。
- **[旧用例语义翻转]** → 既有用例以"删注释段字段"构造漂移，在新语义下不再是漂移——按新语义重构造（删 active 段字段或改 body），这正是本变更的验收载体。
