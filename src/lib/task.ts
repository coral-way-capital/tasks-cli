import type { Task } from "../types";

export function parseTaskFile(content: string): { task: Task; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    throw new Error("Invalid task file: missing frontmatter");
  }

  const [, frontmatterStr, body] = match;
  const meta: Record<string, string | string[]> = {};

  for (const line of frontmatterStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();

    // Parse inline YAML list: dependsOn: [a1b2c3d4, e5f6g7h8]
    if (value.startsWith("[") && value.endsWith("]")) {
      const items = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      meta[key] = items;
    } else {
      meta[key] = value;
    }
  }

  const task: Task = {
    id: meta.id as string,
    title: unquote(meta.title as string),
    status: meta.status as Task["status"],
    priority: meta.priority as Task["priority"],
    type: meta.type as Task["type"],
    dependsOn: Array.isArray(meta.dependsOn) ? meta.dependsOn : [],
    created: meta.created as string,
    updated: meta.updated as string,
  };

  if (meta.githubIssue !== undefined) {
    task.githubIssue = parseInt(meta.githubIssue as string, 10) || undefined;
  }
  if (meta.githubPR !== undefined) {
    task.githubPR = parseInt(meta.githubPR as string, 10) || undefined;
  }

  return { task, body: body.trimEnd() };
}

export function serializeTask(task: Task, body: string): string {
  const lines = [
    "---",
    `id: ${task.id}`,
    `title: ${quote(task.title)}`,
    `status: ${task.status}`,
    `priority: ${task.priority}`,
    `type: ${task.type}`,
  ];

  if (task.dependsOn?.length > 0) {
    lines.push(`dependsOn: [${task.dependsOn.join(", ")}]`);
  }

  lines.push(
    `created: ${task.created}`,
    `updated: ${task.updated}`,
  );

  if (task.githubIssue !== undefined) {
    lines.push(`githubIssue: ${task.githubIssue}`);
  }
  if (task.githubPR !== undefined) {
    lines.push(`githubPR: ${task.githubPR}`);
  }

  lines.push(
    "---",
    "",
  );

  const frontmatter = lines.join("\n");
  return frontmatter + body + "\n";
}

function quote(s: string): string {
  if (s.includes(":") || s.includes("#") || s.includes('"') || s.includes("'")) {
    return `"${s.replace(/"/g, '\\"')}"`;
  }
  return s;
}

function unquote(s: string): string {
  if (s.startsWith('"') && s.endsWith('"')) {
    return s.slice(1, -1).replace(/\\"/g, '"');
  }
  return s;
}
