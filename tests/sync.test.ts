import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  mkdirSync, rmSync, existsSync,
  writeFileSync as realWriteFileSync,
} from "node:fs";
import { join } from "node:path";
import * as childProcess from "node:child_process";
import { run } from "../src/commands/sync";
import { loadConfig, saveConfig } from "../src/lib/config";
import { listTasks, readTask } from "../src/lib/store";
import { serializeTask } from "../src/lib/task";
import type { Task } from "../src/types";

const TEST_DIR = join("/tmp", `.tasks-test-sync-${process.pid}`);
let origDir: string;

// --- Mocks ---

const mockExecFileSync = mock((_cmd: string, _args: string[], _options: any): any => Buffer.from(""));
const logSpy = mock((_msg: string, ..._args: any[]) => {});
const errorSpy = mock((_msg: string, ..._args: any[]) => {});
const mockExit = mock((_code: number) => {});

// --- Helpers ---

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
    ...overrides,
  };
}

function writeTestTask(task: Task, body: string = "## Body"): void {
  const content = serializeTask(task, body);
  realWriteFileSync(join(TEST_DIR, ".tasks", `${task.id}.md`), content);
}

/** Set up the gh CLI mock with per-command responses. */
function setupGhMock(responses: {
  issueList?: string;
  issueCreate?: string;
} = {}): void {
  mockExecFileSync.mockImplementation((_cmd: string, args: string[], _options: any): any => {
    if (args[0] === "--version") return Buffer.from("gh 2.0.0");
    if (args[0] === "repo" && args[1] === "view") return Buffer.from("owner/repo");
    if (args[0] === "issue" && args[1] === "list")
      return Buffer.from(responses.issueList ?? "[]");
    if (args[0] === "issue" && args[1] === "create")
      // Default: simulate gh issue create printing the URL
      return Buffer.from(responses.issueCreate ?? "https://github.com/owner/repo/issues/42");
    if (args[0] === "issue" && args[1] === "edit") return Buffer.from("");
    if (args[0] === "issue" && args[1] === "close") return Buffer.from("");
    if (args[0] === "issue" && args[1] === "reopen") return Buffer.from("");
    if (args[0] === "issue" && args[1] === "comment") return Buffer.from("");
    return Buffer.from("");
  });
}

/** Filter mockExecFileSync calls for a gh sub-command substring in args. */
function ghCallsWithArg(substr: string): any[] {
  return mockExecFileSync.mock.calls.filter(
    (c: any) => Array.isArray(c[1]) && c[1].some((a: string) => a.includes(substr)),
  );
}

// --- Setup / Teardown ---

beforeEach(() => {
  origDir = process.cwd();
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, ".tasks"), { recursive: true });
  process.chdir(TEST_DIR);

  // Clear all mocks
  mockExecFileSync.mockClear();
  logSpy.mockClear();
  errorSpy.mockClear();
  mockExit.mockClear();

  // Default mock: simulates gh CLI being available
  setupGhMock();

  spyOn(childProcess, "execFileSync").mockImplementation(mockExecFileSync);
  spyOn(console, "log").mockImplementation(logSpy);
  spyOn(console, "error").mockImplementation(errorSpy);
  spyOn(process, "exit").mockImplementation(mockExit as any);
});

afterEach(() => {
  process.chdir(origDir);
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  (childProcess.execFileSync as any).mockRestore?.();
  (console.log as any).mockRestore?.();
  (console.error as any).mockRestore?.();
  (process.exit as any).mockRestore?.();
});

// --- Tests ---

