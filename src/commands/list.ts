import { listTasks } from "../lib/store";
import { getBlockedTasks } from "../lib/dag";
import { padRight, formatStatus, formatPriority, bold, dim, red } from "../lib/format";

const PRIORITY_ORDER: Record<string, number> = { p0: 0, p1: 1, p2: 2 };

export function run(args: string[]): void {
  let showAll = false;
  let filterStatus: string | undefined;
  let filterPriority: string | undefined;
  let filterType: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--all") {
      showAll = true;
    } else if (args[i] === "--status" && args[i + 1]) {
      filterStatus = args[++i];
    } else if (args[i] === "--priority" && args[i + 1]) {
      filterPriority = args[++i];
    } else if (args[i] === "--type" && args[i + 1]) {
      filterType = args[++i];
    }
  }

  let tasks = listTasks().map((t) => t.task);

  if (!showAll && !filterStatus) {
    tasks = tasks.filter((t) => t.status !== "done" && t.status !== "cancelled");
  }

  if (filterStatus) {
    tasks = tasks.filter((t) => t.status === filterStatus);
  }
  if (filterPriority) {
    tasks = tasks.filter((t) => t.priority === filterPriority);
  }
  if (filterType) {
    tasks = tasks.filter((t) => t.type === filterType);
  }

  tasks.sort((a, b) => {
    const priDiff = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
    if (priDiff !== 0) return priDiff;
    return a.created.localeCompare(b.created);
  });

  if (tasks.length === 0) {
    console.log("No tasks found");
    return;
  }

  const header = [
    bold(padRight("ID", 10)),
    bold(padRight("PRI", 4)),
    bold(padRight("TYPE", 10)),
    bold(padRight("STATUS", 14)),
    bold(padRight("DEPS", 20)),
    bold("TITLE"),
  ].join("  ");

  console.log(header);

  // Compute blocked set
  const allTasks = listTasks().map((t) => t.task);
  const blockedSet = new Set(getBlockedTasks(allTasks).map((t) => t.id));

  for (const t of tasks) {
    const depsStr = t.dependsOn.length > 0 ? t.dependsOn.join(",") : "";
    const statusStr = (blockedSet.has(t.id) && t.status !== "done" && t.status !== "cancelled")
      ? red("blocked")
      : formatStatus(t.status);
    const row = [
      padRight(t.id, 10),
      padRight(formatPriority(t.priority), 4),
      padRight(t.type, 10),
      padRight(statusStr, 14),
      padRight(depsStr, 20),
      t.title,
    ].join("  ");
    console.log(row);
  }
}
