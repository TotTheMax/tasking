export interface InfoCardButton {
  label: string;
  action?: string;
  url?: string;
  value?: Record<string, unknown>;
  type?: "default" | "primary" | "danger";
}

export interface CardActionReply {
  toast: { type: "info" | "success" | "error" | "warning"; content: string };
  card?: unknown;
}

export interface InfoCardInput {
  title: string;
  lines: string[];
  buttons?: InfoCardButton[];
  rootId?: string;
  kind?: string;
  template?: string;
}

let infoCardRenderSeq = 0;

export function buildInfoCard(input: InfoCardInput): unknown {
  const renderSeq = ++infoCardRenderSeq;
  const elements: Array<Record<string, unknown>> = [];
  const content = input.lines.filter((line) => line.trim() !== "").join("\n");
  if (content !== "") elements.push({ tag: "markdown", content });
  for (const button of input.buttons ?? []) {
    elements.push({
      tag: "button",
      text: { tag: "plain_text", content: button.label },
      type: button.type ?? "default",
      size: "medium",
      behaviors: [
        button.url !== undefined
          ? {
              type: "open_url",
              default_url: button.url,
              pc_url: button.url,
              ios_url: button.url,
              android_url: button.url,
            }
          : {
              type: "callback",
              value: {
                action: button.action ?? "",
                root_id: input.rootId ?? "",
                ...(input.kind === undefined ? {} : { kind: input.kind }),
                ...(button.value ?? {}),
                seq: renderSeq,
              },
            },
      ],
    });
  }
  return {
    schema: "2.0",
    config: { update_multi: true },
    header: {
      template: input.template ?? "blue",
      title: { tag: "plain_text", content: input.title },
    },
    body: { elements },
  };
}
