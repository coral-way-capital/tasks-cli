#!/usr/bin/env bun

const COMMANDS: Record<string, (args: string[]) => void> = {};

function register(name: string, handler: (args: string[]) => void) {
  COMMANDS[name] = handler;
}

function printUsage(): void {
  console.log(`tasks — task spec manager

Usage:
  tasks <command> [arguments]

Commands:
  new <title>    Create a task       [-p|--priority p0|p1|p2] [-t|--type bug|feat|refactor|test|docs]
                                    [--depends-on <id>] [--body]
  list           List tasks          [--all] [--status <s>] [--priority <p>] [--type <t>]
  show <id>      Show task detail    (partial ID, min 4 chars)
  graph          Show dependency graph & execution plan [--json]
  plan           Execution plan      [--json] [--status] [--bash] [--all]
  status <id>    Update status       <open|in-progress|done|blocked|cancelled>
  done <id>      Mark task done
  edit <id>      Edit task           [--body] (reads from stdin with --body)
  github         GitHub integration  [enable|disable|status]
  sync           Sync with GitHub    [push|pull|check] [--task <id>]
  pr             PR integration      [link|list|status]
  help           Show this help

Options:
  --help, -h     Show help for a command`);
}

// Lazy-load commands
register("new", (args) => require("./commands/new").run(args));
register("list", (args) => require("./commands/list").run(args));
register("show", (args) => require("./commands/show").run(args));
register("graph", (args) => require("./commands/graph").run(args));
register("plan", (args) => require("./commands/plan").run(args));
register("status", (args) => require("./commands/status").run(args));
register("done", (args) => require("./commands/done").run(args));
register("edit", (args) => require("./commands/edit").run(args));
register("github", (args) => require("./commands/github").run(args));
register("sync", (args) => require("./commands/sync").run(args));
register("pr", (args) => require("./commands/pr").run(args));
register("help", () => printUsage());

const argv = process.argv.slice(2);

if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
  printUsage();
  process.exit(0);
}

const command = argv[0];
const args = argv.slice(1);

if (COMMANDS[command]) {
  COMMANDS[command](args);
} else {
  console.error(`Unknown command: ${command}`);
  printUsage();
  process.exit(1);
}

export { COMMANDS, printUsage };
