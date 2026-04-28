/**
 * Auto-sync helper: pushes a single task to GitHub after local mutations.
 * Called by new/status/done/edit commands when autoSync is enabled.
 */
import { isGithubEnabled, loadConfig, ensureGithubPrerequisites } from "../lib/config";
import { createIssue, updateIssue, closeIssue, reopenIssue, listIssues, commentOnIssue, statusToIssueState } from "../lib/github";
import { listTasks, readTask, updateFrontmatter } from "../lib/store";
import { dim, yellow } from "../lib/format";
import type { Task } from "../types";

/**
 * Build dependency-enriched body for a single task auto-sync.
 * Resolves the full task list to build dependency cross-references.
 */
function buildEnrichedBody(task: Task, rawBody: string): string {
  const allItems = listTasks();
  const allTasks = allItems.map((i) => i.task as Task);
  const index = new Map<string, { title: string; githubIssue?: number }>();
  for (const { task: t } of allItems) {
    index.set(t.id, { title: t.title, githubIssue: t.githubIssue });
  }

  const sections: string[] = [];

  if (task.dependsOn.length > 0) {
    const lines = ["## Dependencies", "", "This task depends on:"];
    for (const depId of task.dependsOn) {
      const dep = index.get(depId);
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

  const blockedBy = allTasks.filter((t) => t.dependsOn.includes(task.id));
  if (blockedBy.length > 0) {
    const lines = ["## Blocks", "", "The following tasks depend on this one:"];
    for (const b of blockedBy) {
      const bInfo = index.get(b.id);
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
 * If GitHub integration + autoSync are enabled, push the given task to GitHub.
 * Silently skips if prerequisites aren't met or integration is off.
 */
export function autoSyncTask(taskId: string): void {
  if (!isGithubEnabled()) return;

  const config = loadConfig();
  if (!config.github?.autoSync) return;

  const prereq = ensureGithubPrerequisites();
  if (typeof prereq === "string") {
    // Prerequisites not met — silently skip (don't spam errors on every command)
    return;
  }

  try {
    const { task, body } = readTask(taskId);
    const defaultLabels = config.github?.labels ?? ["task"];
    const { state, labels } = statusToIssueState(task.status);
    const combinedLabels = [...new Set([...defaultLabels, ...labels])];

    // Build dependency-enriched body
    const enrichedBody = buildEnrichedBody(task as Task, body);

    // Fetch remote issues for state comparison
    let remoteStateMap: Map<number, string> | null = null;
    try {
      const issues = listIssues();
      remoteStateMap = new Map(issues.map((i) => [i.number, i.state.toLowerCase()]));
    } catch {
      // If we can't list issues, we'll just push without state sync
    }

    if (task.githubIssue !== undefined) {
      // Update existing issue
      updateIssue(task.githubIssue, task, enrichedBody, combinedLabels);

      // Sync open/closed state
      if (remoteStateMap) {
        const remoteState = remoteStateMap.get(task.githubIssue);
        if (remoteState && remoteState !== state) {
          if (state === "closed" && remoteState === "open") {
            closeIssue(task.githubIssue);
          } else if (state === "open" && remoteState === "closed") {
            reopenIssue(task.githubIssue);
          }
        }
      }

      console.log(dim(`  ↗ Synced to GitHub issue #${task.githubIssue}`));
    } else {
      // Create new issue
      const issueNumber = createIssue(task, enrichedBody, combinedLabels);

      // If task is already done/cancelled, close it immediately
      if (state === "closed") {
        try {
          closeIssue(issueNumber);
        } catch {
          // Best effort
        }
      }

      // Persist the link
      const { updateFrontmatter } = require("../lib/store");
      updateFrontmatter(taskId, { githubIssue: issueNumber });

      console.log(dim(`  ↗ Created GitHub issue #${issueNumber}`));
    }
  } catch (e: any) {
    // Auto-sync failures should not break the primary command.
    // Print a warning but don't exit.
    console.error(yellow(`  ⚠ Auto-sync failed: ${e.message}`));
  }
}
