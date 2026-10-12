# 0033 — workflow path 决定关联产物位置；init / doctor 与 start 共用路径语义

`tasking start` 早已用位置参数接受任意位置的 `WORKFLOW.md`，但 `init`（生成 / `--update` / `--restore`）与 `doctor` 写死 `cwd/WORKFLOW.md`。本变更让这两条命令也接受 `[workflow-path]`（缺省 `./WORKFLOW.md`，相对 cwd 解析，纯文件路径，传目录报错），并把 **workflow path**（见 `CONTEXT.md`）确立为三条命令唯一的路径语义：其所在目录是 `.opencode/skills/`、`.tasking/<basename>.reference`、`<workflow-path>.bak` 与 dotenv 的基准；生成模式递归创建父目录。

理由：三条命令的路径语义不再分叉；"配置放在哪里，关联产物就在哪里"是部署者最省心的心智模型。取舍：这使关联产物位置成为用户可见契约——原有的"init 目录 = 配置所在目录"直觉被推广到任意路径，未来改动需按破坏性变更处理。被否决的备选：skills 恒放 cwd（违背同置直觉）、仅 `--update` 支持路径（"能更新却不能生成到自定义路径"的割裂）、传目录自动补 `WORKFLOW.md`（与 `start` 分叉）。本决定延伸 ADR 0007 的所有权边界——tasking 拥有 `.opencode/skills/`、用户拥有配置——二者现在一起随 workflow path 迁移。
