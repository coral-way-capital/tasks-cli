import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

const TEST_DIR = join("/tmp", `.tasks-test-cmds-${process.pid}`);

beforeEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
});

function run(cmd: string, env?: Record<string, string>): string {
  return execSync(`bun run src/cli.ts ${cmd}`, {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
}

function runInTestDir(cmd: string, env?: Record<string, string>): string {
  return execSync(`bun run ${join(process.cwd(), "src/cli.ts")} ${cmd}`, {
    cwd: TEST_DIR,
    env: { ...process.env, ...env },
    encoding: "utf-8",
  });
}

describe("CLI help", () => {
  it("prints usage with no args", () => {
    const out = run("");
    expect(out).toContain("tasks — task spec manager");
  });

  it("prints usage with --help", () => {
    const out = run("--help");
    expect(out).toContain("tasks — task spec manager");
  });

  it("prints error for unknown command", () => {
    expect(() => run("bogus")).toThrow("Unknown command");
  });
});

describe("new command", () => {
  it("creates a task file", () => {
    const out = runInTestDir('new "Fix the thing"');
    expect(out).toContain("Created task");
    expect(out).toContain("Fix the thing");

    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    expect(files).toMatch(/^[a-f0-9]{8}\.md$/);
  });

  it("creates with custom priority and type", () => {
    const out = runInTestDir('new "Urgent bug" --priority p0 --type bug');
    expect(out).toContain("Created task");

    const file = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const content = readFileSync(join(TEST_DIR, ".tasks", file), "utf-8");
    expect(content).toContain("priority: p0");
    expect(content).toContain("type: bug");
  });

  it("defaults to p1 and feat", () => {
    runInTestDir('new "Default task"');
    const file = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const content = readFileSync(join(TEST_DIR, ".tasks", file), "utf-8");
    expect(content).toContain("priority: p1");
    expect(content).toContain("type: feat");
  });

  it("uses ISO timestamp", () => {
    runInTestDir('new "Timestamp task"');
    const file = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const content = readFileSync(join(TEST_DIR, ".tasks", file), "utf-8");
    expect(content).toMatch(/created: \d{4}-\d{2}-\d{2}T/);
  });
});

describe("list command", () => {
  it("shows no tasks message when empty", () => {
    const out = runInTestDir("list");
    expect(out).toContain("No tasks found");
  });

  it("lists tasks", () => {
    runInTestDir('new "Task A" --priority p0');
    runInTestDir('new "Task B" --priority p1');
    const out = runInTestDir("list --all");
    expect(out).toContain("Task A");
    expect(out).toContain("Task B");
  });

  it("excludes done by default", () => {
    runInTestDir('new "Open task"');
    runInTestDir('new "Done task"');
    // Mark second task as done
    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim().split("\n");
    // Read both files to find which is which
    for (const f of files) {
      const content = readFileSync(join(TEST_DIR, ".tasks", f), "utf-8");
      if (content.includes("Done task")) {
        const id = f.replace(".md", "");
        runInTestDir(`done ${id}`);
      }
    }
    const out = runInTestDir("list");
    expect(out).toContain("Open task");
    expect(out).not.toContain("Done task");
  });

  it("--all includes done tasks", () => {
    runInTestDir('new "Done task"');
    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim().split("\n");
    for (const f of files) {
      const id = f.replace(".md", "");
      runInTestDir(`done ${id}`);
    }
    const out = runInTestDir("list --all");
    expect(out).toContain("Done task");
  });

  it("filters by status", () => {
    runInTestDir('new "Open task"');
    const out = runInTestDir("list --status open");
    expect(out).toContain("Open task");
  });

  it("sorts by priority then created date", () => {
    runInTestDir('new "Low prio" --priority p2');
    runInTestDir('new "High prio" --priority p0');
    const out = runInTestDir("list --all");
    const lines = out.split("\n").filter((l) => l.match(/^[a-f0-9]{8}/));
    expect(lines[0]).toContain("High prio");
    expect(lines[1]).toContain("Low prio");
  });
});

describe("show command", () => {
  it("shows task with partial ID", () => {
    runInTestDir('new "Show me"');
    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const id = files.replace(".md", "");
    const out = runInTestDir(`show ${id.slice(0, 4)}`);
    expect(out).toContain("Show me");
  });

  it("errors on invalid ID", () => {
    expect(() => runInTestDir("show zzzz")).toThrow();
  });
});

describe("status command", () => {
  it("updates status", () => {
    runInTestDir('new "Status task"');
    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const id = files.replace(".md", "");
    const out = runInTestDir(`status ${id} in-progress`);
    expect(out).toContain("in-progress");
  });

  it("rejects invalid status", () => {
    expect(() => runInTestDir("status abc invalid")).toThrow();
  });
});

describe("done command", () => {
  it("marks task done", () => {
    runInTestDir('new "Done task"');
    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const id = files.replace(".md", "");
    const out = runInTestDir(`done ${id}`);
    expect(out).toContain("done");

    const content = readFileSync(join(TEST_DIR, ".tasks", files), "utf-8");
    expect(content).toContain("status: done");
  });
});

describe("edit command", () => {
  it("prints path when no EDITOR set", () => {
    runInTestDir('new "Edit task"');
    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const id = files.replace(".md", "");
    const out = runInTestDir(`edit ${id}`, { EDITOR: "" });
    expect(out).toContain(".tasks/");
    expect(out).toContain(".md");
  });

  it("--body replaces body from stdin", () => {
    runInTestDir('new "Body task"');
    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const id = files.replace(".md", "");

    execSync(`echo "## New body" | bun run ${join(process.cwd(), "src/cli.ts")} edit ${id} --body`, {
      cwd: TEST_DIR,
      env: process.env,
      encoding: "utf-8",
    });

    const content = readFileSync(join(TEST_DIR, ".tasks", files), "utf-8");
    expect(content).toContain("## New body");
    expect(content).toContain("status: open"); // frontmatter preserved
  });
});

describe("new --body", () => {
  it("reads body from stdin", () => {
    execSync(`echo "## Custom body\n\nSome details" | bun run ${join(process.cwd(), "src/cli.ts")} new "Stdin task" --body`, {
      cwd: TEST_DIR,
      env: process.env,
      encoding: "utf-8",
    });

    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const content = readFileSync(join(TEST_DIR, ".tasks", files), "utf-8");
    expect(content).toContain("## Custom body");
    expect(content).toContain("Some details");
    expect(content).toContain("title: Stdin task");
  });

  it("works with --priority and --type alongside --body", () => {
    execSync(`echo "## Body" | bun run ${join(process.cwd(), "src/cli.ts")} new "Full task" --body -p p0 -t bug`, {
      cwd: TEST_DIR,
      env: process.env,
      encoding: "utf-8",
    });

    const files = execSync("ls .tasks/", { cwd: TEST_DIR, encoding: "utf-8" }).trim();
    const content = readFileSync(join(TEST_DIR, ".tasks", files), "utf-8");
    expect(content).toContain("priority: p0");
    expect(content).toContain("type: bug");
    expect(content).toContain("## Body");
  });
});

describe("NO_COLOR", () => {
  it("disables colored output", () => {
    runInTestDir('new "Color task"');
    const out = runInTestDir("list", { NO_COLOR: "1" });
    // Should not contain ANSI escape codes
    expect(out).not.toMatch(/\x1b\[/);
  });
});
