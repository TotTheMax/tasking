## MODIFIED Requirements

### Requirement: 内存状态与重启恢复
调度器状态(running、claimed、retry_attempts)SHALL 仅存于内存,重启时 SHALL NOT 从持久存储恢复。恢复 SHALL 由 tracker 驱动(重新轮询活跃任务、复用已保留工作区、运行启动 terminal 清理)。retry timer SHALL NOT 跨重启存活。daemon 启动时 SHALL 先执行在飞会话清扫（见 opencode-v2-driver 的"daemon 重启清扫在飞会话"）再进入正常轮询。停滞检测 SHALL 感知任务的等待审批状态——等待审批期间 SHALL NOT 判为停滞。

#### Scenario: 重启后从 tracker 重新派发
- **WHEN** daemon 重启且先前运行的任务在 tracker 中仍活跃
- **THEN** 在飞会话先被清扫，随后通过轮询重新发现这些任务并作为新 attempt 重新派发

#### Scenario: retry timer 不跨重启存活
- **WHEN** daemon 重启
- **THEN** 前一进程的 retry timer 不再活跃

#### Scenario: 等待审批不判停滞
- **WHEN** 任务处于等待审批状态超过 `stall_timeout_ms`
- **THEN** 停滞检测跳过该任务，不触发清理
