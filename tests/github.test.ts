import { describe, it, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
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

const mockExecSync = mock((_cmd: string, _options: any): any => {
  throw new Error("unexpected command");
});

beforeEach(() => {
  mockExecSync.mockClear();
  spyOn(childProcess, "execSync").mockImplementation(mockExecSync);
});

afterEach(() => {
  mockExecSync.mockRestore();
  (childProcess.execSync as any).mockRestore?.();
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

// ── Functions using execSync (mocked) ───────────────────────────────────────

describe("isGhInstalled", () => {
  it("returns true when which gh succeeds", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return Buffer.from("/usr/local/bin/gh");
    });

    expect(github.isGhInstalled()).toBe(true);
  });

  it("returns false when which gh fails", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      throw new Error("not found");
    });

    expect(github.isGhInstalled()).toBe(false);
  });
});

describe("getRepoInfo", () => {
  it("returns owner/repo when gh succeeds", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return "owner/repo\n";
    });

    expect(github.getRepoInfo()).toEqual({ owner: "owner", repo: "repo" });
  });

  it("returns null when gh fails", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      throw new Error("gh command failed: not in a repo");
    });

    expect(github.getRepoInfo()).toBeNull();
  });
});

describe("createIssue", () => {
  it("creates issue and returns number", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return "42\n";
    });

    const task = makeTask({ title: "New feature" });
    const result = github.createIssue(task, "Task body", ["task", "feat"]);

    expect(result).toBe(42);
    expect(mockExecSync).toHaveBeenCalled();
    const calledCmd = mockExecSync.mock.calls[0][0] as string;
    expect(calledCmd).toContain("gh issue create");
    expect(calledCmd).toContain("--title \"New feature\"");
    expect(calledCmd).toContain("--label \"task,feat\"");
  });
});

describe("updateIssue", () => {
  it("calls gh issue edit with correct args", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return "";
    });

    const task = makeTask({ title: "Updated title" });
    github.updateIssue(7, task, "Updated body", ["task", "in-progress"]);

    expect(mockExecSync).toHaveBeenCalled();
    const calledCmd = mockExecSync.mock.calls[0][0] as string;
    expect(calledCmd).toContain("gh issue edit 7");
    expect(calledCmd).toContain("--title \"Updated title\"");
    expect(calledCmd).toContain("--body \"Updated body\"");
    expect(calledCmd).toContain("--add-label \"task,in-progress\"");
  });
});

describe("closeIssue", () => {
  it("calls gh issue close", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return "";
    });

    github.closeIssue(5);

    expect(mockExecSync).toHaveBeenCalled();
    const calledCmd = mockExecSync.mock.calls[0][0] as string;
    expect(calledCmd).toContain("gh issue close 5");
  });
});

describe("reopenIssue", () => {
  it("calls gh issue reopen", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return "";
    });

    github.reopenIssue(5);

    expect(mockExecSync).toHaveBeenCalled();
    const calledCmd = mockExecSync.mock.calls[0][0] as string;
    expect(calledCmd).toContain("gh issue reopen 5");
  });
});

describe("listIssues", () => {
  it("parses and returns issues", () => {
    const issues = [
      { number: 1, title: "First issue", state: "open", labels: ["task"] },
      { number: 2, title: "Second issue", state: "closed", labels: ["bug"] },
    ];

    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return JSON.stringify(issues);
    });

    const result = github.listIssues();

    expect(result).toEqual(issues);
    expect(mockExecSync).toHaveBeenCalled();
    const calledCmd = mockExecSync.mock.calls[0][0] as string;
    expect(calledCmd).toContain("gh issue list --state all --limit 1000");
  });
});

describe("commentOnIssue", () => {
  it("calls gh issue comment", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return "";
    });

    github.commentOnIssue(3, "This is a comment");

    expect(mockExecSync).toHaveBeenCalled();
    const calledCmd = mockExecSync.mock.calls[0][0] as string;
    expect(calledCmd).toContain("gh issue comment 3");
    expect(calledCmd).toContain("--body \"This is a comment\"");
  });

  it("escapes double quotes in comments", () => {
    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return "";
    });

    github.commentOnIssue(3, 'He said "hello"');

    expect(mockExecSync).toHaveBeenCalled();
    const calledCmd = mockExecSync.mock.calls[0][0] as string;
    expect(calledCmd).toContain('He said \\"hello\\"');
  });
});

describe("getIssueUrl", () => {
  it("returns issue URL", () => {
    const url = "https://github.com/owner/repo/issues/10";

    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return url;
    });

    expect(github.getIssueUrl(10)).toBe(url);
    expect(mockExecSync).toHaveBeenCalled();
    const calledCmd = mockExecSync.mock.calls[0][0] as string;
    expect(calledCmd).toContain("gh issue view 10");
  });
});

describe("getLinkedPRs", () => {
  it("returns linked PRs", () => {
    const prs = [
      { number: 42, title: "Fix thing", state: "open", url: "https://github.com/owner/repo/pull/42" },
    ];

    mockExecSync.mockImplementation((_cmd: string, _options: any) => {
      return JSON.stringify(prs);
    });

    const result = github.getLinkedPRs(10);

    expect(result).toEqual(prs);
    expect(mockExecSync).toHaveBeenCalled();
    const calledCmd = mockExecSync.mock.calls[0][0] as string;
    expect(calledCmd).toContain("gh pr list");
    expect(calledCmd).toContain("fixes #10");
  });
});
