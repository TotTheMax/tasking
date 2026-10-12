import * as readline from "node:readline/promises";
import type { Readable, Writable } from "node:stream";
import { translate } from "../translate/locale.js";
import type { Style } from "./style.js";

export interface SelectOption<T> {
  value: T;
  label: string;
}

export interface PromptInterface {
  ask(question: string, defaultValue?: string): Promise<string>;
  askSelect<T>(question: string, options: ReadonlyArray<SelectOption<T>>): Promise<T>;
  close(): void;
}

export function createPromptInterface(
  input: Readable,
  output: Writable,
  style: Style,
): PromptInterface {
  const rl = readline.createInterface({ input, output, terminal: false });

  return {
    async ask(question: string, defaultValue?: string): Promise<string> {
      const suffix = defaultValue ? ` [${defaultValue}]` : "";
      const answer = await rl.question(`${style.boxPrefix()}${style.bold(question)}${suffix}: `);
      return answer.trim() || (defaultValue ?? "");
    },

    async askSelect<T>(question: string, options: ReadonlyArray<SelectOption<T>>): Promise<T> {
      const prefix = style.boxPrefix();
      const opts = options.map((o, i) => `${prefix}  ${i + 1}. ${translate(o.label)}`).join("\n");
      const answer = await rl.question(
        `${prefix}${style.bold(question)}\n${opts}\n${prefix}Choice [1]: `,
      );
      const chosen = options[Number.parseInt(answer.trim() || "1", 10) - 1] ?? options[0];
      if (chosen === undefined) {
        throw new Error("askSelect requires at least one option");
      }
      return chosen.value;
    },

    close(): void {
      rl.close();
    },
  };
}
