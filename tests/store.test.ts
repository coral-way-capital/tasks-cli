import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ensureTaskDir,
  writeTask,
  readTask,
  listTasks,
  resolveId,
  updateFrontmatter,
  getTasksDir,
} from "../src/lib/store";
import type { Task } from "../src/types";

const TEST_DIR = join("/tmp", `.tasks-test-store-${process.pid}`);

let origDir: string;
let uniqueCounter = 0;
function uniqueId(): string {
  return `test-${Date.now()}-${uniqueCounter++}`;
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: overrides.id ?? "abcd1234",
    title: overrides.title ?? "Test task",
    status: overrides.status ?? "open",
    priority: overrides.priority ?? "p1",
    type: overrides.type ?? "feat",
    dependsOn: overrides.dependsOn ?? [],
    created: overrides.created ?? "2025-03-30T00:00:00Z",
    updated: overrides.updated ?? "2025-03-30T00:00:00Z",
  };
}

// Override getTasksDir for tests
const originalGetTasksDir = getTasksDir;

beforeEach(() => {
  origDir = process.cwd();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  // Monkey-patch to use test dir
  process.chdir(TEST_DIR);
});

afterEach(() => {
  process.chdir(origDir);
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

describe("ensureTaskDir", () => {
  it("creates .tasks/ if missing", () => {
    ensureTaskDir();
    expect(existsSync(join(TEST_DIR, ".tasks"))).toBe(true);
  });

  it("does not error if .tasks/ exists", () => {
    ensureTaskDir();
    ensureTaskDir();
    expect(existsSync(join(TEST_DIR, ".tasks"))).toBe(true);
  });
});

describe("writeTask + readTask", () => {
  it("roundtrips correctly", () => {
    const task = makeTask();
    writeTask(task, "## Body\n\nSome content");
    const { task: read, body } = readTask(task.id);
    expect(read).toEqual(task);
    expect(body).toBe("## Body\n\nSome content");
  });

  it("throws on missing task", () => {
    expect(() => readTask("nonexist")).toThrow("not found");
  });
});

describe("listTasks", () => {
  it("returns empty on empty dir", () => {
    expect(listTasks()).toEqual([]);
  });

  it("returns all tasks", () => {
    writeTask(makeTask({ id: "aaa11111" }), "body1");
    writeTask(makeTask({ id: "bbb22222" }), "body2");
    const tasks = listTasks();
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.task.id).sort()).toEqual(["aaa11111", "bbb22222"]);
  });
});

describe("resolveId", () => {
  it("finds task by 4-char prefix", () => {
    writeTask(makeTask({ id: "abcd1234" }), "body");
    expect(resolveId("abcd")).toBe("abcd1234");
  });

  it("finds task by full id", () => {
    writeTask(makeTask({ id: "abcd1234" }), "body");
    expect(resolveId("abcd1234")).toBe("abcd1234");
  });

  it("throws on ambiguous prefix", () => {
    writeTask(makeTask({ id: "abcd1111" }), "body");
    writeTask(makeTask({ id: "abcd2222" }), "body");
    expect(() => resolveId("abcd")).toThrow("Ambiguous");
  });

  it("throws on prefix too short", () => {
    expect(() => resolveId("ab")).toThrow("at least 4 characters");
  });

  it("throws on not found", () => {
    expect(() => resolveId("zzzz")).toThrow("No task found");
  });
});

describe("updateFrontmatter", () => {
  it("updates only specified fields", () => {
    writeTask(makeTask({ id: "test1234" }), "## Body\n\nKeep this");
    updateFrontmatter("test1234", { status: "in-progress" });
    const { task, body } = readTask("test1234");
    expect(task.status).toBe("in-progress");
    expect(body).toBe("## Body\n\nKeep this");
  });

  it("updates the updated timestamp", () => {
    writeTask(makeTask({ id: "test1234" }), "body");
    const before = readTask("test1234").task.updated;
    updateFrontmatter("test1234", { status: "done" });
    const after = readTask("test1234").task.updated;
    expect(after).not.toBe(before);
  });
});

