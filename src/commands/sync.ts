import { loadConfig, isGithubEnabled, ensureGithubPrerequisites } from "../lib/config";
import {
  createIssue,
  updateIssue,
  closeIssue,
  reopenIssue,
  listIssues,
  statusToIssueState,
} from "../lib/github";
import { listTasks, readTask, updateFrontmatter, resolveId } from "../lib/store";
import { bold, dim, red, green, yellow } from "../lib/format";
import type { TaskStatus } from "../types";

export function run(args: string[]): void {
  const subcommand = args[0];

  switch (subcommand) {
    case "push":
      cmdPush(args.slice(1));
      break;
    case "pull":
      cmdPull(args.slice(1));
      break;
    case "check":
      cmdCheck(args.slice(1));
      break;
    default:
      cmdSync(args);
      break;
  }
}

function checkPrerequisites(): void {
  if (!isGithubEnabled()) {
    console.log(dim("GitHub integration is not enabled. Run 'tasks github enable' first."));
    process.exit(0);
  }

  const result = ensureGithubPrerequisites();
  if (typeof result === "string") {
    console.error(red(result));
    process.exit(1);
  }
}

function parseTaskFlag(args: string[]): string | undefined {
  const idx = args.indexOf("--task");
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return undefined;
}

function cmdSync(args: string[]): void {
  checkPrerequisites();
  console.log(bold("Syncing with GitHub..."));

  const pullSummary = doPull(false);
  const pushSummary = doPush(false);

  const total =
    pullSummary.changed +
    pushSummary.created +
    pushSummary.updated;

  if (total === 0) {
    console.log(green("  ✓ Everything is in sync."));
  } else {
    if (pullSummary.changed) {
      console.log(green(`  ✓ Pulled ${pullSummary.changed} change(s).`));
    }
    if (pushSummary.created) {
      console.log(green(`  ✓ Pushed ${pushSummary.created} new issue(s).`));
    }
    if (pushSummary.updated) {
      console.log(green(`  ✓ Updated ${pushSummary.updated} issue(s).`));
    }
  }
}

function cmdPush(args: string[]): void {
  checkPrerequisites();
  doPush(true, args);
}

function cmdPull(args: string[]): void {
  checkPrerequisites();
  doPull(true, args);
}

function doPush(verbose: boolean, args: string[] = []): { created: number; updated: number } {
  const config = loadConfig();
  const defaultLabels = config.github?.labels ?? ["task"];
  const taskPartial = parseTaskFlag(args);

  // Fetch remote issues once for state lookups
  let remoteStateMap: Map<number, string>;
  try {
    const remoteIssues = listIssues();
    remoteStateMap = new Map();
    for (const issue of remoteIssues) {
      remoteStateMap.set(issue.number, issue.state);
    }
  } catch (e: any) {
    console.error(red(`Failed to list remote issues: ${e.message}`));
    return { created: 0, updated: 0 };
  }

  // Determine which tasks to work on
  let items: { task: any; body: string }[];
  if (taskPartial) {
    const id = resolveId(taskPartial);
    const { task, body } = readTask(id);
    items = [{ task, body }];
  } else {
    items = listTasks();
  }

  let created = 0;
  let updated = 0;

  for (const { task, body } of items) {
    const mapped = statusToIssueState(task.status as TaskStatus);
    const combinedLabels = [...new Set([...defaultLabels, ...mapped.labels])];

    if (task.githubIssue !== undefined) {
      // Update existing issue
      updateIssue(task.githubIssue, task, body, combinedLabels);

      const remoteState = remoteStateMap.get(task.githubIssue) ?? "open";
      const isTerminal = task.status === "done" || task.status === "cancelled";

      if (isTerminal && remoteState !== "closed") {
        closeIssue(task.githubIssue);
      } else if (!isTerminal && remoteState === "closed") {
        reopenIssue(task.githubIssue);
      }

      console.log(green(`  ↗ Updated issue #${task.githubIssue}: ${task.title}`));
      updated++;
    } else {
      // Create new issue
      const issueNumber = createIssue(task, body, defaultLabels);
      updateFrontmatter(task.id, { githubIssue: issueNumber });

      const isTerminal = task.status === "done" || task.status === "cancelled";
      if (isTerminal) {
        closeIssue(issueNumber);
      }

      console.log(green(`  + Created issue #${issueNumber}: ${task.title}`));
      created++;
    }
  }

  if (verbose && created === 0 && updated === 0) {
    console.log(green("  ✓ Nothing to push."));
  }

  return { created, updated };
}

