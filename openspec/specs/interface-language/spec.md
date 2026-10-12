## Purpose

tasking 自有文案的界面语言（interface_language，zh|en）体系：出口翻译机制、卡片翻译边界、CLI/TUI 渲染、字典覆盖率门禁与运行时残留告警。

## Requirements

### Requirement: 界面语言出口翻译
`interface_language` 为 `en` 时，tasking 自产文案 SHALL 在离开系统的出口被翻译为英文；为 `zh` 或字典未命中时 SHALL 原样放行。翻译 SHALL 经由双层字典：静态串精确匹配；带变量串仅翻译中文框架，变量部分 SHALL 原样透传且不再二次翻译。用户内容与 agent 输出（桥接镜像正文、`/chat` 提示词、卡片内模型文本与工具输出）SHALL NOT 被翻译。

#### Scenario: en 静态文案翻译
- **WHEN** `interface_language: en` 且出口收到字典内的静态中文文案
- **THEN** 发出对应英文文案

#### Scenario: 带变量文案框架翻译、变量透传
- **WHEN** `interface_language: en` 且出口收到形如 `**失败：** {detail}` 的文案
- **THEN** 发出 `**Failed:** {detail}`，`{detail}` 内容原样保留

#### Scenario: zh 与未命中原样放行
- **WHEN** `interface_language: zh`，或 en 下字典未命中
- **THEN** 出口内容与源码文案完全一致

#### Scenario: 用户内容不翻译
- **WHEN** `interface_language: en` 且出口处理桥接镜像的用户正文或 agent 输出
- **THEN** 正文原样发出，仅 tasking 自产框架文案被翻译
### Requirement: 卡片翻译不触碰协议字段
飞书卡片在发送前 SHALL 经 JSON 遍历翻译字符串叶子；button 的 `value` 及 `tag`/`url` 等协议字段 SHALL NOT 被翻译或改写。卡片内 agent 文本与工具输出 SHALL 自动透传。

#### Scenario: en 卡片渲染与按钮路由
- **WHEN** `interface_language: en` 下渲染直连会话卡片并点击按钮
- **THEN** label 为英文、value 与 zh 模式完全一致，回路路由行为不变
### Requirement: CLI 与 TUI 英文渲染
`interface_language: en` 时，CLI 输出（doctor/init/start/validator 消息）SHALL 无汉字残留；TUI SHALL 在宽度计算之前完成翻译，保证英文替换后布局不错位；TUI SHALL 从 daemon 的 effective config 获取 `interface_language`。

#### Scenario: en 下 doctor 输出无汉字
- **WHEN** `interface_language: en` 时运行 `tasking doctor`
- **THEN** 全部输出不含汉字

#### Scenario: en 下 TUI 布局
- **WHEN** `interface_language: en` 时渲染 TUI 含中文源文案的格子
- **THEN** 格子显示英文且列宽按英文文本计算，不错位
### Requirement: 字典覆盖率 CI 门禁
覆盖率测试 SHALL 扫描 `src/` 全部字符串/模板字面量中的汉字（模板字面量按与模式字典共用的归一函数把 `${...}` 归一为通配），每条 SHALL 满足其一：被精确字典命中、被某条模式规则覆盖、或位于带理由的白名单。白名单初始 SHALL 仅含 sentinel 兼容正则中的 `飞书`（协议串）。

#### Scenario: 新增中文文案未配字典
- **WHEN** `src/` 新增一条含汉字的字符串字面量且字典与白名单均未覆盖
- **THEN** 覆盖率测试失败（CI 红）

#### Scenario: 模板变量归一一致
- **WHEN** 源码存在 `` `还有 ${n} 个` `` 形式的字面量且字典含对应框架规则
- **THEN** 覆盖率测试判定其为已覆盖
### Requirement: 运行时汉字残留告警
`interface_language: en` 时，出口翻译后仍含汉字的 tasking 自产文案 SHALL 触发 `logger.warn`（附原文），作为覆盖率测试之外的第二道防线。

#### Scenario: 残留汉字告警
- **WHEN** en 模式下某条 tasking 自产文案翻译后仍含汉字
- **THEN** 记录 warn 日志且消息照常发出
