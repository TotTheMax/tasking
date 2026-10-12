## 1. 配置面（T1）

- [x] 1.1 `interface_language` 字段（先写失败测试：缺省为 `zh`、`en` 解析、非法值 `fr` 被 validator 拒绝并列出合法取值，覆盖 `tests/config.test.ts`），再实现 `config-types.ts` 类型与 `DEFAULTS`、`resolver.ts` 解析、`validator.ts` 校验
- [x] 1.2 热重载暴露（先写失败测试：config manager reload 后 `interface_language` 新值可被读取），再把字段接入现有 reload 管道，确认无需重启的语义（对照 `tests/daemon-config.test.ts`）

## 2. 翻译机制（T2）

- [x] 2.1 `src/translate/` 归一函数 `normalizeTemplate`（`${expr}` → `(.*)`、相邻通配合并；先写失败测试：多变量、相邻变量、无变量三种模板），实现后供覆盖率测试与模式字典共用
- [x] 2.2 `translate()` 双层字典（先写失败测试：静态串精确命中、模式规则变量透传 `$1`、zh 与未命中原样返回、透传内容不二次进字典），实现 `EXACT`/`PATTERNS` 表结构与查找函数，字典先带少量样例条目
- [x] 2.3 locale 提供器（先写失败测试：设置 `en` 后 translate 生效、切回 `zh` 即放行），实现模块级 `getLocale()/setLocale()`，daemon 在 config load/reload 时更新

## 3. Sentinel 切换（T3）

- [x] 3.1 `via Feishu` 恒定与双匹配（先写失败测试：`hasSentinel` 认 `via 飞书` 与 `via Feishu` 两种评论、`buildBridgedCommentBody` 产出 `via Feishu` 且缺名兜底为 `user`），再改 `SENTINEL` 常量、`SENTINEL_PREFIX` alternation、`?? "用户"` → `?? "user"`；全量跑 `tests/comment-bridge.test.ts`、`tests/bridge-flow.test.ts` 确认零回归

## 4. 出口接线（T4）

- [x] 4.1 飞书文本出口（先写失败测试：en 下 send/reply 内容被翻译、zh 原样），在 `adapters/feishu/source.ts` 发送出口挂 translate；跑 `tests/feishu-source.test.ts`
- [x] 4.2 toast 出口（先写失败测试：en 下卡片动作 toast 为英文），在 toast 产生处挂 translate；跑 `tests/comment-bridge.test.ts`
- [x] 4.3 卡片出口（先写失败测试：en 下卡片 label 英文、`value`/`tag`/`url` 字段不变、卡片内 agent 文本透传），实现 JSON 字符串叶子遍历 + 协议字段跳过，挂在卡片发送前；在 `tests/card-roundtrip.test.ts` 增加 en 用例（取 en 卡片 button value 走真实 router 断言英文结果）
- [x] 4.4 CLI 出口（先写失败测试：en 下 doctor 输出无汉字），在 doctor/init/start 的 stdout 写入边界挂 translate（子命令启动时读一次配置）
- [x] 4.5 TUI 出口（先写失败测试：en 下含中文源文案的格子渲染英文且列宽按英文计算），在 `terminal-dashboard.ts` 格子文本边界（宽度计算前）挂 translate，`interface_language` 经 `/api/v1/config` 获取；跑 `tests/terminal-dashboard.test.ts`

## 5. 字典全量与覆盖率门禁（T5，与覆盖率测试同批合入）

- [x] 5.1 覆盖率测试 `tests/translate-coverage.test.ts`（扫 `src/**/*.ts` 排除 `*.test.ts` 的汉字字符串/模板字面量，归一后断言被 EXACT/PATTERNS 覆盖或在白名单；先验证它能对当前字典报红）
- [x] 5.2 按覆盖率测试驱动填字典至全绿（doctor 24、init 75、comment-bridge 74、card 31、manager 177、commands 22、probe 16、source 8、index 6、validator/manager/event-channel 零星；help 英文版按英文习惯重排版）
- [x] 5.3 en 冒烟集落位：helpTextFor 英文块渲染、direct 卡片 en 渲染、sentinel 双匹配单测归档到对应测试文件

## 6. 运行时兜底（T6）

- [x] 6.1 汉字残留告警（先写失败测试：en 下出口翻译后仍含汉字的文案触发 `logger.warn` 且消息照常发出），在 translate 出口路径实现 `/[\u4e00-\u9fff]/` 检测，白名单式放行用户内容路径

## 7. init 种子（T7）

- [x] 7.1 `--lang en` 写字段（先写失败测试：`--lang en` 生成 front matter 含 `interface_language: en`、`--lang zh` 省略），改 `cli/init.ts` 生成逻辑；跑 `tests/init.test.ts`
- [x] 7.2 交互问答同种子（先写失败测试：交互选 `English` 与选 `中文` 两种路径的生成结果），复用 7.1 逻辑
- [x] 7.3 `--update` drift 项（先写失败测试：旧 WORKFLOW.md 的 drift 报告列出该字段默认 `zh` 且不写入），接入现有 drift 管道；更新 `help.ts` 的 `--lang` 描述（同时种子 interface_language）

## 8. 文档与 ADR（T8）

- [x] 8.1 `docs/{zh,en}/configuration.md` 新增 `interface_language` 字段说明（取值/默认/热重载），`docs/{zh,en}/usage.md` 增加切换说明段落；跑 `tests/docs-links.test.ts` 验证双语 parity 与链接
- [x] 8.2 撰写 `docs/adr/0031-interface-language-exit-translation.md`（否决 catalog/L() 的取舍、覆盖率门禁契约、第三语言非目标）

## 9. 门禁收尾

- [x] 9.1 `npm run lint && npm run typecheck && npm test` 全绿；触及 bridge/飞书面 → `npm run test:e2e` 必跑；内网可达时 `npm run test:integration`（验证真 Jira 上 sentinel 双匹配与旧评论兼容），不可达则在提交说明写明原因
- [x] 9.2 final-only 真机冒烟：切换 `interface_language: en` 后目检飞书卡片英文渲染、help/ack/toast 英文、Jira 桥接评论前缀为 `via Feishu`（2026-10-09 Lark 真机实测：en 下 ack/help 卡/toast/直连会话卡均英文；sentinel 双匹配由单测覆盖）
