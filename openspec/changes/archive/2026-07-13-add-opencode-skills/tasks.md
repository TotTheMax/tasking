## 1. 基础设施

- [x] 1.1 创建 `assets/skills/` 目录结构
- [x] 1.2 验证 `after_create` hook clone 的仓库含 `.opencode/skills/` 时 workspace 可用

## 2. commit 技能

- [x] 2.1 编写 `assets/skills/commit/SKILL.md`（从 Symphony 版迁移，去掉 `Co-authored-by: Codex`）
- [x] 2.2 测试：验证 front matter 格式、不含 Codex trailer、含 type 前缀指引

## 3. pull 技能

- [x] 3.1 编写 `assets/skills/pull/SKILL.md`（纯 git workflow，几乎直接移植）
- [x] 3.2 测试：验证含 rerere 指引、zdiff3 冲突风格、fetch + merge 流程

## 4. push 技能

- [x] 4.1 编写 `assets/skills/push/SKILL.md`（`gh` → `glab` 命令映射）
- [x] 4.2 测试：验证使用 `glab mr create` 而非 `gh pr create`、引用 pull 技能

## 5. debug 技能

- [x] 5.1 编写 `assets/skills/debug/SKILL.md`（重写为 tasking 日志格式）
- [x] 5.2 测试：验证使用 `tasking.log` 路径、`task_identifier`/`session_id` 关联键、tasking 事件名

## 6. land 技能

- [x] 6.1 编写 `assets/skills/land/SKILL.md`（从 Symphony 版迁移，去掉 Codex Review 逻辑）
- [x] 6.2 测试：验证不含 `## Codex Review`、不含 `[codex]` 前缀、含 `glab mr merge` 指引
- [x] 6.3 编写 `assets/skills/land/land_watch.py`（GitLab API 版，保留 asyncio 框架和 exit code 协议）
- [x] 6.4 测试：land_watch.py 单元测试（mock GitLab API，验证 exit code 逻辑）
- [x] 6.5 测试：验证 land_watch.py 不含 `CODEX_BOTS`、`## Codex Review` 过滤

## 7. WORKFLOW.md prompt 集成

- [x] 7.1 WORKFLOW.md.example 的 `{% if attempt %}` 分支新增 land 技能引用指引
- [x] 7.2 测试：prompt.test.ts 验证 attempt > 1 时 prompt 含技能引用
- [x] 7.3 更新 `docs/usage.md` 说明技能系统

## 8. 文档

- [x] 8.1 创建 `docs/skills.md` 说明 5 个技能的用途、前置条件、使用方式
- [x] 8.2 更新 `docs/README.md` 索引新增技能文档链接

## 9. 迁移中发现并修复的 tasking 流程不足

- [x] 9.1 记录迁移过程中发现的 bug/不足
- [x] 9.2 修复发现的问题（每个单独处理）

## 10. 验证

- [x] 10.1 运行 `npm run lint && npm run typecheck && npm test`，确保全部通过
- [x] 10.2 验证 `assets/skills/` 下所有技能文件 front matter 格式正确
- [x] 10.3 验证 land_watch.py Python 语法正确（`python3 -c "import py_compile; py_compile.compile('land_watch.py')"`)
