## MODIFIED Requirements

### Requirement: 安全不变式——工作区路径位于 root 内
管理器 SHALL 将工作区路径与工作区 root 都通过 `realpathSync`(或等价方法)解析为真实路径(解析符号链接后),并 SHALL 要求工作区路径的真实路径以工作区 root 的真实路径为前缀目录。任何经符号链接逃出 root 的路径 SHALL 被拒绝。路径不存在时 SHALL 回退到 `path.resolve` 规范化(不解析 symlink)并接受校验。

#### Scenario: root 内路径被接受
- **WHEN** 工作区路径位于配置 root 内(无 symlink)
- **THEN** 接受

#### Scenario: 路径逃逸被拒绝
- **WHEN** 计算所得工作区路径会逃出工作区 root(如经 `..` 遍历)
- **THEN** 拒绝

#### Scenario: symlink 逃逸被拒绝
- **WHEN** 工作区路径含指向 root 外的符号链接
- **THEN** 解析真实路径后拒绝

#### Scenario: 不存在的路径回退
- **WHEN** 工作区路径尚不存在(首次创建前)
- **THEN** 回退到 `path.resolve` 规范化,不因 `realpathSync` 异常而失败
