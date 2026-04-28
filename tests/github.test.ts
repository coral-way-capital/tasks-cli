import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as github from "../src/lib/github";
import type { Task } from "../src/types";

const makeTask = (overrides: Partial<Task> = {}): Task => ({
  id: "abcd1234",
  title: "Test task",
  status: "open",
  priority: "p1",
  type: "feat",
  dependsOn: [],
  created: "2025-03-30T00:00:00Z",
  updated: "2025-03-30T00:00:00Z",
  ...overrides,
});

// We mock execFileSync, and the temp file helpers (mkdtempSync, writeFileSync, unlinkSync, rmSync)
// so that createIssue/updateIssue/commentOnIssue work without touching the real filesystem.

const mockExecFileSync = mock((_cmd: string, _args: string[], _options: any): any => {
  throw new Error("unexpected command");
});

let capturedTempFiles: Map<string, string> = new Map();
let tempDirCounter = 0;

beforeEach(() => {
  mockExecFileSync.mockClear();
  capturedTempFiles = new Map();
  tempDirCounter = 0;

  spyOn(childProcess, "execFileSync").mockImplementation(mockExecFileSync);
  spyOn(fs, "mkdtempSync").mockImplementation((prefix: string) => {
    tempDirCounter++;
    return `/tmp/tasks-cli-test-${tempDirCounter}`;
  });
  spyOn(fs, "writeFileSync").mockImplementation((filePath: string, content: string) => {
    capturedTempFiles.set(filePath, content);
  });
  spyOn(fs, "unlinkSync").mockImplementation(() => {});
  spyOn(fs, "rmSync").mockImplementation(() => {});
});

afterEach(() => {
  (childProcess.execFileSync as any).mockRestore?.();
  (fs.mkdtempSync as any).mockRestore?.();
  (fs.writeFileSync as any).mockRestore?.();
  (fs.unlinkSync as any).mockRestore?.();
  (fs.rmSync as any).mockRestore?.();
});

// ── Pure functions ──────────────────────────────────────────────────────────

describe("statusToIssueState", () => {
  it("maps open status correctly", () => {
    expect(github.statusToIssueState("open")).toEqual({ state: "open", labels: ["task"] });
  });

  it("maps in-progress status correctly", () => {
    expect(github.statusToIssueState("in-progress")).toEqual({ state: "open", labels: ["task", "in-progress"] });
  });

  it("maps blocked status correctly", () => {
    expect(github.statusToIssueState("blocked")).toEqual({ state: "open", labels: ["task", "blocked"] });
  });

  it("maps done status correctly", () => {
    expect(github.statusToIssueState("done")).toEqual({ state: "closed", labels: [] });
  });

  it("maps cancelled status correctly", () => {
    expect(github.statusToIssueState("cancelled")).toEqual({ state: "closed", labels: [] });
  });
});

describe("issueStateToLocal", () => {
  it("maps closed to done", () => {
    expect(github.issueStateToLocal("closed")).toBe("done");
  });

  it("maps open to open", () => {
    expect(github.issueStateToLocal("open")).toBe("open");
  });
});

// ── Functions using execFileSync (mocked) ───────────────────────────────────

describe("isGhInstalled", () => {
  it("returns true when gh --version succeeds", () => {
    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from("gh version 2.0.0\n");
    });

    expect(github.isGhInstalled()).toBe(true);
  });

  it("returns false when gh --version fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("not found");
    });

    expect(github.isGhInstalled()).toBe(false);
  });
});

describe("getRepoInfo", () => {
  it("returns owner/repo when gh succeeds", () => {
    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from("owner/repo");
    });

    expect(github.getRepoInfo()).toEqual({ owner: "owner", repo: "repo" });
  });

  it("returns null when gh fails", () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error("gh command failed: not in a repo");
    });

    expect(github.getRepoInfo()).toBeNull();
  });
});

describe("createIssue", () => {
  it("creates issue and returns number", () => {
    mockExecFileSync.mockImplementation((_cmd: string, args: string[]) => {
      // Simulate gh issue create output: the issue URL
      return Buffer.from("https://github.com/owner/repo/issues/42");
    });

    const task = makeTask({ title: "New feature" });
    const result = github.createIssue(task, "Task body", ["task", "feat"]);

    expect(result).toBe(42);
    expect(mockExecFileSync).toHaveBeenCalled();
    const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("issue");
    expect(callArgs).toContain("create");
    expect(callArgs).toContain("--title");
    expect(callArgs).toContain("New feature");
    expect(callArgs).toContain("--label");
    expect(callArgs).toContain("task,feat");
    expect(callArgs).toContain("--body-file");
    // createIssue no longer uses --json; it parses issue number from URL output
    expect(callArgs).not.toContain("--json");

    // Verify body was written to temp file
    expect(capturedTempFiles.size).toBe(1);
    const body = Array.from(capturedTempFiles.values())[0];
    expect(body).toBe("Task body");
  });

  it("handles backticks in title and body without shell errors", () => {
    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      // Simulate gh issue create output: the issue URL
      return Buffer.from("https://github.com/owner/repo/issues/99");
    });

    const task = makeTask({ title: "Run `skill:sync` for DOC-disco-sua" });
    const body = "Path: `src/parsers/sua/`\nCode: `parteBImssComponents(...)`";
    const result = github.createIssue(task, body, ["task"]);

    expect(result).toBe(99);
    const tempBody = Array.from(capturedTempFiles.values())[0];
    expect(tempBody).toBe(body);
  });
});

