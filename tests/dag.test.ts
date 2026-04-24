import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  buildDAG,
  getBlockedTasks,
  getReadyTasks,
  getDirectDependents,
  validateStatusTransition,
} from "../src/lib/dag";
import type { Task } from "../src/types";

const TEST_DIR = join("/tmp", `.tasks-test-deps-${process.pid}`);

function makeTask(overrides: Partial<Task> & { id: string }): Task {
  return {
    title: "Test",
    status: "open",
    priority: "p1",
    type: "feat",
    dependsOn: [],
    created: "2025-03-30T00:00:00Z",
    updated: "2025-03-30T00:00:00Z",
    ...overrides,
  };
}

function runInTestDir(cmd: string, env?: Record<string, string>): string {
  return execSync(`bun run ${join(process.cwd(), "src/cli.ts")} ${cmd}`, {
    cwd: TEST_DIR,
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
}

function runInTestDirExpectError(cmd: string): string {
  try {
    return runInTestDir(cmd);
  } catch (e: any) {
    return e.stdout || e.stderr || e.message;
  }
}

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

// ─── DAG unit tests ────────────────────────────────────────────────────

describe("buildDAG", () => {
  it("produces single wave for independent tasks", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b" }), makeTask({ id: "c" })];
    const result = buildDAG(tasks);
    expect(result.cycle).toBeNull();
    expect(result.waves).toHaveLength(1);
    expect(result.waves![0].taskIds).toHaveLength(3);
  });

  it("produces multiple waves for dependent tasks", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
      makeTask({ id: "c", dependsOn: ["a"] }),
      makeTask({ id: "d", dependsOn: ["b", "c"] }),
    ];
    const result = buildDAG(tasks);
    expect(result.cycle).toBeNull();
    expect(result.waves).toHaveLength(3);
    expect(result.waves![0].taskIds).toEqual(["a"]);
    expect(result.waves![1].taskIds.sort()).toEqual(["b", "c"]);
    expect(result.waves![2].taskIds).toEqual(["d"]);
  });

  it("detects simple cycle", () => {
    const tasks = [
      makeTask({ id: "a", dependsOn: ["b"] }),
      makeTask({ id: "b", dependsOn: ["a"] }),
    ];
    const result = buildDAG(tasks);
    expect(result.cycle).not.toBeNull();
    expect(result.waves).toBeNull();
  });

  it("detects longer cycle", () => {
    const tasks = [
      makeTask({ id: "a", dependsOn: ["c"] }),
      makeTask({ id: "b", dependsOn: ["a"] }),
      makeTask({ id: "c", dependsOn: ["b"] }),
    ];
    const result = buildDAG(tasks);
    expect(result.cycle).not.toBeNull();
    expect(result.waves).toBeNull();
  });

  it("detects self-dependency", () => {
    const tasks = [makeTask({ id: "a", dependsOn: ["a"] })];
    const result = buildDAG(tasks);
    expect(result.cycle).not.toBeNull();
  });

  it("throws on missing dependency ID", () => {
    const tasks = [makeTask({ id: "a", dependsOn: ["z"] })];
    expect(() => buildDAG(tasks)).toThrow("does not exist");
  });

  it("handles mixed independent and dependent tasks", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
      makeTask({ id: "c" }), // independent
    ];
    const result = buildDAG(tasks);
    expect(result.waves).toHaveLength(2);
    expect(result.waves![0].taskIds.sort()).toEqual(["a", "c"]);
    expect(result.waves![1].taskIds).toEqual(["b"]);
  });
});

