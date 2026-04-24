import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
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

const mockExecSync = mock((_cmd: string, _options: any): any => "");
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
  writeFileSync(join(TEST_DIR, ".tasks", `${task.id}.md`), content);
}

/** Set up the gh CLI mock with per-command responses. */
function setupGhMock(responses: {
  issueList?: string;
  issueCreate?: string;
} = {}): void {
  mockExecSync.mockImplementation((cmd: string, _options: any): any => {
    if (cmd === "which gh") return Buffer.from("");
    if (typeof cmd === "string" && cmd.includes("gh repo view")) return "owner/repo";
    if (typeof cmd === "string" && cmd.includes("gh issue list"))
      return responses.issueList ?? "[]";
    if (typeof cmd === "string" && cmd.includes("gh issue create"))
      return responses.issueCreate ?? "42";
    if (typeof cmd === "string" && cmd.includes("gh issue edit")) return "";
    if (typeof cmd === "string" && cmd.includes("gh issue close")) return "";
    if (typeof cmd === "string" && cmd.includes("gh issue reopen")) return "";
    return "";
  });
}

/** Filter mockExecSync calls for a gh sub-command substring. */
function ghCallsContaining(substr: string): any[] {
  return mockExecSync.mock.calls.filter(
    (c: any) => typeof c[0] === "string" && c[0].includes(substr),
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
  mockExecSync.mockClear();
  logSpy.mockClear();
  errorSpy.mockClear();
  mockExit.mockClear();

  // Default execSync mock: simulates gh CLI being available
  setupGhMock();

  spyOn(childProcess, "execSync").mockImplementation(mockExecSync);
  spyOn(console, "log").mockImplementation(logSpy);
  spyOn(console, "error").mockImplementation(errorSpy);
  spyOn(process, "exit").mockImplementation(mockExit as any);
});

afterEach(() => {
  process.chdir(origDir);
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  (childProcess.execSync as any).mockRestore?.();
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
      const createCalls = ghCallsContaining("gh issue create");
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
          { number: 10, title: "Test task", state: "open", labels: ["task"] },
        ]),
      });

      run(["push"]);

      const editCalls = ghCallsContaining("gh issue edit");
      expect(editCalls.length).toBe(1);
      expect(editCalls[0][0]).toContain("10");
    });
  });

  describe("push closes issue when task is done", () => {
    it("calls gh issue close for a done task whose remote issue is still open", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });
      writeTestTask(makeTask({ status: "done", githubIssue: 10 }));

      setupGhMock({
        issueList: JSON.stringify([
          { number: 10, title: "Test task", state: "open", labels: ["task"] },
        ]),
      });

      run(["push"]);

      const closeCalls = ghCallsContaining("gh issue close");
      expect(closeCalls.length).toBe(1);
      expect(closeCalls[0][0]).toContain("10");
    });
  });

  describe("pull marks task done when remote is closed", () => {
    it("sets local task status to done when the remote issue is closed", () => {
      saveConfig({ github: { enabled: true, labels: ["task"], autoSync: false } });
      writeTestTask(makeTask({ status: "open", githubIssue: 10 }));

      setupGhMock({
        issueList: JSON.stringify([
          { number: 10, title: "Test task", state: "closed", labels: ["task"] },
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
          { number: 10, title: "Test task", state: "open", labels: ["task"] },
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
      expect(ghCallsContaining("gh issue create")).toHaveLength(0);
      expect(ghCallsContaining("gh issue edit")).toHaveLength(0);
      expect(ghCallsContaining("gh issue close")).toHaveLength(0);
      expect(ghCallsContaining("gh issue reopen")).toHaveLength(0);

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

      const createCalls = ghCallsContaining("gh issue create");
      expect(createCalls.length).toBe(1);

      // Only the specified task should have been linked
      const { task: t1 } = readTask("abcd1234");
      expect(t1.githubIssue).toBe(42);

      const { task: t2 } = readTask("efgh5678");
      expect(t2.githubIssue).toBeUndefined();
    });
  });
});
