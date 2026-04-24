import { listTasks } from "../lib/store";
import { buildDAG, getBlockedTasks, getReadyTasks } from "../lib/dag";
import {
  bold,
  dim,
  red,
  green,
  yellow,
  cyan,
  padRight,
  formatStatus,
  formatPriority,
} from "../lib/format";

export function run(args: string[]): void {
  const json = args.includes("--json");

  const allTasks = listTasks().map((t) => t.task);

  if (allTasks.length === 0) {
    console.log("No tasks found");
    return;
  }

  if (json) {
    outputJSON(allTasks);
    return;
  }

  outputText(allTasks);
}

function outputText(tasks: import("../types").Task[]): void {
  const idSet = new Set(tasks.map((t) => t.id));

  // Check for tasks with deps on non-existent tasks
  const brokenDeps = tasks.filter((t) =>
    t.dependsOn.some((d) => !idSet.has(d))
  );
  if (brokenDeps.length > 0) {
    console.log(red("⚠ Broken dependencies (missing task IDs):"));
    for (const t of brokenDeps) {
      const missing = t.dependsOn.filter((d) => !idSet.has(d));
      console.log(red(`  ${t.id} — ${t.title} → missing: ${missing.join(", ")}`));
    }
    console.log();
  }

  // Build DAG
  try {
    const result = buildDAG(tasks);

    if (result.cycle) {
      console.log(red("⚠ Dependency cycle detected:"));
      console.log(red(`  ${result.cycle.join(" → ")} → ...`));
      console.log();
      console.log("Cannot produce execution plan while cycle exists.");
      return;
    }

    // Filter waves to exclude done/cancelled tasks
    const activeIds = new Set(tasks.filter((t) => t.status !== "done" && t.status !== "cancelled").map((t) => t.id));
    const filteredWaves = result.waves!
      .map((w) => ({ ...w, taskIds: w.taskIds.filter((id) => activeIds.has(id)) }))
      .filter((w) => w.taskIds.length > 0);
    filteredWaves.forEach((w, i) => (w.wave = i + 1));

    // Show execution waves
    console.log(bold("Execution Plan (parallel waves):"));
    console.log();

    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    for (const wave of filteredWaves) {
      console.log(`${bold(cyan(`Wave ${wave.wave}`))}:`);
      for (const id of wave.taskIds) {
        const task = taskMap.get(id)!;
        const deps = task.dependsOn.length > 0 ? ` (after: ${task.dependsOn.join(", ")})` : "";
        console.log(
          `  ${padRight(id, 10)} ${formatPriority(task.priority)} ${padRight(task.type, 10)} ${task.title}${dim(deps)}`
        );
      }
      if (wave.wave < filteredWaves.length) {
        console.log(dim("  ─────────────────────────────────────"));
      }
      console.log();
    }
  } catch (e: any) {
    console.log(red(`Error: ${e.message}`));
    return;
  }

  // Show blocked/ready summary
  const blocked = getBlockedTasks(tasks);
  const ready = getReadyTasks(tasks);

  if (blocked.length > 0) {
    console.log(red(`Blocked (${blocked.length}):`));
    for (const t of blocked) {
      const unmet = t.dependsOn.filter((d) => {
        const dep = tasks.find((x) => x.id === d);
        return dep && dep.status !== "done";
      });
      console.log(red(`  ✗ ${t.id} — ${t.title} (waiting on: ${unmet.join(", ")})`));
    }
    console.log();
  }

  if (ready.length > 0) {
    console.log(green(`Ready (${ready.length}):`));
    for (const t of ready) {
      console.log(green(`  ✓ ${t.id} — ${t.title}`));
    }
    console.log();
  }
}

function outputJSON(tasks: import("../types").Task[]): void {
  const idSet = new Set(tasks.map((t) => t.id));
  const brokenDeps = tasks.filter((t) =>
    t.dependsOn.some((d) => !idSet.has(d))
  );

  let dagResult: { waves: { wave: number; taskIds: string[] }[] | null; cycle: string[] | null };
  let errorMsg: string | null = null;

  try {
    dagResult = buildDAG(tasks);
  } catch (e: any) {
    dagResult = { waves: null, cycle: null };
    errorMsg = e.message;
  }

  const output = {
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      type: t.type,
      dependsOn: t.dependsOn,
    })),
    brokenDependencies: brokenDeps.map((t) => ({
      taskId: t.id,
      missingDeps: t.dependsOn.filter((d) => !idSet.has(d)),
    })),
    executionPlan: dagResult.waves
      ? { waves: dagResult.waves, cycle: null }
      : { waves: null, cycle: dagResult.cycle },
    error: errorMsg,
    blocked: getBlockedTasks(tasks).map((t) => t.id),
    ready: getReadyTasks(tasks).map((t) => t.id),
  };

  console.log(JSON.stringify(output, null, 2));
}
