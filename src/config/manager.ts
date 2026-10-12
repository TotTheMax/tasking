import { type FSWatcher, watch } from "node:fs";
import { dirname } from "node:path";
import { type TaskingError, toTaskingError } from "../shared/errors.js";
import type { WorkflowDefinition } from "../shared/types.js";
import type { EffectiveConfig } from "./config-types.js";
import { loadWorkflowFile } from "./loader.js";
import { resolveConfig } from "./resolver.js";

export interface ConfigReloadResult {
  config: EffectiveConfig;
  workflow: WorkflowDefinition;
  error: TaskingError | null;
  warnings: string[];
}

export class ConfigManager {
  private workflow: WorkflowDefinition;
  private config: EffectiveConfig;
  private configWarnings: string[] = [];
  private watcher: FSWatcher | null = null;
  private reloadListeners: Array<(result: ConfigReloadResult) => void> = [];
  private reloadTimer: NodeJS.Timeout | null = null;
  private readonly startupTrackerKind: string;

  constructor(workflow: WorkflowDefinition) {
    this.workflow = workflow;
    const built = this.buildConfig(workflow);
    this.config = built.config;
    this.configWarnings = built.warnings;
    this.startupTrackerKind = this.config.tracker.kind;
  }

  static fromFile(path: string): ConfigManager {
    const workflow = loadWorkflowFile(path);
    return new ConfigManager(workflow);
  }

  get current(): EffectiveConfig {
    return this.config;
  }

  get warnings(): string[] {
    return this.configWarnings;
  }

  get workflowPath(): string {
    return this.workflow.path;
  }

  get workflowDir(): string {
    return dirname(this.workflow.path);
  }

  private buildConfig(workflow: WorkflowDefinition): {
    config: EffectiveConfig;
    warnings: string[];
  } {
    const warnings: string[] = [];
    const config = resolveConfig(
      workflow.config,
      this.workflowDir,
      workflow.prompt_template,
      (message) => warnings.push(message),
    );
    return { config, warnings };
  }

  startWatch(): void {
    if (this.watcher) return;
    try {
      this.watcher = watch(this.workflow.path, () => {
        this.scheduleReload();
      });
    } catch {
      // Watch failed to arm: hot reload is unavailable for this process.
      // There is no dispatch-time fallback; a restart is required.
    }
  }

  stopWatch(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer);
      this.reloadTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  onReload(cb: (result: ConfigReloadResult) => void): void {
    this.reloadListeners.push(cb);
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reload();
    }, 100);
  }

  reload(): ConfigReloadResult {
    try {
      const workflow = loadWorkflowFile(this.workflow.path);
      const built = this.buildConfig(workflow);
      this.workflow = workflow;
      this.config = built.config;
      this.configWarnings = built.warnings;
      if (built.config.tracker.kind !== this.startupTrackerKind) {
        const warn = `任务源变更需重启生效：tracker.kind 启动时为 ${this.startupTrackerKind}，现为 ${built.config.tracker.kind}（运行时装配不随热重载重建）`;
        this.configWarnings = [...built.warnings, warn];
      }
      const result: ConfigReloadResult = {
        config: built.config,
        workflow,
        error: null,
        warnings: this.configWarnings,
      };
      for (const cb of this.reloadListeners) cb(result);
      return result;
    } catch (e) {
      const err = toTaskingError(e);
      const result: ConfigReloadResult = {
        config: this.config,
        workflow: this.workflow,
        error: err,
        warnings: [],
      };
      for (const cb of this.reloadListeners) cb(result);
      return result;
    }
  }
}
