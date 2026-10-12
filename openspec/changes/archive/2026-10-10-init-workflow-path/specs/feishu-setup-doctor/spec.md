## MODIFIED Requirements

### Requirement: doctor 全链路只读体检
`tasking doctor [workflow-path]` SHALL 对 workflow path（缺省当前目录 `./WORKFLOW.md`）依序执行只读检查：WORKFLOW.md 解析、飞书（token、三探针、intake 群可达）、Jira 连接（仅当配置了 Jira）、opencode 在 PATH。dotenv SHALL 从 `dirname(workflow path)` 加载（对齐 `start`）。输出 SHALL 为中文、逐项 ✓/✗/− 与补救提示，末尾汇总表；全部通过退出码 `0`，任一失败退出码 `1`。doctor SHALL 不执行任何写操作。

#### Scenario: 全部通过
- **WHEN** 配置与外部依赖全部正常时运行 `tasking doctor`
- **THEN** 各项标 ✓，汇总表列出通过项，退出码 `0`

#### Scenario: WORKFLOW.md 损坏
- **WHEN** WORKFLOW.md 无法解析时运行 `tasking doctor`
- **THEN** 飞书/Jira 检查项标 −（跳过），WORKFLOW 项标 ✗ 并给出错误位置，退出码 `1`

#### Scenario: 缺 opencode
- **WHEN** opencode 不在 PATH 时运行 `tasking doctor`
- **THEN** opencode 项标 ✗ 并附安装指引，退出码 `1`

#### Scenario: 对自定义路径体检并从其目录加载 dotenv
- **WHEN** 运行 `tasking doctor configs/my-flow.md` 且 `configs/.env` 存在
- **THEN** doctor 解析并体检 `configs/my-flow.md`，dotenv 从 `configs/` 加载
