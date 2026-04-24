import { generateId } from "../lib/id";
import { writeTask, ensureTaskDir, listTasks } from "../lib/store";
import { autoSyncTask } from "../lib/auto-sync";
import type { Task, TaskPriority, TaskType } from "../types";

const TEMPLATE_BODY = `## Description

## Files involved

## Acceptance criteria
`;

export function run(args: string[]): void {
  const title = args[0];
  if (!title) {
    console.error("Usage: tasks new <title> [--priority|-p <p0|p1|p2>] [--type|-t <bug|feat|refactor|test|docs>] [--body]");
    process.exit(1);
  }

  let priority: TaskPriority = "p1";
  let type: TaskType = "feat";
  let useStdinBody = false;
  const dependsOn: string[] = [];

  for (let i = 1; i < args.length; i++) {
    if ((args[i] === "--priority" || args[i] === "-p") && args[i + 1]) {
      priority = args[++i] as TaskPriority;
    } else if ((args[i] === "--type" || args[i] === "-t") && args[i + 1]) {
      type = args[++i] as TaskType;
    } else if (args[i] === "--depends-on" && args[i + 1]) {
      dependsOn.push(args[++i]);
    } else if (args[i] === "--body") {
      useStdinBody = true;
    }
  }

  const id = generateId();
  const now = new Date().toISOString();

  const task: Task = {
    id,
    title,
    status: "open",
    priority,
    type,
    dependsOn,
    created: now,
    updated: now,
  };

  // Validate dependency IDs exist
  if (dependsOn.length > 0) {
    const existing = new Set(listTasks().map((t) => t.task.id));
    const missing = dependsOn.filter((d) => !existing.has(d));
    if (missing.length > 0) {
      console.error(`Error: dependency task(s) not found: ${missing.join(", ")}`);
      process.exit(1);
    }

    // Check for self-dependency
    if (dependsOn.includes(id)) {
      console.error(`Error: task cannot depend on itself`);
      process.exit(1);
    }
  }

  ensureTaskDir();

  if (useStdinBody) {
    const chunks: Buffer[] = [];
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => chunks.push(Buffer.from(chunk)));
    process.stdin.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf-8").trimEnd();
      writeTask(task, body);
      console.log(`Created task ${id}: ${title}`);
      autoSyncTask(id);
    });
  } else {
    writeTask(task, TEMPLATE_BODY);
    console.log(`Created task ${id}: ${title}`);
    autoSyncTask(id);
  }
}
