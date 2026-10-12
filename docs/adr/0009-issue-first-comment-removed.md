# 移除 /issue 建 issue 后的首条 comment

TAS-4（ux-polish-collection）曾设计：`executeIssue` 建 issue 成功后把原始消息（标题+多行描述）作为带 sentinel 的首条 comment 写入。用户在 `docs/known-issues.md` 反馈该 comment 与 issue 的 summary/description 字段完全重复、多余。决定：删除该 postComment 行为，新建 issue 不再生成首条 comment。

理由：issue 的 summary 已承载标题、description 字段已承载多行描述（v2 字符串 / v3 ADF 段落），首条 comment 无新增信息；桥接防环（`forwardComments` 按 sentinel 跳过）与 binding 生命周期（由飞书 ack 的 `replyInThread` 建立）均不依赖它，删除不影响桥接正确性。既有历史 issue 上的首条 comment 保留不动。将来如有人按旧 spec 重加，本 ADR 为其依据。
