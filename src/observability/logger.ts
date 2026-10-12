import { existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  task_id?: string;
  task_identifier?: string;
  session_id?: string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
  suppressStderr(): void;
}

export interface FileSinkOptions {
  path: string;
  maxBytes: number;
  maxFiles: number;
}

class RotatingFileSink {
  private readonly opts: FileSinkOptions;
  private bytesWritten = 0;

  constructor(opts: FileSinkOptions) {
    this.opts = opts;
    const dir = dirname(resolve(opts.path));
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    try {
      const stat = statSync(opts.path);
      this.bytesWritten = stat.size;
    } catch {
      // file doesn't exist yet
    }
  }

  write(line: string): void {
    const data = `${line}\n`;
    const bytes = Buffer.byteLength(data);
    try {
      if (this.bytesWritten + bytes > this.opts.maxBytes) {
        this.rotate();
      }
      writeFileSync(this.opts.path, data, { flag: "a" });
      this.bytesWritten += bytes;
    } catch {
      // best-effort; don't crash daemon on file write failure
    }
  }

  private rotate(): void {
    for (let i = this.opts.maxFiles - 1; i > 0; i--) {
      const from = `${this.opts.path}.${i}`;
      const to = `${this.opts.path}.${i + 1}`;
      if (existsSync(from)) renameSync(from, to);
    }
    if (existsSync(this.opts.path)) {
      renameSync(this.opts.path, `${this.opts.path}.1`);
    }
    this.bytesWritten = 0;
  }
}

export class ConsoleLogger implements Logger {
  private readonly baseFields: LogFields;
  private readonly sinks: ((line: string) => void)[];
  private stderrSuppressed = false;

  constructor(baseFields: LogFields = {}, sink?: (line: string) => void) {
    this.baseFields = baseFields;
    if (sink) {
      this.sinks = [sink];
    } else {
      this.sinks = [this.makeStderrSink()];
    }
  }

  static withFileSink(
    baseFields: LogFields,
    fileOpts: FileSinkOptions,
    stderrSink?: (line: string) => void,
  ): ConsoleLogger {
    const fileSink = new RotatingFileSink(fileOpts);
    const logger = new ConsoleLogger(baseFields);
    logger.sinks.length = 0;
    logger.sinks.push(logger.makeStderrSink(stderrSink));
    logger.sinks.push((line: string) => fileSink.write(line));
    return logger;
  }

  private makeStderrSink(custom?: (line: string) => void): (line: string) => void {
    const sink = custom ?? ((line: string) => console.error(line));
    return (line: string) => {
      if (!this.stderrSuppressed) sink(line);
    };
  }

  suppressStderr(): void {
    this.stderrSuppressed = true;
  }

  addSink(sink: (line: string) => void): void {
    this.sinks.push(sink);
  }

  private emit(level: LogLevel, message: string, fields?: LogFields): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg: message,
      ...this.baseFields,
      ...fields,
    };
    const line = JSON.stringify(entry);
    for (const sink of this.sinks) {
      sink(line);
    }
  }

  debug(message: string, fields?: LogFields): void {
    this.emit("debug", message, fields);
  }

  info(message: string, fields?: LogFields): void {
    this.emit("info", message, fields);
  }

  warn(message: string, fields?: LogFields): void {
    this.emit("warn", message, fields);
  }

  error(message: string, fields?: LogFields): void {
    this.emit("error", message, fields);
  }

  child(fields: LogFields): Logger {
    const child = new ConsoleLogger({ ...this.baseFields, ...fields });
    child.sinks.length = 0;
    child.sinks.push(...this.sinks);
    if (this.stderrSuppressed) child.stderrSuppressed = true;
    return child;
  }
}
