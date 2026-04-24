import type { Task } from "../types";

/**
 * Represents one wave of tasks that can execute in parallel.
 * Each wave contains task IDs whose dependencies are all satisfied.
 */
export interface ExecutionWave {
  wave: number;
  taskIds: string[];
}

/**
 * Result of topological sort with cycle detection.
 */
export interface DAGResult {
  /** Execution waves (parallel groups in dependency order). null if cycle detected. */
  waves: ExecutionWave[] | null;
  /** The IDs forming a cycle, if one exists. */
  cycle: string[] | null;
}

/**
 * Build a DAG result from a list of tasks.
 * - Validates that all dependency IDs reference existing tasks.
 * - Detects cycles.
 * - Produces execution waves via topological sort.
 */
export function buildDAG(tasks: Task[]): DAGResult {
  const idSet = new Set(tasks.map((t) => t.id));

  // Validate all deps exist
  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      if (!idSet.has(dep)) {
        throw new Error(
          `Task ${task.id} depends on ${dep}, which does not exist`
        );
      }
    }
  }

  // Kahn's algorithm for topological sort + cycle detection
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dep → [tasks that depend on it]

  for (const task of tasks) {
    if (!inDegree.has(task.id)) inDegree.set(task.id, 0);
    if (!dependents.has(task.id)) dependents.set(task.id, []);
  }

  for (const task of tasks) {
    for (const dep of task.dependsOn) {
      inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      dependents.get(dep)!.push(task.id);
    }
  }

  // Start with nodes that have no dependencies
  let queue: string[] = tasks
    .filter((t) => (inDegree.get(t.id) ?? 0) === 0)
    .map((t) => t.id);

  const waves: ExecutionWave[] = [];
  let waveNum = 0;
  let processed = 0;

  while (queue.length > 0) {
    waveNum++;
    waves.push({ wave: waveNum, taskIds: [...queue] });
    processed += queue.length;

    const nextQueue: string[] = [];
    for (const id of queue) {
      for (const child of dependents.get(id) ?? []) {
        const newDegree = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, newDegree);
        if (newDegree === 0) {
          nextQueue.push(child);
        }
      }
    }
    queue = nextQueue;
  }

  // Cycle detected if not all nodes processed
  if (processed < tasks.length) {
    const cycleIds = tasks
      .filter((t) => (inDegree.get(t.id) ?? 0) > 0)
      .map((t) => t.id);
    return { waves: null, cycle: cycleIds };
  }

  return { waves, cycle: null };
}

/**
 * Get tasks that are blocked because their dependencies aren't all done.
 */
export function getBlockedTasks(tasks: Task[]): Task[] {
  const doneSet = new Set(
    tasks.filter((t) => t.status === "done").map((t) => t.id)
  );

  return tasks.filter((task) => {
    if (task.dependsOn.length === 0) return false;
    if (task.status === "done" || task.status === "cancelled") return false;
    return task.dependsOn.some((dep) => !doneSet.has(dep));
  });
}

/**
 * Get tasks that are ready to be worked on (all deps done, not done/cancelled).
 */
export function getReadyTasks(tasks: Task[]): Task[] {
  const doneSet = new Set(
    tasks.filter((t) => t.status === "done").map((t) => t.id)
  );

  return tasks.filter((task) => {
    if (task.status === "done" || task.status === "cancelled") return false;
    if (task.dependsOn.length === 0) return true;
    return task.dependsOn.every((dep) => doneSet.has(dep));
  });
}

/**
 * Get all tasks that depend on a given task ID (direct dependents).
 */
export function getDirectDependents(
  taskId: string,
  tasks: Task[]
): Task[] {
  return tasks.filter((t) => t.dependsOn.includes(taskId));
}

/**
 * Check if setting a task to a given status is valid given its dependencies.
 * Returns an error message if invalid, or null if valid.
 */
export function validateStatusTransition(
  task: Task,
  newStatus: string,
  allTasks: Task[]
): string | null {
  const doneSet = new Set(
    allTasks.filter((t) => t.status === "done").map((t) => t.id)
  );

  if (newStatus === "in-progress" || newStatus === "open") {
    // Can't start if deps aren't done
    const unmet = task.dependsOn.filter((dep) => !doneSet.has(dep));
    if (unmet.length > 0) {
      return `Cannot start task ${task.id}: blocked by unfinished dependencies: ${unmet.join(", ")}`;
    }
  }

  return null;
}
