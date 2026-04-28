import { loadConfig, isGithubEnabled, ensureGithubPrerequisites } from "../lib/config";
import {
  createIssue,
  updateIssue,
  closeIssue,
  reopenIssue,
  listIssues,
  commentOnIssue,
  statusToIssueState,
} from "../lib/github";
import { listTasks, readTask, updateFrontmatter, resolveId } from "../lib/store";
import { bold, dim, red, green, yellow } from "../lib/format";
import type { Task, TaskStatus } from "../types";

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

// ── Dependency-aware body builder ─────────────────────────────────────────

/**
 * Build a map of task-id → { title, githubIssue? } for all tasks,
 * used to resolve dependency cross-references.
 */
function buildTaskIndex(items: { task: Task; body: string }[]): Map<string, { title: string; githubIssue?: number }> {
  const index = new Map<string, { title: string; githubIssue?: number }>();
  for (const { task } of items) {
    index.set(task.id, { title: task.title, githubIssue: task.githubIssue });
  }
  return index;
}

/**
 * Inject dependency and blocks sections into the issue body if the task
 * has dependsOn or is depended upon by other tasks.
 *
 * We insert a structured section at the top of the body (after any existing
 * frontmatter-parsed content). We avoid duplicating if already present.
 */
function buildIssueBody(
  task: Task,
  rawBody: string,
  taskIndex: Map<string, { title: string; githubIssue?: number }>,
  allTasks: Task[],
): string {
  const sections: string[] = [];

  // ── Dependencies section ──
  if (task.dependsOn.length > 0) {
    const lines = ["## Dependencies", "", "This task depends on:"];
    for (const depId of task.dependsOn) {
      const dep = taskIndex.get(depId);
      if (dep) {
        const ref = dep.githubIssue ? `#${dep.githubIssue}` : `\`${depId}\``;
        lines.push(`- ${ref} — ${dep.title}`);
      } else {
        lines.push(`- \`${depId}\` (unknown task)`);
      }
    }
    lines.push("");
    sections.push(lines.join("\n"));
  }

  // ── Blocks section ──
  const blockedBy = allTasks.filter((t) => t.dependsOn.includes(task.id));
  if (blockedBy.length > 0) {
    const lines = ["## Blocks", "", "The following tasks depend on this one:"];
    for (const b of blockedBy) {
      const bInfo = taskIndex.get(b.id);
      const ref = bInfo?.githubIssue ? `#${bInfo.githubIssue}` : `\`${b.id}\``;
      const title = bInfo?.title ?? b.title;
      lines.push(`- ${ref} — ${title}`);
    }
    lines.push("");
    sections.push(lines.join("\n"));
  }

  if (sections.length === 0) return rawBody;

  return sections.join("\n") + "\n" + rawBody;
}

/**
 * Post cross-reference comments on issues that this task depends on or blocks.
 * Only posts for newly-created issues to avoid duplicate comments on re-push.
 */
function postDependencyComments(
  task: Task,
  issueNumber: number,
  taskIndex: Map<string, { title: string; githubIssue?: number }>,
  allTasks: Task[],
): void {
  // ── Comment on issues this task depends on ──
  for (const depId of task.dependsOn) {
    const dep = taskIndex.get(depId);
    if (dep?.githubIssue) {
      commentOnIssue(dep.githubIssue, `🔓 **Blocks:** #${issueNumber} — ${task.title}`);
    }
  }

  // ── Comment on issues that depend on this one ──
  const blockedBy = allTasks.filter((t) => t.dependsOn.includes(task.id));
  for (const b of blockedBy) {
    const bInfo = taskIndex.get(b.id);
    if (bInfo?.githubIssue) {
      commentOnIssue(bInfo.githubIssue, `📦 **Depends on:** #${issueNumber} — ${task.title}`);
    }
  }
}

// ── Push logic ────────────────────────────────────────────────────────────

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
      remoteStateMap.set(issue.number, issue.state.toLowerCase());
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

  // Build dependency index from ALL tasks (not just filtered ones)
  const allItems = listTasks();
  const allTasks = allItems.map((i) => i.task as Task);
  const taskIndex = buildTaskIndex(allItems);

  let created = 0;
  let updated = 0;

  for (const { task, body } of items) {
    const mapped = statusToIssueState(task.status as TaskStatus);
    const combinedLabels = [...new Set([...defaultLabels, ...mapped.labels])];

    // Build dependency-enriched body
    const enrichedBody = buildIssueBody(task as Task, body, taskIndex, allTasks);

    if (task.githubIssue !== undefined) {
      // Update existing issue
      updateIssue(task.githubIssue, task, enrichedBody, combinedLabels);

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
      const issueNumber = createIssue(task, enrichedBody, defaultLabels);
      updateFrontmatter(task.id, { githubIssue: issueNumber });

      const isTerminal = task.status === "done" || task.status === "cancelled";
      if (isTerminal) {
        closeIssue(issueNumber);
      }

      // Update the taskIndex with the new issue number so later tasks can reference it
      taskIndex.set(task.id, { title: task.title, githubIssue: issueNumber });

      // Post cross-reference dependency comments
      try {
        postDependencyComments(task as Task, issueNumber, taskIndex, allTasks);
      } catch (e: any) {
        // Non-blocking: dependency comments are nice-to-have
        console.error(yellow(`  ⚠ Failed to post dependency comments: ${e.message}`));
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
    remoteMap.set(issue.number, { ...issue, state: issue.state.toLowerCase() });
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
    remoteMap.set(issue.number, { ...issue, state: issue.state.toLowerCase() });
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
