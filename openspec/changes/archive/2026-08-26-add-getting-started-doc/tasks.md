# Tasks

## 1. 文档内链完整性测试（TDD）

- [x] 1.1 写失败测试 `tests/docs-links.test.ts`：扫描 `docs/**/*.md` 与根 `README.md`、`CONTEXT.md`，解析本地相对 markdown 链接（`./` 或 `../` 起始，排除 `http(s)`、纯锚点 `#`、mailto、裸 URL），断言每个目标文件存在；并断言 `docs/getting-started.md` 存在。运行确认红（`getting-started.md` 尚不存在）。
- [x] 1.2 若 1.1 运行暴露既有文档断链（与新增文档无关），作为文档卫生修复之，记录修复处。（修复：根 `README.md` 的 `openspec/changes/bootstrap-tasking-runtime/design.md` 指向其归档路径 `openspec/changes/archive/2026-06-23-bootstrap-tasking-runtime/design.md`。）

## 2. 快速上手指南（doc，非 TDD；使 1.1 转绿）

- [x] 2.1 写 `docs/getting-started.md` 主线：安装（`npm i -g tasking` / `npx`）→准备 Jira API token→`tasking init`→最小 `WORKFLOW.md`（`tracker` 块：`endpoint`/`api_key`/`api_user`/`project_key`，`$VAR` 间接引用）→`tasking start`→启动后验证清单；关键命令/配置内联可复制，深度细节深链 `usage.md`/`configuration.md`。
- [x] 2.2 写「可选：接飞书 IM」节：建自建应用→开机器人能力→授权 scope（`im:message.group_msg`/`im:chat:readonly`/`im:message:send_as_bot`）→发布版本并审批→建 intake 群拉机器人入群→取 `chat_id`（token + `GET /im/v1/chats`）→配 `feishu:` 块→验证清单（`/help`、`/issue`、`/state`）；深链 `feishu-quickstart.md` 手把手细节。

## 3. 索引与可发现性

- [x] 3.1 `docs/README.md`：文档索引表新增 `getting-started.md` 一行；「快速导航」首条置顶「新用户优先看 [快速上手](./getting-started.md)」（原首条 `usage.md` 的「安装」节降为次条）。
- [x] 3.2 根 `README.md`：Quick start 末尾加一行指向 `docs/getting-started.md`，不改现有英文内容。

## 4. 验证

- [x] 4.1 运行 `tests/docs-links.test.ts` 见绿：`docs/getting-started.md` 存在且全部本地相对链接解析。
- [x] 4.2 `npm run lint && npm run typecheck && npm test` 全绿。
