## 1. 共享 workflow path 解析（T1）

- [x] 1.1 新增 `resolveWorkflowPath(cwd, positional)` 与关联目录派生 helper：先写失败单测 `tests/workflow-path.test.ts`（显式相对路径相对 cwd 解析、缺省 `./WORKFLOW.md`、指向现存目录时报错），再实现最小函数使其通过
- [x] 1.2 让 `runInit` / `runDoctor` 复用同一 helper：以单测断言三命令得到一致的绝对路径；保持 `runInit(dir, opts)` / `runDoctor(cwd, deps)` 现有签名（新增可选路径参数）

## 2. init 生成支持自定义路径（T2）

- [x] 2.1 `tasking init [workflow-path]` 入口透传：先写失败测试（`tasking init configs/my-flow.md` 写到该文件），再在 `src/cli/index.ts` 把已捕获的 `positionals[0]` 传入 `runInit`
- [x] 2.2 生成模式写 wfPath + 递归建父目录：先写失败测试（`deep/a/b/WORKFLOW.md` 父目录不存在仍成功），再改 `runNonInteractiveInit` 用 `wfPath` 并 `mkdirSync(dirname, {recursive:true})`
- [x] 2.3 生成模式关联产物跟随 `dirname(wfPath)`：先写失败测试（skills 落到 `configs/.opencode/skills/`、备份为 `<path>.bak`），再改实现

## 3. init --update / --restore 支持自定义路径（T3）

- [x] 3.1 `--update` 在 workflow path 作业：先写失败测试（自定义路径的 skills 同步到其所在目录、缺少该路径文件报错指名路径），再改 `runUpdate` 接收完整 `wfPath`
- [x] 3.2 漂移参考副本改 `<basename>.reference`：先写失败测试（`configs/.tasking/my-flow.md.reference` 及提示命令使用该路径），再改 `syncDriftReference` / `reportWorkflowDrift`
- [x] 3.3 `--restore` 在 workflow path 所在目录还原：先写失败测试（`configs/.opencode/skills/` 的 `.bak` 被还原），再改 `runRestore` 用 `dirname(wfPath)`

## 4. doctor 支持自定义路径（T4）

- [x] 4.1 `runDoctor` 接受可选 workflow path 且 dotenv 从 `dirname(path)` 加载：先写失败测试（`doctor configs/my-flow.md` 读取该文件、从 `configs/` 加载 dotenv；无路径时仍 cwd），再改 `src/cli/doctor.ts`
- [x] 4.2 `doctor` 入口接受位置参数：先写失败测试（`tasking doctor configs/my-flow.md` 不再报"doctor takes no arguments"），再改 `src/cli/index.ts` 的 doctor 分支

## 5. 帮助与输出文案（T5）

- [x] 5.1 `src/cli/help.ts` 为 `init` / `doctor` 补 `[workflow-path]`：先写失败测试（`tasking init --help` / `tasking doctor --help` 含 workflow-path 用法行），再改 help 定义
- [x] 5.2 指向具体目标文件的输出文案改用实际路径/`basename`（如 "existing … backed up"、漂移参考行、restore 提示）：先写失败测试断言使用目标文件名，再改 `src/cli/init.ts`；按需同步 `src/translate/dict.ts`

## 6. 文档与 ADR（T6）

- [x] 6.1 双语 `docs/{zh,en}/usage.md` 更新 `init` / `doctor` / `start` 的 `[workflow-path]` 用法，并保持双语 parity（`tests/docs-links.test.ts` 绿）
- [x] 6.2 新增 `docs/adr/0033-workflow-path-relocates-companions.md`（workflow path 决定关联产物位置；三命令共用路径语义），并给 `docs/adr/0007-init-update-ownership-boundary.md` 加指针
- [x] 6.3 确认 `CONTEXT.md` 的 **Workflow path** 词条与 Init / init --update 回填已就位（本变更已写入）

## 7. 门禁收尾

- [x] 7.1 `npm run lint && npm run typecheck && npm test` 全绿
- [x] 7.2 `openspec validate --changes` 复核变更通过（活动变更保持不含日期的 `init-workflow-path`；归档时由 `opsx-archive` 加 `YYYY-MM-DD-` 前缀）
