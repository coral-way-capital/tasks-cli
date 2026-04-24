import { resolveId, updateFrontmatter, readTask, listTasks } from "../lib/store";
import { getDirectDependents, getBlockedTasks, getReadyTasks } from "../lib/dag";
import { autoSyncTask } from "../lib/auto-sync";
import { green, dim, yellow } from "../lib/format";

export function run(args: string[]): void {
  const partial = args[0];
  if (!partial) {
    console.error("Usage: tasks done <id>");
    process.exit(1);
  }

  try {
    const id = resolveId(partial);
    updateFrontmatter(id, { status: "done" });
    console.log(`Task ${id} → done`);
    autoSyncTask(id);

    // Check if this unblocks any dependent tasks
    const allTasks = listTasks().map((t) => t.task);
    const justDone = readTask(id).task;
    const dependents = getDirectDependents(id, allTasks);

    if (dependents.length > 0) {
      const stillBlocked = getBlockedTasks(allTasks);
      const nowReady = dependents.filter(
        (d) => d.status !== "done" && d.status !== "cancelled" && !stillBlocked.some((b) => b.id === d.id)
      );

      if (nowReady.length > 0) {
        console.log();
        console.log(green("Unblocked:"));
        for (const t of nowReady) {
          console.log(green(`  ✓ ${t.id} — ${t.title}`));
        }
      }

      const stillBlockedDeps = dependents.filter((d) =>
        stillBlocked.some((b) => b.id === d.id)
      );
      if (stillBlockedDeps.length > 0) {
        console.log();
        console.log(dim("Still blocked:"));
        for (const t of stillBlockedDeps) {
          console.log(dim(`  ✗ ${t.id} — ${t.title}`));
        }
      }
    }
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
}