function doPull(verbose: boolean, args: string[] = []): { changed: number; unchanged: number } {
  // Fetch remote issues
  let remoteIssues: { number: number; title: string; state: string; labels: string[] }[];
  try {
    remoteIssues = listIssues();
  } catch (e: any) {
    console.error(red(`Failed to list remote issues: ${e.message}`));
    return { changed: 0, unchanged: 0 };
  }

  const remoteMap = new Map<number, { title: string; state: string; labels: string[] }>();
  for (const issue of remoteIssues) {
    remoteMap.set(issue.number, issue);
  }

  const taskPartial = parseTaskFlag(args);
  let localItems: { task: any; body: string }[];
  if (taskPartial) {
    const id = resolveId(taskPartial);
    localItems = [readTask(id)];
  } else {
    localItems = listTasks();
  }

  let changed = 0;
  let unchanged = 0;

  for (const { task } of localItems) {
    if (task.githubIssue === undefined) {
      unchanged++;
      continue;
    }

    const remote = remoteMap.get(task.githubIssue);
    if (!remote) {
      unchanged++;
      continue;
    }

    const isTerminalLocal = task.status === "done" || task.status === "cancelled";

    if (remote.state === "closed" && !isTerminalLocal) {
      updateFrontmatter(task.id, { status: "done" });
      console.log(yellow(`  ← Issue #${task.githubIssue} closed on GitHub → task ${task.id} marked done`));
      changed++;
    } else if (remote.state === "open" && task.status === "done") {
      updateFrontmatter(task.id, { status: "open" });
      console.log(yellow(`  ← Issue #${task.githubIssue} reopened on GitHub → task ${task.id} set to open`));
      changed++;
    } else {
      unchanged++;
    }
  }

  if (verbose && changed === 0) {
    console.log(green("  ✓ Everything is up to date."));
  }

  return { changed, unchanged };
}

function cmdCheck(args: string[]): void {
  checkPrerequisites();

  // Fetch remote issues
  let remoteIssues: { number: number; title: string; state: string; labels: string[] }[];
  try {
    remoteIssues = listIssues();
  } catch (e: any) {
    console.error(red(`Failed to list remote issues: ${e.message}`));
    return;
  }

  const remoteMap = new Map<number, { title: string; state: string; labels: string[] }>();
  for (const issue of remoteIssues) {
    remoteMap.set(issue.number, issue);
  }

  const localItems = listTasks();
  // --- Push check ---
  console.log(bold("Push (local → GitHub):"));

  const toCreate: any[] = [];
  const toUpdate: any[] = [];

  for (const { task } of localItems) {
    if (task.githubIssue !== undefined) {
      const remote = remoteMap.get(task.githubIssue);
      const mapped = statusToIssueState(task.status as TaskStatus);
      const needsStateChange =
        (mapped.state === "closed" && remote?.state !== "closed") ||
        (mapped.state === "open" && remote?.state === "closed");
      if (needsStateChange || remote === undefined) {
        toUpdate.push(task);
      }
    } else {
      toCreate.push(task);
    }
  }

  if (toCreate.length === 0 && toUpdate.length === 0) {
    console.log(green("  ✓ Nothing to push."));
  } else {
    for (const task of toCreate) {
      console.log(dim(`  + Would create issue: ${task.title}`));
    }
    for (const task of toUpdate) {
      console.log(dim(`  ↗ Would update issue #${task.githubIssue}: ${task.title}`));
    }
  }

  // --- Pull check ---
  console.log("");
  console.log(bold("Pull (GitHub → local):"));

  const toPull: { task: any; remoteState: string; newStatus: string }[] = [];

  for (const { task } of localItems) {
    if (task.githubIssue === undefined) continue;
    const remote = remoteMap.get(task.githubIssue);
    if (!remote) continue;

    const isTerminalLocal = task.status === "done" || task.status === "cancelled";

    if (remote.state === "closed" && !isTerminalLocal) {
      toPull.push({ task, remoteState: "closed", newStatus: "done" });
    } else if (remote.state === "open" && task.status === "done") {
      toPull.push({ task, remoteState: "open", newStatus: "open" });
    }
  }

  if (toPull.length === 0) {
    console.log(green("  ✓ Nothing to pull."));
  } else {
    for (const { task, remoteState, newStatus } of toPull) {
      console.log(
        dim(`  ← Issue #${task.githubIssue} (${remoteState}) → task ${task.id} would be set to ${newStatus}`)
      );
    }
  }

  // --- Summary ---
  console.log("");
  const total = toCreate.length + toUpdate.length + toPull.length;
  if (total === 0) {
    console.log(green("✓ Everything is in sync."));
  } else {
    console.log(yellow(`${total} change(s) detected.`));
  }
  console.log(dim("(dry run — no changes made)"));
}
