import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import type { Task } from "../types";
import { parseTaskFile, serializeTask } from "./task";

const TASKS_DIR = ".tasks";

export function getTasksDir(): string {
  // 1. Walk up from CWD
  const walked = findAncestorTasksDir(process.cwd());
  if (walked) return walked;

  // 2. If in a git worktree, find main repo via .git file
  const mainRepo = getMainRepoFromGit();
  if (mainRepo) {
    const candidate = join(mainRepo, TASKS_DIR);
    if (existsSync(candidate)) return candidate;
  }

  // 3. Fall back to CWD (ensureTaskDir creates it on write)
  return join(process.cwd(), TASKS_DIR);
}

function findAncestorTasksDir(startDir: string): string | null {
  let dir = resolve(startDir);
  const root = resolve("/");
  for (;;) {
    const candidate = join(dir, TASKS_DIR);
    if (existsSync(candidate)) return candidate;
    if (dir === root) break;
    dir = dirname(dir);
  }
  return null;
}

function getMainRepoFromGit(): string | null {
  try {
    const gitPath = join(process.cwd(), ".git");
    if (!existsSync(gitPath)) return null;
    const content = readFileSync(gitPath, "utf-8").trim();
    if (!content.startsWith("gitdir: ")) return null;
    // gitdir: /path/to/main-repo/.git/worktrees/<name>
    const gitdir = content.slice(8);
    // Go up 3 levels: worktrees/<name> → .git → main-repo root
    return resolve(gitdir, "../../..");
  } catch {
    return null;
  }
}

export function ensureTaskDir(): void {
  const dir = getTasksDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

export function writeTask(task: Task, body: string): void {
  ensureTaskDir();
  const filePath = join(getTasksDir(), `${task.id}.md`);
  writeFileSync(filePath, serializeTask(task, body), "utf-8");
}

export function readTask(id: string): { task: Task; body: string } {
  const filePath = join(getTasksDir(), `${id}.md`);
  if (!existsSync(filePath)) {
    throw new Error(`Task ${id} not found`);
  }
  const content = readFileSync(filePath, "utf-8");
  return parseTaskFile(content);
}

export function listTasks(): { task: Task; body: string }[] {
  const dir = getTasksDir();
  if (!existsSync(dir)) {
    return [];
  }

  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort();

  const results: { task: Task; body: string }[] = [];
  for (const file of files) {
    try {
      const content = readFileSync(join(dir, file), "utf-8");
      results.push(parseTaskFile(content));
    } catch {
      // skip malformed files
    }
  }
  return results;
}

export function resolveId(partial: string): string {
  if (partial.length < 4) {
    throw new Error("ID prefix must be at least 4 characters");
  }

  const tasks = listTasks();
  const matches = tasks.filter((t) => t.task.id.startsWith(partial));

  if (matches.length === 0) {
    throw new Error(`No task found matching "${partial}"`);
  }
  if (matches.length > 1) {
    const ids = matches.map((m) => m.task.id).join(", ");
    throw new Error(`Ambiguous ID "${partial}" matches: ${ids}. Use more characters.`);
  }
  return matches[0].task.id;
}

export function updateFrontmatter(id: string, updates: Partial<Task>): void {
  const { task, body } = readTask(id);
  const updated = { ...task, ...updates, updated: new Date().toISOString() };
  writeTask(updated, body);
}
