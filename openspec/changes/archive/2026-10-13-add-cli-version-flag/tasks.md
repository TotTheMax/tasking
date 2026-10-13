## 1. 版本查询 flag

- [x] 1.1 实现顶层 `--version`（红→绿：先在 `tests/cli.test.ts` 写失败测试——`main(["node","tasking","--version"])` 返回 0 且 stdout 匹配 `/^\d+\.\d+\.\d+\n$/`，断言用独立 semver 正则、不复算 package.json；再新增 `src/cli/version.ts` 的 `readTaskingVersion()`（readFileSync + JSON.parse，失败返回 `unknown`）并在 `main()` 的 `--help` 分支旁加 `--version` 分支使测试通过）
- [x] 1.2 支持短形式 `-v`（红→绿：同上 seam 写 `main(["node","tasking","-v"])` 失败测试，随后在同一分支命中 `-v` 使其通过）
- [x] 1.3 帮助文本露出（红→绿：先写失败测试断言 `TOP_LEVEL_HELP` 的 Options 区含 `-v, --version` 行，再改 `help.ts` Options 区与 `-h, --help` 并列加一行）

## 2. doctor 版本行

- [x] 2.1 doctor 头部显示版本（红→绿：先在 `tests/doctor.test.ts` 写失败测试断言 `runDoctor` 输出含 `tasking \d+\.\d+\.\d+` 版本行，再在 `runDoctor` 开头 `out.write` 一行 `tasking ${readTaskingVersion()}` 使其通过）

## 3. 文档与门禁

- [x] 3.1 同步命令文档：`README.md` 与 `README.zh-CN.md` 命令表、`docs/en/usage.md` 与 `docs/zh/usage.md` 安装/命令区各加 `tasking --version` 一行说明
- [x] 3.2 跑全量门禁：`npm run lint`、`npm run typecheck`、`npm test`、`npm run build` 全绿后收尾
