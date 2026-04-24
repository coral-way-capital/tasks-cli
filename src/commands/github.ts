import { loadConfig, saveConfig, ensureGithubPrerequisites } from "../lib/config";
import { isGhInstalled, getRepoInfo, listIssues, statusToIssueState } from "../lib/github";
import { listTasks } from "../lib/store";
import { bold, dim, red, green, yellow, padRight } from "../lib/format";

export function run(args: string[]): void {
  const subcommand = args[0];

  switch (subcommand) {
    case "enable":
      cmdEnable();
      break;
    case "disable":
      cmdDisable();
      break;
    case "status":
      cmdStatus();
      break;
    default:
      cmdShow();
      break;
  }
}

function cmdShow(): void {
  // gh CLI
  const ghOk = isGhInstalled();
  console.log(`${bold("gh CLI:")}       ${ghOk ? green("installed") : red("not found")}`);

  // GitHub repo
  const repo = getRepoInfo();
  console.log(
    `${bold("GitHub repo:")}  ${repo ? green(`${repo.owner}/${repo.repo}`) : red("not detected")}`
  );

  // Integration
  const config = loadConfig();
  const enabled = !!config.github?.enabled;
  console.log(`${bold("Integration:")}  ${enabled ? green("enabled") : dim("disabled")}`);

  if (enabled) {
    // Auto-sync
    const autoSync = config.github?.autoSync ?? false;
    console.log(`${bold("Auto-sync:")}    ${autoSync ? green("enabled") : dim("disabled")}`);

    // Default labels
    const labels = config.github?.labels ?? ["task"];
    console.log(`${bold("Default labels:")} ${labels.join(", ")}`);

    // Linked tasks
    const tasks = listTasks().map((t) => t.task);
    const linked = tasks.filter((t) => t.githubIssue !== undefined);

    console.log(``);
    console.log(`${bold(`Linked tasks: ${linked.length}`)}`);

    if (linked.length > 0 && ghOk && repo) {
      const header = [
        bold(padRight("ID", 10)),
        bold(padRight("ISSUE#", 8)),
        bold("TITLE"),
      ].join("  ");
      console.log(header);
      for (const t of linked) {
        console.log(
          [padRight(t.id, 10), padRight(`#${t.githubIssue}`, 8), t.title].join("  ")
        );
      }
    }
  }
}

function cmdEnable(): void {
  const result = ensureGithubPrerequisites();
  if (typeof result === "string") {
    console.error(red(result));
    process.exit(1);
  }

  const config = loadConfig();
  if (!config.github) {
    config.github = { enabled: true };
  }
  config.github.enabled = true;
  if (!config.github.labels) {
    config.github.labels = ["task"];
  }
  if (config.github.autoSync === undefined) {
    config.github.autoSync = false;
  }
  saveConfig(config);

  console.log(green("✓ GitHub integration enabled"));
  console.log(`  Repository: ${result.owner}/${result.repo}`);
  console.log(dim("Run 'tasks sync push' to create issues from existing tasks."));
}

function cmdDisable(): void {
  const config = loadConfig();
  if (!config.github) {
    config.github = { enabled: false };
  }
  config.github.enabled = false;
  saveConfig(config);

  console.log(yellow("GitHub integration disabled."));
  console.log(
    dim("Existing GitHub issues will not be removed. Run 'tasks github enable' to re-enable.")
  );
}

function cmdStatus(): void {
  const config = loadConfig();
  const enabled = !!config.github?.enabled;

  if (!enabled) {
    console.log(dim("GitHub integration is disabled."));
    return;
  }

  const prereq = ensureGithubPrerequisites();
  if (typeof prereq === "string") {
    console.error(red(prereq));
    return;
  }

  // Fetch remote issues and local tasks
  let remoteIssues: { number: number; title: string; state: string; labels: string[] }[];
  try {
    remoteIssues = listIssues();
  } catch (e: any) {
    console.error(red(`Failed to list issues: ${e.message}`));
    return;
  }

  const localTasks = listTasks().map((t) => t.task);

  // Build lookup for remote issues by number
  const remoteByNumber = new Map<number, { number: number; title: string; state: string; labels: string[] }>();
  for (const issue of remoteIssues) {
    remoteByNumber.set(issue.number, issue);
  }

  // Linked tasks
  const linked = localTasks.filter((t) => t.githubIssue !== undefined);
  const linkedIssueNumbers = new Set(linked.map((t) => t.githubIssue!));

  // --- Linked tasks section ---
  console.log(``);
  console.log(bold(`Linked tasks (${linked.length}):`));

  if (linked.length > 0) {
    const header = [
      bold(padRight("ID", 10)),
      bold(padRight("ISSUE#", 8)),
      bold(padRight("LOCAL STATUS", 14)),
      bold(padRight("REMOTE STATE", 14)),
      bold(""),
    ].join("  ");
    console.log(header);

    for (const t of linked) {
      const issueNum = t.githubIssue!;
      const remote = remoteByNumber.get(issueNum);
      const localMapped = statusToIssueState(t.status);
      const remoteState = remote?.state ?? "unknown";
      const inSync = localMapped.state === remoteState;
      const indicator = inSync ? green("✓") : yellow("⚠");

      const row = [
        padRight(t.id, 10),
        padRight(`#${issueNum}`, 8),
        padRight(t.status, 14),
        padRight(remoteState, 14),
        indicator,
      ].join("  ");
      console.log(row);
    }
  }

  // --- Unlinked local tasks section ---
  const unlinked = localTasks.filter((t) => t.githubIssue === undefined);
  console.log(``);
  console.log(bold(`Unlinked local tasks (${unlinked.length}):`));

  if (unlinked.length > 0) {
    const header = [bold(padRight("ID", 10)), bold("TITLE")].join("  ");
    console.log(header);
    for (const t of unlinked) {
      console.log([padRight(t.id, 10), t.title].join("  "));
    }
  }

  // --- Orphaned remote issues section ---
  const orphans = remoteIssues.filter((issue) => !linkedIssueNumbers.has(issue.number));
  console.log(``);
  console.log(bold(`Orphaned remote issues (${orphans.length}):`));

  if (orphans.length > 0) {
    const header = [bold(padRight("ISSUE#", 8)), bold("TITLE")].join("  ");
    console.log(header);
    for (const issue of orphans) {
      console.log([padRight(`#${issue.number}`, 8), issue.title].join("  "));
    }
  }
}
