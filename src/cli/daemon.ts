import type { ConfigManager } from "../config/manager.js";
import { validateStartupConfig } from "../config/validator.js";
import type { Logger } from "../observability/logger.js";
import { TaskingError, toTaskingError } from "../shared/errors.js";

export interface DaemonOptions {
  configManager: ConfigManager;
  logger: Logger;
  onTick?: (ctx: TickContext) => Promise<void>;
}

export interface TickContext {
  config: ConfigManager;
  logger: Logger;
}

export class Daemon {
  private configManager: ConfigManager;
  private readonly logger: Logger;
  private readonly onTick?: (ctx: TickContext) => Promise<void>;
  private running = false;
  private tickTimer: NodeJS.Timeout | null = null;

  constructor(opts: DaemonOptions) {
    this.configManager = opts.configManager;
    this.logger = opts.logger;
    this.onTick = opts.onTick;
  }

  get config(): ConfigManager {
    return this.configManager;
  }

  async start(): Promise<number> {
    const startup = validateStartupConfig(this.configManager.current);
    if (!startup.ok) {
      for (const e of startup.errors) {
        this.logger.error("startup validation failed", {
          category: e.category,
          message: e.message,
        });
      }
      return 1;
    }

    this.configManager.startWatch();
    this.configManager.onReload((result) => {
      if (result.error) {
        this.logger.error("workflow reload failed, keeping last good config", {
          category: result.error.category,
          message: result.error.message,
        });
      } else {
        this.logger.info("workflow reloaded");
      }
    });

    this.running = true;
    this.logger.info("daemon started", { workflow: this.configManager.workflowPath });

    this.scheduleTick(0);
    return 0;
  }

  private scheduleTick(delayMs: number): void {
    if (!this.running) return;
    this.tickTimer = setTimeout(() => {
      this.runTick().finally(() => {
        if (this.running) {
          this.scheduleTick(this.configManager.current.polling.interval_ms);
        }
      });
    }, delayMs);
  }

  private async runTick(): Promise<void> {
    if (this.onTick) {
      try {
        await this.onTick({ config: this.configManager, logger: this.logger });
      } catch (e) {
        this.logger.error("tick failed", { error: toTaskingError(e).message });
      }
    }
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.tickTimer) {
      clearTimeout(this.tickTimer);
      this.tickTimer = null;
    }
    this.configManager.stopWatch();
    this.logger.info("daemon stopped");
  }
}

export { TaskingError };
