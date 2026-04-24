import { resolveId, updateFrontmatter, readTask, listTasks } from "../lib/store";
import { validateStatusTransition } from "../lib/dag";
import { autoSyncTask } from "../lib/auto-sync";
import type { TaskStatus } from "../types";

const VALID_STATUSES: TaskStatus[] = ["open", "in-progress", "done", "blocked", "cancelled"];

export function run(args: string[]): void {
  const partial = args[0];
  const newStatus = args[1];

  if (!partial || !newStatus) {
    console.error("Usage: tasks status <id> <status>");
    console.error(`Valid statuses: ${VALID_STATUSES.join(", ")}`);
    process.exit(1);
  }

  if (!VALID_STATUSES.includes(newStatus as TaskStatus)) {
    console.error(`Invalid status "${newStatus}". Valid: ${VALID_STATUSES.join(", ")}`);
    process.exit(1);
  }

  try {
    const id = resolveId(partial);
    const { task } = readTask(id);

    // Validate dependency constraints
    const allTasks = listTasks().map((t) => t.task);
    const error = validateStatusTransition(task, newStatus as TaskStatus, allTasks);
    if (error) {
      console.error(error);
      process.exit(1);
    }

    updateFrontmatter(id, { status: newStatus as TaskStatus });
    console.log(`Task ${id} → ${newStatus}`);
    autoSyncTask(id);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
}
