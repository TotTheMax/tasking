# Card interactions are verified by round-trip, not direct handler calls

复盘（2026-09-22）中多起仅真机可暴露的缺陷——按钮漏路由判别字段而静默失效、去重误伤重复点击、回调缺 `operator.name` 导致显示裸 open_id——都住在「卡片渲染 → 事件通道路由 → handler」的接缝上，而直调 handler 的单元测试结构性绕过该接缝，且 mock 按想象构造与真实载荷有差距。决定：卡片交互一律以回路测试守护（从渲染产物抽取按钮 value、经真实 `startEventChannel` 分发、断言用户可见结果），mock 输入优先取真实载荷 fixture；接受 wiring 与运行成本，换取接缝覆盖。直调单元测试保留用于 handler 逻辑；"直调测逻辑、回路测链路"。
