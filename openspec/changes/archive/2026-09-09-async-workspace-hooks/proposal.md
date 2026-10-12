## Why

`runHook`/`deleteSession` 使用 `execFileSync` 同步执行:hook(git clone 等重脚本,上限 60s)与 session 清理(15s)期间整个 daemon 事件循环停摆——其他并发 worker 的 stdout 处理延迟、bridge/dashboard/tick 全部冻结,最坏情况长停顿饿死飞书 WS 心跳导致断连重连。无任何 spec 要求同步执行(workspace-management spec 只要求"以工作区为 cwd 的 shell 执行 + timeout 约束");Symphony 参考实现(Erlang)本无阻塞编排器的概念,同步是 Node 侧的顺手选择,非继承的设计决策。出厂模板 hooks 为 null,影响仅限配置了重 hook 的部署——但一旦配置,这是吞吐/延迟层面最重的单点。

## What Changes

- `runHook` → `Promise<HookResult>`(`execFile` promisified),超时(到点对 bash 发 SIGTERM)与失败分类语义不变。
- `createWorkspace`/`removeWorkspace`/`deleteSession` 变 async;`runner.ts`(runAttempt 三处)与 `scheduler.ts`(`terminateRunning` 及其 4 个调用点)顺序 `await`。
- hook 超时的击杀语义**维持现状**(仅杀 bash 本体,不组杀孙进程)——本 change 是纯异步重构,语义零变化。

## Capabilities

### New Capabilities

(无)

### Modified Capabilities

- `workspace-management`:MODIFIED "工作区生命周期 hook" requirement——补"hook 执行与 session 清理 SHALL 异步进行、SHALL NOT 阻塞 daemon 事件循环;超时上限与失败语义不变"。其余 requirement(安全不变式等)不动。

## Impact

- 代码:`src/workspace/manager.ts`(runHook/deleteSession/createWorkspace/removeWorkspace)、`src/worker/runner.ts`、`src/scheduler/scheduler.ts`。
- 测试:`tests/workspace.test.ts` 全量加 await;`tests/scheduler.test.ts`/`tests/e2e.test.ts` 中 terminateRunning 相关异步化。
- 顺序影响:`reconcileStalledRuns` 中"先终止后调度 retry"的次序靠顺序 await 保持;`runAttempt` 中 after_run 的 finally 语义不变。
- 无配置、无文档变更(README 的 hooks 受信/timeout 表述不受影响)。