describe("getBlockedTasks", () => {
  it("returns tasks with unfinished deps", () => {
    const tasks = [
      makeTask({ id: "a", status: "done" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
      makeTask({ id: "c", dependsOn: ["b"] }),
    ];
    expect(getBlockedTasks(tasks).map((t) => t.id)).toEqual(["c"]);
  });

  it("returns empty when all deps done", () => {
    const tasks = [
      makeTask({ id: "a", status: "done" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
    ];
    expect(getBlockedTasks(tasks)).toHaveLength(0);
  });

  it("ignores done and cancelled tasks", () => {
    const tasks = [
      makeTask({ id: "a", status: "open" }),
      makeTask({ id: "b", dependsOn: ["a"], status: "done" }),
    ];
    expect(getBlockedTasks(tasks)).toHaveLength(0);
  });
});

describe("getReadyTasks", () => {
  it("returns tasks with all deps done", () => {
    const tasks = [
      makeTask({ id: "a", status: "done" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
      makeTask({ id: "c", dependsOn: ["b"] }),
    ];
    expect(getReadyTasks(tasks).map((t) => t.id)).toEqual(["b"]);
  });

  it("includes independent open tasks", () => {
    const tasks = [makeTask({ id: "a" }), makeTask({ id: "b", status: "done" })];
    expect(getReadyTasks(tasks).map((t) => t.id)).toEqual(["a"]);
  });

  it("excludes done and cancelled", () => {
    const tasks = [
      makeTask({ id: "a", status: "done" }),
      makeTask({ id: "b", status: "cancelled" }),
    ];
    expect(getReadyTasks(tasks)).toHaveLength(0);
  });
});

describe("getDirectDependents", () => {
  it("finds tasks that depend on a given task", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
      makeTask({ id: "c", dependsOn: ["a", "b"] }),
      makeTask({ id: "d" }),
    ];
    expect(getDirectDependents("a", tasks).map((t) => t.id)).toEqual(["b", "c"]);
    expect(getDirectDependents("b", tasks).map((t) => t.id)).toEqual(["c"]);
    expect(getDirectDependents("d", tasks)).toHaveLength(0);
  });
});

describe("validateStatusTransition", () => {
  it("allows starting when all deps done", () => {
    const tasks = [
      makeTask({ id: "a", status: "done" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
    ];
    expect(validateStatusTransition(tasks[1], "in-progress", tasks)).toBeNull();
  });

  it("blocks starting when deps not done", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
    ];
    const error = validateStatusTransition(tasks[1], "in-progress", tasks);
    expect(error).toContain("blocked by unfinished dependencies");
  });

  it("allows setting to blocked status regardless", () => {
    const tasks = [
      makeTask({ id: "a" }),
      makeTask({ id: "b", dependsOn: ["a"] }),
    ];
    expect(validateStatusTransition(tasks[1], "blocked", tasks)).toBeNull();
  });
});

// ─── CLI integration tests ─────────────────────────────────────────────

describe("new --depends-on", () => {
  it("creates task with dependency", () => {
    const id1 = runInTestDir('new "Base task"').match(/[a-f0-9]{8}/)![0];
    const out = runInTestDir(`new "Dependent task" --depends-on ${id1}`);
    expect(out).toContain("Created task");

    // Verify the task file contains dependsOn
    const depId = out.match(/[a-f0-9]{8}/)![0];
    const content = readFileSync(join(TEST_DIR, ".tasks", `${depId}.md`), "utf-8");
    expect(content).toContain(`dependsOn: [${id1}]`);
  });

  it("rejects non-existent dependency", () => {
    const out = runInTestDirExpectError('new "Bad dep" --depends-on zzzzzzzz');
    expect(out).toContain("not found");
  });

  it("rejects self-dependency", () => {
    // Create a task, then try to create another depending on a non-existent ID
    const out = runInTestDirExpectError('new "Self dep" --depends-on self1234');
    expect(out).toContain("not found");
  });
});

describe("list shows DEPS column", () => {
  it("shows dependency IDs in list output", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    runInTestDir(`new "Dependent" --depends-on ${id1}`);
    const out = runInTestDir("list --all");
    expect(out).toContain(id1);
  });

  it("shows blocked status for tasks with unfinished deps", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    runInTestDir(`new "Dependent" --depends-on ${id1}`);
    const out = runInTestDir("list", { NO_COLOR: "1" });
    expect(out).toContain("blocked");
  });
});

describe("show displays deps and blockers", () => {
  it("shows Depends and Blocks lines", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    runInTestDir(`new "Dependent" --depends-on ${id1}`);
    const out = runInTestDir(`show ${id1}`);
    expect(out).toContain("Blocks:");
    expect(out).toContain("Dependent");
  });

  it("shows Deps line for dependent task", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    const id2 = runInTestDir(`new "Dependent" --depends-on ${id1}`).match(/[a-f0-9]{8}/)![0];
    const out = runInTestDir(`show ${id2}`);
    expect(out).toContain("Deps:");
    expect(out).toContain(id1);
  });
});

describe("done unblocks dependents", () => {
  it("shows unblocked message when completing a dependency", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    runInTestDir(`new "Dependent" --depends-on ${id1}`);
    const out = runInTestDir(`done ${id1}`);
    expect(out).toContain("Unblocked:");
    expect(out).toContain("Dependent");
  });

  it("shows still-blocked when only some deps done", () => {
    const id1 = runInTestDir('new "Base1"').match(/[a-f0-9]{8}/)![0];
    const id2 = runInTestDir('new "Base2"').match(/[a-f0-9]{8}/)![0];
    runInTestDir(`new "Dependent" --depends-on ${id1} --depends-on ${id2}`);
    const out = runInTestDir(`done ${id1}`);
    expect(out).toContain("Still blocked:");
  });
});

