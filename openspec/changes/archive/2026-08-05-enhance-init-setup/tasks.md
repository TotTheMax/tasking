## 1. Skill 拷贝逻辑

- [x] 1.1 实现 `copySkill(wfDir: string, output: Writable)` 函数：解析 `assets/skills/land/` 源路径，拷贝 `SKILL.md` + `land_watch.py` 到 `<wfDir>/.opencode/skills/land/`，跳过 `__pycache__`，已存在则跳过，拷贝失败打印警告不阻断
- [x] 1.2 在 `runInteractiveInit` 中接入 `copySkill`（写 WORKFLOW.md 之后、打印 initialized 之前）
- [x] 1.3 在 `runNonInteractiveInit` 中接入 `copySkill`（写 WORKFLOW.md 之后）

## 2. glab 检查与 GitLab 提示

- [x] 2.1 实现 `checkGlab(output: Writable)` 函数：`which glab`，找不到打印警告，不阻断——与 `checkOpencode` 对称
- [x] 2.2 实现 `printGitLabHint(output: Writable)` 函数：检查 `process.env.GITLAB_TOKEN`，已设跳过，未设打印提示（两种方式：export 或直接写 `env:` 配置段）
- [x] 2.3 在 `runInteractiveInit` 中接入：`checkOpencode` → `checkGlab` → `printGitLabHint`（条件）→ `openEditor` → `printCompletionHint`

## 3. 测试

- [x] 3.1 glab 检查测试：模拟 `which glab` 成功（不打印警告）和失败（打印警告但不阻断）
- [x] 3.2 GitLab 提示条件触发测试：`GITLAB_TOKEN` 已设（跳过提示）和未设（打印提示含两种方式）
- [x] 3.3 skill 拷贝测试：目标不存在（拷贝成功）、目标已存在（跳过不覆盖）、拷贝失败（打印警告不阻断）
- [x] 3.4 非交互式 skill 拷贝测试：`runNonInteractiveInit` 也拷贝 skill

## 4. Spec 同步与验证

- [x] 4.1 同步 delta specs 到主 specs（interactive-init、cli-runtime、opencode-skills）
- [x] 4.2 更新 `docs/usage.md`（init 命令新增 glab 检查、GitLab 提示、skill 安装行为）
- [x] 4.3 lint + typecheck + test 全绿
