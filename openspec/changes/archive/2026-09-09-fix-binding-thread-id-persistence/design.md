# C2 fix-binding-thread-id-persistence 设计

## Context

`BindingStore.upsertBinding` 自初次提交(fcb892d)起即 `INSERT OR IGNORE`,当时语义是幂等创建。`e3d946e` 引入 thread_id 后,`forwardComments` 的迁移分支(检测到 `r.thread_id !== b.thread_id` 时调用 `upsertBinding`)期望的是**更新**已存在行,SQL 未同步,该调用静默空转;`c02cc9f`(ALTER TABLE)与 `e11acf3`(onDispatch 立即建话题)均为同一洞的症状修复。bug 被三重掩盖:内存副本 `b.thread_id` 已改(当前进程 sweep 正常)、事件通道实时路径不经 thread_id(ADR 0018)、观察到问题需"NULL thread_id 绑定 + 重启 + WS 断线窗口"三者叠加。

## Goals / Non-Goals

**Goals:**
- forwardComments 发现的新 thread_id 真正落库,daemon 重启后 sweep 可用。
- 存量 NULL thread_id 行(`c02cc9f` 迁移遗留)在下一次 Jira→飞书转发时被治愈。

**Non-Goals:**
- 不改治愈路径本身(仍是 forwardComments,不新增后台治愈任务)。
- 不动 root_id/chat_id/游标/status 的更新语义。
- 无 DB schema 变更、无迁移脚本。

## Decisions

**D1 conditional upsert(而非无条件 ON CONFLICT UPDATE)**
```sql
INSERT INTO bindings (issue_id, issue_key, chat_id, root_id, thread_id, status)
VALUES (?, ?, ?, ?, ?, 'active')
ON CONFLICT(issue_id) DO UPDATE SET thread_id = excluded.thread_id
WHERE excluded.thread_id IS NOT NULL
  AND bindings.thread_id IS NOT excluded.thread_id
```
- 只 SET `thread_id`:terminal 绑定不复活,游标/root/chat 不被覆盖。
- `WHERE excluded.thread_id IS NOT NULL`:`executeIssue`/`onDispatch` 建行时可能拿到 null,不允许抹掉已有好值。
- `bindings.thread_id IS NOT excluded.thread_id`:同值不写,避免 forward 每 5s 快循环的空转 UPDATE(WAL 噪音)。
- 备选否决:拆出独立的 `updateThreadId` 方法——调用点语义仍是"不存在则建、存在则补",单方法保持调用方零改动。

**D2 测试断言直查 store**:治愈测试必须断言 `store.getBinding(...).thread_id`(持久层),而非仅内存副本——本 bug 恰恰是"内存对、DB 错"才能存活多年。

## Risks / Trade-offs

- [SQLite 版本不支持 UPSERT WHERE 子句] → better-sqlite3 内置 SQLite ≥ 3.35(2021),`IS NOT` 比较与条件 UPSERT 均支持;测试即验证。
- [治愈只发生在下一次 Jira→飞书转发] → 接受:active 绑定必然有转发流量;terminal 绑定不需要 thread_id。
