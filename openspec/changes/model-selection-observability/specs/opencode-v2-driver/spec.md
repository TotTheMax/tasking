## ADDED Requirements

### Requirement: 解析模型读回

会话操作 SHALL 从 `session.create` 与 `session.get` 响应的 `data.model` 读回服务端解析的模型（`{id, providerID, variant?}` 形状），随 `SessionInfo` 返回；`runTurn` 的结果 SHALL 携带本 turn 内观察到的解析模型终值。响应缺失该字段时 SHALL 容忍为空（undefined），不产生错误。

#### Scenario: create 响应带模型

- **WHEN** `session.create` 响应的 `data.model` 为 `{id: "glm-5.3", providerID: "zhipuai-coding-plan", variant: "default"}`
- **THEN** `SessionInfo.model` 返回该解析模型

#### Scenario: get 响应带模型

- **WHEN** `session.get` 响应的 `data.model` 为 `{id: "glm-5.3", providerID: "zhipuai-coding-plan"}`
- **THEN** `SessionInfo.model` 返回该解析模型

#### Scenario: 响应缺失模型字段

- **WHEN** `session.create` 或 `session.get` 响应不含 `data.model`
- **THEN** `SessionInfo.model` 为 undefined，调用不报错

#### Scenario: turn 结果携带观察值

- **WHEN** 一个 turn 的轮询期间观察到解析模型
- **THEN** `runTurn` 返回的结果携带该 turn 的解析模型终值
