import { execSync } from "node:child_process";
import { ensureGithubPrerequisites } from "../lib/config";
import { getLinkedPRs, commentOnIssue } from "../lib/github";
import { listTasks, readTask, updateFrontmatter, resolveId } from "../lib/store";
import { bold, dim, red, green, yellow, cyan, padRight } from "../lib/format";

export function run(args: string[]): void {
  const sub = args[0];
  if (sub === "link") cmdLink(args.slice(1));
  else if (sub === "list") cmdList(args.slice(1));
  else if (sub === "status") cmdStatus();
  else {
    console.error("Usage: tasks pr <link|list|status>");
    process.exit(1);
  }
}

function cmdLink(args: string[]): void {
  const taskIdPartial = args[0];
  const prNumberStr = args[1];

  if (!taskIdPartial || !prNumberStr) {
    console.error("Usage: tasks pr link <task-id> <pr-number>");
    process.exit(1);
  }

  const id = resolveId(taskIdPartial);
  const { task } = readTask(id);

  if (task.githubIssue === undefined) {
    console.log(yellow("Warning: This task is not linked to a GitHub issue. Run 'tasks sync push' first."));
  }

  const prNumber = parseInt(prNumberStr, 10);
  if (isNaN(prNumber)) {
    console.error(red(`Invalid PR number: "${prNumberStr}"`));
    process.exit(1);
  }

  updateFrontmatter(id, { githubPR: prNumber });

  if (task.githubIssue !== undefined) {
    try {
      commentOnIssue(task.githubIssue, `Linked to PR #${prNumber}`);
    } catch (e: any) {
      console.error(yellow(`Warning: Could not comment on issue #${task.githubIssue}: ${e.message}`));
    }
  }

  console.log(green(`✓ Linked PR #${prNumber} to task ${id}`));
}

function cmdList(args: string[]): void {
  if (args[0]) {
    // List PRs for a specific task
    const id = resolveId(args[0]);
    const { task } = readTask(id);

    if (task.githubPR !== undefined) {
      console.log(`  ${cyan(`#${task.githubPR}`)} — ${task.title}`);
      return;
    }

    if (task.githubIssue !== undefined) {
      try {
        const linkedPRs = getLinkedPRs(task.githubIssue);
        if (linkedPRs.length > 0) {
          for (const pr of linkedPRs) {
            console.log(`  ${cyan(`#${pr.number}`)} — ${pr.title} (${pr.state})`);
          }
        } else {
          console.log(dim("No linked PRs found for this task."));
        }
      } catch (e: any) {
        console.error(yellow(`Could not fetch linked PRs: ${e.message}`));
      }
      return;
    }

    console.log(dim("This task is not linked to a GitHub issue or PR."));
    return;
  }

  // List all tasks with PRs or issues
  const items = listTasks().map((t) => t.task);
  const linked = items.filter((t) => t.githubPR !== undefined || t.githubIssue !== undefined);

  if (linked.length === 0) {
    console.log(dim("No tasks linked to PRs."));
    return;
  }

  const header = [
    bold(padRight("ID", 10)),
    bold(padRight("PR#", 8)),
    bold(padRight("ISSUE#", 8)),
    bold("TITLE"),
  ].join("  ");
  console.log(header);

  for (const t of linked) {
    const pr = t.githubPR !== undefined ? `#${t.githubPR}` : "";
    const issue = t.githubIssue !== undefined ? `#${t.githubIssue}` : "";
    console.log(
      [padRight(t.id, 10), padRight(pr, 8), padRight(issue, 8), t.title].join("  ")
    );
  }
}

function cmdStatus(): void {
  const prereq = ensureGithubPrerequisites();
  if (typeof prereq === "string") {
    console.error(red(prereq));
    process.exit(1);
  }

  const items = listTasks().map((t) => t.task);
  const withPR = items.filter((t) => t.githubPR !== undefined);

  if (withPR.length === 0) {
    console.log(dim("No tasks linked to PRs. Use 'tasks pr link <task-id> <pr-number>' to link."));
    return;
  }

  console.log("");
  const header = [
    bold(padRight("ID", 10)),
    bold(padRight("PR#", 8)),
    bold(padRight("STATE", 10)),
    bold(padRight("MERGEABLE", 12)),
    bold("TITLE"),
  ].join("  ");
  console.log(header);

  for (const t of withPR) {
    let state = "UNKNOWN";
    let mergeable = "UNKNOWN";

    try {
      const result = execSync(
        `gh pr view ${t.githubPR} --json number,title,state,mergeable --jq '{number,title,state,mergeable}'`,
        { stdio: "pipe", encoding: "utf-8" }
      ).trim();
      const info = JSON.parse(result);
      state = (info.state as string).toUpperCase();
      mergeable = (info.mergeable as string ?? "UNKNOWN").toUpperCase();
    } catch {
      // keep defaults
    }

    const stateStr = formatPRState(state);
    const mergeableStr = formatMergeable(mergeable);

    console.log(
      [padRight(t.id, 10), padRight(`#${t.githubPR}`, 8), padRight(stateStr, 10), padRight(mergeableStr, 12), t.title].join("  ")
    );
  }
}

function formatPRState(state: string): string {
  switch (state) {
    case "MERGED":
      return green("MERGED");
    case "OPEN":
      return yellow("OPEN");
    case "CLOSED":
      return dim("CLOSED");
    default:
      return dim(state);
  }
}

function formatMergeable(mergeable: string): string {
  switch (mergeable) {
    case "MERGEABLE":
      return green("MERGEABLE");
    case "CONFLICTING":
      return red("CONFLICTING");
    default:
      return dim(mergeable);
  }
}
