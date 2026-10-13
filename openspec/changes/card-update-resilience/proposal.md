## Why

Lark 国际版链路上的实战排障（504 网关超时，更新耗时约 5s）暴露出轮次卡片更新失败的现有处理与真实网络行为不匹配：失败后**立即**重试会撞进同一波拥塞连败，两连败后**整个 daemon 生命周期内永久弃卡**（只能靠重启恢复），且降级文本会重发卡片上已有的工具（该缺陷已单独修复上线，但无 spec 记录）。现有 spec（direct-sessions"每 turn 一张轮次卡片"）本意是"退避重试一次 + 后续刷新自愈"，当前实现已偏离。

## What Changes

- 卡片更新失败按错误分类处理：**可重试**（5xx、429、网络层错误 `feishu_api_request`）延迟 2000ms+0-1000ms 抖动后重试一次；**不可重试**（4xx，429 除外）立即放弃，不等待
- 重试仍失败：**仅本 turn** 剩余更新降级为合并文本——单条消息、只含尚未成功上卡的工具（增量），不重发卡片已渲染内容（把已上线的游标推进语义补录为正式需求）
- **下一 turn 自动恢复卡片模式**（`startTurnCard` 重置降级标志），移除"进程生命周期内永久弃卡"
- 重试延迟/次数为硬编码常量，不新增 WORKFLOW.md 配置面
- 文档：known-issues 双语补一条 Lark 国际版需稳定国际线路的环境说明

## Capabilities

### New Capabilities

（无）

### Modified Capabilities

- `direct-sessions`: "每 turn 一张轮次卡片"需求的失败处理条款从"退避重试一次 + 自愈"细化为分类重试 + 每 turn 降级/恢复 + 增量文本投递

## Impact

- 代码：`src/direct/manager.ts`（`flushTurnCard` 失败分类与延迟重试、`startTurnCard` 重置恢复、重试延迟经 deps 注入默认 2000ms 作测试缝）
- 测试：`tests/direct-sessions.test.ts`（分类重试/降级/恢复/快速失败四场景）
- 文档：`CONTEXT.md`（Card fallback 术语，随本 change 已先行落入）、`docs/{en,zh}/known-issues.md`
- 不改 `src/adapters/feishu/source.ts`（状态码已由 `TaskingError.details.status` 结构化传递）
