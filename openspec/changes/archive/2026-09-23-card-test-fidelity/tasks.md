## 1. Fixture

- [x] 1.1 新增 `tests/fixtures/feishu/card-action-trigger.json`：先写失败测试断言 fixture 存在且含两形态（带/不带 `operator.name`）与 `provenance` 字段及必需结构（schema 2.0 信封、event.operator/action.value/context 三组 id）；再落 fixture（provenance: `documented`）
- [x] 1.2 实现期间请用户在真机点一次卡片按钮，比照 daemon 侧事件校验后将 provenance 升级为 `captured`——2026-09-22 真机点击捕获完成：operator.name 确实缺失、全部 id 依 documented 嵌套解析成功，provenance 已升级

## 2. Round-trip helper

- [x] 2.1 `tests/helpers/card-roundtrip.ts` 的 `extractButtons(card)`：先写失败测试（能从桥状态卡/直连信息卡挖出 `{label, action, value}`，含 `kind`/`root_id`/`seq`；无按钮的卡返回空）；再实现
- [x] 2.2 `cardActionEvent(...)` 与 wiring 构建器：先写失败测试（生成的原始事件——`operator.name` 默认 null——经真实 `startEventChannel`（假 client）分发到桥的 `state_refresh` 并返回刷新卡）；再实现（每文件共享一个 wiring 实例）

## 3. 守卫套件（tests/card-roundtrip.test.ts，全部走 2 的 helper，红→绿逐条）

- [x] 3.1 桥·状态卡：`state_open`→`tr`→`tr_confirm` 全链（话题出现"已转 X（操作人：显示名）"、被点卡更新）；`tr_cancel` 零写入（transitions 无 POST）
- [x] 3.2 桥·状态卡：`state_refresh` 去重窗口内连点两次均执行；`state_summon` 召回（旧卡删除+底部新卡）
- [x] 3.3 桥·评论卡：`📋 状态` 召唤；截断卡的 `📄 完整输出` 发出 `.md` 文件
- [x] 3.4 桥·`/agent` 卡：`agent_set` 切换标签且被点卡刷新（此用例即 `/agent` 漏 kind 事故的回归锚）
- [x] 3.5 直连：`/auto` 卡三键、`/collect` 卡三键、轮次卡按钮（`⏹`/`🔁`/`📄`/`🔐`/`🛑` 至少各一）经路由默认分支分发并断言用户可见结果
- [x] 3.7 首跑捕获的真实缺陷：`/collect` 卡按钮漏 `root_id`（点击静默无效）——修 `collectCard` 传入会话 root，套件以 `value.root_id` 断言锚定
- [x] 3.6 重投：同一原始事件原样两投——写动作（`tr_confirm`）第二投返回"该操作已处理"且 Jira 仅一次 POST；幂等动作（`state_refresh`）两投均执行

## 4. 规约与文档

- [x] 4.1 AGENTS.md 新增「Card interaction rules (卡片交互规约)」小节（按访谈定稿：回路测试、三场景模板、fixture 先行+provenance、真机冒烟 opt-in、回访路径），置于 E2E 门禁节之后
- [x] 4.2 `.opencode/skills/opsx-propose-with-tdd/SKILL.md` 注入三场景检查清单（引用 AGENTS.md，不复制正文）
  - 2026-09-23 追记：该注入随后被 `55b9357` 回退（所有者决定：通用技能保持平台中立）；强制力仅由 AGENTS.md → Card interaction rules 承担
- [x] 4.3 `docs/adr/0025-card-interactions-verified-by-round-trip.md`（按访谈草案）
- [x] 4.4 提交 `CONTEXT.md` 术语（「回路测试」「回访路径」两词条，访谈中已写入）

## 5. 门禁

- [x] 5.1 `npm run lint`、`npm run typecheck`、`npm test`（守卫套件被自动收编）、`npm run test:e2e`；真机点一次按钮完成 1.2 后归档
