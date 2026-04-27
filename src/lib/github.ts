import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync, unlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Task, TaskStatus } from "../types";

/**
 * Execute a `gh` command safely via execFileSync (no shell interpolation).
 * Returns trimmed stdout.
 */
function execGh(args: string[], input?: Buffer): string {
  try {
    const result = execFileSync("gh", args, {
      stdio: ["pipe", "pipe", "pipe"],
      maxBuffer: 10 * 1024 * 1024,
      encoding: "utf-8",
      ...(input ? { input } : {}),
    });
    return String(result).trim();
  } catch (err: any) {
    const stderr = err.stderr?.toString().trim();
    throw new Error(`gh command failed: ${stderr || err.message}`);
  }
}

/**
 * Write content to a temporary file and return its path.
 * Caller is responsible for cleaning up.
 */
function writeTempFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "tasks-cli-"));
  const filePath = join(dir, "body.md");
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}

/**
 * Remove a temp file and its parent directory.
 */
function cleanupTempFile(filePath: string): void {
  try {
    unlinkSync(filePath);
    rmSync(join(filePath, ".."), { recursive: true, force: true });
  } catch {
    // best effort
  }
}

export function isGhInstalled(): boolean {
  try {
    execFileSync("gh", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getRepoInfo(): { owner: string; repo: string } | null {
  try {
    const nameWithOwner = execGh(["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"]);
    const [owner, repo] = nameWithOwner.split("/");
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

export function statusToIssueState(status: TaskStatus): { state: string; labels: string[] } {
  switch (status) {
    case "open":
      return { state: "open", labels: ["task"] };
    case "in-progress":
      return { state: "open", labels: ["task", "in-progress"] };
    case "blocked":
      return { state: "open", labels: ["task", "blocked"] };
    case "done":
      return { state: "closed", labels: [] };
    case "cancelled":
      return { state: "closed", labels: [] };
  }
}

export function issueStateToLocal(state: string): TaskStatus {
  return state === "closed" ? "done" : "open";
}

export function createIssue(task: Task, body: string, labels: string[]): number {
  const bodyFile = writeTempFile(body);
  try {
    const args = [
      "issue", "create",
      "--title", task.title,
      "--body-file", bodyFile,
      "--json", "number",
      "-q", ".number",
    ];
    if (labels.length > 0) {
      args.push("--label", labels.join(","));
    }
    const result = execGh(args);
    return parseInt(result, 10);
  } finally {
    cleanupTempFile(bodyFile);
  }
}

export function updateIssue(issueNumber: number, task: Task, body: string, labels: string[]): void {
  const bodyFile = writeTempFile(body);
  try {
    const args = [
      "issue", "edit",
      String(issueNumber),
      "--title", task.title,
      "--body-file", bodyFile,
    ];
    if (labels.length > 0) {
      args.push("--add-label", labels.join(","));
    }
    execGh(args);
  } finally {
    cleanupTempFile(bodyFile);
  }
}

export function closeIssue(issueNumber: number): void {
  execGh(["issue", "close", String(issueNumber)]);
}

export function reopenIssue(issueNumber: number): void {
  execGh(["issue", "reopen", String(issueNumber)]);
}

export function listIssues(): { number: number; title: string; state: string; labels: string[] }[] {
  const result = execGh([
    "issue", "list",
    "--state", "all",
    "--limit", "1000",
    "--json", "number,title,state,labels",
  ]);
  const parsed: { number: number; title: string; state: string; labels: { name: string }[] }[] = JSON.parse(result);
  return parsed.map((i) => ({
    number: i.number,
    title: i.title,
    state: i.state,
    labels: i.labels.map((l) => l.name),
  }));
}

export function getLinkedPRs(issueNumber: number): { number: number; title: string; state: string; url: string }[] {
  const result = execGh([
    "pr", "list",
    "--search", `fixes #${issueNumber} or closes #${issueNumber} or Fixes #${issueNumber} or Closes #${issueNumber}`,
    "--state", "all",
    "--limit", "100",
    "--json", "number,title,state,url",
  ]);
  return JSON.parse(result);
}

export function commentOnIssue(issueNumber: number, comment: string): void {
  const bodyFile = writeTempFile(comment);
  try {
    execGh(["issue", "comment", String(issueNumber), "--body-file", bodyFile]);
  } finally {
    cleanupTempFile(bodyFile);
  }
}

export function getIssueUrl(issueNumber: number): string {
  return execGh(["issue", "view", String(issueNumber), "--json", "url", "-q", ".url"]);
}