describe("getTasksDir walk-up", () => {
  it("finds .tasks/ in CWD", () => {
    ensureTaskDir();
    expect(getTasksDir()).toBe(join(process.cwd(), ".tasks"));
  });

  it("walks up to find .tasks/ in ancestor directory", () => {
    // Create .tasks/ in current test dir
    ensureTaskDir();
    writeTask(makeTask({ id: "walk0001" }), "walk-up test");

    // Create a nested subdir (no .tasks/ here)
    const nested = join(process.cwd(), "a", "b", "c");
    mkdirSync(nested, { recursive: true });
    process.chdir(nested);

    const found = getTasksDir();
    expect(existsSync(found)).toBe(true);
    // Should have found the parent's .tasks/
    const tasks = listTasks();
    expect(tasks.some((t) => t.task.id === "walk0001")).toBe(true);
  });

  it("falls back to CWD when no .tasks/ found anywhere", () => {
    // Use /tmp to guarantee no .tasks/ ancestor
    const isolated = join("/tmp", "tasks-cli-fallback-test", uniqueId());
    mkdirSync(isolated, { recursive: true });
    process.chdir(isolated);

    const result = getTasksDir();
    expect(result).toBe(join(process.cwd(), ".tasks"));

    // Clean up
    process.chdir(TEST_DIR);
    rmSync(isolated, { recursive: true });
  });
});

describe("getTasksDir git worktree resolution", () => {
  it("finds .tasks/ in main repo via .git file", () => {
    // Use /tmp so walk-up doesn't find any ancestor .tasks/
    const base = join("/tmp", `tasks-wt-test-${uniqueId()}`);
    const mainRepo = join(base, "my-repo");
    const worktreeDir = join(base, "my-repo-wt");
    mkdirSync(mainRepo, { recursive: true });
    mkdirSync(worktreeDir, { recursive: true });

    // Create .tasks/ in the main repo
    mkdirSync(join(mainRepo, ".tasks"));
    writeFileSync(
      join(mainRepo, ".tasks", "wttest01.md"),
      ["---", "id: wttest01", "title: Worktree test", "status: open", "priority: p1", "type: feat", "created: 2025-03-30T00:00:00Z", "updated: 2025-03-30T00:00:00Z", "---", "", "body"].join("\n"),
    );

    // Create .git file in the worktree pointing to main repo
    // Simulates: gitdir: /path/to/main-repo/.git/worktrees/<name>
    const fakeGitdir = join(mainRepo, ".git", "worktrees", "test-wt");
    mkdirSync(fakeGitdir, { recursive: true });
    writeFileSync(join(worktreeDir, ".git"), `gitdir: ${fakeGitdir}`);

    process.chdir(worktreeDir);
    const found = getTasksDir();
    expect(found).toBe(join(mainRepo, ".tasks"));

    const tasks = listTasks();
    expect(tasks).toHaveLength(1);
    expect(tasks[0].task.id).toBe("wttest01");

    // Clean up
    process.chdir(TEST_DIR);
    rmSync(base, { recursive: true });
  });

  it("ignores .git directory (not a worktree)", () => {
    // A regular .git directory should not trigger worktree resolution.
    // Use /tmp to isolate from ancestor .tasks/
    const base = join("/tmp", `tasks-gitdir-test-${uniqueId()}`);
    const repoDir = join(base, "regular-repo");
    mkdirSync(join(repoDir, ".git"), { recursive: true });
    process.chdir(repoDir);

    const result = getTasksDir();
    // Should fall back to CWD since no .tasks/ found and .git is a dir
    expect(result).toBe(join(process.cwd(), ".tasks"));

    // Clean up
    process.chdir(TEST_DIR);
    rmSync(base, { recursive: true });
  });
});
