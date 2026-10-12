## ADDED Requirements

### Requirement: TUI 配置视图

TUI SHALL 提供配置视图模式，按 `c` 从 overview 进入、按 `Esc`/`q` 返回 overview。配置视图 SHALL 展示 daemon 当前有效配置（EffectiveConfig，即原始 WORKFLOW.md 前文经默认值补齐、环境变量展开、路径解析后的实际运行值）与运行时属性：workflow 路径、pid、启动时长、workspace 根、tasking.log 路径、daemon host:port，以及 tracker / polling / agent / opencode / router / feishu / server / hooks / env 各配置分组。配置视图 SHALL 对密钥字段（tracker.api_key、feishu.app_secret、feishu.verification_token、feishu.encrypt_key、env 段值）脱敏显示 `****`（值为空时显示未配置）。进程内 TUI SHALL 从 ConfigManager 的当前配置实时取数，配置热重载后视图随之更新；附加 TUI（`tasking tui`）SHALL 经 `GET /api/v1/config` 拉取同一份脱敏数据。

#### Scenario: 进入配置视图
- **WHEN** 用户在 TUI overview 按 `c`
- **THEN** 渲染配置视图，显示运行时属性（workflow 路径、pid、启动时长、workspace 根、日志路径、host:port）与有效配置分组

#### Scenario: 密钥脱敏
- **WHEN** 配置中存在 tracker.api_key / feishu.app_secret / env 段密钥
- **THEN** 配置视图显示 `****` 而非明文

#### Scenario: 返回 overview
- **WHEN** 用户在配置视图按 `Esc` 或 `q`
- **THEN** 返回 overview 模式，daemon 不受影响

#### Scenario: 配置热重载实时反映
- **WHEN** daemon 运行中 WORKFLOW.md 被修改且重新加载成功
- **THEN** 配置视图随后刷新显示新配置

#### Scenario: 附加 TUI 经 HTTP 拉取配置
- **WHEN** `tasking tui` 附加到运行中 daemon 并按 `c`
- **THEN** 配置视图渲染 `GET /api/v1/config` 返回的脱敏配置与运行时属性
