import { TaskingError } from "../shared/errors.js";
import type { EffectiveConfig } from "./config-types.js";

export interface ValidationResult {
  ok: boolean;
  errors: TaskingError[];
}

export function validateDispatchConfig(config: EffectiveConfig): ValidationResult {
  const errors: TaskingError[] = [];

  if (config.tracker.kind === "none") {
    errors.push(
      new TaskingError(
        "config_validation",
        "tracker.kind is none: structured dispatch is disabled (no Jira source)",
      ),
    );
    return { ok: false, errors };
  }

  if (config.tracker.kind === "") {
    errors.push(new TaskingError("config_validation", "tracker.kind is required for dispatch"));
  } else if (config.tracker.kind !== "jira") {
    errors.push(
      new TaskingError(
        "unsupported_tracker_kind",
        `unsupported tracker.kind: ${config.tracker.kind}`,
      ),
    );
  }

  if (config.tracker.kind === "jira") {
    if (!config.tracker.api_key) {
      errors.push(new TaskingError("missing_tracker_api_key", "tracker.api_key is required"));
    }
    if (!config.tracker.project_key && !config.tracker.project_slug) {
      errors.push(
        new TaskingError(
          "missing_tracker_project_slug",
          "tracker.project_key or tracker.project_slug is required",
        ),
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateTrackerlessConfig(config: EffectiveConfig): ValidationResult {
  const errors: TaskingError[] = [];

  if (!config.feishu.enabled) {
    errors.push(
      new TaskingError(
        "config_validation",
        "没有任何任务源：tracker.kind 为 none 且 feishu 未启用 — 没有可运行的任务面",
      ),
    );
    return { ok: false, errors };
  }

  if (!config.feishu.app_id) {
    errors.push(
      new TaskingError("feishu_missing_credentials", "feishu.app_id is required when enabled"),
    );
  }
  if (!config.feishu.app_secret) {
    errors.push(
      new TaskingError("feishu_missing_credentials", "feishu.app_secret is required when enabled"),
    );
  }
  if (!config.feishu.intake_chat_id) {
    errors.push(
      new TaskingError(
        "feishu_missing_credentials",
        "feishu.intake_chat_id is required when enabled (the group hosting issue threads)",
      ),
    );
  }
  if (!config.feishu.direct.enabled) {
    errors.push(
      new TaskingError(
        "config_validation",
        "无事可做：tracker.kind 为 none 时评论镜像无 Jira 可用，而 feishu.direct 又被关闭 — 请启用 direct 或配置 Jira 源",
      ),
    );
  }

  return { ok: errors.length === 0, errors };
}

export function validateStartupConfig(config: EffectiveConfig): ValidationResult {
  if (config.tracker.kind === "none") {
    return validateTrackerlessConfig(config);
  }

  const dispatch = validateDispatchConfig(config);
  if (!dispatch.ok) return dispatch;

  if (config.feishu.enabled) {
    const errors: TaskingError[] = [];
    if (!config.feishu.app_id) {
      errors.push(
        new TaskingError("feishu_missing_credentials", "feishu.app_id is required when enabled"),
      );
    }
    if (!config.feishu.app_secret) {
      errors.push(
        new TaskingError(
          "feishu_missing_credentials",
          "feishu.app_secret is required when enabled",
        ),
      );
    }
    if (!config.feishu.intake_chat_id) {
      errors.push(
        new TaskingError(
          "feishu_missing_credentials",
          "feishu.intake_chat_id is required when enabled (the group hosting issue threads)",
        ),
      );
    }
    if (!config.feishu.create_issue_type) {
      errors.push(
        new TaskingError(
          "feishu_missing_credentials",
          "feishu.create_issue_type is required when enabled (default issueType for /issue)",
        ),
      );
    }
    if (errors.length > 0) return { ok: false, errors };
  }

  return { ok: true, errors: [] };
}
