## 1. CLI 接线与模式互斥

- [ ] 1.1 写失败测试：`runInit({update, force})` 与 `runInit({update, restore})` 打印互斥错误并返回 1
- [ ] 1.2 实现：`InitOptions` 增加 `update`/`restore`；`runInit` 校验 `--force`/`--update`/`--restore` 互斥并分派 `runUpdate`/`runRestore`
- [ ] 1.3 接线：`src/cli/index.ts` init `parseArgs` 增加 `update`/`restore` 布尔 flag 并透传；USAGE 更新

## 2. --update 技能同步（先红后绿）

- [ ] 2.1 写失败测试：`.opencode/skills/<name>/` 缺失时 `--update` 从 `assets/skills/` 安装（含 land 的 `land_watch.py`）
- [ ] 2.2 实现 `syncSkills`：缺失即安装；字节一致跳过并报告 up to date
- [ ] 2.3 写失败测试：改过的技能被备份为 `<file>.bak`、覆盖为新版、打印警告与备份路径；`.bak` 只保留最近一次
- [ ] 2.4 实现备份+覆盖逻辑
- [ ] 2.5 写失败测试：某技能文件拷贝失败仅警告，其余技能继续；`--update` 不修改 WORKFLOW.md 内容
- [ ] 2.6 实现拷贝失败不阻断

## 3. --update WORKFLOW.md 漂移报告（先红后绿）

- [ ] 3.1 写失败测试：用户 frontmatter 缺失模板字段（如 `opencode.variant`）时报告新增字段路径+默认值；无新增字段报告 none
- [ ] 3.2 实现 `collectNewConfigFields`（递归 dotted path 比对）
- [ ] 3.3 写失败测试：用户 prompt body 与模板不同时打印行级 `-`/`+` diff（不含 frontmatter）；相同时报告 identical
- [ ] 3.4 实现行级 LCS diff 与报告输出
- [ ] 3.5 写失败测试：无 WORKFLOW.md 时 `--update` 报错返回 1；`--workflow grill-openspec` 用 grill 模板做报告
- [ ] 3.6 实现：`--update` 要求 WORKFLOW.md 存在；模板选择 = `--workflow` 优先，否则从 prompt body 标记探测

## 4. --restore 技能回撤（先红后绿）

- [ ] 4.1 写失败测试：`--restore` 把 `.opencode/skills/**` 下的 `.bak` 还原为原名（覆盖当前）；无备份时提示并返回 0
- [ ] 4.2 实现 `runRestore`（递归扫描 `.bak` + rename 还原）

## 5. 文档与验证

- [ ] 5.1 更新 `docs/usage.md`：`tasking init` 选项表与说明新增 `--update`/`--restore`
- [ ] 5.2 更新 `docs/known-issues.md`：移除已实现的 `tasking upgrade/init --update` 待做项
- [ ] 5.3 跑通 `npm run lint` + `npm run typecheck` + `npm test`
