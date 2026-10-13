interface CommandHelp {
  name: string;
  description: string;
  usage: string;
  args?: string[];
  options: Array<{ flags: string; description: string }>;
  notes?: string[];
}

const COMMANDS: CommandHelp[] = [
  {
    name: "init",
    description: "Generate a WORKFLOW.md and install tasking skills",
    usage:
      "tasking init [workflow-path] [--force] [--non-interactive] [--workflow <name>] [--lang <zh|en>] [--update | --restore]",
    args: ["workflow-path   Path to WORKFLOW.md (default: ./WORKFLOW.md)"],
    options: [
      { flags: "--force", description: "Overwrite an existing WORKFLOW.md" },
      {
        flags: "--non-interactive",
        description: "Skip interactive prompts (auto when stdin is not a TTY)",
      },
      {
        flags: "--workflow <name>",
        description:
          "Workflow variant: minimal | code-mr | grill-openspec | feishu-direct (default: feishu-direct; --update uses it to select the drift-report template)",
      },
      {
        flags: "--lang <zh|en>",
        description:
          "Template language for WORKFLOW.md comments/guidance AND the interface_language seed (en writes interface_language: en; zh omits it): zh | en (default: zh; interactive init prompts when omitted; --update uses it to select the drift-report template)",
      },
      {
        flags: "--update",
        description:
          "Re-sync tasking skills (modified files backed up as <file>.bak) and report WORKFLOW.md drift vs a fresh init today (missing config fields + prompt body diff)",
      },
      { flags: "--restore", description: "Restore .bak skill backups from the last --update" },
    ],
    notes: [
      "Workflow variants: minimal (workspace task → Jira, no MR); code-mr (write code + create a merge request);",
      "  grill-openspec (grill → propose → implement → archive); feishu-direct (Feishu direct sessions only, no Jira source; the default).",
      "--force, --update, and --restore are mutually exclusive.",
    ],
  },
  {
    name: "start",
    description: "Start the daemon and begin polling and dispatching tasks",
    usage: "tasking start [workflow-path] [options]",
    args: ["workflow-path   Path to WORKFLOW.md (default: ./WORKFLOW.md)"],
    options: [
      {
        flags: "-p, --port <n>",
        description: "Enable the HTTP dashboard on the given port (0 = ephemeral)",
      },
      {
        flags: "--tui",
        description: "Run with the in-process terminal dashboard (default: false)",
      },
      { flags: "--detach", description: "Run the daemon in the background (default: false)" },
      {
        flags: "--fresh",
        description:
          "Start as if on a new machine: drop the local intake cursor and reconcile stale bindings against Jira, so the offline window's history is not replayed (Feishu bridge only; default: false)",
      },
    ],
    notes: ["--detach and --tui are mutually exclusive."],
  },
  {
    name: "status",
    description: "Show a snapshot of the running daemon",
    usage: "tasking status [options]",
    options: [
      {
        flags: "--json",
        description: "Print the raw API JSON (for piping to jq) (default: false)",
      },
    ],
  },
  {
    name: "logs",
    description: "Print recent daemon logs",
    usage: "tasking logs [options]",
    options: [
      { flags: "-n, --lines <n>", description: "Print the last N lines (default: 100)" },
      {
        flags: "-f, --follow",
        description: "Keep printing new log lines until SIGINT (default: false)",
      },
      { flags: "--level <level>", description: "Filter by level: debug | info | warn | error" },
    ],
  },
  {
    name: "stop",
    description: "Stop the running daemon",
    usage: "tasking stop",
    options: [],
  },
  {
    name: "tui",
    description: "Attach a terminal dashboard to the running daemon",
    usage: "tasking tui [options]",
    options: [
      {
        flags: "-p, --port <n>",
        description: "Dashboard port to connect to (daemon.json port, else 8080)",
      },
    ],
  },
  {
    name: "doctor",
    description: "Run a read-only health check (WORKFLOW.md, Feishu, Jira, opencode)",
    usage: "tasking doctor [workflow-path]",
    args: ["workflow-path   Path to WORKFLOW.md (default: ./WORKFLOW.md)"],
    options: [],
    notes: [
      "Checks WORKFLOW.md parsing, Feishu credentials + scopes + intake chat reachability,",
      "the Jira connection (when configured), and opencode on PATH. Read-only; exit 0 when",
      "all checks pass, 1 when any check fails. Chinese output.",
    ],
  },
];

const COMMAND_NAME_WIDTH = 10;

function renderCommand(cmd: CommandHelp): string {
  const lines: string[] = [];
  lines.push(`tasking ${cmd.name} - ${cmd.description}`);
  lines.push("");
  lines.push("Usage:");
  lines.push(`  ${cmd.usage}`);
  if (cmd.args && cmd.args.length > 0) {
    lines.push("");
    lines.push("Arguments:");
    for (const arg of cmd.args) {
      lines.push(`  ${arg}`);
    }
  }
  lines.push("");
  lines.push("Options:");
  for (const opt of cmd.options) {
    lines.push(`  ${opt.flags.padEnd(22)} ${opt.description}`);
  }
  lines.push(`  ${"-h, --help".padEnd(22)} Show help`);
  if (cmd.notes && cmd.notes.length > 0) {
    lines.push("");
    for (const note of cmd.notes) {
      lines.push(note);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export const TOP_LEVEL_HELP = `tasking - orchestrate opencode coding-agent work from Jira and Feishu

Usage:
  tasking <command> [options]

Commands:
${COMMANDS.map((cmd) => `  ${cmd.name.padEnd(COMMAND_NAME_WIDTH)} ${cmd.description}`).join("\n")}

Options:
  -h, --help     Show help
  -v, --version  Print the installed version

Run 'tasking <command> --help' for command-specific options.
`;

export function subcommandHelp(name: string): string | undefined {
  const cmd = COMMANDS.find((c) => c.name === name);
  return cmd ? renderCommand(cmd) : undefined;
}
