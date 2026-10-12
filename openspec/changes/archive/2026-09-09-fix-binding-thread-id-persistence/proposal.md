## Why

`BindingStore.upsertBinding` 使用 `INSERT OR IGNORE`:对已存在的 binding 行,后续调用被静默忽略,`thread_id` 永远不会更新。`CommentBridge.forwardComments` 在转发时发现新 `thread_id` 后调用 `upsertBinding` 期望持久化(spec 已要求"bridge 将 thread_id 持久化到 binding"),实际只改了内存副本——daemon 重启后该绑定的 `thread_id` 回到 NULL/旧值,`bridgeMessages` sweep 以"no thread_id yet"永久跳过该话题,飞书→Jira 方向的兜底清扫失效。git 考古确认这是 `e3d946e` 把迁移条件从 root_id 换成 thread_id 时 SQL 未同步更新的半成品,而非设计取舍(后续 `c02cc9f` 的 ALTER TABLE 与 `e11acf3` 的 onDispatch 修复都在给同一洞打补丁)。

## What Changes

- `upsertBinding` 改为带守卫的 conditional upsert:`ON CONFLICT(issue_id) DO UPDATE SET thread_id = excluded.thread_id`,且仅在 `excluded.thread_id IS NOT NULL AND bindings.thread_id IS NOT excluded.thread_id` 时更新(NULL 不覆写、同值不写)。
- 更新只碰 `thread_id`:不复活 terminal 绑定、不动游标与 root/chat。
- 无 DB 迁移:列已存在(`c02cc9f`),存量 NULL 行靠 `forwardComments` 运行时治愈。

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `comment-bridge`:MODIFIED "Binding 1:1 issue↔飞书话题" requirement——binding 映射字段补 `thread_id`,并新增 scenario:存量 NULL thread_id 绑定经 forwardComments 治愈并**持久化到 binding 表**(重启后 sweep 依据 DB 中的 thread_id 续拉)。现有文字已隐含持久化,此处使其显式、可测。

## Impact

- 代码:`src/bridge/binding-store.ts`(`upsertBinding` SQL)、`src/bridge/comment-bridge.ts`(不改逻辑,治愈路径现有)。
- 测试:`tests/binding-store.test.ts`(insert 新行 / update 改 thread_id / NULL 不覆写 / terminal 不复活)、`tests/comment-bridge.test.ts`(治愈落库断言,直查 store 而非内存副本)。
- 无配置、无 schema、无文档变更。