describe("sync command", () => {
  describe("push with no config", () => {
    it("prints message when GitHub is not enabled and exits 0", () => {
      run(["push"]);

      expect(mockExit).toHaveBeenCalledWith(0);
      const logMessages = logSpy.mock.calls.map((c: any) => c[0]);
      expect(logMessages.some((m: string) => m.includes("not enabled"))).toBe(true);
    });
  });

  describe("push creates issues for unlinked tasks", () => {
    it("creates a GitHub issue and links it to the task", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });
      writeTestTask(makeTask());

      run(["push"]);

      // Verify issue create was called exactly once
      const createCalls = ghCallsWithArg("create");
      expect(createCalls.length).toBe(1);

      // Verify the task file now has githubIssue set
      const { task } = readTask("abcd1234");
      expect(task.githubIssue).toBe(42);
    });
  });

  describe("push updates existing issues", () => {
    it("calls gh issue edit for tasks that already have a githubIssue", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });
      writeTestTask(makeTask({ githubIssue: 10 }));

      setupGhMock({
        issueList: JSON.stringify([
          { number: 10, title: "Test task", state: "open", labels: [{ name: "task" }] },
        ]),
      });

      run(["push"]);

      const editCalls = ghCallsWithArg("edit");
      expect(editCalls.length).toBe(1);
      expect(editCalls[0][1]).toContain("10");
    });
  });

  describe("push closes issue when task is done", () => {
    it("calls gh issue close for a done task whose remote issue is still open", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });
      writeTestTask(makeTask({ status: "done", githubIssue: 10 }));

      setupGhMock({
        issueList: JSON.stringify([
          { number: 10, title: "Test task", state: "open", labels: [{ name: "task" }] },
        ]),
      });

      run(["push"]);

      const closeCalls = ghCallsWithArg("close");
      expect(closeCalls.length).toBe(1);
      expect(closeCalls[0][1]).toContain("10");
    });
  });

  describe("pull marks task done when remote is closed", () => {
    it("sets local task status to done when the remote issue is closed", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });
      writeTestTask(makeTask({ status: "open", githubIssue: 10 }));

      setupGhMock({
        issueList: JSON.stringify([
          { number: 10, title: "Test task", state: "closed", labels: [{ name: "task" }] },
        ]),
      });

      run(["pull"]);

      const { task } = readTask("abcd1234");
      expect(task.status).toBe("done");
    });
  });

  describe("pull reopens task when remote is open", () => {
    it("sets local task status to open when the remote issue is reopened", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });
      writeTestTask(makeTask({ status: "done", githubIssue: 10 }));

      setupGhMock({
        issueList: JSON.stringify([
          { number: 10, title: "Test task", state: "open", labels: [{ name: "task" }] },
        ]),
      });

      run(["pull"]);

      const { task } = readTask("abcd1234");
      expect(task.status).toBe("open");
    });
  });

  describe("check is dry run", () => {
    it("does not create or edit issues and reports dry run", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });
      writeTestTask(makeTask());

      run(["check"]);

      // No mutating gh commands should be called
      expect(ghCallsWithArg("create")).toHaveLength(0);
      expect(ghCallsWithArg("edit")).toHaveLength(0);
      expect(ghCallsWithArg("close")).toHaveLength(0);
      expect(ghCallsWithArg("reopen")).toHaveLength(0);

      // Should mention dry run
      const logMessages = logSpy.mock.calls.map((c: any) => c[0]);
      expect(logMessages.some((m: string) => m.includes("dry run"))).toBe(true);
    });
  });

  describe("push --task filters to single task", () => {
    it("creates an issue only for the specified task", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });
      writeTestTask(makeTask({ id: "abcd1234" }));
      writeTestTask(makeTask({ id: "efgh5678" }));

      run(["push", "--task", "abcd1234"]);

      const createCalls = ghCallsWithArg("create");
      expect(createCalls.length).toBe(1);

      // Only the specified task should have been linked
      const { task: t1 } = readTask("abcd1234");
      expect(t1.githubIssue).toBe(42);

      const { task: t2 } = readTask("efgh5678");
      expect(t2.githubIssue).toBeUndefined();
    });
  });

  describe("dependency body enrichment", () => {
    it("injects Dependencies section into issue body for tasks with dependsOn", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });

      // Create parent task first with an issue number
      writeTestTask(makeTask({ id: "parent001", githubIssue: 10 }));
      // Create child task that depends on parent
      writeTestTask(makeTask({ id: "child0001", dependsOn: ["parent001"] }));

      setupGhMock({
        issueList: JSON.stringify([
          { number: 10, title: "Test task", state: "open", labels: [{ name: "task" }] },
        ]),
      });

      run(["push"]);

      // The child task should have been created with enriched body
      const createCalls = ghCallsWithArg("create");
      expect(createCalls.length).toBe(1);

      // Find the body file written for the create call
      // The body should contain dependency section
      const { task } = readTask("child0001");
      expect(task.githubIssue).toBe(42);
    });

    it("injects Blocks section into issue body for tasks that are depended upon", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });

      writeTestTask(makeTask({ id: "parent001" }));
      writeTestTask(makeTask({ id: "child0001", dependsOn: ["parent001"] }));

      // Mock: first create returns issue #50, second returns #51
      let createCount = 0;
      mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
        if (args[0] === "repo" && args[1] === "view") return Buffer.from("owner/repo");
        if (args[0] === "issue" && args[1] === "list") return Buffer.from("[]");
        if (args[0] === "issue" && args[1] === "create") {
          createCount++;
          return Buffer.from(`https://github.com/owner/repo/issues/${createCount + 49}`);
        }
        if (args[0] === "issue" && args[1] === "comment") return Buffer.from("");
        return Buffer.from("");
      });

      run(["push"]);

      // Both tasks should be created
      const { task: child } = readTask("child0001");
      expect(child.githubIssue).toBe(50);
      const { task: parent } = readTask("parent001");
      expect(parent.githubIssue).toBe(51);

      // A dependency comment should have been posted on the parent issue
      const commentCalls = ghCallsWithArg("comment");
      expect(commentCalls.length).toBeGreaterThan(0);
    });
  });
});