describe("updateIssue", () => {
  it("calls gh issue edit with correct args via body-file", () => {
    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from("");
    });

    const task = makeTask({ title: "Updated title" });
    github.updateIssue(7, task, "Updated body", ["task", "in-progress"]);

    expect(mockExecFileSync).toHaveBeenCalled();
    const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("issue");
    expect(callArgs).toContain("edit");
    expect(callArgs).toContain("7");
    expect(callArgs).toContain("--title");
    expect(callArgs).toContain("Updated title");
    expect(callArgs).toContain("--body-file");
    expect(callArgs).toContain("--label");
    expect(callArgs).toContain("task,in-progress");

    // Verify body was written to temp file
    expect(capturedTempFiles.size).toBe(1);
    const body = Array.from(capturedTempFiles.values())[0];
    expect(body).toBe("Updated body");
  });
});

describe("closeIssue", () => {
  it("calls gh issue close", () => {
    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from("");
    });

    github.closeIssue(5);

    expect(mockExecFileSync).toHaveBeenCalled();
    const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("issue");
    expect(callArgs).toContain("close");
    expect(callArgs).toContain("5");
  });
});

describe("reopenIssue", () => {
  it("calls gh issue reopen", () => {
    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from("");
    });

    github.reopenIssue(5);

    expect(mockExecFileSync).toHaveBeenCalled();
    const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("issue");
    expect(callArgs).toContain("reopen");
    expect(callArgs).toContain("5");
  });
});

describe("listIssues", () => {
  it("parses and returns issues", () => {
    const issues = [
      { number: 1, title: "First issue", state: "open", labels: [{ name: "task" }] },
      { number: 2, title: "Second issue", state: "closed", labels: [{ name: "bug" }] },
    ];

    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from(JSON.stringify(issues));
    });

    const result = github.listIssues();

    expect(result).toEqual([
      { number: 1, title: "First issue", state: "open", labels: ["task"] },
      { number: 2, title: "Second issue", state: "closed", labels: ["bug"] },
    ]);
    expect(mockExecFileSync).toHaveBeenCalled();
    const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("issue");
    expect(callArgs).toContain("list");
    expect(callArgs).toContain("--state");
    expect(callArgs).toContain("all");
  });
});

describe("commentOnIssue", () => {
  it("calls gh issue comment with body-file", () => {
    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from("");
    });

    github.commentOnIssue(3, "This is a comment");

    expect(mockExecFileSync).toHaveBeenCalled();
    const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("issue");
    expect(callArgs).toContain("comment");
    expect(callArgs).toContain("3");
    expect(callArgs).toContain("--body-file");

    // Verify comment was written to temp file
    expect(capturedTempFiles.size).toBe(1);
    const body = Array.from(capturedTempFiles.values())[0];
    expect(body).toBe("This is a comment");
  });

  it("handles double quotes in comments without shell escaping issues", () => {
    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from("");
    });

    github.commentOnIssue(3, 'He said "hello"');

    expect(mockExecFileSync).toHaveBeenCalled();
    const tempBody = Array.from(capturedTempFiles.values())[0];
    expect(tempBody).toBe('He said "hello"');
  });
});

describe("getIssueUrl", () => {
  it("returns issue URL", () => {
    const url = "https://github.com/owner/repo/issues/10";

    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from(url);
    });

    expect(github.getIssueUrl(10)).toBe(url);
    expect(mockExecFileSync).toHaveBeenCalled();
    const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("issue");
    expect(callArgs).toContain("view");
    expect(callArgs).toContain("10");
  });
});

describe("getLinkedPRs", () => {
  it("returns linked PRs", () => {
    const prs = [
      { number: 42, title: "Fix thing", state: "open", url: "https://github.com/owner/repo/pull/42" },
    ];

    mockExecFileSync.mockImplementation((_cmd: string, _args: string[]) => {
      return Buffer.from(JSON.stringify(prs));
    });

    const result = github.getLinkedPRs(10);

    expect(result).toEqual(prs);
    expect(mockExecFileSync).toHaveBeenCalled();
    const callArgs = mockExecFileSync.mock.calls[0][1] as string[];
    expect(callArgs).toContain("pr");
    expect(callArgs).toContain("list");
    expect(callArgs.some((a: string) => a.includes("fixes #10"))).toBe(true);
  });
});
