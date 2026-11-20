## Context

opencode v2（tasking 契约钉 2.0.29，源码逐层核实）的模型解析规则为：**会话显式值（`session.model`，由 create 传入或 `switchModel` 写入）→ opencode 配置默认（`model` 键）→ 最新发布的可用模型**；没有 v1 的 last-used 回退，未显式选择时每次 prompt 都重新解析。tasking 未配置 `opencode.model` 时 create 不传 model、续轮不重新应用，因此每轮实际模型由服务端默认链决定，且 tasking 丢弃了响应中的 `model` 字段（`SessionInfo` 不读），全链路显示配置值。TUI 客户端的"最近使用"来自其本地 `model.json` recent 列表并显式传入，与 tasking（headless API）无关。

前置已完成：`opencode-v2-adaptation` 与 `card-update-resilience` 已归档，主规格含 `opencode-v2-driver` 等全部 capability。

本机存在 `opencode-v2` wrapper（v2.0.29，spike 沙箱），fixture 采集与契约版本一致。

## Goals / Non-Goals

**Goals:**

- 每轮 turn 实际使用的模型（解析模型）在日志、TUI/dashboard、sidecar 中可见
- 模型漂移（同会话相邻 turn 解析模型不一致）发生时主动告警
- 未配置 `opencode.model` 的风险在 doctor 与 init 两处显性化；init 引导用户做知情选择
- 领域术语与架构决策落档（CONTEXT.md、ADR 0039）

**Non-Goals:**

- 运行时软钉住（首轮解析后 `switchModel` 钉死）——见 ADR 0039，被否
- 飞书轮次卡片显示模型（回路测试成本高；TUI 已覆盖，待真实反馈）
- variant 追问（文档指路手填 `opencode.variant`）
- `--model` 存在性校验、独立 `tasking models` 命令
- 修改 `WORKFLOW.md` 配置面（`opencode.model` 键与语义不变）

## Decisions

1. **解析模型从既有调用免费搭车，不做预探测。** `SessionInfo` 增加 `model`，`createSession`/`getSession` 解析 `payload.model`；`session.get` 本就每 poll 调用，零额外 API。备选"worker 启动时调 `model.default` 预探测"被否：多一次调用，且与该 turn 实际解析仍可能不一致。
2. **事件链用后续刷新，不改 `turn_started` 语义。** `turn_started` 仍发配置值（发事件时首轮实际模型未知）；首轮 poll 观察到解析模型后经新事件（如 `model_resolved`）更新调度器条目，TUI/dashboard 显示实际值。副作用：首轮开始后的几秒内 TUI 显示配置值再刷新——接受，非缺陷。
3. **漂移判定为 turn 级相邻比对。** 每 turn 记录其解析模型（driver 返回值），与同会话上一 turn 比对；不同则 `warn` 一条（含 task/session、`A → B`），连续相同不重复。worker 与 direct 共用判定逻辑、各自落日志。poll 级比对被否：能抓的只有 attach 场景且价值有限（当前 run 不受影响，下一 turn 的 turn 级比对仍能发现），却引入每 2 秒比对与字段抖动误报风险。
4. **doctor 探测复用 `execApi`，cwd 取 workspace root。** 未配置 → `model.default` 显示实际解析值 + **warn**；已配置 → `model.list` 校验存在性，失效 **fail**（提前暴露运行时 `ModelUnavailableError`）；探测失败/超时（15s）→ **info** 降级，不算失败。detail 顺带提示"完整列表可跑 `opencode api model.list`"。
5. **init 交互为两段式搜索。** 关键词（子序列模糊匹配 providerID/模型 id/显示名）→ 编号列表；空回车列最近发布 top 20（`time.released` 倒序）；免费标签按 cost 全 0 判定，不显示价格；无匹配提示重搜或手输。实时 fzf 式过滤被否：raw-mode 复杂度、可测性差，为一次性问题不值。等待期 spinner 附教育性提示（模型格式/漂移事实/可改性），双语走 `translate()`。
6. **"跟随服务端默认"落盘写 `null`。** 选项文案已实时显示解析值与漂移风险，选择即知情接受；写死瞬态默认等于替用户做了另一个决定，且数月后模型过时无人知晓。兜底 = doctor warn + 漂移告警。
7. **`--model` 与 `--workflow`/`--lang` 预答惯例一致，仅格式校验（含 `/`）。** 存在性校验归 doctor（职责分离）；CI 中 opencode 常不可达，降级路径不值。非交互安装默认跳过模型问题且不写 model；显式 `--model` 时写入（CI 钉模型的唯一入口）。
8. **`--update` 绝不触碰 `opencode.model`。** 该键是用户显式决策字段，不在模板漂移基线机制的管理范围内；update 只读不写。
9. **sidecar 增量兼容。** `.tasking-session.json` 增加 optional `resolved_model`；读旧文件无此字段得 `undefined`，无迁移。
10. **fixture-first。** `model-list.json`/`model-default.json` 在本机 `opencode-v2`（v2.0.29）采集，provenance: captured；测试 mock 一律经 `tests/helpers/opencode-fixtures.ts` 克隆派生，不手写 v2 载荷。
11. **不做运行时软钉住（ADR 0039）。** 钉住的失败语义反转（模型下架 → 硬失败）与钉住时机/失败处理复杂度，相对"init 显式选择 + doctor 曝光 + 漂移告警"的组合无净收益。

## Risks / Trade-offs

- [fixture 形状与用户实际版本（如 2.2.6）有差异] → fixture 采自契约版本 2.0.29；`model.list`/`model.default` 不在 SDK 契约测试范围，形状以采集为准；provenance 记录版本。
- [model.list 大列表拖慢 init/doctor] → 15s 超时；init 降级为手输/跳过，doctor 降级 info；列表仅在交互选择时渲染 top 20。
- [漂移告警误报] → 判定只取 turn 终值（非 poll 瞬时值），相邻 turn 严格不等才告警；同模型连续 turn 静默。
- [TUI 首轮短暂显示配置值] → 事件刷新语义，接受；文档不承诺"turn 开始即显示实际值"。
- [init 问题增加安装摩擦] → 单问、可空回车跟随默认、可 `--model` 预答、非交互完全跳过。
- [`--update` 保留逻辑回归] → init-update 既有用例补一条"已有 opencode.model 不被覆盖"。

## Migration Plan

纯增量发布，无配置迁移、无数据迁移（sidecar 向后兼容）。回滚 = revert 提交；日志字段与事件新增对旧消费者无影响（`model` 事件字段语义未变，仅新增事件）。

## Open Questions

（无——全部决策已在提案前的拷问中定案；卡片显示模型与运行时钉住作为已否选项记录于 ADR 0039，重访路径：真实使用反馈"漂移告警高频出现"或"卡片需看模型"时再启。）
