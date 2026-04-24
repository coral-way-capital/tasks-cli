import { listTasks } from "../lib/store";
import { buildDAG, getBlockedTasks, getReadyTasks } from "../lib/dag";
import { red, dim } from "../lib/format";

/**
 * Output the execution plan for the current tasks.
 * Default: JSON with wave structure for programmatic consumption.
 * --status: human-readable summary of blocked/ready tasks.
 * --bash: shell commands to execute each wave.
 */
export function run(args: string[]): void {
  const showStatus = args.includes("--status");
  const showBash = args.includes("--bash");
  const allFlag = args.includes("--all");

  const allTasks = listTasks().map((t) => t.task);

  if (allTasks.length === 0) {
    console.log("[]");
    return;
  }

  // Always build DAG with ALL tasks (including done) so dependency IDs resolve
  try {
    const result = buildDAG(allTasks);

    if (result.cycle) {
      console.error(red(`Dependency cycle detected: ${result.cycle.join(" → ")}`));
      process.exit(1);
    }

    // Filter waves: exclude done/cancelled tasks (unless --all)
    const activeIds = new Set(allFlag ? allTasks.map((t) => t.id) : allTasks.filter((t) => t.status !== "done" && t.status !== "cancelled").map((t) => t.id));
    const filteredWaves = result.waves!
      .map((w) => ({ ...w, taskIds: w.taskIds.filter((id) => activeIds.has(id)) }))
      .filter((w) => w.taskIds.length > 0);

    // Renumber waves after filtering
    filteredWaves.forEach((w, i) => (w.wave = i + 1));

    const activeTasks = allTasks.filter((t) => activeIds.has(t.id));

    if (filteredWaves.length === 0 && !showStatus) {
      console.log("[]");
      return;
    }

    if (showStatus) {
      outputStatus(allTasks, activeTasks);
    } else if (showBash) {
      outputBash(filteredWaves);
    } else {
      outputJSON(filteredWaves, activeTasks, allTasks);
    }
  } catch (e: any) {
    console.error(red(`Error: ${e.message}`));
    process.exit(1);
  }
}

function outputJSON(
  waves: { wave: number; taskIds: string[] }[],
  activeTasks: import("../types").Task[],
  allTasks: import("../types").Task[]
): void {
  const taskMap = new Map(allTasks.map((t) => [t.id, t]));

  const plan = {
    waves: waves.map((w) => ({
      wave: w.wave,
      tasks: w.taskIds.map((id) => {
        const t = taskMap.get(id)!;
        return {
          id: t.id,
          title: t.title,
          priority: t.priority,
          type: t.type,
          dependsOn: t.dependsOn,
        };
      }),
    })),
    blocked: getBlockedTasks(allTasks).filter((t) => t.status !== "done" && t.status !== "cancelled").map((t) => t.id),
    ready: getReadyTasks(allTasks).map((t) => t.id),
    totalWaves: waves.length,
    totalTasks: activeTasks.length,
  };

  console.log(JSON.stringify(plan, null, 2));
}

function outputStatus(allTasks: import("../types").Task[], activeTasks: import("../types").Task[]): void {
  const blocked = getBlockedTasks(allTasks).filter((t) => t.status !== "done" && t.status !== "cancelled");
  const ready = getReadyTasks(allTasks);
  const inProgress = activeTasks.filter(
    (t) => t.status === "in-progress" && !blocked.some((b) => b.id === t.id)
  );

  if (ready.length > 0) {
    console.log(`Ready to start (${ready.length}):`);
    for (const t of ready) {
      console.log(`  ${t.id} — ${t.title}`);
    }
  }

  if (inProgress.length > 0) {
    console.log(`\nIn progress (${inProgress.length}):`);
    for (const t of inProgress) {
      console.log(`  ${t.id} — ${t.title}`);
    }
  }

  if (blocked.length > 0) {
    console.log(`\nBlocked (${blocked.length}):`);
    for (const t of blocked) {
      const unmet = t.dependsOn.filter((d) => {
        const dep = allTasks.find((x) => x.id === d);
        return dep && dep.status !== "done";
      });
      console.log(`  ${t.id} — ${t.title} (waiting: ${unmet.join(", ")})`);
    }
  }

  if (ready.length === 0 && blocked.length === 0 && inProgress.length === 0) {
    console.log(dim("No active tasks."));
  }
}

function outputBash(waves: { wave: number; taskIds: string[] }[]): void {
  console.log("#!/bin/bash");
  console.log("# Auto-generated execution plan from 'tasks plan --bash'");
  console.log("# Run each wave in parallel, then proceed to the next wave.");
  console.log();

  for (const wave of waves) {
    const ids = wave.taskIds.join(" ");
    console.log(`# Wave ${wave.wave} (parallel)`);
    console.log(`echo \"=== Wave ${wave.wave} ===\"`);
    if (wave.taskIds.length === 1) {
      console.log(`task_work --task-ids ${ids}`);
    } else {
      console.log(`task_work --task-ids ${ids} --parallel`);
    }
    console.log();
  }
}
