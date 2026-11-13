# 模型选择：init 显式配置 + 全链路观测，而非运行时钉住

opencode v2（契约钉 2.x，源码核实）没有 v1 的 last-used 回退：每轮解析为 会话显式值（`session.model`，create 传入或 `switchModel` 写入）→ opencode 配置默认（`model` 键）→ 最新发布的可用模型。tasking 未配置 `opencode.model` 时不传 model、续轮不重新应用，于是每轮实际模型由服务端默认链决定，且相邻 turn 可能因目录刷新/配置变更/人工 attach 而变化（模型漂移），此前完全不可见。TUI 的"最近使用"是客户端本地 `model.json` recent 列表并显式传入，对 tasking（headless API）不适用。

我们决定：**在 init 时引导显式选择（写入 `opencode.model`，选"跟随服务端默认"则保持 null），并把解析模型读回全链路展示**（日志/TUI/sidecar + turn 级漂移告警 + doctor 模型解析检查），而不是在运行时把首轮解析结果 `switchModel` 钉死在会话上。

被否方案：

- **运行时软钉住**（首轮解析后 `switchModel` 一次）：失败语义反转（模型下架从静默自适应变为 `ModelUnavailableError` 硬失败），钉住时机与失败处理需要额外设计；init 显式选择 + doctor 曝光 + 漂移告警的组合已覆盖其价值。重访条件：观测显示未配置安装仍大量存在且漂移高频。
- **强制必填 `opencode.model`**：BREAKING，对只想用服务端默认的用户不友好。
- **每 turn 重新 `switchModel`**：每轮多一次 API，且会与用户 `opencode attach` 手动切换打架。

"跟随服务端默认"落盘写 `null` 而非写死当前解析值：选项文案已实时显示解析值与漂移风险，选择即知情接受；写死瞬态默认等于替用户做了另一个决定，数月后模型过时无人知晓。
