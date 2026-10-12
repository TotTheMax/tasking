## ADDED Requirements

### Requirement: 卡片交互由回路测试守卫
凡带回调按钮的卡片（桥或直连），其按钮行为 SHALL 由回路测试守卫：从**渲染出的卡**抽取按钮 value，经真实事件通道路由（`startEventChannel`）分发，断言**用户可见结果**（话题回复/卡片更新/文件消息），而非仅直调 handler。每个新增按钮 SHALL 同步加入守卫套件 `tests/card-roundtrip.test.ts`。回路的输入载荷 SHALL 默认采用缺 `operator.name` 的真实形态（fixture），防住"显示裸 open_id"类回归。存量直调单元测试不受影响（直调测 handler 逻辑，回路测接缝）。

#### Scenario: 回路从渲染产物出发
- **WHEN** 守卫套件验证某个按钮
- **THEN** 它从渲染卡 JSON 中抽取该按钮的 value（含路由判别字段与渲染序号），经真实路由分发，不手造 value 绕过接缝

#### Scenario: 新按钮必进套件
- **WHEN** 某 change 新增一个带回调按钮的卡片
- **THEN** 守卫套件同步包含该按钮的回路用例

#### Scenario: 缺操作人姓名的回调
- **WHEN** 回路分发的回调事件不带 `operator.name`
- **THEN** 涉及操作人显示的行为从群成员表解析显示名，不出现裸 open_id

#### Scenario: 同一原始事件重投
- **WHEN** 同一回调事件被原样重投
- **THEN** 写操作（如确认转状态）只执行一次并提示已处理，幂等读取操作（如刷新）可重复执行
