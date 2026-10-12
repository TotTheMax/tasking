## ADDED Requirements

### Requirement: 问卷引导跟随界面语言
交互式 init 问卷的自有文案（框线标题、说明行、问题文本、选项标签）SHALL 按界面语言渲染：语言判定遵循三条规则——① `--lang` 显式给出时 SHALL 在问卷任何输出之前设置 locale（`--lang en` 下第一问即为英文）；② 未给出 `--lang` 时前两问 SHALL 维持 zh 默认（模板语言本身是问卷项，鸡生蛋），答完立即切换；③ `--force` 重跑且已存在 WORKFLOW.md 时 SHALL 读取旧文件 `interface_language` 预设问卷语言（读取/解析失败静默回退 zh）。zh locale 下问卷输出 SHALL 与现状逐字节一致。

#### Scenario: --lang en 下第一问即为英文
- **WHEN** 以 `--lang en` 运行交互式 init
- **THEN** 任务来源问（含说明行与选项标签）渲染为英文，后续框线/问题/选项同为英文

#### Scenario: 无 --lang 时前两问维持中文
- **WHEN** 不带 `--lang` 运行交互式 init
- **THEN** 任务来源与模板语言两问以中文呈现（现状行为），选择 English 后后续问卷切换英文

#### Scenario: --force 沿用既有界面语言
- **WHEN** WORKFLOW.md 已存在（interface_language: en）且以 `--force` 重跑交互式 init
- **THEN** 问卷以英文开始

#### Scenario: --force 旧文件不可读时回退
- **WHEN** `--force` 重跑但旧 WORKFLOW.md 缺失 interface_language 或解析失败
- **THEN** 问卷以 zh 开始（等同现状），不报错

### Requirement: 选项协议值与显示标签解耦
`askSelect` 选项 SHALL 采用 `{ value, label }` 形态：`value` 为类型化协议值（调用方分支判断仅使用 value），`label` 为显示文案（渲染瞬间翻译、用完即弃）。修改/翻译标签文案 SHALL NOT 影响任何问卷分支判断。动态数据标签（群名、Jira issueType）SHALL 原样显示（翻译对非字典串恒等）。

#### Scenario: 英文标签不改变分支走向
- **WHEN** `--lang en` 下用户在任务来源问选择 "Connect Jira"
- **THEN** 问卷走接 Jira 分支（协议值为 jira），与 zh 下选择 "接 Jira" 行为一致

#### Scenario: 动态数据标签原样显示
- **WHEN** 群选择器列出机器人所在群（群名为用户命名数据）
- **THEN** 群名标签按原文显示，选中后以对应 chat_id 作为协议值返回
