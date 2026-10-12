## ADDED Requirements

### Requirement: 内存环形日志缓冲
系统 SHALL 提供 `LogRingBuffer` 类，实现 `(line: string) => void` sink 签名，在内存中保留最近 N 条（默认 200）结构化日志条目。buffer SHALL 解析 JSON 日志行为结构化条目 `{ ts, level, msg, fields }`；解析失败时 SHALL 存原始字符串并将 level 视为 `"info"`。buffer 满时 SHALL 覆盖最旧条目。

#### Scenario: 正常 JSON 日志行入缓冲
- **WHEN** sink 收到一条合法 JSON 日志行 `{"ts":"...","level":"warn","msg":"poll failed"}`
- **THEN** buffer 存储结构化条目 `{ ts, level: "warn", msg: "poll failed" }`

#### Scenario: 非法 JSON 行入缓冲
- **WHEN** sink 收到非 JSON 字符串 `some raw text`
- **THEN** buffer 存储条目 `{ ts: <当前时间>, level: "info", msg: "some raw text" }`

#### Scenario: buffer 满时覆盖
- **WHEN** buffer 容量为 200 且已有 200 条，再收到一条新日志
- **THEN** 最旧条目被覆盖，buffer 仍为 200 条，最新条目在末尾

#### Scenario: 读取最近 N 条
- **WHEN** 调用 `recent(6)` 且 buffer 有 50 条
- **THEN** 返回最近 6 条，按时间升序排列

#### Scenario: buffer 为空时读取
- **WHEN** 调用 `recent(6)` 且 buffer 无条目
- **THEN** 返回空数组

### Requirement: daemon 启动时注入 buffer sink
daemon SHALL 在创建 `ConsoleLogger` 时注入 `LogRingBuffer` 作为额外 sink，与 stderr sink 和文件 sink 并行工作。buffer sink SHALL NOT 受 `suppressStderr()` 影响。

#### Scenario: TUI 模式下 buffer 仍收到日志
- **WHEN** TUI 激活且 `suppressStderr()` 已调用
- **THEN** `LogRingBuffer` 仍收到所有日志条目

#### Scenario: 非 TUI 模式下 buffer 仍收到日志
- **WHEN** TUI 未激活
- **THEN** `LogRingBuffer` 仍收到所有日志条目（与 stderr/文件 sink 并行）
