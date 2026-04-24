import { execSync } from "node:child_process";
import type { Task, TaskStatus } from "../types";

function execGh(args: string): string {
  try {
    return execSync(`gh ${args}`, { stdio: "pipe", encoding: "utf-8" }).trim();
  } catch (err: any) {
    throw new Error(`gh command failed: ${err.stderr?.toString().trim() || err.message}`);
  }
}

export function isGhInstalled(): boolean {
  try {
    execSync("which gh", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function getRepoInfo(): { owner: string; repo: string } | null {
  try {
    const nameWithOwner = execGh("repo view --json nameWithOwner -q .nameWithOwner");
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

function escapeShell(str: string): string {
  return str.replace(/"/g, '\\"');
}

export function createIssue(task: Task, body: string, labels: string[]): number {
  const title = escapeShell(task.title);
  const escapedBody = escapeShell(body);
  const labelArg = labels.length > 0 ? `--label "${labels.join(",")}"` : "";
  const result = execGh(
    `issue create --title "${title}" --body "${escapedBody}" ${labelArg} --json number -q .number`
  );
  return parseInt(result, 10);
}

export function updateIssue(issueNumber: number, task: Task, body: string, labels: string[]): void {
  const title = escapeShell(task.title);
  const escapedBody = escapeShell(body);
  const labelArg = labels.length > 0 ? ` --add-label "${labels.join(",")}"` : "";
  execGh(
    `issue edit ${issueNumber} --title "${title}" --body "${escapedBody}"${labelArg}`
  );
}

export function closeIssue(issueNumber: number): void {
  execGh(`issue close ${issueNumber}`);
}

export function reopenIssue(issueNumber: number): void {
  execGh(`issue reopen ${issueNumber}`);
}

export function listIssues(): { number: number; title: string; state: string; labels: string[] }[] {
  const result = execGh(
    `issue list --state all --limit 1000 --json number,title,state,labels -q '.[] | {number, title, state, labels: [.labels[].name]}'`
  );
  return JSON.parse(result);
}

export function getLinkedPRs(issueNumber: number): { number: number; title: string; state: string; url: string }[] {
  const result = execGh(
    `pr list --search "fixes #${issueNumber} or closes #${issueNumber} or Fixes #${issueNumber} or Closes #${issueNumber}" --state all --limit 100 --json number,title,state,url`
  );
  return JSON.parse(result);
}

export function commentOnIssue(issueNumber: number, comment: string): void {
  const escaped = escapeShell(comment);
  execGh(`issue comment ${issueNumber} --body "${escaped}"`);
}

export function getIssueUrl(issueNumber: number): string {
  return execGh(`issue view ${issueNumber} --json url -q .url`);
}
