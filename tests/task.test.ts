import { describe, it, expect } from "bun:test";
import { parseTaskFile, serializeTask } from "../src/lib/task";
import type { Task } from "../src/types";

const sampleTask: Task = {
  id: "a1b2c3d4",
  title: "Fix auth token expiry validation",
  status: "open",
  priority: "p1",
  type: "bug",
  dependsOn: [],
  created: "2025-03-30T14:22:00Z",
  updated: "2025-03-30T14:22:00Z",
};

const sampleBody = `## Description

The JWT validation doesn't check the \`exp\` claim properly.

## Acceptance criteria

- [ ] Token with expired \`exp\` is rejected`;

describe("parseTaskFile", () => {
  it("parses frontmatter and body", () => {
    const content = serializeTask(sampleTask, sampleBody);
    const { task, body } = parseTaskFile(content);

    expect(task.id).toBe("a1b2c3d4");
    expect(task.title).toBe("Fix auth token expiry validation");
    expect(task.status).toBe("open");
    expect(task.priority).toBe("p1");
    expect(task.type).toBe("bug");
    expect(body).toBe(sampleBody);
  });

  it("throws on missing frontmatter", () => {
    expect(() => parseTaskFile("just some text")).toThrow("Invalid task file");
  });
});

describe("serializeTask", () => {
  it("produces valid frontmatter + body", () => {
    const result = serializeTask(sampleTask, sampleBody);
    expect(result).toContain("id: a1b2c3d4");
    expect(result).toContain("title: Fix auth token expiry validation");
    expect(result).toContain("status: open");
    expect(result).toContain("## Description");
  });
});

describe("roundtrip", () => {
  it("write then read preserves all fields", () => {
    const serialized = serializeTask(sampleTask, sampleBody);
    const { task, body } = parseTaskFile(serialized);

    expect(task).toEqual(sampleTask);
    expect(body).toBe(sampleBody);
  });

  it("preserves title with colons", () => {
    const task: Task = { ...sampleTask, title: 'Fix: the "thing"' };
    const serialized = serializeTask(task, "body");
    const { task: parsed } = parseTaskFile(serialized);
    expect(parsed.title).toBe('Fix: the "thing"');
  });
});
