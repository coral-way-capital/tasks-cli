import { resolveId, readTask, writeTask, getTasksDir, listTasks } from "../lib/store";
import { buildDAG } from "../lib/dag";
import { autoSyncTask } from "../lib/auto-sync";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import { parseTaskFile } from "../lib/task";

export function run(args: string[]): void {
  const partial = args[0];
  if (!partial) {
    console.error("Usage: tasks edit <id> [--body] [--depends-on id1,id2,...]");
    process.exit(1);
  }

  const useBody = args.includes("--body");
  const depsIdx = args.indexOf("--depends-on");
  const newDeps = depsIdx !== -1 && args[depsIdx + 1] ? args[depsIdx + 1].split(",").map((s) => s.trim()).filter(Boolean) : null;

  try {
    const id = resolveId(partial);
    const filePath = join(getTasksDir(), `${id}.md`);

    if (useBody) {
      // Read body from stdin
      const chunks: Buffer[] = [];
      process.stdin.setEncoding("utf-8");
      process.stdin.on("data", (chunk: string) => chunks.push(Buffer.from(chunk)));
      process.stdin.on("end", () => {
        const newBody = Buffer.concat(chunks).toString("utf-8").trimEnd();
        const { task } = readTask(id);
        const updatedTask = { ...task, updated: new Date().toISOString() };
        if (newDeps !== null) updatedTask.dependsOn = newDeps;
        writeTask(updatedTask, newBody);
        console.log(`Updated body for task ${id}`);
        autoSyncTask(id);
      });
    } else if (newDeps !== null) {
      // Update only dependsOn
      const { task, body } = readTask(id);

      // Validate dep IDs exist
      const existing = new Set(listTasks().map((t) => t.task.id));
      const missing = newDeps.filter((d) => !existing.has(d));
      if (missing.length > 0) {
        console.error(`Error: dependency task(s) not found: ${missing.join(", ")}`);
        process.exit(1);
      }
      if (newDeps.includes(id)) {
        console.error("Error: task cannot depend on itself");
        process.exit(1);
      }

      const updated = { ...task, dependsOn: newDeps, updated: new Date().toISOString() };

      // Validate no cycles
      try {
        const allTasks = listTasks().map((t) => {
          if (t.task.id === id) return { task: updated, body: t.body };
          return t;
        }).map((t) => t.task);
        const result = buildDAG(allTasks);
        if (result.cycle) {
          console.error(`Error: this change would create a dependency cycle involving: ${result.cycle.join(", ")}`);
          process.exit(1);
        }
      } catch (e: any) {
        console.error(`Error: ${e.message}`);
        process.exit(1);
      }

      writeTask(updated, body);
      console.log(`Updated dependencies for task ${id}: [${newDeps.join(", ")}]`);
      autoSyncTask(id);
    } else {
      const editor = process.env.EDITOR;
      if (editor) {
        execSync(`${editor} "${filePath}"`, { stdio: "inherit" });
      } else {
        console.log(filePath);
      }
    }
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
}
