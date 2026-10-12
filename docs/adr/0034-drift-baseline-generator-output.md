# 0034 — 漂移基线 = 生成器当日产物，而非原始模板

`init --update` 的缺失字段报告曾以未裁剪的模板 frontmatter 为基线，而 init 生成物按 ADR 0028 有意裁剪（非本变体的段整段注释、zh 省略 `interface_language`、未启用桥只保 `enabled: false`）——刚生成、未手改的文件随即报 ~11 条"missing"并触发写入 `.tasking/<name>.reference`（尽管 body identical），"裁剪设计如此"的噪音淹没了"升级后新增字段"的真信号。本变更把**漂移基线**（见 `CONTEXT.md`）定为：对探测到的（或 `--workflow`/`--lang` 显式覆盖的）variant × lang 走**与 init 同一条生成路径**产出的配置键集合，只比键不比值，且 feishu 段形态镜像用户文件里的 `feishu.enabled`（否则桥用户——本仓库主力——听不到 feishu 段的新字段）。prompt body diff 与 reference 副本仍以原始模板为准；reference 仅在真实漂移（基线缺失 ∨ body diff）时写入。

被否决：**纯生成基线（不镜像 feishu.enabled）**——feishu 段升级感知落到主力用户群身上是漏报；**混合基线（对用户手工解注释的段再按完整模板比对）**——两条规则、双重心智模型，留作日后按需增量；**措辞分级（基线不动，只把噪音分组展示）**——正确分类所需信息恰好就是生成基线，算出来后当比对基准反而更简单，且噪音仍在。已知代价：仅存在于被裁剪段的新可选字段不再列入报告（仍走 `DEFAULTS`、文档与 reference 可见；`generated-config-trimming` 的分段护栏测试保证模板新增顶层段时生成器必须跟进）。这修订了 ADR 0028 所列"三台以模板为基准的机器"中的第一台（漂移检测）；ADR 0007 的所有权边界不变。
