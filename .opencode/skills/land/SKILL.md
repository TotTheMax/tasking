---
name: land
description:
  MR landing playbook: CI/review monitoring via land_watch.py, review feedback
  handling via glab api, and squash-merge. Only read this skill when you need
  to land/merge an MR.
---

# Land

## glab 预认证

`glab` 已通过 `GITLAB_TOKEN` 环境变量预认证，直接使用 `glab` 命令。无需 `glab auth login`。

## 前置条件

- 当前分支有已创建的 MR
- 工作区干净（有未提交改动先 commit + push）

## 监控 CI 和 Review

运行异步监控脚本，并行等待 CI 和 review：

```bash
python3 .opencode/skills/land/land_watch.py
```

根据 exit code 行动：

| Exit 0 | CI green, 无未处理 review | 执行 squash-merge（下方命令） |
| Exit 2 | 有 review 评论 | 处理 review 反馈（下方步骤），完后重跑脚本 |
| Exit 3 | CI 失败 | 本地修复，commit + push，重跑脚本 |
| Exit 4 | MR head 更新（如 CI auto-fix） | pull/amend/force-push 重触发 CI，重跑脚本 |
| Exit 5 | 合并冲突 | rebase against main，push，重跑脚本 |

## 处理 Review 反馈 (exit 2)

获取 review 评论：

```bash
glab api "projects/:id/merge_requests/<iid>/discussions"
```

回复评论：

```bash
glab api -X POST "projects/:id/merge_requests/<iid>/discussions" \
  -f body="<your response>"
```

- 每条评论判断：接受、澄清、拒绝
- 接受的反馈：实现修改，commit + push，重跑监控脚本
- 拒绝的反馈：给出替代方案或后续计划

## Squash-Merge

CI green 且 review 处理完后：

```bash
glab mr merge --squash --yes
```

不要在有未处理 review 评论时合并。
