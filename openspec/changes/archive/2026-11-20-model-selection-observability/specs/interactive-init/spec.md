## ADDED Requirements

### Requirement: 模型选择问答

交互式 init 在凭据类问答汇合后、生成 WORKFLOW.md 前 SHALL 提出模型选择问题（中英双语），选项语义：

- **跟随服务端默认**——实时探测 `opencode api model.default` 并在选项文案中显示实际解析值与漂移风险提示；选中则写入 `model: null`；
- **关键词搜索选择**——输入关键词后列出匹配的编号列表（子序列模糊匹配 providerID、模型 id 与显示名；空回车列出按发布时间倒序的前 20 个；免费模型按 cost 全 0 标注"免费"标签；无匹配时提示重搜或手动输入）；选中写入该模型；
- **手动输入**——`provider/model` 格式，格式校验须含 `/`。

探测等待期间 SHALL 显示进度与教育性提示（双语）；探测失败或超时 SHALL 降级为手动输入/跳过，init 不得因探测失败而失败。非交互模式（`--non-interactive`、非 TTY）SHALL 跳过本问题;未显式提供 `--model` 时不写入 model(保持模板默认),显式 `--model` 时写入该值。`--update` 模式不适用本问答，且绝不改写已有 `opencode.model`（见 init-update 的只读约束）。

#### Scenario: 选中搜索结果写入配置

- **WHEN** 用户搜索 `glm` 并选择 `zhipuai-coding-plan/glm-5.3`
- **THEN** 生成的 WORKFLOW.md 中 `opencode.model` 为该值

#### Scenario: 跟随默认写入 null

- **WHEN** 用户选择"跟随服务端默认"（文案已显示解析值 X）
- **THEN** `opencode.model` 写入 `null`

#### Scenario: 空回车列出推荐

- **WHEN** 搜索关键词为空回车
- **THEN** 列出按发布时间倒序的前 20 个可用模型

#### Scenario: 模糊匹配

- **WHEN** 输入关键词 `glm53`
- **THEN** 匹配列表包含 `glm-5.3`（子序列命中）

#### Scenario: 探测失败降级

- **WHEN** 模型列表探测失败或超时
- **THEN** 问题退化为手动输入/跳过，init 继续且不失败

#### Scenario: 非交互跳过

- **WHEN** 以 `--non-interactive` 运行 init
- **THEN** 不出现模型问答，`opencode.model` 保持模板默认 `null`（未提供 `--model` 时）

### Requirement: --model 预答 flag

`tasking init --model <provider/model>` SHALL 作为模型问答的预答机制（与 `--workflow`/`--lang` 惯例一致）：指定时跳过模型问答并将该值写入 `opencode.model`；值不满足 `provider/model` 格式（不含 `/`）时 SHALL 报错退出。flag 值 SHALL 仅做格式校验，不做存在性校验。

#### Scenario: 指定 --model 跳过问答

- **WHEN** 以 `--model zhipuai-coding-plan/glm-5.3` 运行 init
- **THEN** 跳过模型问答，`opencode.model` 写入该值

#### Scenario: 格式非法报错

- **WHEN** 以 `--model glm-5.3`（不含 `/`）运行 init
- **THEN** init 报错退出，不生成 WORKFLOW.md
