import { resolveId, readTask, listTasks } from "../lib/store";
import { bold, cyan, dim, yellow } from "../lib/format";

export function run(args: string[]): void {
  const partial = args[0];
  if (!partial) {
    console.error("Usage: tasks show <id>");
    process.exit(1);
  }

  try {
    const id = resolveId(partial);
    const { task, body } = readTask(id);

    console.log(bold(cyan(`Task ${task.id}`)));
    console.log(`  Title:    ${task.title}`);
    console.log(`  Status:   ${task.status}`);
    console.log(`  Priority: ${task.priority}`);
    console.log(`  Type:     ${task.type}`);
    console.log(`  Created:  ${task.created}`);
    console.log(`  Updated:  ${task.updated}`);
    if (task.dependsOn.length > 0) {
      console.log(`  Deps:     ${task.dependsOn.join(", ")}`);
    }

    // Show direct dependents
    const dependents = listTasks()
      .filter((t) => t.task.dependsOn.includes(task.id))
      .map((t) => t.task);
    if (dependents.length > 0) {
      console.log(`  Blocks:   ${dependents.map((t) => `${t.id} (${t.title})`).join(", ")}`);
    }

    console.log();
    if (body.trim()) {
      console.log(body);
    }
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
}
