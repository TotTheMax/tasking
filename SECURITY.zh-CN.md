简体中文 | [English](./SECURITY.md)

# 安全策略

## 支持的版本

仅最新的发布线（`0.x`）接收安全修复。

## 报告漏洞

**安全漏洞请勿开公开的 GitHub issue。**

请使用 GitHub 私有漏洞报告渠道：在本仓库 GitHub 页面 → **Security** 标签 → **Report a vulnerability**。这会私密地通知维护者。

请包含：

- 问题及其影响的描述
- 复现步骤或 proof of concept
- 受影响版本（`npm ls -g @tothemax/tasking`）

我们力争在 72 小时内确认收到的报告，并与你协商披露时间。

## 信任边界（部署前必读）

`tasking` 面向**可信环境**设计：

- `WORKFLOW.md` hooks（`after_create`、`before_run` 等）会在工作区目录执行任意 shell 命令。只使用来自你信任的来源的 hook 配置。
- `opencode run` worker 以 daemon 的 OS 权限执行。需要时通过 opencode 自身的审批/沙箱设置收紧。
- API token 从环境变量或被 gitignore 的 `.env` 文件读取，绝不写入日志。
