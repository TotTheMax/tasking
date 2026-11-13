import type { Writable } from "node:stream";
import type { AvailableModelRef, OpencodeModelsProbe } from "../driver/opencode-models.js";
import { formatResolvedModel } from "../driver/session-ops.js";
import { translate } from "../translate/locale.js";
import type { PromptInterface } from "./prompts.js";
import type { createStyle } from "./style.js";

const MODEL_FOLLOW = "__follow__";
const MODEL_MANUAL = "__manual__";
const MODEL_LIST_LIMIT = 20;
const SEARCH_ATTEMPTS = 3;

function subsequenceMatch(query: string, target: string): boolean {
  let i = 0;
  for (const ch of target) {
    if (ch === query[i]) i++;
  }
  return i === query.length;
}

function modelOptionLabel(entry: AvailableModelRef): string {
  const base = `${entry.providerID}/${entry.id}`;
  return entry.free ? `${base}${translate("（免费）")}` : base;
}

function followDefaultLabel(probe: OpencodeModelsProbe): string {
  if (!probe.defaultModel) return translate("跟随服务端默认（由 opencode 服务端决定）");
  return translate(
    `跟随服务端默认（当前解析为 ${formatResolvedModel(probe.defaultModel)}，随目录更新可能变化）`,
  );
}

async function askManualModel(
  prompts: PromptInterface,
  output: Writable,
  style: ReturnType<typeof createStyle>,
): Promise<string | null> {
  for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt++) {
    const value = (await prompts.ask(translate("输入模型（provider/model，回车跳过）"))).trim();
    if (value === "") return null;
    if (value.includes("/")) return value;
    output.write(`${style.statusIcon("warn")} ${translate("格式应为 provider/model（含 /）")}\n`);
  }
  return null;
}

export async function selectModelSetting(
  prompts: PromptInterface,
  output: Writable,
  style: ReturnType<typeof createStyle>,
  probe: () => Promise<OpencodeModelsProbe>,
): Promise<string | null> {
  output.write(style.boxHeader(translate("opencode 模型")));
  const waitingHints = [
    translate("提示：模型格式是 provider/model，例如 zhipuai-coding-plan/glm-5.3"),
    translate("提示：不配置时 opencode 会用服务端默认模型，目录更新后可能变化"),
    translate("提示：选择会写入 WORKFLOW.md 的 opencode.model，之后随时可改"),
  ];
  let hintIndex = 0;
  let frame = 0;
  const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  const isTTY = Boolean((output as { isTTY?: boolean }).isTTY);
  const spinner = isTTY
    ? setInterval(() => {
        const spinning = spinnerFrames[frame % spinnerFrames.length] ?? "⠋";
        frame++;
        output.write(`\r\x1b[2K${spinning} ${waitingHints[hintIndex % waitingHints.length] ?? ""}`);
        if (frame % 8 === 0) hintIndex++;
      }, 250)
    : null;
  let info: OpencodeModelsProbe;
  try {
    if (!isTTY) {
      output.write(
        `${style.statusIcon("info")} ${translate("正在获取 opencode 可用模型（首次可能需要 10 秒左右）…")}\n`,
      );
      output.write(`${style.statusIcon("info")} ${waitingHints[0] ?? ""}\n`);
    }
    info = await probe();
  } finally {
    if (spinner !== null) clearInterval(spinner);
    if (isTTY) output.write("\r\x1b[2K");
  }

  if (info.status !== "ok") {
    const manual = await askManualModel(prompts, output, style);
    output.write(style.boxFooter());
    return manual;
  }

  const catalog = info.available ?? [];
  let candidates: AvailableModelRef[] = [];
  if (catalog.length > 0) {
    for (let attempt = 0; attempt < SEARCH_ATTEMPTS; attempt++) {
      const keyword = await prompts.ask(
        translate("模型搜索关键词（如 glm / claude / free，回车列出推荐）"),
      );
      const query = keyword.trim().toLowerCase();
      candidates = query
        ? catalog.filter((m) =>
            subsequenceMatch(query, `${m.providerID}/${m.id} ${m.name ?? ""}`.toLowerCase()),
          )
        : [...catalog]
            .sort((a, b) => (b.releasedMs ?? 0) - (a.releasedMs ?? 0))
            .slice(0, MODEL_LIST_LIMIT);
      if (candidates.length > 0) break;
      output.write(
        `${style.statusIcon("warn")} ${translate("没有匹配的模型——可换关键词重搜，或手动输入 provider/model")}\n`,
      );
    }
  }

  const options: Array<{ value: string; label: string }> = [
    { value: MODEL_FOLLOW, label: followDefaultLabel(info) },
    ...candidates.map((m) => ({ value: `${m.providerID}/${m.id}`, label: modelOptionLabel(m) })),
    { value: MODEL_MANUAL, label: translate("手动输入 provider/model") },
  ];
  const picked = await prompts.askSelect(translate("选择 opencode 模型"), options);
  if (picked === MODEL_FOLLOW) {
    output.write(style.boxFooter());
    return null;
  }
  if (picked === MODEL_MANUAL) {
    const manual = await askManualModel(prompts, output, style);
    output.write(style.boxFooter());
    return manual;
  }
  output.write(style.boxFooter());
  return picked;
}