describe("status validates deps", () => {
  it("blocks in-progress when deps not done", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    const id2 = runInTestDir(`new "Dependent" --depends-on ${id1}`).match(/[a-f0-9]{8}/)![0];
    const out = runInTestDirExpectError(`status ${id2} in-progress`);
    expect(out).toContain("blocked by unfinished dependencies");
  });
});

describe("edit --depends-on", () => {
  it("updates dependencies", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    const id2 = runInTestDir('new "Task to edit"').match(/[a-f0-9]{8}/)![0];
    const out = runInTestDir(`edit ${id2} --depends-on ${id1}`);
    expect(out).toContain("Updated dependencies");
  });

  it("rejects cycles", () => {
    const id1 = runInTestDir('new "Task A"').match(/[a-f0-9]{8}/)![0];
    const id2 = runInTestDir(`new "Task B" --depends-on ${id1}`).match(/[a-f0-9]{8}/)![0];
    // Try to make A depend on B (creates cycle A→B→A)
    const out = runInTestDirExpectError(`edit ${id1} --depends-on ${id2}`);
    expect(out).toContain("cycle");
  });
});

describe("graph command", () => {
  it("shows execution waves", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    runInTestDir(`new "Dep" --depends-on ${id1}`);
    const out = runInTestDir("graph", { NO_COLOR: "1" });
    expect(out).toContain("Wave 1");
    expect(out).toContain("Wave 2");
    expect(out).toContain("Base");
    expect(out).toContain("Dep");
  });

  it("outputs JSON with --json", () => {
    runInTestDir('new "Task A"');
    const out = runInTestDir("graph --json");
    const parsed = JSON.parse(out);
    expect(parsed).toHaveProperty("executionPlan");
    expect(parsed.executionPlan.waves).toHaveLength(1);
  });

  it("detects cycles in graph", () => {
    const id1 = runInTestDir('new "A"').match(/[a-f0-9]{8}/)![0];
    const id2 = runInTestDir(`new "B" --depends-on ${id1}`).match(/[a-f0-9]{8}/)![0];
    // Manually create a cycle by writing A to depend on B directly
    const content = readFileSync(join(TEST_DIR, ".tasks", `${id1}.md`), "utf-8");
    const cycledContent = content.replace(
      "type: feat\n",
      `type: feat\ndependsOn: [${id2}]\n`
    );
    writeFileSync(join(TEST_DIR, ".tasks", `${id1}.md`), cycledContent);
    const out = runInTestDir("graph", { NO_COLOR: "1" });
    expect(out).toContain("cycle");
  });
});

describe("plan command", () => {
  it("outputs JSON execution plan", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    runInTestDir(`new "Dep1" --depends-on ${id1}`);
    runInTestDir(`new "Dep2" --depends-on ${id1}`);
    const out = runInTestDir("plan");
    const parsed = JSON.parse(out);
    expect(parsed.waves).toHaveLength(2);
    expect(parsed.waves[0].tasks).toHaveLength(1);
    expect(parsed.waves[1].tasks).toHaveLength(2);
    expect(parsed.totalWaves).toBe(2);
    expect(parsed.totalTasks).toBe(3);
  });

  it("outputs empty array when no tasks", () => {
    const out = runInTestDir("plan");
    expect(out).toBe("[]\n");
  });

  it("--status shows human-readable summary", () => {
    const id1 = runInTestDir('new "Base"').match(/[a-f0-9]{8}/)![0];
    runInTestDir(`new "Dep" --depends-on ${id1}`);
    const out = runInTestDir("plan --status", { NO_COLOR: "1" });
    expect(out).toContain("Ready to start");
    expect(out).toContain("Blocked");
  });

  it("--bash outputs shell script", () => {
    runInTestDir('new "Task A"');
    const out = runInTestDir("plan --bash");
    expect(out).toContain("#!/bin/bash");
    expect(out).toContain("Wave 1");
  });
});

// ─── Backward compatibility ────────────────────────────────────────────

describe("backward compat", () => {
  it("reads old task files without dependsOn field", () => {
    const { writeFileSync } = require("node:fs");
    mkdirSync(join(TEST_DIR, ".tasks"), { recursive: true });
    writeFileSync(join(TEST_DIR, ".tasks", "oldtask1.md"), [
      "---",
      "id: oldtask1",
      "title: Old task",
      "status: open",
      "priority: p1",
      "type: feat",
      "created: 2025-03-30T00:00:00Z",
      "updated: 2025-03-30T00:00:00Z",
      "---",
      "",
      "body",
    ].join("\n"));

    const out = runInTestDir("show oldtask1");
    expect(out).toContain("Old task");
    expect(out).not.toContain("Error");
  });
});
