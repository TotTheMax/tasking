## 1. fixture 采集（先行）

- [x] 1.1 在本机 `opencode-v2` wrapper（v2.0.29）采集 `model.list`/`model.default` 真实载荷到 `tests/fixtures/opencode-v2/rest/model-list.json`、`model-default.json`，provenance.md 登记（captured，含版本与采集方式）；`tests/helpers/opencode-fixtures.ts` 增加两个派生 helper

## 2. 驱动层解析模型读回

- [x] 2.1 `SessionInfo.model` 读回（写失败测试先：fixture 派生 mock 断言 create/get 响应的 `data.model` 解析为 `{id, providerID, variant?}`、字段缺失容忍为 undefined；再改 `src/driver/session-ops.ts`）
- [x] 2.2 `runTurn` 结果携带解析模型终值（写失败测试先：轮询剧本中途返回带 model 的 session.get → 断言 TurnResult.model 为终值；再改 `src/driver/turn-driver.ts`）

## 3. worker 观测与事件链

- [x] 3.1 turn 解析模型入日志 + `model_resolved` 事件（写失败测试先：假 opencode 剧本跑通 turn → 断言 runner 发射 `model_resolved` 事件且日志含解析模型，`turn_started` 仍为配置值；再改 `src/worker/runner.ts`）
- [x] 3.2 worker 漂移告警（写失败测试先：同会话相邻 turn A→B 各告警一次、连续同模型不告警；再实现 runner 的 turn 级相邻比对）
- [x] 3.3 sidecar `resolved_model`（写失败测试先：写入含字段、读旧版文件兼容；再改 `src/workspace/manager.ts` sidecar 读写）

## 4. 调度器条目刷新

- [x] 4.1 `model_resolved` 更新运行条目（写失败测试先：条目 model 初值 null → 事件携带 X → `RunningEntry.model` 为 X，配置值被解析值覆盖；再改 `src/scheduler/scheduler.ts`）

## 5. direct 路径观测

- [x] 5.1 direct 日志与漂移告警（写失败测试先：direct turn 日志含解析模型、同会话相邻变化 warn 一次含 root_id；再改 `src/direct/manager.ts` 复用比对逻辑）

## 6. doctor 模型解析检查

- [x] 6.1 检查项四态（写失败测试先：配置有效 pass/配置失效 fail/未配置 warn 显示解析值/探测超时 info，detail 含列表查询提示；再改 `src/cli/doctor.ts`——复用 execApi、cwd 取 workspace root、15s 超时）

## 7. init 模型选择

- [x] 7.1 探测 helper 与降级（写失败测试先：可达返回模型列表与默认值、超时/失败返回 null 不抛错；再实现可注入探测函数）
- [x] 7.2 模型选择问答（写失败测试先：搜索命中写入/模糊子序列匹配/空回车 top20 按发布时间倒序/免费标签/跟随默认写 null 且文案含解析值/手输格式校验/探测失败降级手输/非交互跳过不写 model；再实现 `src/cli/init.ts` 问答与 `src/cli/prompts.ts`，spinner 教育提示双语）
- [x] 7.3 `--model` 预答 flag（写失败测试先：指定后跳过问答写入该值、`glm-5.3` 裸名报错退出不生成文件；再改 `src/cli/init.ts` 与 `src/cli/help.ts`）
- [x] 7.4 `--update` 保留回归（写失败测试先：已有 `opencode.model` 的 WORKFLOW 经 `--update` 后该值不变——对既有"不写 WORKFLOW.md"需求的回归；通过或修复）

## 8. 文档与领域记录

- [x] 8.1 CONTEXT.md 新增 `Model resolution` 术语（Configured model/Resolved model/Model drift，漂移显式限定与 Drift baseline 区分）
- [x] 8.2 撰写 `docs/adr/0039-model-selection-observability-over-runtime-pinning.md`（v2 解析规则考据 + 决策 + 被否方案）
- [x] 8.3 双语文档同步：`docs/{zh,en}/configuration.md`（模型解析规则与漂移）、`usage.md`（doctor 模型项）、`getting-started.md`（init 模型选择）、README；`tests/docs-links.test.ts` 过

## 9. 门禁与收尾

- [x] 9.1 全门禁绿：`npm run lint`、`npm run typecheck`、`npm test` 全量（不触飞书/Jira 适配器，e2e 随全量执行）；确认 `WORKFLOW.md` 配置面零变化
